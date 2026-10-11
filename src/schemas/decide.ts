import { z } from "zod";
import { SCHEMA_VERSION, nonEmptyString, sha256Hex } from "./common.js";
import { GATE_SLOTS } from "./gates.js";

/**
 * C-2⁶, C-3⁗, C-2¹² (PRDR-282) — what DECIDE's session writes, and what
 * DECIDE keeps between runs.
 *
 * The session sorts every item AUDIT left open, naming each by the id its
 * inputs gave it: a question C-3″ lets DECIDE ask, a vetoable default, or an
 * entry the decision log already holds. It writes this artifact and nothing
 * else; code checks the sorting (`decide-items.ts`) and writes the log from it
 * (`decide-log.ts`), so every row the log gains is one the pack's grammar reads.
 */

/**
 * D-10′: the stack as a structured entry. `gates` holds only the commands the
 * documents name, by slot; a slot they name none for is left out, and the
 * stack table is the fallback for it as before (PRDR-115).
 */
export const stackEntrySchema = z.strictObject({
  language: nonEmptyString,
  toolchain: nonEmptyString,
  scaffold_files: z.array(nonEmptyString).default([]),
  gates: z.partialRecord(z.enum(GATE_SLOTS), nonEmptyString).default({}),
});
export type StackEntry = z.infer<typeof stackEntrySchema>;

/** Item ids are the inputs' (`C1`, `G1`, `R1`, `K1`, `stack`); code checks each against them. */
const settles = z.array(nonEmptyString).min(1, "settles no item");

export const decideOptionSchema = z.strictObject({
  answer: nonEmptyString,
  /** What choosing it means: what the product then does, protects, promises or costs. */
  consequence: nonEmptyString,
  /** C-3⁶ (PRDR-339): what the consequence rests on, a source, the passages or the reasoning, since the founder chooses on it. */
  basis: nonEmptyString,
  /** A question that settles the stack carries one on every option (D-10′). */
  stack: stackEntrySchema.optional(),
});
export type DecideOption = z.infer<typeof decideOptionSchema>;

export const decideQuestionSchema = z.strictObject({
  question: nonEmptyString,
  /** C-3″: why the answer is the founder's, counted in money or contracts rather than in code. */
  why_asked: nonEmptyString,
  /** The recommended option first. */
  options: z.array(decideOptionSchema).min(2, "offers fewer than two options"),
  settles,
});
export type DecideQuestion = z.infer<typeof decideQuestionSchema>;

/**
 * C-3⁶ (PRDR-339): a founder decision a default touches, named as the
 * documents or the log name it, and whether the default follows it unchanged
 * or changes it. Code refuses `changes`: a change to a founder decision is the
 * founder's to make, so it is asked.
 */
export const TOUCH_EFFECTS = ["applies", "changes"] as const;
export const touchSchema = z.strictObject({
  decision: nonEmptyString,
  effect: z.enum(TOUCH_EFFECTS),
});
export type Touch = z.infer<typeof touchSchema>;

export const decideDefaultSchema = z.strictObject({
  /** The decision, stated as a rule the plan follows. */
  value: nonEmptyString,
  reason: nonEmptyString,
  /** C-3⁶ (PRDR-339): what settles it, in one line: a primary source, the passages, or the reasoning from them. */
  basis: nonEmptyString,
  touches: z.array(touchSchema).default([]),
  settles,
  /** The default that settles the stack carries it (D-10′). */
  stack: stackEntrySchema.optional(),
});
export type DecideDefault = z.infer<typeof decideDefaultSchema>;

export const decideSettledSchema = z.strictObject({
  item: nonEmptyString,
  /** The decision log's own id for the entry that already settles the item. */
  entry: nonEmptyString,
});

export const decideArtifactSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  questions: z.array(decideQuestionSchema).default([]),
  defaults: z.array(decideDefaultSchema).default([]),
  settled: z.array(decideSettledSchema).default([]),
});
export type DecideArtifact = z.infer<typeof decideArtifactSchema>;

/**
 * DECIDE's own record, kept beside its checkpoint (C-2¹²).
 *
 * `settled` maps each item DECIDE sorted, by its content key, to the log entry
 * that settled it, so a run whose items are all still settled by entries the
 * log still holds launches no session: an answer or a veto edits an entry and
 * leaves it standing. `draft` is the last session's checked artifact with the
 * key of the inputs it was written for, so questions deferred on a terminal are
 * asked again without a session while those inputs stand.
 */
export const decideRecordSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  settled: z.record(sha256Hex, nonEmptyString).default({}),
  draft: z.strictObject({ key: sha256Hex, artifact: decideArtifactSchema }).nullable().default(null),
});
export type DecideRecord = z.infer<typeof decideRecordSchema>;
