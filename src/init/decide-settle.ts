import type { DecideArtifact, DecideQuestion } from "../schemas/decide.js";
import type { DecidedStack, LogAdditions, LogView } from "./decide-log.js";
import { nextId } from "./decide-log.js";
import { placesOf, type Item } from "./decide-items.js";
import type { NewQuestion } from "./founder-questions.js";

/**
 * C-3⁗, C-2¹² (PRDR-282) — how DECIDE asks its questions on a terminal, and
 * what the log gains from its sorting and the founder's answers. C-3⁶
 * (PRDR-340): a question the founder answers later is recorded open, with the
 * items it settles and the places they quote.
 */

/** One question as a terminal shows it, the recommended option first. */
export interface AskedQuestion {
  readonly number: number;
  readonly question: string;
  readonly why_asked: string;
  readonly options: readonly { readonly answer: string; readonly consequence: string; readonly basis: string }[];
  /** False for the question that settles the stack: an answer in the founder's own words carries no stack entry (D-10′). */
  readonly ownAllowed: boolean;
}

/** An option by its index, or the founder's own words. */
export type DecideAnswer = { readonly option: number } | { readonly own: string };

/**
 * C-3⁗: one screen of at most `SCREEN` questions, answered in order. C-3⁶
 * (PRDR-340): fewer answers than the screen holds means the founder answers
 * the rest later, and no screen after it is shown.
 */
export type DecideAsk = (screen: readonly AskedQuestion[]) => Promise<readonly DecideAnswer[]>;

export const SCREEN = 4;

const asked = (q: DecideQuestion, number: number): AskedQuestion => ({
  number,
  question: q.question,
  why_asked: q.why_asked,
  options: q.options.map((o) => ({ answer: o.answer, consequence: o.consequence, basis: o.basis })),
  ownAllowed: !q.options.some((o) => o.stack !== undefined),
});

/** Every question, in screens of at most four, until the founder answers the rest later (C-3⁶). */
export async function askAll(ask: DecideAsk, questions: readonly DecideQuestion[]): Promise<DecideAnswer[]> {
  const answers: DecideAnswer[] = [];
  for (let at = 0; at < questions.length; at += SCREEN) {
    const screen = questions.slice(at, at + SCREEN).map((q, i) => asked(q, at + i + 1));
    const got = await ask(screen);
    if (got.length > screen.length) throw new Error(`the asker answered ${String(got.length)} of ${String(screen.length)} questions`);
    answers.push(...got);
    if (got.length < screen.length) break;
  }
  return answers;
}

/**
 * C-3⁶ (PRDR-339): a default's row says what it rests on and which founder
 * decisions it applies, in its reason, so the log's grammar is unchanged (F-3).
 * A default that changes one never reaches here: `checkDecide` refuses it.
 */
function declaredReason(d: DecideArtifact["defaults"][number]): string {
  const applied = d.touches.filter((t) => t.effect === "applies").map((t) => t.decision);
  return [d.reason, `Rests on: ${d.basis}.`, ...(applied.length > 0 ? [`Applies unchanged: ${applied.join("; ")}.`] : [])].join(" ");
}

/** What the log gains, and which entry settles each item. `answers` are the first questions', in order; the rest stay open (C-3⁶). */
export function settle(sorted: DecideArtifact, answers: readonly DecideAnswer[], log: LogView) {
  const nextD = nextId(log.ids, "D");
  const nextX = nextId(log.ids, "X");
  const add: { decisions: LogAdditions["decisions"][number][]; defaults: LogAdditions["defaults"][number][]; stack: DecidedStack | null } = {
    decisions: [],
    defaults: [],
    stack: null,
  };
  const by = new Map(sorted.settled.map((s) => [s.item, s.entry]));
  for (const d of sorted.defaults) {
    const id = nextX(add.defaults.length);
    add.defaults.push({ id, value: d.value, reason: declaredReason(d) });
    for (const item of d.settles) by.set(item, id);
    if (d.stack !== undefined) add.stack = { ...d.stack, decision: id };
  }
  answers.forEach((answer, n) => {
    const q = sorted.questions[n];
    if (q === undefined) return;
    const option = "option" in answer ? q.options[answer.option] : undefined;
    const id = nextD(add.decisions.length);
    add.decisions.push({
      id,
      question: q.question,
      answer: option?.answer ?? ("own" in answer ? answer.own : ""),
      reason: option?.consequence ?? "The founder's own answer, given at DECIDE.",
    });
    for (const item of q.settles) by.set(item, id);
    if (option?.stack !== undefined) add.stack = { ...option.stack, decision: id };
  });
  return { add, by };
}

/** A question nobody answered on a terminal, as the questions record keeps it: with the items it settles and the places they quote (C-3⁶). */
export function founderQuestion(q: DecideQuestion, open: readonly Item[]): NewQuestion {
  const settled = open.filter((i) => q.settles.includes(i.id));
  return {
    phase: "DECIDE",
    question: q.question,
    why_asked: q.why_asked,
    options: q.options,
    own_allowed: !q.options.some((o) => o.stack !== undefined),
    items: settled.map((i) => i.key),
    places: placesOf(settled),
  };
}
