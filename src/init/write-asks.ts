import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FounderQuestion, QuestionsRecord } from "../schemas/founder-questions.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";
import type { WriteArtifact } from "../schemas/write.js";
import { decisionLogFile } from "./decide-log.js";
import { askQuestions, openQuestions, placeQuestions, type NewQuestion } from "./founder-questions.js";
import { questionNote } from "./founder-questions-file.js";
import { QUESTION_REF } from "./pack-check-refs.js";

/**
 * C-3⁶ (PRDR-341) — what WRITE asks, and what it may not settle.
 *
 * WRITE writes each place that depends on an open question as its recommended
 * option and cites its `Q-n`, and asks, rather than settles, an item it finds
 * open that is the founder's. Each default it adds to the log it declares as
 * DECIDE declares one, and code refuses one it does not declare, and one that
 * changes a founder decision, which is the founder's to make.
 */

/** The open questions, as WRITE's session is told them: what each is, and what its recommended option says. */
export function openForWrite(record: QuestionsRecord): Record<string, unknown>[] {
  return openQuestions(record).map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options.map((o) => ({ answer: o.answer, consequence: o.consequence, basis: o.basis })),
  }));
}

/** What is wrong with the questions the artifact asks: an id the record or the artifact already uses. */
export function questionIssues(artifact: WriteArtifact, record: QuestionsRecord): string[] {
  const used = new Set(record.questions.map((q) => q.id));
  const issues: string[] = [];
  for (const q of artifact.questions) {
    if (used.has(q.id)) issues.push(`your question ${q.id} reuses an id already asked; number your questions from next_question`);
    used.add(q.id);
  }
  return issues;
}

/**
 * The defaults the session added that code refuses: one it did not declare,
 * one that changes a founder decision, and a declaration of a default the log
 * does not gain. Each refusal names its default.
 */
export function refusedDefaults(artifact: Pick<WriteArtifact, "defaults">, added: readonly string[]): { readonly ids: string[]; readonly issues: string[] } {
  const declared = new Map(artifact.defaults.map((d) => [d.id, d]));
  const ids: string[] = [];
  const issues: string[] = [];
  for (const id of added) {
    const d = declared.get(id);
    const changed = d?.touches.filter((t) => t.effect === "changes").map((t) => t.decision) ?? [];
    if (d === undefined) issues.push(`${id} is a default you added and did not declare in your artifact's defaults, with its basis and the founder decisions it touches`);
    else if (changed.length > 0) {
      issues.push(`${id} changes the founder decision ${changed.join(", ")}; a change to a founder decision is the founder's to make, so ask it as a question (C-3⁶)`);
    } else continue;
    ids.push(id);
  }
  for (const id of declared.keys()) if (!added.includes(id)) issues.push(`your artifact declares ${id}, a default the decision log does not gain`);
  return { ids, issues };
}

/** Take the refused defaults' rows out of the log: each is WRITE's own, added this attempt. */
export function removeRows(root: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const refused = new Set(ids);
  const text = readFileSync(decisionLogFile(root), "utf8");
  const kept = text.split(/(?<=\n)/u).filter((line) => !refused.has(/^\|\s*([^|]+?)\s*\|/u.exec(line)?.[1] ?? ""));
  writeFileSync(decisionLogFile(root), kept.join(""));
}

/** Where the pack's documents cite each question, by `Q-n`. */
export function citedPlaces(root: string, docs: readonly string[]): Map<string, { file: string; line: number }[]> {
  const places = new Map<string, { file: string; line: number }[]>();
  for (const rel of docs.filter((d) => d !== DECISION_LOG_PATH)) {
    readFileSync(path.join(root, ...rel.split("/")), "utf8")
      .split(/\r?\n/u)
      .forEach((text, n) => {
        for (const m of text.matchAll(new RegExp(QUESTION_REF.source, "gu"))) places.set(m[0], [...(places.get(m[0]) ?? []), { file: rel, line: n + 1 }]);
      });
  }
  return places;
}

/**
 * Record the questions WRITE asked, open, each with the places that cite it,
 * and point every open question at the places in the pack that now depend on
 * it. Returns the questions recorded.
 */
export function recordAsked(root: string, artifact: WriteArtifact, docs: readonly string[]): FounderQuestion[] {
  const places = citedPlaces(root, docs);
  const asked: NewQuestion[] = artifact.questions.map((q) => ({
    id: q.id,
    phase: "WRITE",
    question: q.question,
    why_asked: q.why_asked,
    options: q.options,
    own_allowed: true,
    items: [],
    places: places.get(q.id) ?? [],
  }));
  const added = askQuestions(root, asked);
  placeQuestions(root, places);
  return added;
}

/** What the operator is told of the questions WRITE asked: each in full, as DECIDE prints its own. */
export function askedNote(asked: readonly FounderQuestion[]): string {
  return [
    `WRITE asks the founder ${String(asked.length)} question${asked.length === 1 ? "" : "s"} it found open, recorded in .detent/questions.md, ` +
      "and wrote the pack on each recommended option, citing the question where it depends on it. `init` goes on (C-3⁶):",
    ...asked.map(questionNote),
  ].join("\n");
}
