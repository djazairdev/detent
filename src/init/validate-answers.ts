import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FounderQuestion } from "../schemas/founder-questions.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";
import type { FixArtifact } from "../schemas/validate.js";
import { readDecisionLog } from "./decide-log.js";
import { applyAnswers, readQuestions, unreadAnswer, updateQuestions } from "./founder-questions.js";
import { questionNote, readAnswer } from "./founder-questions-file.js";
import { DECISION_REF, QUESTION_REF } from "./pack-check-refs.js";
import { packDocuments, packHash, readConformanceRecord, writeConformanceRecord } from "./pack.js";
import { askFindings } from "./validate-asks.js";
import { packPathFiles } from "./write-tree.js";
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
 * its `Q-n` is cited and where its question records, and cites its `D-n`
 * there; and an answer moves no round's scope by itself, since it is the
 * founder's and never a defect: the round after reviews the places the writer
 * changed, and what cites them.
 *
 * #45: a question VALIDATE's writer asks is cited nowhere in the pack, and
 * records the places its findings were found at. Code read only the `Q-n`
 * cites, so on Hearth four such answers reached the writer as none and were
 * marked applied, though none was. An answer's places are now both, and it
 * stays unapplied until each document among them cites its `D-n`.
 */

/** An answer for the writer to apply: its question, its decision, and every place it applies. */
export interface Answer {
  readonly id: string;
  readonly decision: string;
  readonly question: string;
  readonly answer: string;
  readonly places: readonly { readonly file: string; readonly line: number }[];
}

type Place = { file: string; line: number };

/**
 * Every place the pack's documents cite each question, by its id. The
 * decision log is left out: the writer changes none of its rows, so a row
 * that names a question is the log's own record, not a place to apply it.
 */
export function questionCites(root: string): Map<string, Place[]> {
  const out = new Map<string, Place[]>();
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

/** #45: the documents the writer may apply an answer in: the pack's paths, but the log, as `questionCites` leaves it out. */
const writable = (root: string): Set<string> => new Set(packPathFiles(root).filter((d) => d !== DECISION_LOG_PATH));

/** The documents the writer may change that cite each decision or default, by its id. */
function decisionCites(root: string, docs: ReadonlySet<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const pattern = new RegExp(DECISION_REF.source, "gu");
  for (const rel of docs) {
    for (const m of readFileSync(path.join(root, ...rel.split("/")), "utf8").matchAll(pattern)) out.set(m[0], (out.get(m[0]) ?? new Set<string>()).add(rel));
  }
  return out;
}

/**
 * #45: every place a question's answer applies, each once: where the pack
 * cites the question, and where the question records, those its findings,
 * and any attached to it, were found at. A recorded place in a document the
 * writer may not change, the log, an original DECIDE quoted, or one gone, is
 * none.
 */
function answerPlaces(q: FounderQuestion, cites: ReadonlyMap<string, readonly Place[]>, docs: ReadonlySet<string>): Place[] {
  const all = [...(cites.get(q.id) ?? []), ...q.places.filter((p) => docs.has(p.file))];
  return all.filter((p, i) => all.findIndex((o) => o.file === p.file && o.line === p.line) === i).map((p) => ({ file: p.file, line: p.line }));
}

/**
 * The answered questions whose answers wait to be applied, each at the places
 * it applies. One with no place in the pack is marked applied, since nothing
 * in the pack waits on it.
 */
export function pendingAnswers(root: string): Answer[] {
  const waiting = readQuestions(root).questions.filter((q) => q.decision !== null && !q.applied);
  if (waiting.length === 0) return [];
  const cites = questionCites(root);
  const docs = writable(root);
  const placed = new Map(waiting.map((q) => [q.id, answerPlaces(q, cites, docs)]));
  const nowhere = waiting.filter((q) => (placed.get(q.id) ?? []).length === 0).map((q) => q.id);
  if (nowhere.length > 0) updateQuestions(root, (q) => (nowhere.includes(q.id) ? { ...q, applied: true } : q));
  const log = readDecisionLog(root).decisions;
  return waiting
    .filter((q) => !nowhere.includes(q.id))
    .map((q) => ({
      id: q.id,
      decision: q.decision ?? "",
      question: q.question,
      /* The answer as the founder gave it, without the bold the log writes it in. */
      answer: (log.find((d) => d.id === q.decision)?.answer ?? "").replace(/\*\*/gu, ""),
      places: placed.get(q.id) ?? [],
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

/**
 * What leaves each answer the writer was given unapplied: each place the pack
 * still cites its question, and each document among its places, one that
 * cites the question no longer, that does not cite its decision (#45).
 */
function unappliedBy(root: string): (a: Answer) => string[] {
  const cites = questionCites(root);
  const docs = writable(root);
  const decided = decisionCites(root, docs);
  return (a) => {
    const still = cites.get(a.id) ?? [];
    const files = [...new Set(a.places.map((p) => p.file))].filter((f) => docs.has(f) && !still.some((p) => p.file === f) && !(decided.get(a.decision)?.has(f) ?? false));
    return [
      ...still.map((p) => `${a.id} is answered as ${a.decision}, and ${p.file}:${String(p.line)} still cites ${a.id}: apply its answer there, and cite ${a.decision} in its place (C-3⁶)`),
      ...files.map((f) => {
        const at = a.places.filter((p) => p.file === f).map((p) => `${p.file}:${String(p.line)}`);
        return `${a.id} is answered as ${a.decision}, and ${f} does not cite ${a.decision}: apply its answer at ${at.join(", ")}, and cite ${a.decision} there (C-3⁶)`;
      }),
    ];
  };
}

/** Each place an answer the writer was given is not yet applied at. */
export function answerIssues(root: string, given: readonly Answer[]): string[] {
  if (given.length === 0) return [];
  return given.flatMap(unappliedBy(root));
}

/** Mark applied each answer the writer was given that is applied at every place it applies and that still stands, and return their ids. */
export function markApplied(root: string, given: readonly Answer[]): string[] {
  if (given.length === 0) return [];
  const unapplied = unappliedBy(root);
  const standing = new Set(readQuestions(root).questions.filter((q) => q.decision !== null).map((q) => q.id));
  const done = given.filter((a) => standing.has(a.id) && unapplied(a).length === 0).map((a) => a.id);
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
