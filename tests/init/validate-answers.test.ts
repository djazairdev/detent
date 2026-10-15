import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { readDecisionLog } from "../../src/init/decide-log.js";
import { askQuestions, readQuestions } from "../../src/init/founder-questions.js";
import { answerIntoLog, correctionIssues, pendingAnswers, questionCites } from "../../src/init/validate-answers.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { fixArtifactSchema } from "../../src/schemas/validate.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { BUDGETS, repo } from "./plan-fixture.js";
import { PRICE_DEFAULT, REFUND, STACK_DEFAULT, TS_STACK, artifact, decide, type Json } from "./decide-fixture.js";
import { RAW, WROTE, packFor, read, write } from "./write-fixture.js";
import { LENDING_PRD, byRound, finding, initThroughValidate, record, writer } from "./validate-fixture.js";

/**
 * PRDR-343 — the founder's answers flow into VALIDATE (C-3⁶, C-2²⁹).
 *
 * On Hearth the operator stopped the run to write four answers into the pack,
 * and the edit to the decision log made the resumed round review all 23 areas
 * again, about $189. Code now reads the answers before each round's writer,
 * writes each to the log before the writer's first batch, and the writer
 * applies it where its `Q-n` is cited; the round after reviews those places
 * and what cites them, and an answer moves no round's scope by itself. A
 * question a reviewer found wrong is corrected, asked again, and an answer
 * given to its earlier wording goes back to the founder.
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
/** TAX as the record holds a question: DECIDE's `settles` is no field of it. */
const ASKED = { question: TAX.question, why_asked: TAX.why_asked, options: TAX.options };
const NOTES = "docs/design/notes.md";
/** DECIDE asks the late-return gap and leaves it open as Q-1 (X-1 the fee, X-2 the stack, X-3 the price). */
const asksLate = () => decide(() => artifact({ questions: [TAX], defaults: [REFUND, STACK_DEFAULT, PRICE_DEFAULT] }));
/** WRITE cites Q-1 at the late-return rule, and a design note cites the fee's default, X-1, and nothing of Lending's. */
const citesLate = () => write((_, inputs) => ({ files: { ...packFor(inputs), [NOTES]: "# Notes\n\nA refund keeps the processing fee (X-1).\n" }, artifact: WROTE() }));
const lending = (per: (round: number) => readonly Json[]) => byRound((round, area) => (area === "Lending" ? per(round) : []));
const ceiling = (n: number) => ({ more: { budgets: { ...BUDGETS, spec_validation_rounds: n } } });
const account = (over: Json = {}): Json => ({ schema_version: SCHEMA_VERSION, applied: [], declined: [], ...over });
const issueOf = (inputs: Json | undefined): string => String((inputs?.["previous_attempt"] as { issue?: string } | undefined)?.issue ?? "");
const questionsFile = (root: string): string => path.join(stateDir(root), "questions.md");

/** The founder writes `text` after a question's `Answer:` in `.detent/questions.md`. */
function answer(root: string, id: string, text: string): void {
  const lines = readFileSync(questionsFile(root), "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith(`## ${id} `));
  const line = lines.findIndex((l, i) => i > at && l.startsWith("Answer:"));
  lines[line] = `Answer: ${text}`;
  writeFileSync(questionsFile(root), lines.join("\n"));
}

/** The writer applies each answer it is given: the decision cited where the question was. */
const applies = (t: string, inputs: Json): string => ((inputs["answers"] as { id: string; decision: string }[] | undefined) ?? []).reduce((text, a) => text.replaceAll(a.id, a.decision), t);
const answering = (over: (inputs: Json, call: number) => Json = () => ({})) =>
  writer((call, inputs) => ({
    edit: { [LENDING_PRD]: (t) => applies(t, inputs) },
    artifact: account({ applied: ((inputs["findings"] as { id: string }[] | undefined) ?? []).map((f) => f.id), ...over(inputs, call) }),
  }));
const prompt = (role: string): string => ((loadPromptSet().prompts as Readonly<Record<string, string>>)[role] ?? "").replace(/\s+/gu, " ");

describe("PRDR-343: an answer given while VALIDATE runs reaches its writer (C-3⁶)", () => {
  it("writes the answer to the log before the round's writer, which applies it where Q-1 is cited, and the round after verifies it", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const r = byRound((round, area) => {
      if (round === 1 && area === "Lending") answer(root, "Q-1", "1");
      return [];
    });
    const w = answering();
    await initThroughValidate(root, { reviewers: r, writer: w, notes, decideStub: asksLate() }, citesLate());
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(decision).toMatch(/^D-\d+$/u);
    expect(readDecisionLog(root).decisions.find((d) => d.id === decision)?.question).toBe(TAX.question);
    expect(w.inputs[0]?.["answers"]).toEqual([{ id: "Q-1", decision, question: TAX.question, answer: "New loans wait for the tool", places: [{ file: LENDING_PRD, line: 6 }] }]);
    expect(w.inputs, "the account is taken at once").toHaveLength(1);
    expect(read(root, LENDING_PRD)).toContain(`until the tool is back (${decision}).`);
    expect(readQuestions(root).questions[0]).toMatchObject({ decision, applied: true });
    expect(read(root, ".detent/questions.md")).toContain(`## Q-1 — answered as ${decision}, applied to the pack (asked at DECIDE)`);
    expect(notes.join("\n")).toContain(`the founder's answers to Q-1 applied, which the round after verifies (C-3⁶)`);
    expect(notes.join("\n"), "the answer read before the writer is said").toContain(`Q-1 is answered, and ${decision} records it in ${DECISION_LOG_PATH}`);
    expect(r.inputs.filter((i) => i["round"] === 2).map((i) => [i["area"], i["documents"]]), "the round after reviews where it landed, and what cites it").toEqual([
      ["foundations", ["docs/prd/index.md"]],
      ["Lending", [LENDING_PRD]],
    ]);
    expect(record(root).validated).toBe(true);
  });

  it("refuses an account that leaves the answered question cited, and keeps the answer in the log when the batch is undone", async () => {
    const root = repo(RAW);
    const r = byRound((round, area) => {
      if (round === 1 && area === "Lending") answer(root, "Q-1", "1");
      return [];
    });
    const uncovers = (t: string) => t.split("\n").filter((l) => !l.includes("LND-AC-02")).join("\n");
    const w = writer((call, inputs) => (call < 2 ? { edit: { [LENDING_PRD]: uncovers }, artifact: account() } : { edit: { [LENDING_PRD]: (t) => applies(t, inputs) }, artifact: account() }));
    await initThroughValidate(root, { reviewers: r, writer: w, decideStub: asksLate() }, citesLate());
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(issueOf(w.inputs[1])).toContain(`Q-1 is answered as ${decision}, and ${LENDING_PRD}:6 still cites Q-1: apply its answer there, and cite ${decision} in its place (C-3⁶)`);
    expect(readDecisionLog(root).decisions.map((d) => d.id), "the batch's rollback leaves the answer in the log").toContain(decision);
    expect(w.inputs[2]?.["answers"], "the next writer is given it again").toEqual([expect.objectContaining({ id: "Q-1", decision })]);
    expect(readQuestions(root).questions[0]?.applied).toBe(true);
  });
});

describe("PRDR-343: where an answer waits to be applied (C-3⁶)", () => {
  it("leaves an answer not applied while the pack still cites its question, and gives it to the next round's writer", async () => {
    const root = repo(RAW);
    const r = byRound((round, area) => {
      if (round === 1 && area === "Lending") answer(root, "Q-1", "1");
      return [];
    });
    const w = writer((call, inputs) => (call < 2 ? { artifact: account() } : { edit: { [LENDING_PRD]: (t) => applies(t, inputs) }, artifact: account() }));
    const states: boolean[] = [];
    await initThroughValidate(
      root,
      { reviewers: { ...r, stage: (spec) => (states.push(readQuestions(root).questions[0]?.applied ?? false), r.stage(spec)) }, writer: w, decideStub: asksLate() },
      citesLate(),
    );
    expect(states.slice(2, 4), "round 2's reviewers run while Q-1 is cited and not applied").toEqual([false, false]);
    expect(w.inputs[2]?.["answers"]).toEqual([expect.objectContaining({ id: "Q-1" })]);
    expect(readQuestions(root).questions[0]?.applied).toBe(true);
  });

  it("marks applied an answer the pack cites nowhere, and never counts the decision log's rows as places to apply it", async () => {
    const root = repo(RAW);
    await initThroughValidate(root, { reviewers: lending(() => []), writer: answering(), decideStub: asksLate() }, citesLate());
    askQuestions(root, [{ phase: "VALIDATE", ...ASKED, question: "How long does a loan last?", own_allowed: true, items: [], places: [] }]);
    const log = path.join(root, ...DECISION_LOG_PATH.split("/"));
    writeFileSync(log, `${readFileSync(log, "utf8")}\nThe loan's length waits on Q-2.\n`);
    expect(questionCites(root).get("Q-2"), "the log's own line is no place to apply it").toBeUndefined();
    answer(root, "Q-2", "1");
    answerIntoLog(root);
    expect(pendingAnswers(root)).toEqual([]);
    expect(readQuestions(root).questions.find((q) => q.id === "Q-2")?.applied).toBe(true);
  });
});

describe("PRDR-343: an answer moves no round's scope by itself (C-2²⁹)", () => {
  it("reviews, after an answer given while init was stopped, where the writer applied it, and not every document citing a decision", async () => {
    const root = repo(RAW);
    const r = lending((round) => (round === 1 ? [finding({ severity: "blocker", category: "invariant", places: [{ file: LENDING_PRD, line: 7, quote: "A refund MUST keep the card processing fee" }] })] : []));
    const declines = answering(() => ({ applied: [], declined: [{ id: "R1-1", reason: "the facts settle it" }] }));
    const first = await initThroughValidate(root, { reviewers: r, writer: declines, decideStub: asksLate(), ...ceiling(1) }, citesLate());
    expect(first.interrupt?.interrupt).toBe("AWAIT_INFO");
    answer(root, "Q-1", "1");
    const notes: string[] = [];
    const again = await initThroughValidate(root, { reviewers: r, writer: declines, notes, decideStub: asksLate(), ...ceiling(1) }, citesLate());
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(notes.join("\n")).toContain("VALIDATE: the founder answered Q-1, which the pack rests on; its writer applies the answer before any round (C-3⁶)");
    expect(declines.inputs[1]).toMatchObject({ findings: [], answers: [expect.objectContaining({ id: "Q-1", decision })] });
    const round2 = r.inputs.filter((i) => i["round"] === 2);
    expect(round2.flatMap((i) => i["documents"] as string[]), "neither the log nor the design note, which cites only X-1").not.toContain(NOTES);
    expect(round2.flatMap((i) => i["documents"] as string[])).not.toContain(DECISION_LOG_PATH);
    expect(round2.find((i) => i["area"] === "Lending")?.["documents"]).toEqual([LENDING_PRD]);
    expect(again.reachedPhase).toBe("READY");
  });

  it("validates a conforming pack again where an answer lands, applying it first", async () => {
    const root = repo(RAW);
    const r = lending(() => []);
    const w = answering();
    await initThroughValidate(root, { reviewers: r, writer: w, decideStub: asksLate() }, citesLate());
    expect(record(root).validated).toBe(true);
    answer(root, "Q-1", "2");
    await initThroughValidate(root, { reviewers: r, writer: w, decideStub: asksLate() }, citesLate());
    const decision = readQuestions(root).questions[0]?.decision ?? "";
    expect(w.inputs.at(-1)?.["answers"]).toEqual([expect.objectContaining({ id: "Q-1", decision, answer: "A day's fee" })]);
    expect(read(root, LENDING_PRD)).toContain(`(${decision})`);
    const after = r.inputs.slice(2);
    expect(after.map((i) => [i["round"], i["task"], i["area"], i["documents"]])).toEqual([
      [1, "review", "foundations", ["docs/prd/index.md"]],
      [1, "review", "Lending", [LENDING_PRD]],
    ]);
  });

  it("holds the log in the record when only an answer moved it, and not when anyone else edited it", async () => {
    const root = repo(RAW);
    const log = path.join(root, ...DECISION_LOG_PATH.split("/"));
    const held = () => JSON.parse(read(root, "docs/conformance.json")) as { documents: Record<string, string>; hash: string };
    await initThroughValidate(root, { reviewers: lending(() => []), writer: answering(), decideStub: asksLate() }, citesLate());
    const before = held();
    answer(root, "Q-1", "1");
    answerIntoLog(root);
    const after = held();
    expect(after.documents[DECISION_LOG_PATH]).not.toBe(before.documents[DECISION_LOG_PATH]);
    expect(after.hash).not.toBe(before.hash);
    writeFileSync(log, `${readFileSync(log, "utf8")}\nA line the operator added.\n`);
    askQuestions(root, [{ phase: "VALIDATE", ...ASKED, question: "How long does a loan last?", own_allowed: true, items: [], places: [] }]);
    answer(root, "Q-2", "1");
    expect(answerIntoLog(root).join("\n"), "the answer is written").toContain("Q-2 is answered");
    expect(held().documents[DECISION_LOG_PATH], "an edit of anyone else's still moves it").toBe(after.documents[DECISION_LOG_PATH]);
  });
});

describe("PRDR-343: a question a reviewer found wrong is corrected and asked again (C-3⁶)", () => {
  const CORRECTED = { ...TAX, options: [TAX.options[0], { ...TAX.options[1], consequence: "Members pay for each late day, up to the tool's price." }] };
  const corrects = (over: Json = {}) => ({ corrected: [{ id: "Q-1", findings: ["R1-1"], question: CORRECTED.question, why_asked: CORRECTED.why_asked, options: CORRECTED.options, ...over }] });
  const wrongOption = finding({ category: "founder", why: "Q-1's second option leaves out the cap", fix: "state the cap in its consequence" });

  it("puts an answer given to the earlier wording back to the founder, never applied, and asks the question again", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const r = lending((round) => {
      if (round === 1) answer(root, "Q-1", "2");
      return round === 1 ? [wrongOption] : [];
    });
    const w = writer(() => ({ artifact: account(corrects()) }));
    await initThroughValidate(root, { reviewers: r, writer: w, notes, decideStub: asksLate() }, citesLate());
    const earlier = (w.inputs[0]?.["answers"] as { decision: string }[])[0]?.decision ?? "";
    expect(w.inputs, "an answer whose question it corrects is not applied, and not refused").toHaveLength(1);
    const q = readQuestions(root).questions[0];
    expect(q).toMatchObject({ id: "Q-1", options: CORRECTED.options, decision: null, applied: false, put_back: `A day's fee (recorded as ${earlier})` });
    expect(read(root, LENDING_PRD), "the place still cites the question").toContain("(Q-1).");
    const file = read(root, ".detent/questions.md");
    expect(file).toContain("## Q-1 — open (asked at DECIDE)");
    expect(file).toContain(`> A review corrected this question after an answer was given to its earlier wording: A day's fee (recorded as ${earlier}). Detent did not apply it; answer the question as it reads now.`);
    expect(file).toMatch(/Answer:\n?$/u);
    expect(notes.join("\n")).toContain("corrects 1 question a reviewer found wrong, and asks the founder again, in .detent/questions.md (C-3⁶):\n  Q-1 (asked at DECIDE)");
    expect(notes.join("\n")).toContain(`put back to you, not applied: A day's fee (recorded as ${earlier}), given to its earlier wording`);
    expect(record(root).rounds[0]?.open, "the finding the correction settles is applied").toEqual([]);
  });

  it("takes an answer written while the writer ran out of the file when its question is corrected", async () => {
    const root = repo(RAW);
    const r = lending((round) => (round === 1 ? [wrongOption] : []));
    const w = writer(() => {
      answer(root, "Q-1", "1");
      return { artifact: account(corrects()) };
    });
    await initThroughValidate(root, { reviewers: r, writer: w, decideStub: asksLate() }, citesLate());
    expect(readQuestions(root).questions[0]).toMatchObject({ decision: null, put_back: "option 1, New loans wait for the tool" });
    expect(readDecisionLog(root).decisions.map((d) => d.question)).not.toContain(TAX.question);
  });

  it("never marks a corrected question applied, though its writer took its cite out", async () => {
    const root = repo(RAW);
    const r = lending((round) => {
      if (round === 1) answer(root, "Q-1", "2");
      return round === 1 ? [wrongOption] : [];
    });
    const w = writer((_, inputs) => ({ edit: { [LENDING_PRD]: (t) => applies(t, inputs) }, artifact: account(corrects()) }));
    await initThroughValidate(root, { reviewers: r, writer: w, decideStub: asksLate() }, citesLate());
    expect(readQuestions(root).questions[0]).toMatchObject({ decision: null, applied: false });
  });

  it("refuses an account that corrects a question not asked, and takes the next", async () => {
    const root = repo(RAW);
    const r = lending((round) => (round === 1 ? [wrongOption] : []));
    const w = writer((call) => ({ artifact: account(corrects(call === 0 ? { id: "Q-7" } : {})) }));
    await initThroughValidate(root, { reviewers: r, writer: w, decideStub: asksLate() }, citesLate());
    expect(issueOf(w.inputs[1])).toContain("Q-7 is no question asked, so there is nothing to correct");
    expect(readQuestions(root).questions[0]?.options).toEqual(CORRECTED.options);
  });

  it("writes a new decision when the corrected question is answered with another option", async () => {
    const root = repo(RAW);
    const r = lending((round) => {
      if (round === 1) answer(root, "Q-1", "2");
      return round === 1 ? [wrongOption] : [];
    });
    await initThroughValidate(root, { reviewers: r, writer: writer(() => ({ artifact: account(corrects()) })), decideStub: asksLate() }, citesLate());
    const earlier = readDecisionLog(root).decisions.map((d) => d.id);
    answer(root, "Q-1", "1");
    answerIntoLog(root);
    const now = readQuestions(root).questions[0];
    expect(now?.decision).not.toBeNull();
    expect(earlier).not.toContain(now?.decision);
    expect(now?.put_back).toBeNull();
  });

  it("refuses a correction of a question that is not asked, one already applied, and the stack's", () => {
    const root = repo(RAW);
    askQuestions(root, [
      { phase: "DECIDE", ...ASKED, own_allowed: true, items: [], places: [] },
      { phase: "DECIDE", question: "Which stack?", why_asked: "It is the product's.", options: ["TypeScript", "Go"].map((answer) => ({ answer, consequence: "The stack the product is built in.", basis: "the documents", stack: TS_STACK })), own_allowed: false, items: [], places: [] },
    ]);
    const file = path.join(stateDir(root), "state", "questions.json");
    const held = JSON.parse(readFileSync(file, "utf8")) as { questions: Json[] };
    writeFileSync(file, JSON.stringify({ ...held, questions: held.questions.map((q, i) => (i === 0 ? { ...q, decision: "D-9", applied: true } : q)) }));
    const fix = (id: string) => fixArtifactSchema.parse(account(corrects({ id })));
    expect(correctionIssues(root, fix("Q-1"))).toEqual(["Q-1 is answered as D-9 and applied to the pack, so a correction comes too late: ask the decision again as a question of its own"]);
    expect(correctionIssues(root, fix("Q-2"))).toEqual(["Q-2 settles the stack, which only DECIDE asks (D-10′): ask a question of your own rather than correct it"]);
    expect(correctionIssues(root, fix("Q-7"))).toEqual(["Q-7 is no question asked, so there is nothing to correct"]);
  });
});

describe("PRDR-343: the writer is told to apply answers and correct questions", () => {
  it("says so in the fix task, and tells the reviewer a cited answered question is the writer's", () => {
    const fix = /`fix`:[\s\S]*/u.exec(prompt("spec_write"))?.[0] ?? "";
    expect(fix).toContain("`answers` are the founder's answers given since the pack cited their questions");
    expect(fix).toContain("Apply each answer at each of its places, in the pack's own grammar, and cite its `D-n` there, in place of the `Q-n` where the pack cites one");
    expect(fix).toContain("list the question in `corrected`, by its `Q-n`");
    expect(fix).toContain("an answer given to its earlier wording goes back to the founder, never applied");
    const review = prompt("spec_review");
    expect(review).toContain("A place that cites a question already answered is the writer's to apply in this round: no defect either");
    expect(review).toContain("A finding applied by correcting a question has its fix in `questions`: judge it there");
  });
});
