import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { definitionText, definitions } from "./prd-marks.js";

/**
 * PRDR-338 — the PRD records, before any code (N-6), that Detent settles only
 * what a source or reasoning settles, asks the founder the rest, and never
 * stops `init` where a question is found.
 *
 * C-3⁶ draws the founder's line and makes questions open records rather than
 * stops; C-2²⁹ has VALIDATE ask what its rounds cannot settle. Each clause is a
 * sentence the build implements, so each is pinned here, and each rule the
 * two amend says so where a reader lands on it.
 */
const PRD = readFileSync(new URL("../../detent-prd-v3.md", import.meta.url), "utf8");

/** Text as a reader sees it: a sentence the PRD wraps across lines is one sentence. */
const flat = (text: string): string => text.replace(/\s+/gu, " ");

/** The one definition of `mark`, as a reader sees it. */
const rule = (mark: string): string => flat(definitionText(PRD, mark)[0] ?? "");

/** One sub-bullet of a rule, by its bold head, as a reader sees it. */
function clause(mark: string, head: string): string {
  const lines = (definitionText(PRD, mark)[0] ?? "").split("\n");
  const at = lines.findIndex((l) => l.startsWith(`  - **${head}**`));
  if (at < 0) return "";
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => /^ {2}(?:- |\S)/u.test(l));
  return flat([lines[at], ...(end < 0 ? rest : rest.slice(0, end))].join("\n"));
}

const AMENDED: Record<string, string> = {
  "C-3″": "C-3⁶",
  "C-3⁗": "C-3⁶",
  "C-2⁶": "C-3⁶",
  "C-2¹⁴": "C-2²⁹",
};

describe("PRDR-338 the PRD records the founder's line and questions that do not stop init", () => {
  it("C-3⁶ and C-2²⁹ are each defined once, and name PRDR-338", () => {
    const heads = definitions(PRD);
    for (const mark of ["C-3⁶", "C-2²⁹"]) {
      expect(heads.get(mark) ?? [], `${mark} is defined once`).toHaveLength(1);
      expect(rule(mark), `${mark} names its ticket`).toContain("PRDR-338");
    }
  });

  it("the line is drawn by what a choice affects, and a corrected fact's response is the founder's", () => {
    const text = clause("C-3⁶", "The line.");
    for (const token of [
      "primary source",
      "reasoning",
      "easy to reverse",
      "what C-3″ lists",
      "changes what the product does, promises, protects or costs",
      "trades one goal against another",
      "changes scope or which milestone ships what",
      "any change to a founder decision's meaning",
      "the response to it is the founder's",
    ]) {
      expect(text, token).toContain(token);
    }
  });

  it("a default names its basis and the founder decisions it touches, and a question's options are claims", () => {
    const defaults = clause("C-3⁶", "A default declares what it touches.");
    expect(defaults).toMatch(/names its basis/u);
    expect(defaults).toMatch(/every founder decision it touches, applied unchanged or changed/u);
    expect(defaults).toMatch(/refuses a default with no basis and one that changes a founder decision/u);
    const options = clause("C-3⁶", "A question's options are claims.");
    expect(options).toMatch(/consequence names its basis/u);
    expect(options).toMatch(/goes back to the founder/u);
  });

  it("a question is recorded open where it is found, off a TTY nobody's answer is taken, and `later` stops nothing", () => {
    const text = clause("C-3⁶", "Asked, never waited on.");
    for (const token of ["`Q-n`", "`.detent/questions.md`", "DECIDE, WRITE or VALIDATE", "the recommended one first", "the places that depend on it"]) {
      expect(text, token).toContain(token);
    }
    expect(text).toMatch(/Off a TTY no recommended answer is taken for the founder/u);
    expect(text).toMatch(/`later` leaves their questions open instead of raising AWAIT_INFO/u);
    expect(text).toContain("amending specification decision 9");
    expect(text).toContain("amending specification decision 5");
  });

  it("the pack cites an open question where it depends on one, and answers reach the log between writer batches", () => {
    const written = clause("C-3⁶", "The pack is written around an open question.");
    expect(written).toMatch(/cites its `Q-n` there/u);
    expect(written).toMatch(/checker resolves a `Q-n` as it resolves an `X-n`/u);
    const answers = clause("C-3⁶", "Answers flow in.");
    expect(answers).toMatch(/before each VALIDATE round's writer/u);
    expect(answers).toMatch(/as a `D-n` between writer batches/u);
    expect(answers).toMatch(/makes neither DECIDE's nor WRITE's checkpoint stale/u);
  });

  it("planning waits only for the slices that cite an open question, and PRESENT needs every answer", () => {
    const text = clause("C-3⁶", "Planning plans around open questions.");
    expect(text).toMatch(/SLICE cuts the whole pack as written/u);
    expect(text).toMatch(/holds no requirement citing an open `Q-n`/u);
    expect(text).toMatch(/raises AWAIT_INFO once, just before PRESENT/u);
    expect(text).toMatch(/PRESENT, and so approval, needs every question answered/u);
    expect(rule("C-3⁶"), "C-5's five, and no sixth").toMatch(/The five interrupts stay five/u);
    expect(clause("C-3⁶", "Blocking stays a veto."), "the first design stays a vetoable call").toMatch(/vetoable call 2/u);
  });

  it("C-2²⁹: the writer asks or attaches, reviewers read the questions, and a blocker after a blocker is asked", () => {
    expect(clause("C-2²⁹", "The writer asks or attaches.")).toMatch(/attached to the question and is not patched/u);
    expect(clause("C-2²⁹", "The writer asks or attaches.")).toMatch(/recorded `declined`, with a reason naming its question/u);
    expect(clause("C-2²⁹", "The reviewers are the second reader.")).toMatch(/read the questions file with the foundations/u);
    const repeated = clause("C-2²⁹", "A repeated blocker is asked.");
    expect(repeated).toMatch(/whose `previous` names a blocker of round N−1/u);
    expect(repeated).toMatch(/A blocker after a major starts a chain, and does not end one/u);
    expect(clause("C-2²⁹", "The stop rule counts what Detent can fix.")).toMatch(/do not count among a round's blockers and majors/u);
    expect(clause("C-2²⁹", "The stop rule counts what Detent can fix.")).toMatch(/ceiling stays 8/u);
    expect(clause("C-2²⁹", "An answer is re-validated where it lands.")).toMatch(/not every document that cites any decision/u);
  });

  for (const [old, by] of Object.entries(AMENDED)) {
    it(`${old} points forward to ${by}`, () => {
      const text = definitionText(PRD, old).join("\n");
      expect(text, `${old} is defined`).not.toBe("");
      expect(text).toMatch(new RegExp(`Amended by ${by} \\(PRDR-338\\)`, "u"));
    });
  }

});
