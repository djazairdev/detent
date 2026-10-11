import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readDecisionLog } from "../../src/init/decide-log.js";
import { askQuestions, readQuestions } from "../../src/init/founder-questions.js";
import { askedReason, attachedReason, reviewerQuestions } from "../../src/init/validate-asks.js";
import { reviewKey } from "../../src/init/validate-kept.js";
import type { ReviewTask } from "../../src/init/validate-round.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { reviewFindingSchema } from "../../src/schemas/validate.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { BUDGETS, repo } from "./plan-fixture.js";
import { PRICE_DEFAULT, REFUND, STACK_DEFAULT, artifact, decide, type Json } from "./decide-fixture.js";
import { RAW, WROTE, packFor, read, write } from "./write-fixture.js";
import { FEE_RULE, LENDING_PRD, byRound, finding, initThroughValidate, record, writer } from "./validate-fixture.js";

/**
 * PRDR-342 — VALIDATE asks what its rounds cannot settle (C-2²⁹).
 *
 * On Hearth the metrics breakdown's blocker came back four rounds running,
 * each patch a new check of SQL text with another route past it, while the
 * fix was a design choice the writer was never allowed to make. The writer
 * now asks a finding whose fix is the founder's and attaches one an open
 * question's answer settles; a blocker after a blocker reaches it marked, to
 * be asked; and what waits on the founder does not count for the stop rule.
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
const account = (over: Json = {}): Json => ({ schema_version: SCHEMA_VERSION, applied: [], declined: [], ...over });
const asks = (ids: string[]): Json => account({ asked: [{ findings: ids, ...LOAN }] });
const lending = (per: (round: number) => readonly Json[]) => byRound((round, area) => (area === "Lending" ? per(round) : []));
const ceiling = (n: number) => ({ more: { budgets: { ...BUDGETS, spec_validation_rounds: n } } });
const rounds = (inputs: readonly Json[]): unknown[] => [...new Set(inputs.map((i) => i["round"]))];
const issueOf = (inputs: Json | undefined): string => String((inputs?.["previous_attempt"] as { issue?: string } | undefined)?.issue ?? "");
/** DECIDE asks the late-return gap and leaves it open as Q-1; WRITE cites it at the late-return rule. */
const asksLate = () => decide(() => artifact({ questions: [TAX], defaults: [REFUND, STACK_DEFAULT, PRICE_DEFAULT] }));
const citesLate = () => write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE() }));
const addRow = (id: string) => (t: string) => t.replace(/(\| X-4 \|[^\n]*\n)/u, `$1| ${id} | A loan lasts a week. | The documents imply it. |\n`);
const prompt = (role: string): string => ((loadPromptSet().prompts as Readonly<Record<string, string>>)[role] ?? "").replace(/\s+/gu, " ");

describe("PRDR-342: the writer asks or attaches (C-2²⁹)", () => {
  it("records an asked group as an open question at its findings' places, prints it, and leaves them declined, waiting on it", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const r = lending((round) => (round === 1 ? [finding()] : []));
    const w = writer(() => ({ artifact: asks(["R1-1"]) }));
    const result = await initThroughValidate(root, { reviewers: r, writer: w, notes });
    expect(result.reachedPhase).toBe("READY");
    const why_asked = `${LOAN.why_asked} R1-1: ${String(finding()["why"])}`;
    expect(readQuestions(root).questions, "the reviewer's why follows the writer's").toEqual([
      { id: "Q-1", phase: "VALIDATE", ...LOAN, why_asked, own_allowed: true, items: [], places: [{ file: LENDING_PRD, line: 6 }], decision: null, applied: false, put_back: null },
    ]);
    expect(read(root, ".detent/questions.md")).toContain("## Q-1 — open (asked at VALIDATE)");
    expect(notes.join("\n")).toContain(`round 1: asks the founder 1 question, recorded in .detent/questions.md, and patches none of the findings asked (C-2²⁹):\n  Q-1 (asked at VALIDATE): ${LOAN.question}`);
    expect(record(root).rounds[0]?.open).toEqual([expect.objectContaining({ id: "R1-1", left: "declined", reason: askedReason("Q-1") })]);
    expect(w.inputs, "an asked finding is accounted for").toHaveLength(1);
    expect(notes.join("\n")).toContain("1 waiting on the founder (C-2¹⁴, C-2²⁹)");
    expect(rounds(r.inputs), "a major that waits on the founder earns no round").toEqual([1]);
    expect(record(root).validated).toBe(true);
    expect((w.inputs[0]?.["expected_output"] as Json)["attached"], "no question is open to attach to").toEqual([]);
  });

  it("attaches a finding to the open question whose answer settles it, asks nothing new, and leaves it waiting", async () => {
    const root = repo(RAW);
    const r = lending((round) => (round === 1 ? [finding()] : []));
    const w = writer(() => ({ artifact: account({ attached: [{ id: "R1-1", question: "Q-1" }] }) }));
    await initThroughValidate(root, { reviewers: r, writer: w, decideStub: asksLate() }, citesLate());
    expect(w.inputs[0]?.["open_questions"]).toEqual([{ id: "Q-1", question: TAX.question, options: TAX.options }]);
    expect((w.inputs[0]?.["expected_output"] as Json)["attached"]).toEqual([expect.objectContaining({ question: "Q-1" })]);
    expect(w.inputs, "the attachment is accepted at once").toHaveLength(1);
    expect(readQuestions(root).questions.map((q) => q.id)).toEqual(["Q-1"]);
    expect(record(root).rounds[0]?.open).toEqual([expect.objectContaining({ id: "R1-1", left: "declined", reason: attachedReason("Q-1") })]);
    expect(rounds(r.inputs)).toEqual([1]);
  });

  it("keeps an asked finding waiting when the round's fixes are undone", async () => {
    const root = repo(RAW);
    const fee = finding({ places: [FEE_RULE], fix: "name the fee" });
    const r = lending((round) => (round === 1 ? [finding(), fee] : []));
    const uncovers = (t: string) => t.split("\n").filter((l) => !l.includes("LND-AC-02")).join("\n");
    const w = writer(() => ({ edit: { [LENDING_PRD]: uncovers }, artifact: account({ applied: ["R1-2"], asked: [{ findings: ["R1-1"], ...LOAN }] }) }));
    await initThroughValidate(root, { reviewers: r, writer: w });
    expect(record(root).rounds[0]?.open).toEqual([
      expect.objectContaining({ id: "R1-1", left: "declined", reason: askedReason("Q-1") }),
      expect.objectContaining({ id: "R1-2", left: "undone" }),
    ]);
  });

  it("refuses an attachment to a question that is not open, and one left there waits on nothing", async () => {
    const root = repo(RAW);
    const r = lending((round) => (round === 1 ? [finding()] : []));
    const w = writer(() => ({ artifact: account({ attached: [{ id: "R1-1", question: "Q-9" }] }) }));
    await initThroughValidate(root, { reviewers: r, writer: w });
    expect(issueOf(w.inputs[1])).toContain("R1-1 is attached to Q-9, which is no question still open");
    expect(record(root).rounds[0]?.open).toEqual([expect.objectContaining({ id: "R1-1", left: "declined", reason: "its writer did not say whether it applied it" })]);
    expect(rounds(r.inputs), "it counts, so a round verifies it").toEqual([1, 2]);
  });
});

describe("PRDR-342: the writer declares each default it adds (C-3⁶)", () => {
  it("refuses an undeclared default, and the log loses it when the second attempt still does not declare it", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const r = lending((round) => (round === 1 ? [finding()] : []));
    const w = writer(() => ({ edit: { [DECISION_LOG_PATH]: (t) => (t.includes("| X-5 |") ? t : addRow("X-5")(t)) } }));
    await initThroughValidate(root, { reviewers: r, writer: w, notes });
    expect(issueOf(w.inputs[1])).toContain("X-5 is a default you added and did not declare in your artifact's defaults");
    expect(readDecisionLog(root).defaults.map((d) => d.id)).not.toContain("X-5");
    expect(notes.join("\n")).toContain("round 1: the log loses X-5, which code refused");
  });

  it("refuses a declared default that changes a founder decision", async () => {
    const root = repo(RAW);
    const r = lending((round) => (round === 1 ? [finding()] : []));
    const touches = [{ decision: "D-1", effect: "changes" }];
    const w = writer((_, inputs) => ({
      edit: { [DECISION_LOG_PATH]: (t) => (t.includes("| X-5 |") ? t : addRow("X-5")(t)) },
      artifact: account({ applied: (inputs["findings"] as { id: string }[]).map((f) => f.id), defaults: [{ id: "X-5", basis: "the documents imply it", touches }] }),
    }));
    await initThroughValidate(root, { reviewers: r, writer: w });
    expect(issueOf(w.inputs[1])).toContain("X-5 changes the founder decision D-1; a change to a founder decision is the founder's to make, so ask it as a question (C-3⁶)");
    expect(readDecisionLog(root).defaults.map((d) => d.id)).not.toContain("X-5");
  });

  it("judges a fix that cites a refused default without it, so the round's fixes are undone", async () => {
    const root = repo(RAW);
    const r = lending((round) => (round === 1 ? [finding()] : []));
    const w = writer(() => ({
      edit: {
        [DECISION_LOG_PATH]: (t) => (t.includes("| X-5 |") ? t : addRow("X-5")(t)),
        [LENDING_PRD]: (t) => t.replace("until the tool is back (", "until the tool is back, within a week (X-5; "),
      },
    }));
    await initThroughValidate(root, { reviewers: r, writer: w });
    expect(record(root).rounds[0]?.open).toEqual([expect.objectContaining({ id: "R1-1", left: "undone" })]);
    expect(read(root, LENDING_PRD)).not.toContain("X-5");
  });
});

describe("PRDR-342: the reviewers are the second reader (C-2²⁹)", () => {
  it("gives every reviewer the questions with the foundations, each with what its answer became", async () => {
    const root = repo(RAW);
    const fee = finding({ places: [FEE_RULE], fix: "name the fee" });
    const r = lending((round) => (round === 1 ? [finding(), fee] : []));
    const w = writer(() => ({ artifact: account({ declined: [{ id: "R1-2", reason: "the facts settle the fee" }], asked: [{ findings: ["R1-1"], ...LOAN }] }) }));
    await initThroughValidate(root, { reviewers: r, writer: w });
    expect(r.inputs.filter((i) => i["round"] === 1).map((i) => i["questions"])).toEqual([[], []]);
    const given = [{ id: "Q-1", ...LOAN, why_asked: `${LOAN.why_asked} R1-1: ${String(finding()["why"])}`, places: [{ file: LENDING_PRD, line: 6 }], answered_as: null }];
    expect(r.inputs.filter((i) => i["round"] === 2).map((i) => i["questions"])).toEqual([given, given]);
  });

  it("reads a question answered as its decision", () => {
    const root = repo(RAW);
    askQuestions(root, [{ phase: "VALIDATE", ...LOAN, own_allowed: true, items: [], places: [] }]);
    const file = path.join(root, ".detent", "state", "questions.json");
    const held = JSON.parse(readFileSync(file, "utf8")) as { questions: { decision: string | null }[] };
    writeFileSync(file, JSON.stringify({ ...held, questions: held.questions.map((q) => ({ ...q, decision: "D-7" })) }));
    expect(reviewerQuestions(root)).toEqual([expect.objectContaining({ id: "Q-1", answered_as: "D-7" })]);
  });

  it("keys a kept review on the questions once one is asked, and every other under the key it had", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "detent-key-")));
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/facts.md"), "# Facts\n\nThe ministry sets the term's dates.\n");
    writeFileSync(path.join(root, "docs/lending.md"), "# Lending\n\nA tool is lent for a week.\n");
    const task: ReviewTask = { area: { name: "Lending", documents: ["docs/lending.md"] }, foundations: ["docs/facts.md"], documents: ["docs/lending.md"], previous: null, diff: null, heuristic: [] };
    /* validate-round-prefix.test.ts's key, computed at 8e09020. */
    const before = "6f97e3b1edc8b7470a85b208f11d4692ca3b80a20a9f9a2e466978068d0ccba8";
    expect(reviewKey(root, 1, task, "a".repeat(64))).toBe(before);
    askQuestions(root, [{ phase: "VALIDATE", ...LOAN, own_allowed: true, items: [], places: [] }]);
    expect(reviewKey(root, 1, task, "a".repeat(64))).not.toBe(before);
  });

  it("takes a finding of the founder's category", () => {
    expect(reviewFindingSchema.safeParse(finding({ category: "founder" })).success).toBe(true);
  });

  it("tells the reviewer to read the questions, to leave what waits on one, and what the founder's category is", () => {
    const review = prompt("spec_review");
    expect(review).toContain("`questions` are the decisions the founder was asked");
    expect(review).toContain("A place that cites an open question's `Q-n` is written as its recommended option and waits for the answer: it is no defect");
    expect(review).toContain("A finding declined as asked of the founder or attached to a question waits for the founder's answer: do not report it again");
    expect(review).toContain("- `founder`: you are the founder's second reader (C-2²⁹)");
    expect(review).toContain("an option of a question whose `consequence` its `basis` does not support");
  });

  it("tells the writer to ask, attach, declare its defaults, and ask a marked blocker", () => {
    const fix = /`fix`:[\s\S]*/u.exec(prompt("spec_write"))?.[0] ?? "";
    expect(fix).toContain("declare each in your artifact's `defaults`, with its `id`, `basis` and `touches`");
    expect(fix).toContain("A finding whose fix is the founder's");
    expect(fix).toContain("you attach to it and do not patch: list it in `attached` with the question's `Q-n`");
    expect(fix).toContain("A finding that carries `ask: true` is a blocker after a blocker");
    expect(fix).toContain("ask it, or attach it, and never apply or decline it");
    expect(fix).toContain("A finding of category `founder` is the reviewer's report that a default, a fix or an option takes a decision that is the founder's: ask it");
  });
});

describe("PRDR-342: a repeated blocker is asked (C-2²⁹)", () => {
  it("marks a blocker after a blocker with its chain back to the first round's, refuses it applied, and leaves a blocker after a major unmarked", async () => {
    const root = repo(RAW);
    const r = lending((round) => {
      if (round === 1) return [finding()];
      if (round === 2) return [finding({ severity: "blocker", category: "invariant", previous: "R1-1" })];
      return round === 3 ? [finding({ severity: "blocker", category: "invariant", previous: "R2-1" })] : [];
    });
    const w = writer((call, inputs) => {
      const id = (inputs["findings"] as { id: string }[])[0]?.id ?? "";
      if (call < 2) return { artifact: account({ declined: [{ id, reason: "the criterion states it" }] }) };
      return { artifact: call === 2 ? account({ applied: [id] }) : asks([id]) };
    });
    await initThroughValidate(root, { reviewers: r, writer: w });
    expect(w.inputs[1]?.["findings"], "a blocker after a major is not marked").toEqual([expect.not.objectContaining({ ask: true })]);
    const at = (id: string) => ({ id, file: LENDING_PRD, line: 6 });
    expect(w.inputs[2]?.["findings"]).toEqual([expect.objectContaining({ id: "R3-1", ask: true, chain: [at("R1-1"), at("R2-1"), at("R3-1")] })]);
    expect(issueOf(w.inputs[3])).toContain("R3-1 is a blocker after a blocker, so two rounds of fixes have not settled it: ask it, or attach it to the open question whose answer settles it (C-2²⁹)");
    expect(record(root).rounds[2]?.open).toEqual([expect.objectContaining({ id: "R3-1", severity: "blocker", reason: askedReason("Q-1") })]);
    const where = `${LENDING_PRD}:6`;
    expect(readQuestions(root).questions[0]?.why_asked, "its question lists the chain").toBe(
      `${LOAN.why_asked} R3-1: ${String(finding()["why"])} It came back 3 rounds running: R1-1 at ${where}, R2-1 at ${where}, R3-1 at ${where}.`,
    );
    expect(rounds(r.inputs)).toEqual([1, 2, 3]);
  });

  it("starts the chain of one that carries on from a stopped validation at its last round's finding", async () => {
    const root = repo(RAW);
    const r = lending((round) => [finding({ severity: "blocker", category: "invariant", previous: round === 1 ? null : "R1-1" })]);
    const w = writer((call, inputs) => {
      const id = (inputs["findings"] as { id: string }[])[0]?.id ?? "";
      return { artifact: call === 0 ? account({ declined: [{ id, reason: "the criterion states it" }] }) : asks([id]) };
    });
    const first = await initThroughValidate(root, { reviewers: r, writer: w, ...ceiling(1) });
    expect(first.interrupt?.interrupt).toBe("AWAIT_INFO");
    writeFileSync(path.join(root, ...LENDING_PRD.split("/")), read(root, LENDING_PRD).replace("until the tool is back", "until the tool is back, with a day's grace"));
    await initThroughValidate(root, { reviewers: r, writer: w, ...ceiling(1) });
    const at = (id: string) => ({ id, file: LENDING_PRD, line: 6 });
    expect(w.inputs[1]?.["findings"]).toEqual([expect.objectContaining({ id: "R2-1", ask: true, chain: [at("R1-1"), at("R2-1")] })]);
  });
});

describe("PRDR-342: the stop rule counts what Detent can fix (C-2²⁹)", () => {
  it("lets a blocker that waits on the founder stop nothing at the ceiling", async () => {
    const root = repo(RAW);
    const fee = finding({ places: [FEE_RULE], fix: "name the fee" });
    const r = lending((round) => (round === 1 ? [finding({ severity: "blocker", category: "invariant" }), fee] : []));
    const w = writer(() => ({ artifact: account({ declined: [{ id: "R1-2", reason: "the facts settle the fee" }], asked: [{ findings: ["R1-1"], ...LOAN }] }) }));
    const result = await initThroughValidate(root, { reviewers: r, writer: w, ...ceiling(1) });
    expect(result.interrupt, "the major it declined leaves the round short of the stop rule; the asked blocker stops nothing").toBeUndefined();
    expect(result.reachedPhase).toBe("READY");
    expect(record(root)).toMatchObject({ validated: true, rounds: [{ round: 1, counts: { blocker: 1, major: 1 } }] });
  });

  it("runs no round when a validation cut short left only findings that wait on the founder", async () => {
    const root = repo(RAW);
    let alive = false;
    const notes: string[] = [];
    const dies = Object.assign(notes, {
      push: (...texts: string[]): number => {
        if (!alive && texts.some((t) => t.startsWith("VALIDATE round 1: 1 finding"))) throw new Error("killed after the round");
        return Array.prototype.push.apply(notes, texts);
      },
    });
    const r = lending((round) => (round === 1 ? [finding({ severity: "blocker", category: "invariant" })] : []));
    const w = writer(() => ({ artifact: asks(["R1-1"]) }));
    await expect(initThroughValidate(root, { reviewers: r, writer: w, notes: dies })).rejects.toThrow(/killed after the round/u);
    expect(record(root)).toMatchObject({ validated: false, rounds: [{ round: 1, counts: { blocker: 1 } }] });
    alive = true;
    const resumed = await initThroughValidate(root, { reviewers: r, writer: w, notes: dies });
    expect(resumed.reachedPhase).toBe("READY");
    expect(rounds(r.inputs)).toEqual([1]);
    expect(notes.join("\n")).toContain("VALIDATE: nothing in the pack moved since round 1");
    expect(record(root).validated).toBe(true);
  });
});
