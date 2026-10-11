import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { askQuestions, readQuestions } from "../../src/init/founder-questions.js";
import { packDocuments } from "../../src/init/pack.js";
import { parsePack } from "../../src/init/pack-parse.js";
import { questionsInterrupt, questionsRefusal, unsettledQuestions, waitingSlices } from "../../src/init/plan-waits.js";
import { answerIntoLog } from "../../src/init/validate-answers.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SliceSpec } from "../../src/schemas/init.js";
import { LONE_CANDIDATE, repo } from "./plan-fixture.js";
import { PRICE_DEFAULT, REFUND, STACK_DEFAULT, artifact, decide, type Json } from "./decide-fixture.js";
import { covering, scriptedPlanner, sliceOf, ticket } from "./slicing-fixture.js";
import { RAW, WROTE, packFor, read, write } from "./write-fixture.js";
import { LENDING_PRD, clean, initThroughValidate, writer } from "./validate-fixture.js";

/**
 * PRDR-344 — planning plans around open questions (C-3⁶).
 *
 * With a question open after VALIDATE, nothing kept a slice that rests on it
 * from being drafted on its recommended option, reviewed, and approved before
 * the founder answered. SLICE cuts the whole pack as written; PLAN drafts
 * every slice that cites no unsettled question, and one that does waits;
 * `init` stops once, at PRESENT, listing what is open; and the next `init`
 * applies the answers and plans the slices that waited.
 */

const TAX = {
  question: "What happens when a tool comes back late?",
  why_asked: "It is a fee the members pay.",
  options: [
    { answer: "New loans wait for the tool", consequence: "No fee; a late member waits.", basis: "PRD.md, which lends one tool at a time" },
    { answer: "A day's fee", consequence: "Members pay for each late day.", basis: "the roadmap's daily price" },
  ],
  settles: ["G1"],
};
const ASKED = { question: TAX.question, why_asked: TAX.why_asked, options: TAX.options };
const PROJECT = { ...LONE_CANDIDATE, ...RAW };
/** DECIDE leaves the late-return gap open as Q-1, and WRITE cites it at LND-F-002. */
const asksLate = () => decide(() => artifact({ questions: [TAX], defaults: [REFUND, STACK_DEFAULT, PRICE_DEFAULT] }));
const citesLate = () => write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE() }));
const slice = (id: string, ids: string[]) => ({ id, title: id, goal: `${id} works`, requirement_ids: ids, baseline_items: [], docs: [], depends_on: [], rationale: "" });
/** Two slices: s01 holds the free price and the fee, s02 the late-return rule, which cites Q-1. */
const TWO = { schema_version: SCHEMA_VERSION, slices: [slice("s01", ["LND-F-001", "LND-F-003"]), slice("s02", ["LND-F-002"])] };
const draft = (inputs: Record<string, unknown>): object => covering(inputs, [ticket(`t-${sliceOf(inputs)}-001`)]);
const approve = (): object => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] });
/** VALIDATE's writer applies each answer it is given: the decision cited where the question was. */
const answering = () =>
  writer((_, inputs) => ({
    edit: { [LENDING_PRD]: (t) => ((inputs["answers"] as { id: string; decision: string }[] | undefined) ?? []).reduce((text, a) => text.replaceAll(a.id, a.decision), t) },
    artifact: { schema_version: SCHEMA_VERSION, applied: ((inputs["findings"] as { id: string }[] | undefined) ?? []).map((f) => f.id), declined: [] },
  }));

function answer(root: string, id: string, text: string): void {
  const file = path.join(stateDir(root), "questions.md");
  const lines = readFileSync(file, "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith(`## ${id} `));
  const line = lines.findIndex((l, i) => i > at && l.startsWith("Answer:"));
  lines[line] = `Answer: ${text}`;
  writeFileSync(file, lines.join("\n"));
}

/** One `init` of the whole pipeline: `log` names each planner stage, and `asked` counts approval questions. */
async function init(root: string, log: string[], asked: { n: number } = { n: 0 }, notes: string[] = []) {
  const planner = scriptedPlanner({ slices: TWO, draft, review: approve }, log);
  return await initThroughValidate(
    root,
    {
      all: true,
      reviewers: clean(),
      writer: answering(),
      notes,
      decideStub: asksLate(),
      script: { planner },
      more: { askApproval: async () => ((asked.n += 1), { kind: "deferred" as const }) },
    },
    citesLate(),
  );
}

const outputsOf = (root: string, phase: string): Json =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", `${phase}.json`), "utf8")) as { outputs: Json }).outputs;

describe("PRDR-344: PLAN drafts every slice that cites no open question, and one that does waits (C-3⁶)", () => {
  it("cuts the whole pack, drafts s01, leaves s02 waiting for Q-1, and stops once, at PRESENT, offering no approval", async () => {
    const root = repo(PROJECT);
    const log: string[] = [];
    const asked = { n: 0 };
    const notes: string[] = [];
    const result = await init(root, log, asked, notes);
    expect((outputsOf(root, "SLICE")["slices"] as { id: string; requirement_ids: string[] }[]).map((s) => [s.id, s.requirement_ids]), "SLICE cuts the pack as written").toEqual([
      ["s01", ["LND-F-001", "LND-F-003"]],
      ["s02", ["LND-F-002"]],
    ]);
    expect(log.filter((s) => s.startsWith("PLAN:"))).toEqual(["PLAN:s01"]);
    expect(notes).toContain("s02: waits for the founder's answer to Q-1, so it is not drafted (C-3⁶)");
    expect(outputsOf(root, "PLAN")["waiting"]).toEqual([{ slice: "s02", questions: ["Q-1"] }]);
    expect(result.reachedPhase).toBe("PRESENT");
    expect(result.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(result.interrupt?.message).toContain("1 question for the founder hold this plan: PRESENT, and approval, need every one answered");
    expect(result.interrupt?.message).toContain(`  Q-1 (asked at DECIDE): ${TAX.question}`);
    expect(result.interrupt?.message).toContain("  s02 waits for Q-1");
    expect(result.interrupt?.items).toEqual([`Q-1: ${TAX.question}`]);
    expect(asked.n, "approval is not offered").toBe(0);
    expect((JSON.parse(read(root, ".detent/plan/presentation.json")) as { open_questions: number }).open_questions).toBe(1);
  });

  it("plans the slice that waited once the answer is given, reusing the other, and offers approval", async () => {
    const root = repo(PROJECT);
    await init(root, []);
    answer(root, "Q-1", "1");
    const log: string[] = [];
    const asked = { n: 0 };
    const again = await init(root, log, asked);
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(read(root, LENDING_PRD), "VALIDATE's writer applied it").toContain(`(${decision}).`);
    expect(log.filter((s) => s.startsWith("PLAN:")), "s01 is reused; s02 is drafted").toEqual(["PLAN:s02"]);
    expect(outputsOf(root, "PLAN")["waiting"]).toEqual([]);
    expect(again.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(asked.n).toBe(1);
  });
});

describe("PRDR-344: what holds, and what waits (C-3⁶)", () => {
  it("lets `run` offer no approval while a question is unsettled, as the record says now or as PRESENT listed it", () => {
    const root = repo(PROJECT);
    expect(questionsRefusal(root, 0)).toBeNull();
    expect(questionsRefusal(root, 2)).toContain("2 question(s) for the founder hold approval of this plan");
    askQuestions(root, [{ phase: "VALIDATE", ...ASKED, own_allowed: true, items: [], places: [] }]);
    expect(questionsRefusal(root, 0)).toContain("1 question(s) for the founder hold approval of this plan");
  });

  it("names an answered question not yet applied apart from an open one", () => {
    const open = { id: "Q-1", phase: "DECIDE" as const, ...ASKED, own_allowed: true, items: [], places: [], decision: null, applied: false, put_back: null };
    const held = questionsInterrupt("the plan", [open, { ...open, id: "Q-2", decision: "D-4" }], []);
    expect(held?.message).toContain("Answered, and not yet applied where the pack cites them:\n  Q-2 (answered as D-4)");
    expect(held?.items).toEqual([`Q-1: ${TAX.question}`, `Q-2 (answered as D-4, not yet applied): ${TAX.question}`]);
    expect(questionsInterrupt("the plan", [], [])).toBeNull();
  });

  it("counts an answer the pack cites nowhere as settled", () => {
    const root = repo(PROJECT);
    askQuestions(root, [{ phase: "VALIDATE", ...ASKED, own_allowed: true, items: [], places: [] }]);
    answer(root, "Q-1", "1");
    answerIntoLog(root);
    expect(unsettledQuestions(root)).toEqual([]);
  });

  it("makes a slice wait on a question its criteria cite, and not on one settled", async () => {
    const root = repo(PROJECT);
    await init(root, []);
    const file = path.join(root, ...LENDING_PRD.split("/"));
    writeFileSync(file, readFileSync(file, "utf8").replace("then they are charged 0 (LND-F-001)", "then they are charged 0 (LND-F-001; Q-1)"));
    const { pack } = parsePack(root, packDocuments(root), { greenfield: false });
    const s01 = slice("s01", ["LND-F-001"]) as unknown as SliceSpec;
    expect(waitingSlices(root, pack, [s01])).toEqual([{ slice: "s01", questions: ["Q-1"] }]);
    answer(root, "Q-1", "1");
    answerIntoLog(root);
    expect(waitingSlices(root, pack, [s01]), "answered, and not yet applied where it is cited").toEqual([{ slice: "s01", questions: ["Q-1"] }]);
    writeFileSync(file, readFileSync(file, "utf8").replaceAll("Q-1", readQuestions(root).questions[0]?.decision ?? ""));
    expect(waitingSlices(root, parsePack(root, packDocuments(root), { greenfield: false }).pack, [s01])).toEqual([]);
  });

  it("waits on no question the record holds settled, though the pack cites it while another is open", async () => {
    const root = repo(PROJECT);
    await init(root, []);
    const record = path.join(stateDir(root), "state", "questions.json");
    const held = JSON.parse(readFileSync(record, "utf8")) as { questions: Json[] };
    writeFileSync(record, JSON.stringify({ ...held, questions: held.questions.map((q) => ({ ...q, decision: "D-9", applied: true })) }));
    askQuestions(root, [{ phase: "VALIDATE", ...ASKED, question: "How long does a loan last?", own_allowed: true, items: [], places: [] }]);
    const { pack } = parsePack(root, packDocuments(root), { greenfield: false });
    expect(read(root, LENDING_PRD), "the pack still cites Q-1").toContain("(Q-1).");
    expect(waitingSlices(root, pack, [slice("s02", ["LND-F-002"]) as unknown as SliceSpec])).toEqual([]);
  });
});
