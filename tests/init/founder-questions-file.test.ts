import { describe, expect, it } from "vitest";
import { questionNote, readAnswer, renderQuestions, writtenAnswers } from "../../src/init/founder-questions-file.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { FounderQuestion, QuestionsRecord } from "../../src/schemas/founder-questions.js";

/**
 * PRDR-340 — `.detent/questions.md`, the founder's side of the questions
 * record (C-3⁶): rendered by code, answered after each `Answer:`, and rendered
 * again without losing what the founder wrote.
 */

const PRICE: FounderQuestion = {
  id: "Q-1",
  phase: "DECIDE",
  question: "Is borrowing free at launch, or two dollars a day?",
  why_asked: "It is the product's price.",
  options: [
    { answer: "Free in the MVP", consequence: "No revenue until pricing lands.", basis: "PRD.md:3" },
    { answer: "Two dollars a day", consequence: "The payment rail ships with the MVP.", basis: "docs/roadmap.md:4" },
  ],
  own_allowed: true,
  items: [],
  places: [
    { file: "PRD.md", line: 3 },
    { file: "docs/roadmap.md", line: 4 },
  ],
  decision: null,
};
const HOST: FounderQuestion = {
  ...PRICE,
  id: "Q-2",
  question: "Which hosting contract does the product run on?",
  options: PRICE.options.map((o) => ({ ...o, stack: { language: "Go", toolchain: "Go 1.24", scaffold_files: [], gates: {} } })),
  own_allowed: false,
  places: [],
};
const record = (...questions: FounderQuestion[]): QuestionsRecord => ({ schema_version: SCHEMA_VERSION, questions });
const none = new Map<string, string>();

describe("PRDR-340: the file shows each question as the founder decides on it (C-3⁶)", () => {
  it("shows the question, why it is the founder's, each option with what it means and rests on, the recommended first, and where it lands", () => {
    const text = renderQuestions(record(PRICE, { ...HOST, decision: "D-4" }), none, none);
    expect(text).toContain("# Questions for the founder");
    expect(text).toContain("1 open, 1 answered.");
    expect(text).toContain("## Q-1 — open (asked at DECIDE)\n\nIs borrowing free at launch, or two dollars a day?\n\nWhy it is yours: It is the product's price.");
    expect(text).toContain("1) Free in the MVP (recommended) — No revenue until pricing lands. (rests on: PRD.md:3)");
    expect(text).toContain("2) Two dollars a day — The payment rail ships with the MVP. (rests on: docs/roadmap.md:4)");
    expect(text).toContain("Depends on it: PRD.md:3, docs/roadmap.md:4");
    expect(text).toContain("Answer with an option's number, or in your own words.\n\nAnswer:");
    expect(text).toContain("## Q-2 — answered as D-4 (asked at DECIDE)");
    expect(text).toContain("Recorded as D-4 in docs/founder-decisions.md.");
  });

  it("asks only for a number where the question takes no own words", () => {
    expect(renderQuestions(record(HOST), none, none)).toContain("Answer with an option's number.\n\nAnswer:");
  });

  it("prints a question on the terminal with its options and the places that depend on it", () => {
    const text = questionNote(PRICE);
    expect(text).toContain("Q-1 (asked at DECIDE): Is borrowing free at launch, or two dollars a day?");
    expect(text).toContain("why it is yours: It is the product's price.");
    expect(text).toContain("1) Free in the MVP (recommended) — No revenue until pricing lands. (rests on: PRD.md:3)");
    expect(text).toContain("depends on it: PRD.md:3, docs/roadmap.md:4");
  });
});

describe("PRDR-340: what the founder wrote is read back, and kept (C-3⁶)", () => {
  it("reads every line after a question's Answer: up to the next question, and nothing before it", () => {
    const text = [
      "# Questions for the founder",
      "",
      "## Q-1 — open (asked at DECIDE)",
      "",
      "1) Free in the MVP (recommended)",
      "",
      "Answer: Free for members,",
      "two dollars a day for guests.",
      "",
      "## Q-2 — open (asked at DECIDE)",
      "",
      "answer: 2",
      "## Q-3 — open (asked at DECIDE)",
      "",
      "Answer:",
    ].join("\n");
    const written = writtenAnswers(text);
    expect(written.get("Q-1")).toBe("Free for members,\ntwo dollars a day for guests.");
    expect(written.get("Q-2")).toBe("2");
    expect(written.get("Q-3")).toBe("");
  });

  it("renders again with each answer the founder wrote, so a render never loses one", () => {
    const written = new Map([
      ["Q-1", "Free for members,\ntwo dollars a day for guests."],
      ["Q-2", "2"],
    ]);
    const text = renderQuestions(record(PRICE, HOST), written, none);
    expect(writtenAnswers(text)).toEqual(written);
  });

  it("says beside an answer it could not read why, and that the question stays open", () => {
    const text = renderQuestions(record(PRICE), new Map([["Q-1", "7"]]), new Map([["Q-1", "it names option 7, and Q-1 has 2"]]));
    expect(text).toContain("> Detent could not read the answer below: it names option 7, and Q-1 has 2. Q-1 stays open.\n\nAnswer: 7");
  });
});

describe("PRDR-340: an answer is an option's number, or the founder's own words where the question takes them (C-3⁶)", () => {
  it("reads a number in range as that option, however it is written", () => {
    for (const text of ["2", " 2 ", "2.", "2)", "Option 2", "option2"]) expect(readAnswer(PRICE, text), text).toEqual({ kind: "option", index: 1 });
  });

  it("reads words as the founder's own, on one line", () => {
    expect(readAnswer(PRICE, "Free for members,\ntwo dollars a day for guests.")).toEqual({ kind: "own", text: "Free for members, two dollars a day for guests." });
  });

  it("reads nothing as no answer yet", () => {
    expect(readAnswer(PRICE, "   \n ")).toEqual({ kind: "none" });
  });

  it("reports an answer that names no option and gives no words the question takes", () => {
    expect(readAnswer(PRICE, "7")).toEqual({ kind: "unread", why: "it names option 7, and Q-1 has 2" });
    expect(readAnswer(PRICE, "0")).toEqual({ kind: "unread", why: "it names option 0, and Q-1 has 2" });
    expect(readAnswer(HOST, "Our own server")).toEqual({ kind: "unread", why: "it names no option, and Q-2 takes only an option's number, 1 to 2" });
  });
});
