import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderScreen } from "../../src/cli/decide.js";
import { stateDir } from "../../src/fs/layout.js";
import { decideSkeleton } from "../../src/init/decide.js";
import { readDecideRecord } from "../../src/init/decide-record.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { checkDecide, openItems } from "../../src/init/decide-items.js";
import { readDecisionLog, type LogView } from "../../src/init/decide-log.js";
import { decideArtifactSchema } from "../../src/schemas/decide.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { repo } from "./plan-fixture.js";
import { EXISTING, LATE, PRICE, REFUND, SURVEY, artifact, decide, initThrough, type Json } from "./decide-fixture.js";

/**
 * PRDR-339 — DECIDE draws the founder's line by what a choice affects (C-3⁶),
 * and every default and every option names what it rests on.
 *
 * On Hearth, three of DECIDE's 94 defaults reworded the founder's own
 * decisions and nothing in them said so; the founder found them by reading all
 * 95. A default now declares each founder decision it touches, and one that
 * changes a founder decision is refused, so DECIDE asks it instead.
 */

const prompt = (): string => (loadPromptSet().prompts as Readonly<Record<string, string>>)["spec_write"] ?? "";
const flat = (text: string): string => text.replace(/\s+/gu, " ");
const decideTask = (): string => flat(/`decide`:[\s\S]*?(?=\n`write`:)/u.exec(prompt())?.[0] ?? "");
const writeTask = (): string => flat(/`write`:[\s\S]*?(?=\n`fix`:)/u.exec(prompt())?.[0] ?? "");
const fixTask = (): string => flat(/`fix`:[\s\S]*?(?=\nOutput JSON)/u.exec(prompt())?.[0] ?? "");

const CHECKED_CLAIM = { ...(SURVEY["claims"] as Json[])[0], claim_hash: "a".repeat(64), verdict: "wrong", source: "https://docs.stripe.com/refunds", correction: "Stripe keeps the fee.", checked: true };
const ITEMS = openItems({ ...SURVEY, ran: true, claims: [CHECKED_CLAIM] }, { stackOpen: false });
const LOG: LogView = { exists: true, ids: new Set(), decisions: [], defaults: [], stack: null, hasStack: false, rootSlots: new Set(), packages: [] };
const parse = (value: Json) => decideArtifactSchema.parse(value);
/** `value` without `key`, as an earlier build or a careless session would write it. */
const omit = (value: Json, key: string): Json => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

describe("PRDR-339: the decide task draws the founder's line by what a choice affects (C-3⁶)", () => {
  it("makes a question of every class the line makes the founder's, C-3″'s among them", () => {
    const text = decideTask();
    for (const token of [
      "counted in money or contracts rather than in code (C-3″)",
      "changes what the product does, promises, protects or costs",
      "trades one of the founder's goals against another",
      "changes scope or which milestone ships what",
      "changes the meaning of a decision the founder already made",
    ]) {
      expect(text, token).toContain(token);
    }
  });

  it("settles what a primary source or reasoning settles, and an engineering choice inside the founder's goals, whatever engineers would argue", () => {
    const text = decideTask();
    expect(text).toMatch(/a primary source, in the documents or found by web search, or reasoning from the documents/u);
    expect(text).toMatch(/an engineering choice inside the founder's goals that is easy to reverse/u);
    expect(text).toMatch(/a choice is the founder's by what it affects, not by whether engineers would agree/u);
  });

  it("settles a corrected fact, and asks how the product answers it when more than one answer is workable", () => {
    expect(decideTask()).toMatch(/A corrected fact is settled by its source; how the product answers it is a question whenever more than one answer is workable/u);
  });

  it("tells every default to name its basis and the founder decisions it touches, and every option the basis of its consequence", () => {
    const text = decideTask();
    expect(text).toContain("`basis`");
    expect(text).toContain("`touches`");
    expect(text).toMatch(/`effect` `applies`[^.]*`changes`/u);
    expect(text).toMatch(/A default that changes a founder decision is refused: ask it/u);
  });

  it("tells write and fix to add no default the line makes the founder's", () => {
    expect(writeTask()).toMatch(/never one the line `decide` draws makes the founder's/u);
    expect(fixTask()).toMatch(/never one the line `decide` draws makes the founder's/u);
  });
});

describe("PRDR-339: a default and an option name what they rest on", () => {
  it("refuses a default with no basis, and an option with none", () => {
    expect(decideArtifactSchema.safeParse(artifact({ defaults: [omit(LATE, "basis")] })).success).toBe(false);
    expect(decideArtifactSchema.safeParse(artifact({ defaults: [{ ...LATE, basis: "" }] })).success).toBe(false);
    const bare = { ...PRICE, options: PRICE.options.map((o) => omit(o, "basis")) };
    expect(decideArtifactSchema.safeParse(artifact({ questions: [bare] })).success).toBe(false);
  });

  it("takes a touch only as applies or changes", () => {
    expect(decideArtifactSchema.safeParse(artifact({ defaults: [{ ...LATE, touches: [{ decision: "D20", effect: "narrows" }] }] })).success).toBe(false);
    expect(decideArtifactSchema.safeParse(artifact({ defaults: [{ ...LATE, touches: [{ decision: "D20", effect: "applies" }] }] })).success).toBe(true);
  });

  it("has a skeleton that names both fields, and parses", () => {
    const skeleton = decideSkeleton(false);
    expect(decideArtifactSchema.safeParse(skeleton).success).toBe(true);
    const text = JSON.stringify(skeleton);
    expect(text).toContain('"basis"');
    expect(text).toContain('"touches"');
    expect(text).toContain('"effect"');
  });
});

describe("PRDR-339: a default that changes a founder decision is refused, and asked instead (C-3⁶)", () => {
  it("names the decision and says to ask it, and keeps the default out", () => {
    const changing = { ...LATE, touches: [{ decision: "D20", effect: "changes" }, { decision: "D3", effect: "applies" }] };
    const check = checkDecide(parse(artifact({ questions: [PRICE], defaults: [changing, REFUND] })), ITEMS, LOG);
    expect(check.issues.join("\n")).toContain("default 1 changes the founder decision D20; a change to a founder decision is the founder's to make, so ask it as a question (C-3⁶)");
    expect(check.kept.defaults.map((d) => d.value)).toEqual([REFUND.value]);
    expect(check.unsorted.map((i) => i.id)).toEqual(["G1"]);
  });

  it("takes a default that applies founder decisions unchanged", () => {
    const applying = { ...LATE, touches: [{ decision: "D3", effect: "applies" }] };
    const check = checkDecide(parse(artifact({ questions: [PRICE], defaults: [applying, REFUND] })), ITEMS, LOG);
    expect(check.issues).toEqual([]);
    expect(check.kept.defaults).toHaveLength(2);
  });
});

describe("PRDR-339: the log's row keeps its shape and carries the declaration", () => {
  it("writes the basis and the decisions a default applies into its reason", async () => {
    const root = repo(EXISTING);
    const applying = { ...LATE, touches: [{ decision: "D3", effect: "applies" }, { decision: "ADR-007", effect: "applies" }] };
    await initThrough(root, decide(() => artifact({ questions: [PRICE], defaults: [applying, REFUND] })));
    const late = readDecisionLog(root).defaults.find((d) => d.value === LATE.value);
    expect(late?.reason).toBe(`${LATE.reason} Rests on: ${LATE.basis}. Applies unchanged: D3; ADR-007.`);
    const refund = readDecisionLog(root).defaults.find((d) => d.value === REFUND.value);
    expect(refund?.reason).toBe(`${REFUND.reason} Rests on: ${REFUND.basis}.`);
  });
});

describe("PRDR-339: a terminal shows what each option's consequence rests on", () => {
  it("prints the basis beside the consequence", () => {
    const text = renderScreen([{ number: 1, question: PRICE.question, why_asked: PRICE.why_asked, options: PRICE.options, ownAllowed: true }]);
    for (const o of PRICE.options) expect(text).toContain(`${o.consequence} (rests on: ${o.basis})`);
  });
});

describe("PRDR-339: a record an earlier build wrote", () => {
  it("keeps the items it settled when its draft lacks what a draft now carries, and drops the draft", () => {
    const root = repo(EXISTING);
    const key = "b".repeat(64);
    const oldDefault = omit(LATE, "basis");
    const record = { schema_version: SCHEMA_VERSION, settled: { [key]: "X-1" }, draft: { key: "c".repeat(64), artifact: artifact({ defaults: [oldDefault] }) } };
    mkdirSync(path.join(stateDir(root), "state"), { recursive: true });
    writeFileSync(path.join(stateDir(root), "state", "decide-record.json"), `${JSON.stringify(record)}\n`);
    const read = readDecideRecord(root);
    expect(read.settled).toEqual({ [key]: "X-1" });
    expect(read.draft).toBeNull();
  });
});
