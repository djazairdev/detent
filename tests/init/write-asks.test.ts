import { describe, expect, it } from "vitest";
import { writeArtifact } from "../../src/fs/layout.js";
import { readDecisionLog } from "../../src/init/decide-log.js";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { askQuestions, readQuestions } from "../../src/init/founder-questions.js";
import { checkPack } from "../../src/init/pack-check.js";
import { MISSING_STACK } from "../../src/init/pack-parse.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { repo } from "./plan-fixture.js";
import { PRICE_DEFAULT, REFUND, STACK_DEFAULT, artifact, decide, type Json } from "./decide-fixture.js";
import { CONFORMING_PACK, DECISION_LOG, packRepo } from "./pack-fixture.js";
import { LENDING, RAW, WROTE, initThroughWrite, packFor, read, write } from "./write-fixture.js";

/**
 * PRDR-341 — WRITE writes the pack around an open question (C-3⁶).
 *
 * On Hearth, WRITE added X-96 to X-107 while it wrote the pack, and X-96 and
 * X-97 changed what ships at launch; nothing marked where the pack rested on
 * a decision the founder had not made. WRITE now writes each place that
 * depends on an open question as its recommended option and cites its `Q-n`,
 * asks what it finds open that is the founder's, and declares every default
 * it adds; the checker resolves `Q-n` against the questions record.
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
/** DECIDE asks the late-return gap and leaves it open; the rest are defaults, the stack among them (X-1 the fee, X-2 the stack, X-3 the price). */
const asksLate = () => decide(() => artifact({ questions: [TAX], defaults: [REFUND, STACK_DEFAULT, PRICE_DEFAULT] }));
const issueOf = (inputs: Json | undefined): string => String((inputs?.["previous_attempt"] as { issue?: string } | undefined)?.issue ?? "");
const prompt = (): string => ((loadPromptSet().prompts as Readonly<Record<string, string>>)["spec_write"] ?? "").replace(/\s+/gu, " ");
const writeTask = (): string => /`write`:[\s\S]*?(?= `fix`:)/u.exec(prompt())?.[0] ?? "";

const LOAN = {
  id: "Q-2",
  question: "How long does a loan last?",
  why_asked: "It is a promise the product makes to its members.",
  options: [
    { answer: "Seven days", consequence: "A tool is back within a week.", basis: "the roadmap's weekly rhythm" },
    { answer: "Fourteen days", consequence: "Fewer tools are free at any time.", basis: "reasoning from the shed's size" },
  ],
};
const LOAN_REQUIREMENT = "- **LND-F-004** [M1] A loan MUST last seven days (Q-2).\n- **LND-AC-04** [M1] Given a loan started on day 0, when day 7 ends, then it is due (LND-F-004).\n";

describe("PRDR-341: WRITE is told the open questions, and cites one where the pack depends on it (C-3⁶)", () => {
  it("gives the session each open question, the next id, and the question that settles a finding", async () => {
    const root = repo(RAW);
    const writer = write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE() }));
    await initThroughWrite(root, writer, { decideStub: asksLate() });
    const given = writer.inputs[0] ?? {};
    expect(given["open_questions"]).toEqual([{ id: "Q-1", question: TAX.question, options: TAX.options }]);
    expect(given["next_question"]).toBe("Q-2");
    expect((given["findings"] as Json[]).find((f) => f["id"] === "G1")?.["settled_by"]).toBe("Q-1");
    expect(read(root, "docs/prd/01-lending.md")).toContain("(Q-1)");
  });

  it("refuses a pack that does not cite the open question a finding rests on", async () => {
    const root = repo(RAW);
    const uncited = write((n, inputs) => ({ files: { ...packFor(inputs), "docs/prd/01-lending.md": n === 0 ? LENDING.replace("(X-1)", "") : packFor(inputs)["docs/prd/01-lending.md"] ?? "" }, artifact: WROTE() }));
    await initThroughWrite(root, uncited, { decideStub: asksLate() });
    expect(issueOf(uncited.inputs[1])).toContain("the pack does not cite Q-1, a question still open, which settles G1: write its recommended option there, and cite it");
  });

  it("tells the write task to write the recommended option and cite the question, and to ask what is the founder's", () => {
    const text = writeTask();
    expect(text).toMatch(/A finding whose `settled_by` is a `Q-n` rests on one: write each place that depends on it as its recommended option, the first, and cite its `Q-n` there/u);
    expect(text).toMatch(/An item you find open that the line makes the founder's, you ask: add it to your artifact's `questions`, numbered from `next_question`/u);
    expect(text).toMatch(/Declare each default you add in your artifact's `defaults`/u);
  });
});

describe("PRDR-341: the checker resolves a Q-n against the questions record (C-3⁶)", () => {
  const citing = { ...CONFORMING_PACK, "docs/design/architecture.md": `${CONFORMING_PACK["docs/design/architecture.md"] ?? ""}A refund keeps the fee (Q-1).\n` };
  const references = (root: string): string[] =>
    checkPack(root, discoverDocs(root).docs, { greenfield: true })
      .findings.filter((f) => f.rule === "reference")
      .map((f) => f.message);
  const ask = (root: string): void => {
    askQuestions(root, [{ phase: "DECIDE", question: "Does a refund keep the fee?", why_asked: "w", options: TAX.options, own_allowed: true, items: [], places: [] }]);
  };

  it("takes a Q-n the record holds open, and one it holds answered", () => {
    const open = packRepo(citing);
    ask(open);
    expect(references(open)).toEqual([]);
    const answered = packRepo(citing);
    ask(answered);
    writeArtifact(answered, "state/questions.json", { ...readQuestions(answered), questions: readQuestions(answered).questions.map((q) => ({ ...q, decision: "D-1" })) });
    expect(references(answered)).toEqual([]);
  });

  it("refuses a Q-n that names no question", () => {
    expect(references(packRepo(citing))).toEqual(["`Q-1`: no such question in .detent/questions.md"]);
  });

  it("does not call the stack missing while the question that settles it is open", () => {
    const withoutStack = DECISION_LOG.slice(0, DECISION_LOG.indexOf("## Stack")) + DECISION_LOG.slice(DECISION_LOG.indexOf("## Packages"));
    const files = { ...CONFORMING_PACK, [DECISION_LOG_PATH]: withoutStack };
    const messages = (root: string): string[] => checkPack(root, discoverDocs(root).docs, { greenfield: true }).findings.map((f) => f.message);
    const waits = packRepo(files);
    const stack = { language: "Go", toolchain: "Go 1.24", scaffold_files: [], gates: {} };
    askQuestions(waits, [{ phase: "DECIDE", question: "Which host?", why_asked: "w", options: TAX.options.map((o) => ({ ...o, stack })), own_allowed: false, items: [], places: [] }]);
    expect(messages(waits)).not.toContain(MISSING_STACK);
    const missing = packRepo(files);
    ask(missing);
    expect(messages(missing), "a question that carries no stack does not settle it").toContain(MISSING_STACK);
  });
});

describe("PRDR-341: WRITE asks what it finds open that is the founder's, and goes on (C-3⁶)", () => {
  const asking = () =>
    write((_, inputs) => {
      const files = packFor(inputs);
      return { files: { ...files, "docs/prd/01-lending.md": `${files["docs/prd/01-lending.md"] ?? ""}${LOAN_REQUIREMENT}` }, artifact: WROTE({ questions: [LOAN] }) };
    });

  it("records each question open under the id the pack cites, with the places that cite it, and prints it", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const stub = asking();
    const result = await initThroughWrite(root, stub, { decideStub: asksLate(), notes });
    expect(result.interrupt).toBeUndefined();
    expect(stub.inputs, "the checker resolves the question the attempt cites before code records it").toHaveLength(1);
    const loan = readQuestions(root).questions.find((q) => q.id === "Q-2");
    expect(loan).toEqual({ ...LOAN, phase: "WRITE", own_allowed: true, items: [], places: [{ file: "docs/prd/01-lending.md", line: 14 }], decision: null });
    expect(notes.join("\n")).toContain("WRITE asks the founder 1 question it found open, recorded in .detent/questions.md");
    expect(notes.join("\n")).toContain("Q-2 (asked at WRITE): How long does a loan last?");
    expect(readDecisionLog(root).defaults.map((d) => d.value), "never settled as a default").not.toContain("Seven days");
  });

  it("points DECIDE's open question at the places in the pack that now cite it", async () => {
    const root = repo(RAW);
    await initThroughWrite(root, asking(), { decideStub: asksLate() });
    expect(readQuestions(root).questions.find((q) => q.id === "Q-1")?.places).toEqual([{ file: "docs/prd/01-lending.md", line: 6 }]);
  });

  it("refuses a question the pack does not cite", async () => {
    const root = repo(RAW);
    const uncited = write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE({ questions: [LOAN] }) }));
    await initThroughWrite(root, uncited, { decideStub: asksLate() });
    expect(issueOf(uncited.inputs[1])).toContain("the pack does not cite Q-2, a question you asked, where the pack depends on its answer");
  });

  it("refuses a question that reuses an id already asked", async () => {
    const root = repo(RAW);
    const reusing = write((n, inputs) => {
      const files = packFor(inputs);
      const id = n === 0 ? "Q-1" : "Q-2";
      return { files: { ...files, "docs/prd/01-lending.md": `${files["docs/prd/01-lending.md"] ?? ""}${LOAN_REQUIREMENT.replace("Q-2", id)}` }, artifact: WROTE({ questions: [{ ...LOAN, id }] }) };
    });
    await initThroughWrite(root, reusing, { decideStub: asksLate() });
    expect(issueOf(reusing.inputs[1])).toContain("your question Q-1 reuses an id already asked; number your questions from next_question");
    expect(readQuestions(root).questions.map((q) => [q.id, q.question])).toEqual([
      ["Q-1", TAX.question],
      ["Q-2", LOAN.question],
    ]);
  });
});

describe("PRDR-341: a default WRITE adds is declared, and code refuses one that is not or that changes a founder decision (C-3⁶)", () => {
  const LOG_ROW = "| X-4 | A loan lasts seven days. | The documents imply a week. |\n";
  const adding = (declare: (n: number) => Json[]) =>
    write((n, inputs, r) => {
      const files = packFor(inputs);
      return {
        files: {
          ...files,
          [DECISION_LOG_PATH]: read(r, DECISION_LOG_PATH).includes("| X-4 ") ? read(r, DECISION_LOG_PATH) : read(r, DECISION_LOG_PATH).replace(/(\| X-3 \|[^\n]*\n)/u, `$1${LOG_ROW}`),
          "docs/prd/01-lending.md": `${files["docs/prd/01-lending.md"] ?? ""}${LOAN_REQUIREMENT.replace("Q-2", "X-4")}`,
        },
        artifact: WROTE({ defaults: declare(n) }),
      };
    });

  it("refuses a default it did not declare, and takes its row out of the log when the second attempt still does not", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const stub = adding(() => []);
    await initThroughWrite(root, stub, { decideStub: asksLate(), notes });
    expect(issueOf(stub.inputs[1])).toContain("X-4 is a default you added and did not declare in your artifact's defaults, with its basis and the founder decisions it touches");
    expect(readDecisionLog(root).defaults.map((d) => d.id)).toEqual(["X-1", "X-2", "X-3"]);
    expect(notes.join("\n")).toContain("WRITE: the log loses X-4, which code refused");
  });

  it("refuses a default that changes a founder decision, and says to ask it", async () => {
    const root = repo(RAW);
    const stub = adding(() => [{ id: "X-4", basis: "the roadmap", touches: [{ decision: "D-1", effect: "changes" }] }]);
    await initThroughWrite(root, stub, { decideStub: asksLate() });
    expect(issueOf(stub.inputs[1])).toContain("X-4 changes the founder decision D-1; a change to a founder decision is the founder's to make, so ask it as a question (C-3⁶)");
    expect(readDecisionLog(root).defaults.map((d) => d.id)).not.toContain("X-4");
  });

  it("keeps a default it declares, that applies founder decisions unchanged", async () => {
    const root = repo(RAW);
    const stub = adding(() => [{ id: "X-4", basis: "the roadmap's weekly rhythm", touches: [{ decision: "X-3", effect: "applies" }] }]);
    await initThroughWrite(root, stub, { decideStub: asksLate() });
    expect(stub.inputs).toHaveLength(1);
    expect(readDecisionLog(root).defaults.map((d) => d.id)).toContain("X-4");
  });

  it("refuses a declaration of a default the log does not gain", async () => {
    const root = repo(RAW);
    const stub = write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE({ defaults: [{ id: "X-9", basis: "b", touches: [] }] }) }));
    await initThroughWrite(root, stub, { decideStub: asksLate() });
    expect(issueOf(stub.inputs[1])).toContain("your artifact declares X-9, a default the decision log does not gain");
  });
});
