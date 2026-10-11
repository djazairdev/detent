import { z } from "zod";
import { SCHEMA_VERSION, nonEmptyString, sha256Hex } from "./common.js";
import { decideOptionSchema } from "./decide.js";

/**
 * C-3⁶ (PRDR-340) — the founder's questions, as open records.
 *
 * A question is asked where it is found and recorded here as `Q-n`, numbered
 * across the run, and `init` carries on: nothing waits for it but the work that
 * depends on its answer. The record lives in `.detent/state/`, where no session
 * writes (SEC-3′); `.detent/questions.md`, rendered from it, is the founder's to
 * answer in. A question is open while `decision` is null, and answered once its
 * answer is a `D-n` in the decision log.
 */

export const QUESTION_ID = /^Q-\d+$/u;

/** Where a question was found. */
export const QUESTION_PHASES = ["DECIDE", "WRITE", "VALIDATE"] as const;

export const questionPlaceSchema = z.strictObject({
  file: nonEmptyString,
  line: z.number().int().positive(),
});

export const founderQuestionSchema = z.strictObject({
  id: z.string().regex(QUESTION_ID, "a question's id is Q-n"),
  phase: z.enum(QUESTION_PHASES),
  question: nonEmptyString,
  why_asked: nonEmptyString,
  /** The recommended option first; each says what choosing it means and what that rests on (C-3⁶). */
  options: z.array(decideOptionSchema).min(2, "offers fewer than two options"),
  /** False where only an option will do, as for the question that settles the stack (D-10′). */
  own_allowed: z.boolean(),
  /** DECIDE's items the answer settles, by their content keys (`decide-items.ts`). */
  items: z.array(sha256Hex).default([]),
  /** The places in the pack that depend on the answer. */
  places: z.array(questionPlaceSchema).default([]),
  /** The `D-n` the answer became; null while the question is open. */
  decision: nonEmptyString.nullable().default(null),
});
export type FounderQuestion = z.infer<typeof founderQuestionSchema>;

export const questionsRecordSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  questions: z.array(founderQuestionSchema).default([]),
});
export type QuestionsRecord = z.infer<typeof questionsRecordSchema>;
