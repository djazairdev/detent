import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import type { DecideAnswer } from "../../src/init/decide.js";
import { decisionLogFile, readDecisionLog } from "../../src/init/decide-log.js";
import { readDecideRecord } from "../../src/init/decide-record.js";
import { readQuestions } from "../../src/init/founder-questions.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { repo } from "./plan-fixture.js";
import { DOCS, EXISTING, LATE, PRICE, PRICE_DEFAULT, REFUND, SORTED, STACK_DEFAULT, SURVEY, artifact, auditFinds, decide, decideOutputs, initThrough, type Json } from "./decide-fixture.js";
import { RAW, initThroughWrite, packFor, WROTE, write } from "./write-fixture.js";

/**
 * PRDR-340 — a question is an open record, never a stop (C-3⁶).
 *
 * On Hearth, DECIDE closed at 01:41 and the founder was back at 10:10: off a
 * terminal the data-protection question's recommended answer was taken for
 * them, and a stop would have idled the run for 8½ hours. A question DECIDE
 * leaves unanswered is recorded open as `Q-n`, printed, and settles its items
 * while open; the founder answers in `.detent/questions.md`, and each phase
 * boundary writes the answers given since to the decision log as `D-n`.
 */

const questionsMd = (root: string): string => readFileSync(path.join(stateDir(root), "questions.md"), "utf8");
const logText = (root: string): string => readFileSync(decisionLogFile(root), "utf8");
const keysSettledBy = (root: string, entry: string): string[] =>
  Object.entries(readDecideRecord(root).settled)
    .filter(([, e]) => e === entry)
    .map(([key]) => key);

/** The founder writes `text` after the question's `Answer:`. */
function answer(root: string, id: string, text: string): void {
  const file = path.join(stateDir(root), "questions.md");
  const lines = readFileSync(file, "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith(`## ${id} `));
  const line = lines.findIndex((l, i) => i > at && l.startsWith("Answer:"));
  lines[line] = `Answer: ${text}`;
  writeFileSync(file, lines.join("\n"));
}

const TAX = { ...PRICE, question: "Who pays the sales tax on a rental?", why_asked: "It is a cost the members see.", settles: ["G1"] };

describe("PRDR-340: off a terminal, DECIDE records each question open and completes (C-3⁶)", () => {
  it("records the question as Q-1, with what the founder decides on, the items it settles and the places they quote", async () => {
    const root = repo(EXISTING);
    await initThrough(root, decide((_, i) => SORTED(i)));
    expect(readQuestions(root).questions).toEqual([
      {
        id: "Q-1",
        phase: "DECIDE",
        question: PRICE.question,
        why_asked: PRICE.why_asked,
        options: PRICE.options,
        own_allowed: true,
        items: keysSettledBy(root, "Q-1"),
        places: [
          { file: "PRD.md", line: 3 },
          { file: "docs/roadmap.md", line: 4 },
        ],
        decision: null,
      },
    ]);
    expect(keysSettledBy(root, "Q-1"), "C1, the price").toHaveLength(1);
    expect(questionsMd(root)).toContain(`## Q-1 — open (asked at DECIDE)\n\n${PRICE.question}`);
  });

  it("takes no answer for the founder, raises no AWAIT_INFO, and prints the question as it records it", async () => {
    const root = repo(EXISTING);
    const notes: string[] = [];
    const result = await initThrough(root, decide((_, i) => SORTED(i)), { notes });
    expect(result.interrupt).toBeUndefined();
    expect(result.reachedPhase).toBe("READY");
    expect(existsSync(path.join(stateDir(root), "state", "DECIDE.json")), "DECIDE completed").toBe(true);
    const log = readDecisionLog(root);
    expect(log.decisions).toEqual([]);
    expect(log.defaults.map((d) => d.value)).toEqual([LATE.value, REFUND.value]);
    expect(decideOutputs(root)["opened"]).toEqual(["Q-1"]);
    const said = notes.join("\n");
    expect(said).toContain("1 question left open for the founder (Q-1)");
    expect(said).toContain("DECIDE asks the founder 1 question, recorded open in .detent/questions.md. `init` goes on");
    expect(said).toContain(`Q-1 (asked at DECIDE): ${PRICE.question}`);
    expect(said).toContain("1) Free in the MVP (recommended) — No revenue until pricing lands. (rests on: PRD.md:3, which makes borrowing free)");
    expect(said).not.toContain("without asking, since off a terminal");
  });
});

describe("PRDR-340: on a terminal, `later` leaves questions open and DECIDE completes (C-3⁶)", () => {
  it("records every question open when the founder answers later at the first", async () => {
    const root = repo(EXISTING);
    const result = await initThrough(root, decide((_, i) => SORTED(i)), { ask: async () => [] });
    expect(result.interrupt).toBeUndefined();
    expect(readDecisionLog(root).decisions).toEqual([]);
    expect(readQuestions(root).questions.map((q) => [q.id, q.question, q.decision])).toEqual([["Q-1", PRICE.question, null]]);
  });

  it("shows no screen after the one the founder answers later on", async () => {
    const root = repo(EXISTING);
    const gaps = ["late returns", "lost tools", "damaged tools", "member bans"].map((topic) => ({ topic, detail: `nothing on ${topic}`, passages: [] }));
    const questions = ["C1", "G1", "G2", "G3", "G4"].map((id, n) => ({ ...PRICE, question: `What does the founder want for case ${String(n + 1)} of the rental terms?`, settles: [id] }));
    const screens: number[] = [];
    const ask = async (screen: readonly { number: number }[]): Promise<readonly DecideAnswer[]> => {
      screens.push(screen.length);
      return [{ option: 0 }];
    };
    await initThrough(root, decide(() => artifact({ questions, defaults: [REFUND] })), { ask, audit: auditFinds("wrong", { ...SURVEY, gaps }) });
    expect(screens, "one screen of four, answered at its first question").toEqual([4]);
    expect(readDecisionLog(root).decisions.map((d) => d.id)).toEqual(["D-1"]);
    expect(readQuestions(root).questions.map((q) => q.id)).toEqual(["Q-1", "Q-2", "Q-3", "Q-4"]);
  });

  it("keeps an answer given before `later` as a D-n, and records the rest open", async () => {
    const root = repo(EXISTING);
    const ask = async (): Promise<readonly DecideAnswer[]> => [{ option: 1 }];
    await initThrough(root, decide(() => artifact({ questions: [PRICE, TAX], defaults: [REFUND] })), { ask });
    expect(readDecisionLog(root).decisions.map((d) => [d.id, d.question, d.answer])).toEqual([["D-1", PRICE.question, "**Two dollars a day**"]]);
    expect(readQuestions(root).questions.map((q) => [q.id, q.question])).toEqual([["Q-1", TAX.question]]);
    expect(decideOutputs(root)["asked"]).toEqual(["D-1"]);
    expect(decideOutputs(root)["opened"]).toEqual(["Q-1"]);
  });
});

describe("PRDR-340: an open question settles its items, so a re-run launches no session for them (C-3⁶)", () => {
  it("re-runs DECIDE for a veto without a session, the price still settled by Q-1", async () => {
    const root = repo(EXISTING);
    const stub = decide((_, i) => SORTED(i));
    await initThrough(root, stub);
    writeFileSync(decisionLogFile(root), logText(root).replace(LATE.value, "A late return costs a day's fee."));
    const notes: string[] = [];
    const again = await initThrough(root, stub, { notes });
    expect(again.executed).toEqual(["DECIDE"]);
    expect(stub.inputs).toHaveLength(1);
    expect(notes.join("\n")).toContain("or by a question still open, so no session ran (C-2¹², C-3⁶)");
  });

  it("numbers a later question after every question the record holds, and tells the session what is open", async () => {
    const root = repo(EXISTING);
    const stub = decide((n, i) => (n === 0 ? SORTED(i) : artifact({ questions: [{ ...TAX, question: "What happens when a tool comes back late?" }] })));
    await initThrough(root, stub);
    writeFileSync(decisionLogFile(root), logText(root).split("\n").filter((l) => !l.startsWith("| X-1 ")).join("\n"));
    await initThrough(root, stub);
    expect(stub.inputs[1]?.["open_questions"]).toEqual([{ id: "Q-1", question: PRICE.question }]);
    expect((stub.inputs[1]?.["items"] as Json[]).map((i) => i["id"])).toEqual(["G1"]);
    expect(readQuestions(root).questions.map((q) => q.id)).toEqual(["Q-1", "Q-2"]);
  });

  it("refuses a question already open in other words, and cites it as settling the item", async () => {
    const root = repo(EXISTING);
    const reworded = { ...PRICE, question: "At launch, is borrowing free, or does it cost two dollars a day?", settles: ["G1"] };
    const stub = decide((n, i) => (n === 0 ? SORTED(i) : artifact({ questions: [reworded] })));
    await initThrough(root, stub);
    writeFileSync(decisionLogFile(root), logText(root).split("\n").filter((l) => !l.startsWith("| X-1 ")).join("\n"));
    await initThrough(root, stub);
    expect(String((stub.inputs[2]?.["previous_attempt"] as { issue: string }).issue)).toContain("is already asked and open, as Q-1; cite it in settled instead");
    expect(readQuestions(root).questions.map((q) => q.id), "never asked twice").toEqual(["Q-1"]);
    expect(keysSettledBy(root, "Q-1")).toHaveLength(2);
  });
});

describe("PRDR-340: an answer in the questions file reaches the decision log at the next phase boundary (C-3⁶)", () => {
  it("writes an option's answer as a D-n, marks the question answered, keeps what the founder wrote, and says so", async () => {
    const root = repo(EXISTING);
    const stub = decide((_, i) => SORTED(i));
    await initThrough(root, stub);
    answer(root, "Q-1", "2");
    const again = await initThrough(root, stub);
    expect(readDecisionLog(root).decisions).toEqual([
      { id: "D-1", question: PRICE.question, answer: "**Two dollars a day**", reason: "The payment rail ships with the MVP." },
    ]);
    expect(logText(root)).toContain("### Answered in .detent/questions.md");
    expect(readQuestions(root).questions[0]?.decision).toBe("D-1");
    expect(questionsMd(root)).toContain("## Q-1 — answered as D-1 (asked at DECIDE)");
    expect(questionsMd(root)).toContain("Answer: 2");
    expect(again.messages).toContain(`Q-1 is answered, and D-1 records it in ${DECISION_LOG_PATH}: ${PRICE.question} → Two dollars a day (C-3⁶)`);
    /* Written at the first boundary, before any digest read the log: DECIDE re-runs on it, and the item stands settled by D-1. */
    expect(again.executed).toEqual(["DECIDE"]);
    expect(stub.inputs).toHaveLength(1);
  });

  it("writes the founder's own words where the question takes them", async () => {
    const root = repo(EXISTING);
    await initThrough(root, decide((_, i) => SORTED(i)));
    answer(root, "Q-1", "Free for members, two dollars a day for guests.");
    await initThrough(root, decide((_, i) => SORTED(i)));
    expect(readDecisionLog(root).decisions).toEqual([
      { id: "D-1", question: PRICE.question, answer: "**Free for members, two dollars a day for guests.**", reason: "The founder's own answer, given in .detent/questions.md." },
    ]);
  });

  it("reports an answer it cannot read once, and leaves the question open", async () => {
    const root = repo(EXISTING);
    const stub = decide((_, i) => SORTED(i));
    await initThrough(root, stub);
    answer(root, "Q-1", "7");
    const first = await initThrough(root, stub);
    const said = "Q-1: Detent could not read its answer, since it names option 7, and Q-1 has 2; it stays open (C-3⁶)";
    expect(first.messages).toContain(said);
    expect(questionsMd(root)).toContain("> Detent could not read the answer below: it names option 7, and Q-1 has 2. Q-1 stays open.\n\nAnswer: 7");
    expect(existsSync(decisionLogFile(root)) ? readDecisionLog(root).decisions : []).toEqual([]);
    const second = await initThrough(root, stub);
    expect(second.messages, "the file says it after that").not.toContain(said);
    expect(readQuestions(root).questions[0]?.decision).toBeNull();
  });

  it("records the stack an answer to the stack's question carries, and takes no own words for it", async () => {
    const root = repo(DOCS);
    const hosted = {
      question: "Which hosting contract does the product run on?",
      why_asked: "Each is a contract with its own monthly cost.",
      options: [
        { answer: "A managed Node host", consequence: "A monthly fee.", basis: "the host's price list", stack: { language: "TypeScript", toolchain: "Node.js 24" } },
        { answer: "The founder's Go server", consequence: "No new contract.", basis: "the server the founder runs", stack: { language: "Go", toolchain: "Go 1.24", gates: { test: "go test ./..." } } },
      ],
      settles: ["stack"],
    };
    const stub = decide(() => artifact({ questions: [hosted], defaults: [LATE, REFUND, PRICE_DEFAULT] }));
    await initThrough(root, stub);
    expect(readQuestions(root).questions[0]?.own_allowed).toBe(false);
    expect(readDecisionLog(root).stack, "the stack waits for its answer").toBeNull();
    /* A veto re-runs DECIDE while the stack's question is open: the open question settles the stack, so no session runs. */
    writeFileSync(decisionLogFile(root), logText(root).replace(LATE.value, "A late return costs a day's fee."));
    expect((await initThrough(root, stub)).executed).toEqual(["DECIDE"]);
    expect(stub.inputs).toHaveLength(1);
    answer(root, "Q-1", "Our own server");
    expect((await initThrough(root, stub)).messages.join("\n")).toContain("it names no option, and Q-1 takes only an option's number, 1 to 2");
    answer(root, "Q-1", "2");
    await initThrough(root, stub);
    expect(readDecisionLog(root).stack).toEqual({ decision: "D-1", language: "Go", toolchain: "Go 1.24", scaffold_files: [], gates: { test: "go test ./..." } });
    expect(stub.inputs, "the open stack question settled the stack: no session ran again").toHaveLength(1);
  });

  it("writes an answer the log already holds once, as a boundary that stopped before recording it left it", async () => {
    const root = repo(EXISTING);
    await initThrough(root, decide((_, i) => SORTED(i)));
    answer(root, "Q-1", "2");
    writeFileSync(
      decisionLogFile(root),
      `${logText(root)}\n## Decisions\n\n| Id | Question | Answer | Reason |\n|---|---|---|---|\n| D-7 | ${PRICE.question} | **Two dollars a day** | The payment rail ships with the MVP. |\n`,
    );
    await initThrough(root, decide((_, i) => SORTED(i)));
    expect(readDecisionLog(root).decisions.map((d) => d.id)).toEqual(["D-7"]);
    expect(readQuestions(root).questions[0]?.decision).toBe("D-7");
  });

  it("reopens the items an answered question settled when its D-n is deleted, as a veto of any entry does", async () => {
    const root = repo(EXISTING);
    const stub = decide((n, i) => (n === 0 ? SORTED(i) : artifact({ defaults: [PRICE_DEFAULT] })));
    await initThrough(root, stub);
    answer(root, "Q-1", "1");
    await initThrough(root, stub);
    writeFileSync(decisionLogFile(root), logText(root).split("\n").filter((l) => !l.startsWith("| D-1 ")).join("\n"));
    await initThrough(root, stub);
    expect((stub.inputs[1]?.["items"] as Json[]).map((i) => i["id"])).toEqual(["C1"]);
  });
});

describe("PRDR-340: on a pack WRITE has written, an answer starts neither a DECIDE nor a WRITE session (C-3⁶)", () => {
  it("re-runs both in code, since their keys name the log, and writes nothing", async () => {
    const root = repo(RAW);
    /* The late-return gap is asked and left open; the rest are defaults, the stack among them. */
    const sorted = decide(() => artifact({ questions: [TAX], defaults: [REFUND, STACK_DEFAULT, PRICE_DEFAULT] }));
    const writer = write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE() }));
    await initThroughWrite(root, writer, { decideStub: sorted });
    expect(sorted.inputs).toHaveLength(1);
    expect(writer.inputs).toHaveLength(1);

    answer(root, "Q-1", "1");
    const again = await initThroughWrite(root, writer, { decideStub: sorted });
    expect(readDecisionLog(root).decisions.map((d) => [d.id, d.question])).toEqual([["D-1", TAX.question]]);
    expect(again.executed).toEqual(expect.arrayContaining(["DECIDE", "WRITE"]));
    expect(sorted.inputs, "no DECIDE session").toHaveLength(1);
    expect(writer.inputs, "no WRITE session").toHaveLength(1);
  });
});
