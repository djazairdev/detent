import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FounderQuestion } from "../schemas/founder-questions.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";
import type { FixArtifact } from "../schemas/validate.js";
import { readDecisionLog } from "./decide-log.js";
import { applyAnswers, readQuestions, unreadAnswer, updateQuestions } from "./founder-questions.js";
import { questionNote, readAnswer } from "./founder-questions-file.js";
import { QUESTION_REF } from "./pack-check-refs.js";
import { packDocuments, packHash, readConformanceRecord, writeConformanceRecord } from "./pack.js";
import { askFindings } from "./validate-asks.js";
import type { Outcome } from "./validate-checks.js";

/**
 * C-3⁶, C-2²⁹ (PRDR-343) — the founder's answers, applied inside VALIDATE.
 *
 * PRDR-340 read the answers at each phase boundary only, so one given while
 * VALIDATE ran waited for the next `detent init`, and one written to the log
 * at a boundary moved the log, so the round after reviewed every document
 * that cites any decision: on Hearth, four answers given during a stop made
 * the resumed round review all 23 areas again, about $189. Code now reads the
 * answers before each round's writer, before its first batch, so no batch's
 * restore or rollback of the log undoes one; the writer applies each where
 * its `Q-n` is cited and cites its `D-n` there; and an answer moves no
 * round's scope by itself, since it is the founder's and never a defect: the
 * round after reviews the places the writer changed, and what cites them.
 */

/** An answer for the writer to apply: its question, its decision, and every place the pack cites the question. */
export interface Answer {
  readonly id: string;
  readonly decision: string;
  readonly question: string;
  readonly answer: string;
  readonly places: readonly { readonly file: string; readonly line: number }[];
}

/**
 * Every place the pack's documents cite each question, by its id. The
 * decision log is left out: the writer changes none of its rows, so a row
 * that names a question is the log's own record, not a place to apply it.
 */
export function questionCites(root: string): Map<string, { file: string; line: number }[]> {
  const out = new Map<string, { file: string; line: number }[]>();
  const pattern = new RegExp(QUESTION_REF.source, "gu");
  for (const rel of packDocuments(root).filter((d) => d !== DECISION_LOG_PATH)) {
    readFileSync(path.join(root, ...rel.split("/")), "utf8")
      .split("\n")
      .forEach((text, i) => {
        for (const id of new Set([...text.matchAll(pattern)].map((m) => m[0]))) out.set(id, [...(out.get(id) ?? []), { file: rel, line: i + 1 }]);
      });
  }
  return out;
}

/**
 * The answered questions whose answers wait to be applied, each at the places
 * the pack cites it. One the pack cites nowhere is marked applied, since
 * nothing in the pack waits on it.
 */
export function pendingAnswers(root: string): Answer[] {
  const waiting = readQuestions(root).questions.filter((q) => q.decision !== null && !q.applied);
  if (waiting.length === 0) return [];
  const cites = questionCites(root);
  const nowhere = waiting.filter((q) => !cites.has(q.id)).map((q) => q.id);
  if (nowhere.length > 0) updateQuestions(root, (q) => (nowhere.includes(q.id) ? { ...q, applied: true } : q));
  const log = readDecisionLog(root).decisions;
  return waiting
    .filter((q) => cites.has(q.id))
    .map((q) => ({
      id: q.id,
      decision: q.decision ?? "",
      question: q.question,
      /* The answer as the founder gave it, without the bold the log writes it in. */
      answer: (log.find((d) => d.id === q.decision)?.answer ?? "").replace(/\*\*/gu, ""),
      places: cites.get(q.id) ?? [],
    }));
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Write the answers given since to the decision log (PRDR-340), and, where
 * the conformance record held the log as it was, hold it as it is: an answer
 * moves no round's scope by itself, and the places that cite its question are
 * what the round after the writer applies it reviews. An edit to the log by
 * anyone else still moves it, as before. Each phase boundary writes answers
 * through here too, so an answer given while a run is stopped moves nothing.
 */
export function answerIntoLog(root: string): string[] {
  const file = path.join(root, ...DECISION_LOG_PATH.split("/"));
  const hashed = (): string | null => (existsSync(file) ? sha256(readFileSync(file)) : null);
  const was = hashed();
  const notes = applyAnswers(root);
  const now = hashed();
  if (was === null || now === null || now === was) return notes;
  let record: ReturnType<typeof readConformanceRecord>;
  try {
    record = readConformanceRecord(root);
  } catch {
    return notes;
  }
  if (record?.documents[DECISION_LOG_PATH] !== was) return notes;
  const documents = { ...record.documents, [DECISION_LOG_PATH]: now };
  writeConformanceRecord(root, { ...record, documents, hash: packHash(documents) });
  return notes;
}

/** Before a round's writer: the answers given since, written to the log and said, and those that wait to be applied. */
export function takeAnswers(root: string, note?: (text: string) => void): Answer[] {
  for (const text of answerIntoLog(root)) note?.(text);
  return pendingAnswers(root);
}

/** Each place the pack still cites a question whose answer the writer was given. */
export function answerIssues(root: string, given: readonly Answer[]): string[] {
  if (given.length === 0) return [];
  const cites = questionCites(root);
  return given.flatMap((a) =>
    (cites.get(a.id) ?? []).map((p) => `${a.id} is answered as ${a.decision}, and ${p.file}:${String(p.line)} still cites ${a.id}: apply its answer there, and cite ${a.decision} in its place (C-3⁶)`),
  );
}

/** Mark applied each answer the writer was given that the pack no longer cites and that still stands, and return their ids. */
export function markApplied(root: string, given: readonly Answer[]): string[] {
  if (given.length === 0) return [];
  const cites = questionCites(root);
  const standing = new Set(readQuestions(root).questions.filter((q) => q.decision !== null).map((q) => q.id));
  const done = given.filter((a) => !cites.has(a.id) && standing.has(a.id)).map((a) => a.id);
  if (done.length > 0) updateQuestions(root, (q) => (done.includes(q.id) ? { ...q, applied: true } : q));
  return done;
}

const settlesStack = (q: FounderQuestion): boolean => q.options.some((o) => o.stack !== undefined);

/** The writer's corrections against the record: each of a question asked, whose answer is not yet applied, and none of the stack's. */
export function correctionIssues(root: string, artifact: FixArtifact): string[] {
  const record = readQuestions(root);
  return artifact.corrected.flatMap((c) => {
    const q = record.questions.find((x) => x.id === c.id);
    if (q === undefined) return [`${c.id} is no question asked, so there is nothing to correct`];
    if (q.applied) return [`${c.id} is answered as ${q.decision ?? ""} and applied to the pack, so a correction comes too late: ask the decision again as a question of its own`];
    if (settlesStack(q)) return [`${c.id} settles the stack, which only DECIDE asks (D-10′): ask a question of your own rather than correct it`];
    return [];
  });
}

/** An answer as the founder gave it to a question, for the note that puts it back. */
function givenTo(q: FounderQuestion, written: string, logged: string | undefined): string {
  if (q.decision !== null) return `${(logged ?? "").replace(/\*\*/gu, "")} (recorded as ${q.decision})`.trim();
  const read = readAnswer(q, written);
  if (read.kind === "option") return `option ${String(read.index + 1)}, ${q.options[read.index]?.answer ?? ""}`;
  return read.kind === "own" ? read.text : written.trim();
}

/**
 * Each corrected question as it reads now, open again, and an answer given to
 * its earlier wording put back to the founder, never applied: one the log
 * holds as a `D-n` stays there as the founder gave it, since the log keeps
 * what it holds, and nothing applies it; one written in the file and not yet
 * read is taken out of the file. Returns the questions corrected.
 */
export function correctQuestions(root: string, artifact: FixArtifact): FounderQuestion[] {
  if (artifact.corrected.length === 0 || correctionIssues(root, artifact).length === artifact.corrected.length) return [];
  const record = readQuestions(root);
  const log = readDecisionLog(root).decisions;
  const changes = new Map<string, FounderQuestion>();
  for (const c of artifact.corrected) {
    const q = record.questions.find((x) => x.id === c.id);
    if (q === undefined || q.applied || settlesStack(q)) continue;
    const given = givenTo(q, unreadAnswer(root, q.id), log.find((d) => d.id === q.decision)?.answer);
    const put_back = given === "" ? q.put_back : given;
    changes.set(q.id, { ...q, question: c.question, why_asked: c.why_asked, options: c.options, decision: null, applied: false, put_back });
  }
  updateQuestions(root, (q) => changes.get(q.id) ?? q, [...changes.keys()]);
  return [...changes.values()];
}

/**
 * After a writer's account is taken: what it asked and what it corrected,
 * recorded and said, and the outcome of each finding either settles, which
 * stands whether the batch's fixes do or not, since a question is the
 * founder's whatever became of the patches beside it. A finding settled by a
 * correction is applied: its fix is in the questions, where the round after's
 * reviewers read it.
 */
export function settleQuestions(root: string, stage: string, artifact: FixArtifact, findings: Parameters<typeof askFindings>[2], note?: (text: string) => void): Map<string, Outcome> {
  const waiting = askFindings(root, artifact, findings);
  const n = (count: number, one: string): string => `${String(count)} ${one}${count === 1 ? "" : "s"}`;
  if (waiting.asked.length > 0) {
    note?.([`${stage}: asks the founder ${n(waiting.asked.length, "question")}, recorded in .detent/questions.md, and patches none of the findings asked (C-2²⁹):`, ...waiting.asked.map(questionNote)].join("\n"));
  }
  const reasked = correctQuestions(root, artifact);
  if (reasked.length > 0) {
    const shown = reasked.map((q) => [questionNote(q), ...(q.put_back === null ? [] : [`     put back to you, not applied: ${q.put_back}, given to its earlier wording`])].join("\n"));
    note?.([`${stage}: corrects ${n(reasked.length, "question")} a reviewer found wrong, and asks the founder again, in .detent/questions.md (C-3⁶):`, ...shown].join("\n"));
  }
  const outcome = new Map(waiting.outcome);
  const fixed = new Set(reasked.map((q) => q.id));
  for (const c of artifact.corrected) if (fixed.has(c.id)) for (const id of c.findings) outcome.set(id, { left: "applied", reason: "" });
  return outcome;
}
