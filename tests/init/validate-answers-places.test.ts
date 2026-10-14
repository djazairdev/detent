import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { askQuestions, readQuestions } from "../../src/init/founder-questions.js";
import { unsettledQuestions } from "../../src/init/plan-waits.js";
import { answerIntoLog, answerIssues, pendingAnswers } from "../../src/init/validate-answers.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { repo } from "./plan-fixture.js";
import { PRICE_DEFAULT, REFUND, STACK_DEFAULT, artifact, decide, type Json } from "./decide-fixture.js";
import { RAW, WROTE, packFor, read, write } from "./write-fixture.js";
import { FEE_RULE, LENDING_PRD, byRound, finding, initThroughValidate, record, writer } from "./validate-fixture.js";

/**
 * #45 — an answer to a question VALIDATE asked is applied where it was asked.
 *
 * PRDR-343 gave the writer an answer at the places the pack cites its `Q-n`.
 * A question VALIDATE's writer asks is cited nowhere in the pack: it records
 * the places its findings were found at instead. On Hearth the founder
 * answered four of them, the writer was given `"answers": []`, and code
 * marked all four applied to the pack, which none of them was. An answer's
 * places are now where the pack cites its question and where the question
 * records, in the pack's documents other than the log; it waits until each
 * of those documents cites its decision, and a finding attached to an open
 * question adds its places to the question's.
 */

const LOAN = {
  question: "How long does a loan last?",
  why_asked: "It is a promise the product makes to its members.",
  options: [
    { answer: "Seven days", consequence: "A tool is back within a week.", basis: "the roadmap's weekly rhythm" },
    { answer: "Fourteen days", consequence: "Fewer tools are free at any time.", basis: "reasoning from the shed's size" },
  ],
};
const TAX = { ...LOAN, question: "What happens when a tool comes back late?", settles: ["G1"] };
const FACTS = "docs/research/verified-facts.md";
const FACT_ROW = { file: FACTS, line: 7, quote: "| 1.1 | Stripe keeps the processing fee when a payment is refunded." };
const account = (over: Json = {}): Json => ({ schema_version: SCHEMA_VERSION, applied: [], declined: [], ...over });
const issueOf = (inputs: Json | undefined): string => String((inputs?.["previous_attempt"] as { issue?: string } | undefined)?.issue ?? "");
const questionsFile = (root: string): string => path.join(stateDir(root), "questions.md");
const asksLate = () => decide(() => artifact({ questions: [TAX], defaults: [REFUND, STACK_DEFAULT, PRICE_DEFAULT] }));
const citesLate = () => write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE() }));
const prompt = (role: string): string => ((loadPromptSet().prompts as Readonly<Record<string, string>>)[role] ?? "").replace(/\s+/gu, " ");

/** The founder writes `text` after a question's `Answer:` in `.detent/questions.md`. */
function answer(root: string, id: string, text: string): void {
  const lines = readFileSync(questionsFile(root), "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith(`## ${id} `));
  const line = lines.findIndex((l, i) => i > at && l.startsWith("Answer:"));
  lines[line] = `Answer: ${text}`;
  writeFileSync(questionsFile(root), lines.join("\n"));
}

interface Given {
  readonly id: string;
  readonly decision: string;
  readonly answer: string;
  readonly places: readonly { file: string; line: number }[];
}
const answersOf = (inputs: Json): Given[] => (inputs["answers"] as Given[] | undefined) ?? [];

/** The writer applies each answer it is given at each of its places in `file`: the answer said on the place's line, its decision cited. */
const appliesIn =
  (file: string, inputs: Json) =>
  (text: string): string => {
    const lines = text.split("\n");
    for (const a of answersOf(inputs)) {
      for (const p of a.places) if (p.file === file && lines[p.line - 1] !== undefined) lines[p.line - 1] = `${String(lines[p.line - 1])} ${a.answer} (${a.decision}).`;
    }
    return lines.join("\n").replaceAll(/\bQ-1\b/gu, answersOf(inputs).find((a) => a.id === "Q-1")?.decision ?? "Q-1");
  };

/** A first `init` whose round-1 writer asks the late-return finding as Q-1, recorded at LENDING_PRD:6; reviewers find nothing after it. */
async function asksInValidate(root: string): Promise<void> {
  let once = true;
  const r = byRound((round, area) => {
    if (round !== 1 || area !== "Lending" || !once) return [];
    once = false;
    return [finding()];
  });
  await initThroughValidate(root, { reviewers: r, writer: writer(() => ({ artifact: account({ asked: [{ findings: ["R1-1"], ...LOAN }] }) })) });
  expect(readQuestions(root).questions).toEqual([expect.objectContaining({ id: "Q-1", phase: "VALIDATE", places: [{ file: LENDING_PRD, line: 6 }], decision: null })]);
}

const clean = () => byRound(() => []);

describe("#45: an answer to a question VALIDATE asked waits to be applied where it was asked (C-3⁶)", () => {
  it("holds it unapplied, and unsettled for planning, at the places its findings were found", async () => {
    const root = repo(RAW);
    await asksInValidate(root);
    answer(root, "Q-1", "1");
    answerIntoLog(root);
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(decision).toMatch(/^D-\d+$/u);
    expect(pendingAnswers(root)).toEqual([{ id: "Q-1", decision, question: LOAN.question, answer: "Seven days", places: [{ file: LENDING_PRD, line: 6 }] }]);
    expect(readQuestions(root).questions[0]?.applied).toBe(false);
    expect(unsettledQuestions(root).map((q) => q.id)).toEqual(["Q-1"]);
    const given = pendingAnswers(root);
    expect(answerIssues(root, given)).toEqual([
      `Q-1 is answered as ${decision}, and ${LENDING_PRD} does not cite ${decision}: apply its answer at ${LENDING_PRD}:6, and cite ${decision} there (C-3⁶)`,
    ]);
    const two = [{ ...given[0], places: [{ file: LENDING_PRD, line: 6 }, { file: LENDING_PRD, line: 7 }] } as (typeof given)[number]];
    expect(answerIssues(root, two), "a document's places are named together").toEqual([
      `Q-1 is answered as ${decision}, and ${LENDING_PRD} does not cite ${decision}: apply its answer at ${LENDING_PRD}:6, ${LENDING_PRD}:7, and cite ${decision} there (C-3⁶)`,
    ]);
    rmSync(path.join(root, ...LENDING_PRD.split("/")));
    expect(answerIssues(root, given), "a document gone is no place to apply it").toEqual([]);
  });

  it("names a place that still cites the question once, and not again as a document without the decision", async () => {
    const root = repo(RAW);
    await initThroughValidate(root, { reviewers: clean(), writer: writer(() => ({ artifact: account() })), decideStub: asksLate() }, citesLate());
    answer(root, "Q-1", "1");
    answerIntoLog(root);
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(answerIssues(root, pendingAnswers(root))).toEqual([
      `Q-1 is answered as ${decision}, and ${LENDING_PRD}:6 still cites Q-1: apply its answer there, and cite ${decision} in its place (C-3⁶)`,
    ]);
  });

  it("gives it to the writer before any round, which applies it there, and marks it applied once the place cites its decision", async () => {
    const root = repo(RAW);
    await asksInValidate(root);
    answer(root, "Q-1", "1");
    const notes: string[] = [];
    const r = clean();
    const w = writer((_, inputs) => ({ edit: { [LENDING_PRD]: appliesIn(LENDING_PRD, inputs) }, artifact: account() }));
    const again = await initThroughValidate(root, { reviewers: r, writer: w, notes });
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(w.inputs[0]?.["answers"]).toEqual([{ id: "Q-1", decision, question: LOAN.question, answer: "Seven days", places: [{ file: LENDING_PRD, line: 6 }] }]);
    expect(w.inputs, "the account is taken at once").toHaveLength(1);
    expect(read(root, LENDING_PRD).split("\n")[5]).toBe(`- **LND-F-002** [M1] A late return MUST block new loans until the tool is back (X-1). Seven days (${decision}).`);
    expect(readQuestions(root).questions[0]).toMatchObject({ decision, applied: true });
    expect(notes.join("\n")).toContain("VALIDATE: the founder answered Q-1, which the pack rests on; its writer applies the answer before any round (C-3⁶)");
    expect(r.inputs.find((i) => i["area"] === "Lending")?.["documents"], "the round after reviews where it landed").toEqual([LENDING_PRD]);
    expect(again.reachedPhase).toBe("READY");
  });

  it("refuses an account that leaves a document among its places without its decision, and takes the next", async () => {
    const root = repo(RAW);
    await asksInValidate(root);
    answer(root, "Q-1", "1");
    const w = writer((call, inputs) => (call === 0 ? { artifact: account() } : { edit: { [LENDING_PRD]: appliesIn(LENDING_PRD, inputs) }, artifact: account() }));
    await initThroughValidate(root, { reviewers: clean(), writer: w });
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(issueOf(w.inputs[1])).toContain(`Q-1 is answered as ${decision}, and ${LENDING_PRD} does not cite ${decision}: apply its answer at ${LENDING_PRD}:6, and cite ${decision} there (C-3⁶)`);
    expect(readQuestions(root).questions[0]?.applied).toBe(true);
  });

  it("gives it to the next round's writer while no writer has applied it, and the validation does not end on it", async () => {
    const root = repo(RAW);
    await asksInValidate(root);
    answer(root, "Q-1", "1");
    const w = writer((call, inputs) => (call < 2 ? { artifact: account() } : { edit: { [LENDING_PRD]: appliesIn(LENDING_PRD, inputs) }, artifact: account() }));
    const r = clean();
    await initThroughValidate(root, { reviewers: r, writer: w });
    expect(w.inputs[2]?.["answers"]).toEqual([expect.objectContaining({ id: "Q-1", places: [{ file: LENDING_PRD, line: 6 }] })]);
    expect([...new Set(r.inputs.map((i) => i["round"]))], "a round reviews it again where it waits, and the next verifies it").toEqual([1, 2]);
    expect(readQuestions(root).questions[0]?.applied).toBe(true);
    expect(record(root).validated).toBe(true);
  });

  it("counts no place in the decision log, or in a document the writer may not change, and marks one with no other place applied", () => {
    const root = repo(RAW);
    askQuestions(root, [
      { phase: "VALIDATE", ...LOAN, own_allowed: true, items: [], places: [{ file: DECISION_LOG_PATH, line: 3 }] },
      { phase: "DECIDE", ...LOAN, question: "How many tools may a member hold?", own_allowed: true, items: [], places: [{ file: "PRD.md", line: 4 }] },
    ]);
    answer(root, "Q-1", "1");
    answer(root, "Q-2", "2");
    answerIntoLog(root);
    expect(pendingAnswers(root)).toEqual([]);
    expect(readQuestions(root).questions.map((q) => q.applied)).toEqual([true, true]);
  });
});

describe("#45: a finding attached to an open question adds its places to the question's (C-2²⁹)", () => {
  it("records them, and the answer then waits on each document among them", async () => {
    const root = repo(RAW);
    let once = true;
    const r = byRound((round, area) => {
      if (round !== 1 || area !== "Lending" || !once) return [];
      once = false;
      return [finding({ places: [FEE_RULE] }), finding({ places: [FACT_ROW] }), finding()];
    });
    const to = (id: string) => ({ id, question: "Q-1" });
    const attaches = writer(() => ({ artifact: account({ attached: [to("R1-1"), to("R1-2"), to("R1-3")] }) }));
    await initThroughValidate(root, { reviewers: r, writer: attaches, decideStub: asksLate() }, citesLate());
    expect(readQuestions(root).questions[0]?.places).toEqual([
      { file: LENDING_PRD, line: 6 },
      { file: LENDING_PRD, line: 7 },
      { file: FACTS, line: 7 },
    ]);
    answer(root, "Q-1", "1");
    const w = writer((call, inputs) => ({
      edit: { [LENDING_PRD]: appliesIn(LENDING_PRD, inputs), ...(call === 0 ? {} : { [FACTS]: (t: string) => `${t}\nA late tool waits for its return (${answersOf(inputs)[0]?.decision ?? ""}).\n` }) },
      artifact: account(),
    }));
    await initThroughValidate(root, { reviewers: clean(), writer: w, decideStub: asksLate() }, citesLate());
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(answersOf(w.inputs[0] ?? {})[0]?.places).toEqual([
      { file: LENDING_PRD, line: 6 },
      { file: LENDING_PRD, line: 7 },
      { file: FACTS, line: 7 },
    ]);
    expect(issueOf(w.inputs[1]), "the pack's Q-1 is applied, and the facts' row is not").toBe(
      `Q-1 is answered as ${decision}, and ${FACTS} does not cite ${decision}: apply its answer at ${FACTS}:7, and cite ${decision} there (C-3⁶)`,
    );
    expect(readQuestions(root).questions[0]?.applied).toBe(true);
  });
});

describe("#45: the writer is told where an answer applies", () => {
  it("says an answer's places include where its question was asked, and what code refuses", () => {
    const fix = /`fix`:[\s\S]*/u.exec(prompt("spec_write"))?.[0] ?? "";
    expect(fix).toContain("every place it applies: where the pack cites the question, and where the question was asked or a finding attached to it");
    expect(fix).toContain("cite its `D-n` there, in place of the `Q-n` where the pack cites one");
    expect(fix).toContain("code refuses an account that leaves the pack citing the question, or a document among its places not citing its `D-n`");
    expect(fix).toContain("each line as it was then");
  });
});
