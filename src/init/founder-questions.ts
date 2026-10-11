import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";
import { questionsRecordSchema, type FounderQuestion, type QuestionsRecord } from "../schemas/founder-questions.js";
import { appendToDecisionLog, nextId, readDecisionLog, type DecidedStack, type LogAdditions, type LogHeadings } from "./decide-log.js";
import { questionsFile, readAnswer, renderQuestions, unreadLine, writtenAnswers } from "./founder-questions-file.js";

/**
 * C-3⁶ (PRDR-340) — the founder's questions: asked where they are found,
 * recorded open, and never waited on.
 *
 * A phase that finds a decision only the founder can make records it here as
 * `Q-n` and goes on. Code reads `.detent/questions.md` at each phase boundary
 * (`runInit`), and writes each answer it finds to the decision log as a `D-n`,
 * with the question, the answer and the reason, as a terminal's answer at
 * DECIDE is written. The question is then answered, and names its `D-n`; an
 * item it settles is settled by that entry while the log holds it, as by any
 * other (C-2¹²).
 */

const RECORD = "state/questions.json";

const squash = (text: string): string => text.replace(/\s+/gu, " ").trim();

export function readQuestions(root: string): QuestionsRecord {
  const empty: QuestionsRecord = { schema_version: SCHEMA_VERSION, questions: [] };
  const file = path.join(stateDir(root), ...RECORD.split("/"));
  if (!existsSync(file)) return empty;
  try {
    const parsed = parseArtifact(questionsRecordSchema, JSON.parse(readFileSync(file, "utf8")) as unknown);
    return parsed.ok ? parsed.value : empty;
  } catch {
    return empty;
  }
}

/** The file as `record` renders it, keeping `written`; true when the disk changed. */
function render(root: string, record: QuestionsRecord, written: ReadonlyMap<string, string>, unread: ReadonlyMap<string, string>): boolean {
  const file = questionsFile(root);
  const text = renderQuestions(record, written, unread);
  if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return true;
}

const writtenNow = (root: string): Map<string, string> =>
  existsSync(questionsFile(root)) ? writtenAnswers(readFileSync(questionsFile(root), "utf8")) : new Map<string, string>();

/** A question to record: its id where the session that asked it cited one already (PRDR-341), else the next free one. */
export type NewQuestion = Omit<FounderQuestion, "id" | "decision"> & { readonly id?: string };

/** Record `asked` open, each under its own id or numbered after every question the record holds, and render the file. */
export function askQuestions(root: string, asked: readonly NewQuestion[]): FounderQuestion[] {
  if (asked.length === 0) return [];
  const record = readQuestions(root);
  const used = new Set(record.questions.map((q) => q.id));
  let top = Math.max(0, ...[...used, ...asked.flatMap((q) => (q.id === undefined ? [] : [q.id]))].map((id) => Number(id.slice(2))));
  const added: FounderQuestion[] = asked.map((q) => {
    const id = q.id ?? `Q-${String((top += 1))}`;
    if (used.has(id)) throw new Error(`${id} is asked already: a question's id is never reused (C-3⁶)`);
    used.add(id);
    return { ...q, id, decision: null };
  });
  const next: QuestionsRecord = { ...record, questions: [...record.questions, ...added] };
  writeArtifact(root, RECORD, next);
  render(root, next, writtenNow(root), new Map());
  return added;
}

/** Point each open question at the places that now depend on it, where any do, and render the file (PRDR-341). */
export function placeQuestions(root: string, places: ReadonlyMap<string, readonly { file: string; line: number }[]>): void {
  const record = readQuestions(root);
  const moved = record.questions.map((q) => (q.decision === null && places.has(q.id) ? { ...q, places: [...(places.get(q.id) ?? [])] } : q));
  if (JSON.stringify(moved) === JSON.stringify(record.questions)) return;
  const next: QuestionsRecord = { ...record, questions: moved };
  writeArtifact(root, RECORD, next);
  render(root, next, writtenNow(root), new Map());
}

/** The questions still open. */
export const openQuestions = (record: QuestionsRecord): FounderQuestion[] => record.questions.filter((q) => q.decision === null);

/** An entry as it stands now: a question that was answered stands for the `D-n` its answer became. */
export function standingEntry(record: QuestionsRecord, entry: string): string {
  return record.questions.find((q) => q.id === entry)?.decision ?? entry;
}

export const ANSWERED_HEADINGS: LogHeadings = { asked: "Answered in .detent/questions.md", settled: "Answered in .detent/questions.md" };

/**
 * Write each answer the questions file holds to the decision log, and say
 * what was written and what could not be read. An answer already in the log,
 * as a question an earlier boundary wrote before it could record the answer,
 * is not written twice. A note on an answer that could not be read is said
 * once: the file says it after that.
 */
export function applyAnswers(root: string): string[] {
  const record = readQuestions(root);
  if (record.questions.length === 0) return [];
  const before = existsSync(questionsFile(root)) ? readFileSync(questionsFile(root), "utf8") : "";
  const written = writtenAnswers(before);
  const log = readDecisionLog(root);
  const nextD = nextId(log.ids, "D");
  const decisions: LogAdditions["decisions"][number][] = [];
  let stack: DecidedStack | null = null;
  const answered = new Map<string, string>();
  const unread = new Map<string, string>();
  const notes: string[] = [];
  for (const q of openQuestions(record)) {
    const answer = readAnswer(q, written.get(q.id) ?? "");
    if (answer.kind === "none") continue;
    if (answer.kind === "unread") {
      unread.set(q.id, answer.why);
      if (!before.includes(unreadLine(q, answer.why))) notes.push(`${q.id}: Detent could not read its answer, since ${answer.why}; it stays open (C-3⁶)`);
      continue;
    }
    const option = answer.kind === "option" ? q.options[answer.index] : undefined;
    const value = option?.answer ?? (answer.kind === "own" ? answer.text : "");
    const logged = log.decisions.find((d) => squash(d.question) === squash(q.question));
    const id = logged?.id ?? nextD(decisions.length);
    answered.set(q.id, id);
    notes.push(`${q.id} is answered, and ${id} records it in ${DECISION_LOG_PATH}: ${squash(q.question)} → ${squash(value)} (C-3⁶)`);
    if (logged !== undefined) continue;
    decisions.push({
      id,
      question: q.question,
      answer: value,
      reason: option?.consequence ?? "The founder's own answer, given in .detent/questions.md.",
    });
    if (option?.stack !== undefined) stack = { ...option.stack, decision: id };
  }
  appendToDecisionLog(root, log, { decisions, defaults: [], stack }, ANSWERED_HEADINGS);
  const next: QuestionsRecord = { ...record, questions: record.questions.map((q) => ({ ...q, decision: answered.get(q.id) ?? q.decision })) };
  if (answered.size > 0) writeArtifact(root, RECORD, next);
  render(root, next, written, unread);
  return notes;
}
