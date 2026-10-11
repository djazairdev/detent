import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { DECISION_LOG_PATH, PACK_PATHS } from "../schemas/pack.js";
import { writeArtifactSchema, type WriteArtifact } from "../schemas/write.js";
import { isGreenfield } from "./greenfield.js";
import { readDecideRecord } from "./decide-record.js";
import { openItems } from "./decide-items.js";
import { decisionLogFile, nextId, readDecisionLog, type LogView } from "./decide-log.js";
import { readQuestions, standingEntry } from "./founder-questions.js";
import { askedNote, openForWrite, questionIssues, recordAsked, refusedDefaults, removeRows } from "./write-asks.js";
import { QUESTION_ID } from "../schemas/founder-questions.js";
import { docPatternsFor } from "./discover-docs.js";
import type { PhaseHandler, PhaseOutcome } from "./machine.js";
import { checkPack } from "./pack-check.js";
import { conformanceRecord, packDocuments, writeConformanceRecord } from "./pack.js";
import type { PipelineDeps } from "./pipeline.js";
import { refusedAttemptInput, withOneRelaunch } from "./retry.js";
import { sessionDeps } from "./session-deps.js";
import { launchInitSession, withInitJournal } from "./session.js";
import { checkerIssues, citeIssues, holdsRequirement, logIssues, resolveLists, type Cited, type ListPlan } from "./write-checks.js";
import { handoff, packDigest } from "./write-handoff.js";
import { repointLinks, type Repointed } from "./write-links.js";
import { archiveOriginal, changedSince, restoreFile, rollback, snapshot, type Snapshot } from "./write-tree.js";

/**
 * C-2⁶, C-2¹³ (PRDR-283) — WRITE: the audited and decided documents are
 * rewritten into the pack, and planning reads the pack.
 *
 * After AUDIT and DECIDE the documents were still in their author's shape:
 * requirements without ids, criteria without values, decisions in prose, so
 * PLAN could trace nothing and review could check nothing. One `spec_write`
 * session writes the pack at the pack's paths from the documents, AUDIT's
 * findings and the decision log, citing the entries that settled them. Code
 * checks what it wrote, moves the originals it rewrote to `archive/`, and
 * writes the conformance record, which says the pack is not validated.
 *
 * It writes on a raw document set only. A conforming pack is never rewritten
 * (specification decision 6); a changed pack's change and a written pack's
 * validation are VALIDATE's, after it (C-2¹⁴); and `plan_docs`, which
 * narrows discovery to part of the set, leaves the documents as they are,
 * since a pack is written from the whole set.
 */

type Json = Record<string, unknown>;
type Ctx = Parameters<PhaseHandler["digest"]>[0];

/** Where the session writes its artifact, before anything has checked it, cleared before each launch (D-19). */
export function writeArtifactPath(root: string): string {
  return path.join(stateDir(root), "state", "write-artifact.json");
}

/** The `expected_output` skeleton; a test parses it through `writeArtifactSchema`, so the two cannot drift. */
export function writeSkeleton(nextQuestion = "Q-1"): Json {
  return {
    schema_version: SCHEMA_VERSION,
    archive: ["<each document you were given whose content you rewrote into the pack>"],
    context: ["<each document you were given that stays as it is, where it is: a README, a runbook>"],
    questions: [
      {
        id: nextQuestion,
        question: "<a decision you found open that is the founder's by what it affects>",
        why_asked: "<why it is the founder's>",
        options: ["the option you recommend", "another option"].map((which) => ({
          answer: `<${which}>`,
          consequence: "<what choosing it means: what the product then does, protects, promises or costs>",
          basis: "<what that consequence rests on: a primary source, the passages, or your reasoning from them>",
        })),
      },
    ],
    defaults: [
      {
        id: "<the X-n of a default you added to the log>",
        basis: "<what settles it, in one line: a primary source, the passages, or the reasoning from them>",
        touches: [{ decision: "<a founder decision it touches, as the documents or the log name it>", effect: "applies" }],
      },
    ],
  };
}

export interface WriteStageDeps {
  readonly root: string;
  /** AUDIT's checkpoint outputs, as the bus carries them. */
  readonly audit: Json | undefined;
  /** The originals: every document DISCOVER found, which never lists the decision log (C-2¹²). */
  readonly documents: readonly string[];
  readonly stackMarkers: readonly string[];
  /** DISCOVER's patterns, which find the pack for the phases after WRITE. */
  readonly patterns: readonly string[];
  /** `YYYY-MM-DD`, for the record. */
  readonly today: string;
  readonly launch: (inputs: Json, artifactOut: string) => Promise<void>;
  readonly note?: (text: string) => void;
}

interface LogState {
  readonly view: LogView;
  readonly text: string;
}

const logState = (root: string): LogState => ({
  view: readDecisionLog(root),
  text: existsSync(decisionLogFile(root)) ? readFileSync(decisionLogFile(root), "utf8") : "",
});

const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((v): v is Json => typeof v === "object" && v !== null) : []);

/**
 * Every finding AUDIT left open, with the entry that settled it, and the cites
 * that makes the pack owe. DECIDE ran in this `init` and re-settled any item
 * whose entry the log no longer held, so every entry here is in the log, or
 * is a question still open (C-3⁶); an item it left unsorted has none.
 */
function findings(deps: WriteStageDeps): { readonly shown: Json[]; readonly owed: Cited[] } {
  const settled = readDecideRecord(deps.root).settled;
  const asked = readQuestions(deps.root);
  const shown: Json[] = [];
  const by = new Map<string, string[]>();
  for (const item of openItems(deps.audit, { stackOpen: false })) {
    /* C-3⁶ (PRDR-340, PRDR-341): an answered question stands for its D-n; one still open is cited where the pack writes its recommended option. */
    const standing = standingEntry(asked, settled[item.key] ?? "");
    const entry = standing === "" ? null : standing;
    shown.push({ ...item.shown, settled_by: entry });
    if (entry !== null) by.set(entry, [...(by.get(entry) ?? []), item.id]);
  }
  const why = (id: string, items: readonly string[]): string =>
    QUESTION_ID.test(id) ? `a question still open, which settles ${items.join(", ")}: write its recommended option there, and cite it` : `which settles ${items.join(", ")}`;
  return { shown, owed: [...by].map(([id, items]) => ({ id, why: why(id, items) })) };
}

function sessionInputs(deps: WriteStageDeps, log: LogView, shown: readonly Json[], greenfield: boolean): Json {
  const nextQuestion = `Q-${String(Math.max(0, ...readQuestions(deps.root).questions.map((q) => Number(q.id.slice(2)))) + 1)}`;
  return {
    task: "write",
    greenfield,
    stack_markers: [...deps.stackMarkers],
    documents: [...deps.documents],
    findings: shown,
    claims: list(deps.audit?.["claims"]),
    decision_log: DECISION_LOG_PATH,
    decision_log_entries: [
      ...log.decisions.map((d) => ({ id: d.id, question: d.question, answer: d.answer })),
      ...log.defaults.map((d) => ({ id: d.id, value: d.value })),
    ],
    next_default: nextId(log.ids, "X")(0),
    open_questions: openForWrite(readQuestions(deps.root)),
    next_question: nextQuestion,
    pack_paths: [...PACK_PATHS],
    expected_output: writeSkeleton(nextQuestion),
  };
}

function readWritten(file: string): { readonly artifact: WriteArtifact | null; readonly issue: string | null } {
  if (!existsSync(file)) return { artifact: null, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { artifact: null, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(writeArtifactSchema, raw);
  if (!parsed.ok) return { artifact: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  return { artifact: parsed.value, issue: null };
}

interface Written {
  readonly plan: ListPlan;
  /** Defaults the session added to the log, less the ones code refused (C-3⁶). */
  readonly added: readonly string[];
  /** The questions it asked that code records (C-3⁶). */
  readonly asked: WriteArtifact;
  /** Cites the pack still owes after the second attempt. */
  readonly owing: readonly string[];
}

interface Attempt {
  readonly deps: WriteStageDeps;
  readonly before: Snapshot;
  readonly logBefore: LogState;
  readonly owed: readonly Cited[];
  readonly greenfield: boolean;
  readonly strict: boolean;
}

/** One attempt's result: refused on any issue when strict, and on the second, what stands, the pack as the session left it. */
function evaluate(a: Attempt): { value: Written | null; issue: string | null } {
  const { deps, before } = a;
  const read = readWritten(writeArtifactPath(deps.root));
  if (read.artifact === null) return { value: null, issue: read.issue };
  const damaged = logIssues(a.logBefore, logState(deps.root));
  if (damaged.length > 0) {
    restoreFile(deps.root, before, DECISION_LOG_PATH);
    deps.note?.(`WRITE: the decision log is restored as DECIDE left it, since the rewrite changed what it held: ${damaged.join("; ")}`);
  }
  const gained = damaged.length > 0 ? [] : readDecisionLog(deps.root).defaults.filter((d) => !a.logBefore.view.ids.has(d.id)).map((d) => d.id);
  /* C-3⁶ (PRDR-341): a default it did not declare, or one that changes a founder decision, is refused; a question keeps an id of its own. */
  const refused = refusedDefaults(read.artifact, gained);
  const reused = questionIssues(read.artifact, readQuestions(deps.root));
  const added = gained.filter((id) => !refused.ids.includes(id));
  const { issues: listed, plan } = resolveLists(read.artifact, deps.documents, (rel) => changedSince(deps.root, before, rel));
  /* The pack as it will stand once the originals are archived. */
  const docs = packDocuments(deps.root).filter((rel) => !plan.archive.includes(rel));
  const owing = citeIssues(deps.root, docs, [
    ...a.owed,
    ...added.map((id) => ({ id, why: "a default you added to the log" })),
    ...read.artifact.questions.map((q) => ({ id: q.id, why: "a question you asked, where the pack depends on its answer" })),
  ]);
  const holds = holdsRequirement(deps.root, docs, a.greenfield);
  const asking = read.artifact.questions.map((q) => q.id);
  const issues = [
    ...damaged,
    ...refused.issues,
    ...reused,
    ...listed,
    ...(holds ? [] : ["the pack holds no requirement: write the module PRDs under docs/prd/"]),
    ...owing,
    ...checkerIssues(checkPack(deps.root, docs, { greenfield: a.greenfield, asking })),
  ];
  if (a.strict && issues.length > 0) return { value: null, issue: issues.join("; ") };
  if (!holds) throw new Error("WRITE wrote no requirement in either attempt, so there is no pack to plan from (C-2¹³)");
  removeRows(deps.root, refused.ids);
  if (refused.ids.length > 0) deps.note?.(`WRITE: the log loses ${refused.ids.join(", ")}, which code refused: ${refused.issues.join("; ")}`);
  const taken = new Set(readQuestions(deps.root).questions.map((q) => q.id));
  const asked = { ...read.artifact, questions: read.artifact.questions.filter((q, n, all) => !taken.has(q.id) && all.findIndex((o) => o.id === q.id) === n) };
  return { value: { plan, added, asked, owing }, issue: null };
}

const names = (rels: readonly string[]): string => (rels.length === 0 ? "none" : rels.join(", "));

function repointNote(repointed: readonly Repointed[]): string {
  const links = repointed.reduce((n, r) => n + r.links, 0);
  const one = links === 1;
  return (
    `WRITE: ${String(links)} link${one ? "" : "s"} in ${String(repointed.length)} document${repointed.length === 1 ? "" : "s"} named an original it moved, ` +
    `and now name${one ? "s" : ""} its place in archive/: ${names(repointed.map((r) => r.file))} (C-2²²)`
  );
}

/** The originals archived, the record written, and what the operator is told. */
function apply(deps: WriteStageDeps, before: Snapshot, written: Written, greenfield: boolean): PhaseOutcome {
  const rewritten = written.plan.rewritten.map((rel) => ({ path: rel, original: archiveOriginal(deps.root, before, rel) }));
  const archived = written.plan.archive.map((rel) => ({ from: rel, to: archiveOriginal(deps.root, before, rel) }));
  /* C-2²² (PRDR-312): the move broke every link to what it moved, so the links follow it before the checker reads them. */
  const documents = packDocuments(deps.root);
  const repointed = repointLinks(deps.root, documents, new Map(archived.map((m) => [m.from, m.to])));
  /* C-3⁶ (PRDR-341): its questions are recorded open before the checker resolves their cites, and printed. */
  const asked = recordAsked(deps.root, written.asked, documents);
  const checker = checkPack(deps.root, documents, { greenfield });
  writeConformanceRecord(deps.root, conformanceRecord(deps.root, { checker, rounds: [], date: deps.today, validated: false }));
  const blocking = checker.findings.filter((f) => f.blocks).length;
  const notes = [
    `WRITE wrote the pack: it archived ${names(archived.map((m) => m.from))}, kept ${names(written.plan.context)} as context, and rewrote ` +
      `${names(rewritten.map((r) => r.path))} in place, keeping each original in archive/. The conformance record says the pack is not validated (C-2¹³)`,
    ...(repointed.length === 0 ? [] : [repointNote(repointed)]),
    ...(asked.length === 0 ? [] : [askedNote(asked)]),
    ...written.plan.notes,
    ...written.owing.map((issue) => `WRITE: ${issue}; the pack goes to planning without it (C-2⁶)`),
    ...(checker.green ? [] : [`WRITE: the pack checker is red, with ${String(blocking)} blocking finding${blocking === 1 ? "" : "s"}; the pack goes to planning as it stands (C-2¹³)`]),
  ];
  for (const text of notes) deps.note?.(text);
  /* X-1⁵ (C-2⁶): a completed WRITE is a unit of work. */
  noteUnitComplete(deps.root);
  return handoff(deps.root, deps.patterns, {
    ran: true,
    archived,
    rewritten,
    repointed,
    context: [...written.plan.context],
    added_defaults: [...written.added],
    asked: asked.map((q) => q.id),
    checker_green: checker.green,
  });
}

export async function writeStage(deps: WriteStageDeps): Promise<PhaseOutcome> {
  const greenfield = isGreenfield(deps.stackMarkers);
  const before = snapshot(deps.root, deps.documents);
  const logBefore = logState(deps.root);
  const { shown, owed } = findings(deps);
  const inputs = sessionInputs(deps, logBefore.view, shown, greenfield);
  const artifactOut = writeArtifactPath(deps.root);
  let written: Written;
  try {
    const result = await withOneRelaunch<Written>({ stage: "WRITE", note: deps.note }, async (previous) => {
      rmSync(artifactOut, { force: true });
      await deps.launch({ ...inputs, ...refusedAttemptInput(previous, "artifact") }, artifactOut);
      return evaluate({ deps, before, logBefore, owed, greenfield, strict: previous === null });
    });
    if (result.value === null) throw new Error(`WRITE produced no usable artifact: ${result.issue ?? "unusable"}`);
    written = result.value;
  } catch (err) {
    /* C-2¹³: no pack came of it, so the pack's paths go back as they were, and nothing is archived. */
    rollback(deps.root, before);
    deps.note?.("WRITE: no pack came of its session, so the pack's paths are as they were before it ran, and nothing was archived");
    throw err;
  }
  return apply(deps, before, written, greenfield);
}

/** What WRITE says when it writes nothing: a pack of each kind but raw, or a set `plan_docs` narrows. */
function skipNote(skip: string): string {
  if (skip === "plan_docs") {
    return (
      "WRITE: plan_docs narrows discovery to part of the document set, and a pack is written from the whole set, so nothing " +
      "is written, and planning reads the narrowed documents as they are (C-2¹³)"
    );
  }
  if (skip === "conforming") return "WRITE: the documents are a conforming pack, which is never rewritten (C-2⁶)";
  if (skip === "written") return "WRITE: the documents are the pack WRITE wrote, which is never rewritten: VALIDATE, after it, validates it (C-2¹⁴)";
  return "WRITE: the documents are a changed pack, which is never rewritten: VALIDATE, after it, re-validates its change (C-2¹⁴)";
}

export function writePhase(deps: PipelineDeps): PhaseHandler {
  const patterns = docPatternsFor(deps.planDocs);
  const discovered = (ctx: Ctx, key: string): unknown => ctx.outputs["DISCOVER"]?.[key];
  const packOf = (ctx: Ctx): string => {
    const kind = (discovered(ctx, "pack") as { readonly kind?: unknown } | undefined)?.kind;
    return typeof kind === "string" ? kind : "raw";
  };
  return {
    phase: "WRITE",
    /* C-2¹³: the move re-runs DISCOVER on the next init, and must not re-plan; WRITE writes what its digest reads. */
    restartsChain: true,
    keyedAfterRun: true,
    digest: () => packDigest(deps.root, patterns, deps.planDocs),
    run: async (ctx) => {
      const pack = packOf(ctx);
      const narrowed = deps.planDocs !== undefined && deps.planDocs.length > 0;
      const skip = pack !== "raw" ? pack : narrowed ? "plan_docs" : null;
      if (skip !== null) {
        deps.note?.(skipNote(skip));
        noteUnitComplete(deps.root);
        return handoff(deps.root, patterns, { ran: false, reason: skip });
      }
      const markers = (discovered(ctx, "stack_markers") as string[] | undefined) ?? [];
      return await withInitJournal(
        deps.root,
        async (journal) =>
          await writeStage({
            root: deps.root,
            audit: ctx.outputs["AUDIT"],
            documents: (discovered(ctx, "docs") as string[] | undefined) ?? [],
            stackMarkers: markers,
            patterns,
            today: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
            ...(deps.note === undefined ? {} : { note: deps.note }),
            launch: async (inputs, artifactOut) => {
              await launchInitSession(sessionDeps(deps, journal, "WRITE"), { role: "spec_write", inputs, artifactOut, surface: PACK_PATHS });
            },
          }),
      );
    },
  };
}
