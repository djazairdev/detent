import type { SliceSpec } from "../schemas/init.js";
import type { FounderQuestion } from "../schemas/founder-questions.js";
import type { Pack } from "../schemas/pack.js";
import type { PhaseOutcome } from "./machine.js";
import { readQuestions } from "./founder-questions.js";
import { questionNote } from "./founder-questions-file.js";
import { QUESTION_REF } from "./pack-check-refs.js";
import { sliceRecords } from "./plan-records.js";
import { pendingAnswers } from "./validate-answers.js";

/**
 * C-3⁶ (PRDR-344) — planning plans around open questions.
 *
 * Nothing kept a slice that rests on a founder's question from being drafted
 * on its recommended option, reviewed and approved before the founder
 * answered. SLICE still cuts the whole pack as written, and PLAN drafts every
 * slice none of whose requirements, or the criteria that test them, cites a
 * question the pack does not yet hold the answer to: one still open, or one
 * answered whose answer VALIDATE has not yet applied where it is cited. A
 * slice that does waits, named with its questions, and is drafted by the
 * `detent init` that finds them settled. PRESENT, and so approval, needs every
 * question answered and applied: while one is not, `init` raises AWAIT_INFO
 * there, once every phase before it has done what it can, listing each with
 * its options (cost decision 2).
 */

/** A slice PLAN did not draft, and the questions it waits on. */
export interface WaitingSlice {
  readonly slice: string;
  readonly questions: readonly string[];
}

/** The questions the pack does not yet hold the answer to, as the record says, without marking anything. */
export const unsettled = (root: string): FounderQuestion[] => readQuestions(root).questions.filter((q) => q.decision === null || !q.applied);

/** The same, once each answered question the pack cites nowhere is marked applied, since nothing in the pack waits on it. */
export function unsettledQuestions(root: string): FounderQuestion[] {
  pendingAnswers(root);
  return unsettled(root);
}

/** Each slice whose requirements, or the criteria that test them, cite an unsettled question, with those questions in order. */
export function waitingSlices(root: string, pack: Pack | null, slices: readonly SliceSpec[]): WaitingSlice[] {
  if (pack === null) return [];
  const open = new Set(unsettledQuestions(root).map((q) => q.id));
  if (open.size === 0) return [];
  const pattern = new RegExp(QUESTION_REF.source, "gu");
  return slices.flatMap((slice) => {
    const records = sliceRecords(root, pack, slice.requirement_ids);
    const text = [...records.requirements.map((r) => r.text), ...records.criteria.map((c) => c.text)].join("\n");
    const cited = [...new Set([...text.matchAll(pattern)].map((m) => m[0]))].filter((id) => open.has(id)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    return cited.length === 0 ? [] : [{ slice: slice.id, questions: cited }];
  });
}

/**
 * C-3⁶: the AWAIT_INFO an unsettled question raises at PRESENT, or null where
 * every question is answered and applied. It lists each question with its
 * options, and the slices that wait.
 */
export function questionsInterrupt(
  presentation: string,
  questions: readonly FounderQuestion[],
  waiting: readonly WaitingSlice[],
): Extract<PhaseOutcome, { readonly kind: "interrupt" }> | null {
  if (questions.length === 0) return null;
  const open = questions.filter((q) => q.decision === null);
  const answered = questions.filter((q) => q.decision !== null);
  const lines = [
    presentation,
    "",
    `${String(questions.length)} question${questions.length === 1 ? "" : "s"} for the founder hold this plan: PRESENT, and approval, need every one answered, ` +
      "so the whole project is checked and planned before anything is built (C-3⁶, cost decision 2).",
    ...(open.length === 0 ? [] : ["", "Open — answer each in .detent/questions.md, after its `Answer:`:", ...open.map(questionNote)]),
    ...(answered.length === 0 ? [] : ["", "Answered, and not yet applied where the pack cites them:", ...answered.map((q) => `  ${q.id} (answered as ${q.decision ?? ""}): ${q.question}`)]),
    ...(waiting.length === 0 ? [] : ["", "Not drafted, each waiting for an answer:", ...waiting.map((w) => `  ${w.slice} waits for ${w.questions.join(", ")}`)]),
    "",
    "Re-run `detent init` once they are answered: it applies each answer where the pack cites its question, re-validates those places, " +
      "plans the slices that waited, and re-plans only the slices whose records changed (C-8⁵).",
  ];
  return {
    kind: "interrupt",
    interrupt: "AWAIT_INFO",
    message: lines.join("\n"),
    items: questions.map((q) => `${q.id}${q.decision === null ? "" : ` (answered as ${q.decision}, not yet applied)`}: ${q.question}`),
  };
}

/**
 * C-3⁶: why `detent run` offers no approval while a question is unsettled, as
 * the record says now or as PRESENT listed it, so the second exit is no way
 * around the first one's hold; null where none is.
 */
export function questionsRefusal(root: string, listed: number): string | null {
  const asked = Math.max(listed, unsettledQuestions(root).length);
  if (asked === 0) return null;
  return (
    `${String(asked)} question(s) for the founder hold approval of this plan — answer each in .detent/questions.md and re-run ` +
    "`detent init`, which applies the answers and plans the slices that waited (C-3⁶)."
  );
}
