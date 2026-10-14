import type { FounderQuestion, QuestionsRecord } from "../schemas/founder-questions.js";
import type { FixArtifact } from "../schemas/validate.js";
import { askQuestions, openQuestions, readQuestions, updateQuestions } from "./founder-questions.js";
import type { Outcome } from "./validate-checks.js";

/**
 * C-2²⁹ (PRDR-342) — what VALIDATE's writer asks rather than patches.
 *
 * C-2¹⁴'s writer patched every finding, and a blocker whose real cause was a
 * design choice came back round after round: on Hearth the metrics
 * breakdown's came back four rounds running, each patch a new check of SQL
 * text with another route past it. The writer now asks a finding whose fix is
 * the founder's, and attaches one an open question's answer would settle;
 * neither is patched, and each is recorded `declined` with a reason naming its
 * question, so the conformance record keeps its shape (F-3). A blocker whose
 * `previous` is a blocker of the round before reaches the writer marked: two
 * rounds of patches show reasoning is not settling it, so it is asked.
 */

export const askedReason = (question: string): string => `asked as ${question}: its fix is the founder's to choose (C-2²⁹)`;
export const attachedReason = (question: string): string => `attached to ${question}, whose answer settles it (C-2²⁹)`;

/** The question a finding waits on, read from the reason code gave it; null for one it does not wait on. */
export const questionOf = (reason: string): string | null => /^(?:asked as|attached to) (Q-\d+)\b/u.exec(reason)?.[1] ?? null;

/** One link of a finding's chain: a finding, back to the first round's, at its first place. */
export interface Link {
  readonly id: string;
  readonly file: string;
  readonly line: number;
}

interface Linked {
  readonly id: string;
  readonly severity: string;
  readonly previous: string | null;
  readonly places: readonly { readonly file: string; readonly line: number }[];
}

/**
 * Each finding's chain, the round before's chains extended by it, and the
 * blockers whose `previous` is a blocker of the round before: those are asked.
 * A blocker after a major starts a chain and is not marked.
 */
export function chainsOf(
  findings: readonly Linked[],
  before: ReadonlyMap<string, readonly Link[]>,
  severities: ReadonlyMap<string, string>,
): { readonly chains: Map<string, Link[]>; readonly marked: Map<string, Link[]> } {
  const chains = new Map<string, Link[]>();
  const marked = new Map<string, Link[]>();
  for (const f of findings) {
    const place = f.places[0] ?? { file: "", line: 0 };
    const chain = [...(f.previous === null ? [] : (before.get(f.previous) ?? [])), { id: f.id, file: place.file, line: place.line }];
    chains.set(f.id, chain);
    if (f.severity === "blocker" && f.previous !== null && severities.get(f.previous) === "blocker") marked.set(f.id, chain);
  }
  return { chains, marked };
}

/**
 * The writer's account against the findings it was given: each id once, in
 * `applied`, `declined`, an asked group or `attached`; each attached to a
 * question still open; and a marked blocker asked or attached, never applied
 * or declined. A first attempt with any of these is refused; a second's
 * account stands, as C-2¹⁴'s does, and the next round judges it.
 */
export function accountIssues(artifact: FixArtifact, ids: readonly string[], marked: ReadonlySet<string>, record: QuestionsRecord): string[] {
  const asked = artifact.asked.flatMap((g) => g.findings);
  /* PRDR-343: a finding the writer settled by correcting a question is accounted for there. */
  const corrected = artifact.corrected.flatMap((c) => c.findings);
  const listed = [...artifact.applied, ...artifact.declined.map((d) => d.id), ...asked, ...artifact.attached.map((a) => a.id), ...corrected];
  const issues: string[] = [];
  for (const id of new Set(listed)) {
    if (!ids.includes(id)) issues.push(`${id} is not one of the findings you were given`);
    else if (listed.filter((l) => l === id).length > 1) issues.push(`${id} is listed twice`);
  }
  for (const id of ids) if (!listed.includes(id)) issues.push(`${id} is listed in none of applied, declined, asked, attached and corrected`);
  const open = new Set(openQuestions(record).map((q) => q.id));
  for (const a of artifact.attached) if (!open.has(a.question)) issues.push(`${a.id} is attached to ${a.question}, which is no question still open`);
  for (const id of marked) {
    if (artifact.applied.includes(id) || artifact.declined.some((d) => d.id === id)) {
      issues.push(`${id} is a blocker after a blocker, so two rounds of fixes have not settled it: ask it, or attach it to the open question whose answer settles it (C-2²⁹)`);
    }
  }
  return issues;
}

interface Asked {
  readonly id: string;
  readonly places?: unknown;
  readonly why?: unknown;
  readonly chain?: unknown;
}

/** What the founder reads of a finding asked: the reviewer's `why`, and a repeated blocker's chain, each link at its place. */
function foundBy(f: Asked | undefined): string {
  if (f === undefined) return "";
  const chain = Array.isArray(f.chain) ? (f.chain as Link[]) : [];
  const links = chain.map((l) => `${l.id} at ${l.file}:${String(l.line)}`).join(", ");
  return `${f.id}: ${typeof f.why === "string" ? f.why : ""}${chain.length > 1 ? ` It came back ${String(chain.length)} rounds running: ${links}.` : ""}`;
}

/**
 * Record each asked group as an open question, its places its findings',
 * its reasons each finding's `why` and chain after the writer's, add each
 * attached finding's places to its question's, since its answer applies
 * there too (#45), and say what became of every asked or attached finding. A
 * finding attached to a question that is not open waits on nothing, and is
 * left to the account's other outcomes.
 */
export function askFindings(root: string, artifact: FixArtifact, findings: readonly Asked[]): { readonly asked: FounderQuestion[]; readonly outcome: Map<string, Outcome> } {
  const placesOf = (id: string): { file: string; line: number }[] => {
    const places = findings.find((f) => f.id === id)?.places;
    return Array.isArray(places) ? (places as { file: string; line: number }[]).map((p) => ({ file: p.file, line: p.line })) : [];
  };
  const open = new Set(openQuestions(readQuestions(root)).map((q) => q.id));
  const asked = askQuestions(
    root,
    artifact.asked.map((g) => ({
      phase: "VALIDATE",
      question: g.question,
      why_asked: [g.why_asked, ...g.findings.map((id) => foundBy(findings.find((f) => f.id === id)))].filter((s) => s !== "").join(" "),
      options: g.options,
      own_allowed: true,
      items: [],
      places: g.findings.flatMap(placesOf),
    })),
  );
  const outcome = new Map<string, Outcome>();
  artifact.asked.forEach((g, n) => {
    for (const id of g.findings) outcome.set(id, { left: "declined", reason: askedReason(asked[n]?.id ?? "") });
  });
  const attached = new Map<string, { file: string; line: number }[]>();
  for (const a of artifact.attached) {
    if (!open.has(a.question)) continue;
    outcome.set(a.id, { left: "declined", reason: attachedReason(a.question) });
    attached.set(a.question, [...(attached.get(a.question) ?? []), ...placesOf(a.id)]);
  }
  if (attached.size > 0) {
    updateQuestions(root, (q) => {
      const more = attached.get(q.id);
      if (more === undefined) return q;
      const all = [...q.places, ...more];
      return { ...q, places: all.filter((p, i) => all.findIndex((o) => o.file === p.file && o.line === p.line) === i) };
    });
  }
  return { asked, outcome };
}

/** C-2²⁹ (PRDR-342): every question asked, open or answered, as a reviewer reads it beside the foundations. */
export function reviewerQuestions(root: string): Record<string, unknown>[] {
  return readQuestions(root).questions.map((q) => ({
    id: q.id,
    question: q.question,
    why_asked: q.why_asked,
    options: q.options.map((o) => ({ answer: o.answer, consequence: o.consequence, basis: o.basis })),
    places: q.places,
    answered_as: q.decision,
  }));
}

/** The round's blockers and majors the stop rule counts: what Detent can fix, so none that waits on the founder's answer (specification decision 3). */
export function counted<T extends { readonly id: string; readonly severity: string }>(findings: readonly T[], outcome: ReadonlyMap<string, Outcome>): T[] {
  return findings.filter((f) => (f.severity === "blocker" || f.severity === "major") && questionOf(outcome.get(f.id)?.reason ?? "") === null);
}
