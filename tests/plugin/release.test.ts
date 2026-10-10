import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { selfBuild } from "../../scripts/self-build.js";
import { definitionText, definitions } from "../docs/prd-marks.js";
import { removeTree } from "../helpers.js";

/**
 * T-140/T-141/T-142 — MP4's keyless body: the N-7 harness proven end-to-end
 * up to the R-10 key gate, the release pipeline shaped so no commit can spend
 * by itself, the release checklist, and the T-141 positioning surface. The
 * live halves — the budgeted self-build and the public marketplace channels —
 * are dispatch- and user-gated by construction. Since PRDR-336 the self-build
 * is no longer a release requirement (N-7″); its harness and its workflow
 * stay, and so do these tests of them.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");

/** Text as a reader sees it: a sentence wrapped across lines is one sentence. */
const flat = (text: string): string => text.replace(/\s+/gu, " ");
const trees: string[] = [];
afterAll(() => {
  for (const tree of trees) removeTree(tree);
});

describe("T-140 the N-7 harness (dry run — spends nothing by construction)", () => {
  it("wires PRD-only folder → git init → init with the cap, and stops at the R-10 key gate", { timeout: 60_000 }, async () => {
    const result = await selfBuild({ capUsd: 1, dryRun: true });
    trees.push(result.dir);

    expect(result.phase).toBe("dry-run");
    expect(result.ok, result.detail).toBe(true);
    /** the folder contains only the PRD (plus git) — N-7's exact precondition */
    expect(readFileSync(path.join(result.dir, "detent-prd-v3.md"), "utf8")).toContain("Detent");
  });
});

describe("T-140 the release pipeline cannot spend on its own", () => {
  const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "self-build.yml"), "utf8");

  it("workflow_dispatch is the ONLY trigger — the click is the consent (R-10)", () => {
    expect(workflow).toContain("workflow_dispatch:");
    for (const trigger of ["push:", "pull_request:", "schedule:"]) {
      expect(workflow, `self-build must never fire on ${trigger}`).not.toContain(trigger);
    }
  });

  it("takes the X-1 cap as input, gates on the secret, runs the harness, uploads the journal", () => {
    expect(workflow).toContain("spend_cap_usd");
    expect(workflow).toContain("secrets.ANTHROPIC_API_KEY");
    expect(workflow).toContain("scripts/self-build.ts");
    expect(workflow).toContain("upload-artifact");
  });
});

describe("T-142 the release checklist makes its items unskippable", () => {
  const checklist = read("docs", "release-checklist.md");

  it("names the porcelain freeze, strict validation, the install smoke, SEC-6 and schema discipline", () => {
    for (const token of ["C-14′", "plugin:validate", "claude plugin install detent@detent", "SEC-6", "F-3"]) {
      expect(checklist, token).toContain(token);
    }
  });

  it("states its teeth: the release pull request merges only when every item is green", () => {
    expect(flat(checklist)).toContain("merge it only when every item is green");
  });
});

describe("T-141 the README leads with the four unclaimed axes (research C.2)", () => {
  const readme = read("README.md");

  it("names all four axes and the upstream-complementary framing", () => {
    for (const token of ["auditable state machine", "Hard budgets", "drift halts", "write containment", "input"]) {
      expect(readme, token).toContain(token);
    }
  });

  it("says what Detent's own changes and releases pass — the maintenance answer since PRDR-336", () => {
    const text = flat(readme);
    expect(text).toMatch(/every change to Detent lands through a pull request/u);
    expect(text).toContain("(docs/release-checklist.md)");
  });

  it("documents the marketplace install without touching the golden path", () => {
    expect(readme).toContain("claude plugin marketplace add");
    expect(readme).toContain("claude plugin install detent@detent");
  });
});

/** A passage as a reader meets it: the line that opens it, up to the next blank line. */
function passage(text: string, opens: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(opens));
  if (start === -1) return "";
  const end = lines.findIndex((line, i) => i > start && line.trim() === "");
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/**
 * PRDR-336 — the self-build is no longer a release requirement (N-7″, D-16′).
 *
 * The maintainer retired the gate on 2026-10-10, after waiving it for 3.2.0.
 * The PRD records that by amendment, so each passage that stated the gate
 * points forward to the rule that retired it. The checklist keeps item 5's
 * number, retired, because code, tests and the 3.2.0 release notes cite items
 * 6 to 8 by number. And each phrase that stated the gate is pinned absent from
 * the file it stood in.
 */
describe("PRDR-336 the self-build is not a release requirement", () => {
  const prd = read("detent-prd-v3.md");
  const checklist = read("docs", "release-checklist.md");
  const rule = (mark: string): string => flat(definitionText(prd, mark)[0] ?? "");

  it("the PRD defines N-7″ and D-16′ once each: the gate is retired and D-16 withdrawn", () => {
    expect(definitions(prd).get("N-7″")).toHaveLength(1);
    expect(definitions(prd).get("D-16′")).toHaveLength(1);
    expect(rule("N-7″")).toMatch(/not a release requirement/u);
    expect(rule("N-7″"), "the harness stays, to be run by hand").toContain("`self-build` workflow");
    expect(rule("D-16′")).toMatch(/D-16 is withdrawn/u);
  });

  it("every v3 passage that stated the gate points forward", () => {
    expect(rule("N-7′")).toContain("N-7″");
    expect(rule("S-3⁗")).toContain("D-16′");
    expect(flat(passage(prd, "- **MP4 —"))).toContain("D-16′");
    expect(flat(passage(prd, "- **§9 Branch & Merge Contract (B)**"))).toContain("N-7″");
    expect(passage(prd, "D-1…D-25 carry forward")).toContain("D-16′");
    const status = prd.split("\n").find((line) => line.startsWith("| Status |")) ?? "";
    expect(status).toContain("N-7″");
    expect(status, "the Status line cites no checklist item").not.toMatch(/item \d/u);
  });

  it("the checklist asks for no self-build, and item 5 keeps its number, retired", () => {
    const item5 = /\n5\. \*\*[\s\S]*?(?=\n6\. )/u.exec(checklist)?.[0] ?? "";
    expect(item5).toMatch(/retired/iu);
    expect(item5).toContain("N-7″");
    expect(item5).toContain("D-16′");
    expect(item5).not.toContain("Dispatch the");
    for (const [n, title] of [[6, "Version pins coherent"], [7, "Security fixtures green"], [8, "Schema discipline"]] as const) {
      expect(checklist, `item ${String(n)} keeps its number`).toContain(`\n${String(n)}. **${title}`);
    }
    expect(checklist.split("\n")[0], "the title cites no D-16").not.toContain("D-16");
  });

  it("the README and the guide state no release gate", () => {
    const readme = read("README.md");
    expect(readme).not.toContain("self-build.yml/badge.svg");
    expect(readme).not.toMatch(/release requirement/u);
    expect(read("docs", "using-detent.md")).not.toMatch(/release gate/u);
  });

  it("no comment that stated the gate states it still", () => {
    const stated: Readonly<Record<string, readonly string[]>> = {
      ".github/workflows/release.yml": ["no green, no release"],
      ".github/workflows/self-build.yml": ["self-build release gate"],
      "scripts/self-build.ts": ["the permanent gate"],
      "src/init/config.ts": ["the self-build gate"],
      "src/schemas/records.ts": ["n-7 gate"],
      "src/sessions/live.ts": ["the release gate", "item 5 putting"],
      "tests/cli/init-symbols.test.ts": ["the self-build gate"],
      "tests/cli/doctor.test.ts": ["release-checklist item 5"],
      "tests/oracle/pin-parity.test.ts": ["item 5 puts"],
      "tests/scripts/self-build-flags.test.ts": ["the permanent gate"],
    };
    for (const [file, phrases] of Object.entries(stated)) {
      const text = read(file).toLowerCase();
      for (const phrase of phrases) expect(text, `${file}: "${phrase}"`).not.toContain(phrase);
    }
  });
});
