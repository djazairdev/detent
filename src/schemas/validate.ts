import { z } from "zod";
import { SCHEMA_VERSION, nonEmptyString } from "./common.js";
import { SEVERITIES } from "./pack.js";
import { askedOptionSchema, declaredDefaultSchema } from "./decide.js";
import { QUESTION_ID } from "./founder-questions.js";

/**
 * C-2⁶, C-2¹⁴ (PRDR-284) — what VALIDATE's sessions write: a reviewer's
 * findings, and the writer's account of the findings it was given.
 */

/**
 * What a finding says is wrong: the nine kinds of defect the ksarjs review
 * brief named, stated for any pack, and since PRDR-342 a tenth, the founder's. A category is what the finding is about,
 * and the severity is what it costs; neither decides the other.
 */
export const FINDING_CATEGORIES = [
  "contradiction",
  "fact",
  "invariant",
  "unsafe",
  "milestone",
  "untestable",
  "gap",
  "name-drift",
  "present-indicative",
  /**
   * C-2²⁹ (PRDR-342): the reviewer as the founder's second reader: a default
   * the line makes the founder's, a fix that would take a founder's decision,
   * or an option whose consequence is wrong (C-3⁶).
   */
  "founder",
] as const;

/** A passage a finding stands on, quoted from the line it starts on. Code checks that it is there. */
export const findingPlaceSchema = z.strictObject({ file: nonEmptyString, line: z.number().int().positive(), quote: nonEmptyString });
export type FindingPlace = z.infer<typeof findingPlaceSchema>;

export const reviewFindingSchema = z.strictObject({
  severity: z.enum(SEVERITIES),
  category: z.enum(FINDING_CATEGORIES),
  places: z.array(findingPlaceSchema).min(1, "names no place"),
  why: nonEmptyString,
  /** The smallest correct fix: which document changes, and to what. */
  fix: nonEmptyString,
  /** A verification's: the id of the finding it is what remains of, or null for a new one. */
  previous: nonEmptyString.nullable(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewArtifactSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  documents_read: z.array(nonEmptyString),
  findings: z.array(reviewFindingSchema),
});
export type ReviewArtifact = z.infer<typeof reviewArtifactSchema>;

/**
 * C-2²⁸ (PRDR-333): a first round's review. Its reviewer is given no findings
 * of a round before, so a finding's `previous` can only be null there, and one
 * it leaves out reads as null. On N-8's review set at Opus 5.5 `high`, 5 of the
 * 10 reviewers left it out of every finding, and each was relaunched for a
 * second whole review (C-4⁗′); at `max`, none did. A verification's review
 * keeps the field required: there it names the finding a new one is what
 * remains of, and a missing one is a link left unsaid.
 */
export const firstReviewArtifactSchema = reviewArtifactSchema.extend({
  findings: z.array(reviewFindingSchema.extend({ previous: nonEmptyString.nullable().default(null) })),
});

/**
 * The writer's account: each finding it was given, by id, applied or declined
 * with its reason. A declined finding is left open, and the next round judges
 * the reason; the pack itself is what code checks.
 */
export const fixArtifactSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  applied: z.array(nonEmptyString),
  declined: z.array(z.strictObject({ id: nonEmptyString, reason: nonEmptyString })),
  /**
   * C-2²⁹ (PRDR-342): the findings whose fix is the founder's, each group one
   * question, the recommended option first; none of them is patched.
   */
  asked: z
    .array(
      z.strictObject({
        findings: z.array(nonEmptyString).min(1, "asks for no finding"),
        question: nonEmptyString,
        why_asked: nonEmptyString,
        options: z.array(askedOptionSchema).min(2, "offers fewer than two options"),
      }),
    )
    .default([]),
  /** C-2²⁹: the findings an open question's answer settles, each by that question's `Q-n`; none is patched. */
  attached: z.array(z.strictObject({ id: nonEmptyString, question: z.string().regex(QUESTION_ID, "names no question (Q-n)") })).default([]),
  /** C-3⁶ (PRDR-342): each default the writer added, declared. */
  defaults: z.array(declaredDefaultSchema).default([]),
});
export type FixArtifact = z.infer<typeof fixArtifactSchema>;
