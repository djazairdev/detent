import path from "node:path";
import { stateDir } from "../fs/layout.js";
import type { FounderQuestion, QuestionsRecord } from "../schemas/founder-questions.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";

/**
 * C-3⁶ (PRDR-340) — `.detent/questions.md`, the founder's side of the
 * questions record.
 *
 * Code renders it from the record, and reads back only what follows each
 * question's `Answer:`: an option's number, or the founder's own words where
 * the question takes them. A render keeps every answer the founder wrote, so it
 * never loses one, and says beside an answer it could not read why.
 */

export const QUESTIONS_FILE = "questions.md";

export const questionsFile = (root: string): string => path.join(stateDir(root), QUESTIONS_FILE);

export type ReadAnswer =
  | { readonly kind: "none" }
  | { readonly kind: "option"; readonly index: number }
  | { readonly kind: "own"; readonly text: string }
  | { readonly kind: "unread"; readonly why: string };

const QUESTION_HEADING = /^##\s+(Q-\d+)\b/u;
const OTHER_HEADING = /^#{1,2}\s/u;
const ANSWER = /^answer:(.*)$/iu;
const NUMBER = /^(?:option\s*)?(\d+)[.)]?$/iu;

const squash = (text: string): string => text.replace(/\s+/gu, " ").trim();

/** What the founder wrote after each question's `Answer:`, by its id: every line up to the next heading. */
export function writtenAnswers(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let id: string | null = null;
  let answer: string[] | null = null;
  const flush = (): void => {
    if (id !== null && answer !== null) out.set(id, answer.join("\n").trim());
  };
  for (const line of text.split(/\r?\n/u)) {
    const heading = QUESTION_HEADING.exec(line)?.[1];
    if (heading !== undefined || OTHER_HEADING.test(line)) {
      flush();
      id = heading ?? null;
      answer = null;
    } else if (id !== null && answer === null) {
      const first = ANSWER.exec(line.trim())?.[1];
      if (first !== undefined) answer = [first];
    } else if (answer !== null) {
      answer.push(line);
    }
  }
  flush();
  return out;
}

/** An answer as written, read against its question. */
export function readAnswer(q: FounderQuestion, written: string): ReadAnswer {
  const text = squash(written);
  if (text === "") return { kind: "none" };
  const n = NUMBER.exec(text)?.[1];
  if (n !== undefined) {
    const index = Number(n) - 1;
    if (index >= 0 && index < q.options.length) return { kind: "option", index };
    return { kind: "unread", why: `it names option ${n}, and ${q.id} has ${String(q.options.length)}` };
  }
  if (q.own_allowed) return { kind: "own", text };
  return { kind: "unread", why: `it names no option, and ${q.id} takes only an option's number, 1 to ${String(q.options.length)}` };
}

const options = (q: FounderQuestion): string[] =>
  q.options.map((o, i) => `${String(i + 1)}) ${squash(o.answer)}${i === 0 ? " (recommended)" : ""} — ${squash(o.consequence)} (rests on: ${squash(o.basis)})`);

/** One question as the terminal prints it when it is recorded. */
export function questionNote(q: FounderQuestion): string {
  return [
    `  ${q.id} (asked at ${q.phase}): ${squash(q.question)}`,
    `     why it is yours: ${squash(q.why_asked)}`,
    ...options(q).map((line) => `     ${line}`),
    ...(q.places.length === 0 ? [] : [`     depends on it: ${q.places.map((p) => `${p.file}:${String(p.line)}`).join(", ")}`]),
  ].join("\n");
}

export const unreadLine = (q: FounderQuestion, why: string): string => `> Detent could not read the answer below: ${why}. ${q.id} stays open.`;

/** PRDR-343: what the file says of an answer given to a question's earlier wording. */
export const putBackLine = (q: FounderQuestion): string =>
  `> A review corrected this question after an answer was given to its earlier wording: ${squash(q.put_back ?? "")}. Detent did not apply it; answer the question as it reads now.`;

function block(q: FounderQuestion, written: string, unread: string | undefined): string[] {
  const status = q.decision === null ? "open" : `answered as ${q.decision}${q.applied ? ", applied to the pack" : ""}`;
  const how =
    q.decision !== null
      ? `Recorded as ${q.decision} in ${DECISION_LOG_PATH}. To change it, edit that row, and re-run \`detent init\`.`
      : q.own_allowed
        ? "Answer with an option's number, or in your own words."
        : "Answer with an option's number.";
  return [
    "",
    `## ${q.id} — ${status} (asked at ${q.phase})`,
    "",
    squash(q.question),
    "",
    `Why it is yours: ${squash(q.why_asked)}`,
    "",
    ...options(q),
    ...(q.places.length === 0 ? [] : ["", `Depends on it: ${q.places.map((p) => `${p.file}:${String(p.line)}`).join(", ")}`]),
    "",
    how,
    ...(q.put_back === null ? [] : ["", putBackLine(q)]),
    ...(unread === undefined ? [] : ["", unreadLine(q, unread)]),
    "",
    `Answer: ${written}`.trimEnd(),
  ];
}

/** The file, from the record, with what the founder wrote after each `Answer:` kept, and why an answer could not be read beside it. */
export function renderQuestions(record: QuestionsRecord, written: ReadonlyMap<string, string>, unread: ReadonlyMap<string, string>): string {
  const open = record.questions.filter((q) => q.decision === null).length;
  return [
    "# Questions for the founder",
    "",
    "Detent asks these because each is yours to decide (C-3⁶). `detent init` does not wait for them: it goes on with",
    "everything that does not depend on an answer.",
    "",
    "Answer after a question's `Answer:`, with an option's number or, where the question takes them, your own words.",
    `\`detent init\` reads this file at each phase boundary, and before each writer of VALIDATE's rounds, and writes each`,
    `answer to ${DECISION_LOG_PATH} as a decision, which VALIDATE then applies where the pack cites the question.`,
    "It renders the file again each time, keeping what you wrote after each `Answer:` and nothing else.",
    "",
    `${String(open)} open, ${String(record.questions.length - open)} answered.`,
    ...record.questions.flatMap((q) => block(q, written.get(q.id) ?? "", unread.get(q.id))),
    "",
  ].join("\n");
}
