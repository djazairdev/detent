import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { decideArtifactSchema } from "../schemas/decide.js";
import type { FounderQuestion } from "../schemas/founder-questions.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";
import { isGreenfield } from "./greenfield.js";
import { checkDecide, openItems, type DecideCheck, type Item } from "./decide-items.js";
import { readDecideRecord, writeDecideRecord } from "./decide-record.js";
import { appendToDecisionLog, decisionLogFile, readDecisionLog, type LogView } from "./decide-log.js";
import { askAll, founderQuestion, settle, type DecideAsk } from "./decide-settle.js";
import { decideNotes } from "./decide-notes.js";
import { contentsDigest, valueDigest, type PhaseHandler, type PhaseOutcome } from "./machine.js";
import type { PipelineDeps } from "./pipeline.js";
import { refusedAttemptInput, withOneRelaunch } from "./retry.js";
import { sessionDeps } from "./session-deps.js";
import { askQuestions, openQuestions, readQuestions, standingEntry } from "./founder-questions.js";
import { launchInitSession, withInitJournal } from "./session.js";

/**
 * C-2⁶, C-3⁗, C-2¹² (PRDR-282) — DECIDE: what AUDIT left open is asked or
 * settled before anything plans from it.
 *
 * C-3′ asked every question once, at PRESENT, after the whole plan was drafted
 * on assumptions, so a decision counted in money or contracts had every slice
 * resting on it drafted and reviewed before the founder saw it. DECIDE reads
 * AUDIT's checkpoint and the decision log, and one `spec_write` session sorts
 * each open item: a question C-3″ lets it ask, a vetoable default, or an entry
 * the log already holds. Code checks the sorting and writes the log.
 *
 * On a terminal the questions come in screens of at most four, the recommended
 * option first, and the answers become `D-n` entries.
 *
 * C-3⁶ (PRDR-340): a question is never waited on. One the founder answers
 * later, and every one off a terminal, where nobody can be asked, is recorded
 * open as `Q-n` (`questions.ts`), printed, and settles its items while it is
 * open, and DECIDE completes. No recommended answer is taken for the founder
 * (amending specification decision 9), and `init` does not stop here
 * (amending specification decision 5).
 */

type Json = Record<string, unknown>;
type Ctx = Parameters<PhaseHandler["digest"]>[0];

export type { AskedQuestion, DecideAnswer, DecideAsk } from "./decide-settle.js";

/** Where the session writes, before anything has checked it, cleared before each launch (D-19). */
export function decideArtifactPath(root: string): string {
  return path.join(stateDir(root), "state", "decide-artifact.json");
}

/** The `expected_output` skeleton; a test parses it through `decideArtifactSchema`, so the two cannot drift. */
export function decideSkeleton(stackOpen: boolean): Json {
  const option = (which: string) => ({
    answer: `<${which}>`,
    consequence: "<what choosing it means: what the product then does, protects, promises or costs>",
    basis: "<what that consequence rests on: a primary source, the passages, or your reasoning from them>",
  });
  const stack = {
    language: "<the bare language name>",
    toolchain: "<the runtime and package manager, with versions>",
    scaffold_files: ["<each file the scaffold creates that later tickets lean on>"],
    gates: { test: "<the test command the documents name; leave out every slot they name none for>" },
  };
  return {
    schema_version: SCHEMA_VERSION,
    questions: [
      {
        question: "<a decision that is the founder's by what it affects>",
        why_asked: "<why it is the founder's>",
        options: [option("the option you recommend"), option("another option")],
        settles: ["<the ids of the items it settles>"],
      },
    ],
    defaults: [
      {
        value: "<the decision, stated as a rule the plan follows>",
        reason: "<why it is defensible: the passages, the source or the practice it follows>",
        basis: "<what settles it, in one line: a primary source, the passages, or the reasoning from them>",
        touches: [{ decision: "<a founder decision it touches, as the documents or the log name it>", effect: "applies" }],
        settles: ["<the ids of the items it settles>"],
      },
      ...(stackOpen
        ? [{ value: "<the stack, in one sentence>", reason: "<why this stack>", basis: "<what settles it>", touches: [], settles: ["stack"], stack }]
        : []),
    ],
    settled: [{ item: "<an item id>", entry: "<the decision log's id for the entry that already settles it>" }],
  };
}

export interface DecideStageDeps {
  readonly root: string;
  /** AUDIT's checkpoint outputs, as the bus carries them. */
  readonly audit: Json | undefined;
  readonly documents: readonly string[];
  readonly stackMarkers: readonly string[];
  readonly promptHash: string;
  readonly launch: (inputs: Json, artifactOut: string) => Promise<void>;
  /** A terminal's asker; absent off a terminal, where nobody can be asked, and every question is recorded open (C-3⁶). */
  readonly ask?: DecideAsk;
  readonly note?: (text: string) => void;
}

function readDecide(file: string, items: readonly Item[], log: LogView, strict: boolean): { value: DecideCheck | null; issue: string | null } {
  if (!existsSync(file)) return { value: null, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { value: null, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(decideArtifactSchema, raw);
  if (!parsed.ok) return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  const check = checkDecide(parsed.value, items, log);
  /* C-2¹²: strict on the first attempt, so the relaunch hears everything; the second keeps what stands. */
  if (strict && check.issues.length > 0) return { value: null, issue: check.issues.join("; ") };
  return { value: check, issue: null };
}

/**
 * C-3⁶ (PRDR-340): the log as the session's sorting is checked against it, with
 * each open question in it as an entry, so an item one settles is cited as
 * settled by its `Q-n`, and a question asked again in other words is refused
 * as one the log answers is (C-3‴).
 */
function withWaiting(log: LogView, waiting: readonly FounderQuestion[]): LogView {
  return {
    ...log,
    ids: new Set([...log.ids, ...waiting.map((q) => q.id)]),
    decisions: [...log.decisions, ...waiting.map((q) => ({ id: q.id, question: q.question, answer: "", reason: "" }))],
  };
}

async function sort(deps: DecideStageDeps, open: readonly Item[], log: LogView, greenfield: boolean, waiting: readonly FounderQuestion[]): Promise<DecideCheck> {
  const artifactOut = decideArtifactPath(deps.root);
  const stackOpen = open.some((i) => i.kind === "stack");
  const sorted = await withOneRelaunch<DecideCheck>({ stage: "DECIDE", note: deps.note }, async (previous) => {
    rmSync(artifactOut, { force: true });
    await deps.launch(
      {
        task: "decide",
        greenfield,
        stack_markers: [...deps.stackMarkers],
        documents: [...deps.documents],
        decision_log: DECISION_LOG_PATH,
        decision_log_entries: [
          ...log.decisions.map((d) => ({ id: d.id, question: d.question, answer: d.answer })),
          ...log.defaults.map((d) => ({ id: d.id, value: d.value })),
        ],
        open_questions: waiting.map((q) => ({ id: q.id, question: q.question })),
        items: open.map((i) => i.shown),
        expected_output: decideSkeleton(stackOpen),
        ...refusedAttemptInput(previous, "decision artifact"),
      },
      artifactOut,
    );
    return readDecide(artifactOut, open, withWaiting(log, waiting), previous === null);
  });
  if (sorted.value === null) throw new Error(`DECIDE produced no usable artifact: ${sorted.issue ?? "unusable"}`);
  return sorted.value;
}

function logDigest(root: string): string {
  return contentsDigest(root, [DECISION_LOG_PATH]);
}

/** What the phases after DECIDE read: the log as it stands once DECIDE is done, whether DECIDE wrote to it or not. */
function outputs(root: string, run: Json): PhaseOutcome {
  const log = readDecisionLog(root);
  return {
    kind: "complete",
    outputs: { log: log.exists ? DECISION_LOG_PATH : null, decisions: log.decisions, defaults: log.defaults, stack: log.stack, ...run },
  };
}

export async function decideStage(deps: DecideStageDeps): Promise<PhaseOutcome> {
  const greenfield = isGreenfield(deps.stackMarkers);
  const log = readDecisionLog(deps.root);
  const items = openItems(deps.audit, { stackOpen: greenfield && !log.hasStack });
  const record = readDecideRecord(deps.root);
  const asked = readQuestions(deps.root);
  const waiting = openQuestions(asked);
  const isWaiting = (entry: string): boolean => waiting.some((q) => q.id === entry);
  /*
   * The stack is open while the log has none, unless an open question settles it; any other item, while no entry the
   * log holds settles it, and no question still open does (C-3⁶).
   */
  const open = items.filter((i) => {
    const entry = standingEntry(asked, record.settled[i.key] ?? "");
    return i.kind === "stack" ? !isWaiting(entry) : !log.ids.has(entry) && !isWaiting(entry);
  });
  if (open.length === 0) {
    deps.note?.(
      items.length === 0
        ? "DECIDE: AUDIT left nothing open, so there is nothing to decide (C-2¹²)"
        : "DECIDE: every item AUDIT left open is settled by an entry the decision log still holds, or by a question still open, so no session ran (C-2¹², C-3⁶)",
    );
    noteUnitComplete(deps.root);
    return outputs(deps.root, { ran: true, session: false, asked: [], defaulted: [], opened: [], unsorted: [] });
  }
  const key = createHash("sha256")
    .update(JSON.stringify([open.map((i) => i.key), logDigest(deps.root), waiting.map((q) => q.id), deps.promptHash, greenfield, deps.documents]))
    .digest("hex");
  const reused = record.draft?.key === key ? record.draft.artifact : null;
  const sorted = reused === null ? await sort(deps, open, log, greenfield, waiting) : checkDecide(reused, open, withWaiting(log, waiting));
  writeDecideRecord(deps.root, { ...record, draft: { key, artifact: sorted.kept } });

  const questions = sorted.kept.questions;
  const answers = deps.ask === undefined || questions.length === 0 ? [] : await askAll(deps.ask, questions);
  const { add, by } = settle(sorted.kept, answers, log);
  appendToDecisionLog(deps.root, log, add);
  const later = questions.slice(answers.length);
  const opened = askQuestions(deps.root, later.map((q) => founderQuestion(q, open)));
  later.forEach((q, n) => {
    for (const item of q.settles) by.set(item, opened[n]?.id ?? "");
  });
  const settled = Object.fromEntries(open.flatMap((i) => (by.has(i.id) ? [[i.key, by.get(i.id) ?? ""]] : [])));
  writeDecideRecord(deps.root, { schema_version: SCHEMA_VERSION, settled: { ...record.settled, ...settled }, draft: null });
  const run = {
    asked: add.decisions.map((d) => d.id),
    defaulted: add.defaults.map((d) => d.id),
    opened: opened.map((q) => q.id),
    cited: sorted.kept.settled.map((s) => s.entry),
    unsorted: sorted.unsorted.map((i) => ({ id: i.id, kind: i.kind, summary: i.summary })),
  };
  for (const text of decideNotes(run, opened)) deps.note?.(text);
  /* X-1⁵ (C-2⁶): a completed DECIDE is a unit of work. */
  noteUnitComplete(deps.root);
  return outputs(deps.root, { ran: true, session: reused === null, ...run });
}

/**
 * The documents a planning phase reads: VALIDATE's, the pack as it validated
 * it and the log among them (C-2¹⁴), or WRITE's where VALIDATE is not in the
 * pipeline (C-2¹³). Where neither is, what DISCOVER found, and the decision
 * log where it exists, which DISCOVER does not list (C-2¹²), read from disk,
 * so a digest taken before DECIDE runs, as the in-flight scan takes it, names
 * the same documents as one taken after. Each planning phase names the log's
 * contents in its own digest, which is how DECIDE, off the chain, re-plans.
 */
export function planningDocs(root: string, outputs: Readonly<Record<string, Record<string, unknown>>>): string[] {
  const written = outputs["VALIDATE"]?.["docs"] ?? outputs["WRITE"]?.["docs"];
  if (Array.isArray(written)) return [...(written as string[])];
  const docs = (outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [];
  return existsSync(decisionLogFile(root)) && !docs.includes(DECISION_LOG_PATH) ? [...docs, DECISION_LOG_PATH].sort() : [...docs];
}

export function decidePhase(deps: PipelineDeps): PhaseHandler {
  const docsOf = (ctx: Ctx): string[] => (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [];
  const markersOf = (ctx: Ctx): string[] => (ctx.outputs["DISCOVER"]?.["stack_markers"] as string[] | undefined) ?? [];
  const packOf = (ctx: Ctx): string => {
    const kind = (ctx.outputs["DISCOVER"]?.["pack"] as { readonly kind?: unknown } | undefined)?.kind;
    return typeof kind === "string" ? kind : "raw";
  };
  return {
    phase: "DECIDE",
    /**
     * C-2¹²: off the chain, as AUDIT is, and keyed by the items AUDIT left
     * open rather than by AUDIT's words, which a re-run survey never repeats:
     * a code edit re-runs AUDIT, and only an item that moved re-runs DECIDE.
     * Keyed after it runs, since it writes the log its digest reads.
     */
    standalone: true,
    keyedAfterRun: true,
    digest: (ctx) =>
      valueDigest([
        openItems(ctx.outputs["AUDIT"], { stackOpen: false }).map((i) => i.key),
        logDigest(deps.root),
        deps.prompts.hashes.spec_write,
        markersOf(ctx),
        packOf(ctx),
      ]),
    run: async (ctx) => {
      const pack = packOf(ctx);
      if (pack !== "raw") {
        deps.note?.(
          pack === "conforming"
            ? "DECIDE: the documents are a conforming pack, whose decision log is the founder's record already, so nothing is decided (C-2⁶)"
            : pack === "written"
              ? "DECIDE: the documents are the pack WRITE wrote from what DECIDE decided, so nothing is decided again (C-2¹³)"
              : "DECIDE: the documents are a changed pack, whose change VALIDATE re-validates, so nothing is decided (C-2¹⁴)",
        );
        noteUnitComplete(deps.root);
        return outputs(deps.root, { ran: false, reason: pack });
      }
      return await withInitJournal(
        deps.root,
        async (journal) =>
          await decideStage({
            root: deps.root,
            audit: ctx.outputs["AUDIT"],
            documents: docsOf(ctx),
            stackMarkers: markersOf(ctx),
            promptHash: deps.prompts.hashes.spec_write,
            ...(deps.askDecisions === undefined ? {} : { ask: deps.askDecisions }),
            ...(deps.note === undefined ? {} : { note: deps.note }),
            launch: async (inputs, artifactOut) => {
              await launchInitSession(sessionDeps(deps, journal, "DECIDE"), { role: "spec_write", inputs, artifactOut });
            },
          }),
      );
    },
  };
}
