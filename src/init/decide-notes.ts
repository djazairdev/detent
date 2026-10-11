import { DECISION_LOG_PATH } from "../schemas/pack.js";
import type { FounderQuestion } from "../schemas/founder-questions.js";
import { questionNote } from "./founder-questions-file.js";

/**
 * C-2¹² (PRDR-282) — what DECIDE tells the operator: what it asked and
 * settled, and what it could not sort. C-3⁶ (PRDR-340): and each question it
 * left open, printed in full as it is recorded, with where to answer it.
 */

export interface DecideRun {
  readonly asked: readonly string[];
  readonly defaulted: readonly string[];
  /** The questions recorded open, by their `Q-n`. */
  readonly opened: readonly string[];
  /** The log's entries the session cited as already settling an item. */
  readonly cited: readonly string[];
  readonly unsorted: readonly { readonly id: string; readonly kind: string; readonly summary: string }[];
}

const count = (n: number, noun: string, plural = `${noun}s`): string => `${String(n)} ${n === 1 ? noun : plural}`;
const ids = (list: readonly string[]): string => (list.length === 0 ? "" : ` (${[...new Set(list)].join(", ")})`);

export function decideNotes(run: DecideRun, opened: readonly FounderQuestion[]): string[] {
  const notes = [
    `DECIDE sorted what AUDIT left open: ${count(run.asked.length, "question")} asked and answered${ids(run.asked)}, ` +
      `${count(run.opened.length, "question")} left open for the founder${ids(run.opened)}, ` +
      `${count(run.defaulted.length, "default")} settled without asking${ids(run.defaulted)}, ` +
      `and ${count(new Set(run.cited).size, "entry", "entries")} the decision log already held${ids(run.cited)}. A default is vetoable: edit its ` +
      `row in ${DECISION_LOG_PATH} and re-run \`detent init\` (C-3⁗).`,
  ];
  if (opened.length > 0) {
    notes.push(
      [
        `DECIDE asks the founder ${count(opened.length, "question")}, recorded open in .detent/questions.md. \`init\` goes on: nothing ` +
          "waits for an answer but the work that depends on it. Answer there, by an option's number or in your own words, and the " +
          `next phase boundary writes the answer to ${DECISION_LOG_PATH} as a decision (C-3⁶):`,
        ...opened.map(questionNote),
      ].join("\n"),
    );
  }
  if (run.unsorted.length > 0) {
    notes.push(
      `DECIDE left ${count(run.unsorted.length, "item")} unsorted after its relaunch, so planning goes on from the documents ` +
        `as written for ${run.unsorted.length === 1 ? "it" : "them"} (C-2¹²): ${run.unsorted.map((i) => `${i.id} (${i.kind}) ${i.summary}`).join("; ")}`,
    );
  }
  return notes;
}
