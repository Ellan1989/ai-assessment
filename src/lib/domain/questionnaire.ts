import { z } from "zod";

// ---------------------------------------------------------------- answer shapes

const OtherText = z.string().trim().max(200);

export const AnswerValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single"), value: z.string(), other_text: OtherText.optional() }),
  z.object({ kind: z.literal("multi"), value: z.array(z.string().max(64)), other_text: OtherText.optional() }),
  z.object({ kind: z.literal("scale"), value: z.number().int().min(1).max(5) }),
  z.object({ kind: z.literal("unknown") }),
]);

export type AnswerValue = z.infer<typeof AnswerValueSchema>;

export type AnswerMap = Record<string, AnswerValue>;

// ---------------------------------------------------------------- questions

export type QuestionType = "single" | "multi" | "band" | "scale5";

export interface QuestionOption {
  id: string;
  label: string;
  /** Numeric midpoint used by the value engine (e.g. weekly count, minutes, AUD/hour). */
  midpoint?: number;
}

export interface BranchCondition {
  question_id: string;
  operator: "equals" | "any_of" | "none_of" | "is_known" | "not_known" | "count_gte";
  values?: string[];
}

export interface VisibilityRule {
  all?: BranchCondition[];
  any?: BranchCondition[];
}

export interface QuestionDef {
  id: string;
  version: number;
  group: "profile" | "bottleneck_detail" | "capability" | "intent" | "risk_overlay";
  groupTitle: string;
  prompt: string;
  helpText?: string;
  type: QuestionType;
  options: QuestionOption[];
  /**
   * When set, options are generated at runtime from the selected values of
   * another (multi-select) question — e.g. "which of your bottlenecks is the
   * worst?" Options of this question are ignored.
   */
  dynamicOptionsFrom?: string;
  allowOther?: boolean;
  allowUnknown?: boolean;
  unknownLabel?: string;
  required: boolean;
  maxSelections?: number;
  minSelections?: number;
  /** Human-readable data usage note, shown to the user in the questionnaire UI. */
  purpose: string;
  /**
   * Screen grouping: consecutive visible questions with the same `screen`
   * value render together on one page. Branch visibility still works —
   * questions appear/disappear within their screen.
   */
  screen?: string;
  /**
   * Industry-flavoured hint shown under the question when the respondent's
   * industry matches (key = company_industry option id). Display-layer only:
   * prompts, option ids and scoring are unaffected.
   */
  industryHints?: Record<string, string>;
  visibleIf?: VisibilityRule;
}

export interface Questionnaire {
  version: string;
  questions: QuestionDef[];
}

// ---------------------------------------------------------------- branching

export function answerIsKnown(a: AnswerValue | undefined): boolean {
  return Boolean(a) && a!.kind !== "unknown";
}

function selectedValues(a: AnswerValue | undefined): string[] {
  if (!a) return [];
  if (a.kind === "single") return [a.value];
  if (a.kind === "multi") return a.value;
  if (a.kind === "scale") return [String(a.value)];
  return [];
}

export function evaluateCondition(cond: BranchCondition, answers: AnswerMap): boolean {
  const a = answers[cond.question_id];
  const vals = selectedValues(a);
  switch (cond.operator) {
    case "equals":
      return cond.values != null && vals.length === 1 && vals[0] === cond.values[0];
    case "any_of":
      return cond.values != null && vals.some((v) => cond.values!.includes(v));
    case "none_of":
      return cond.values != null && !vals.some((v) => cond.values!.includes(v));
    case "is_known":
      return answerIsKnown(a);
    case "not_known":
      return !answerIsKnown(a);
    case "count_gte":
      return vals.length >= Number(cond.values?.[0] ?? Infinity);
    default:
      return false;
  }
}

export function isQuestionVisible(q: QuestionDef, answers: AnswerMap): boolean {
  const rule = q.visibleIf;
  if (!rule) return true;
  if (rule.all && !rule.all.every((c) => evaluateCondition(c, answers))) return false;
  if (rule.any && !rule.any.some((c) => evaluateCondition(c, answers))) return false;
  return true;
}

/** Questions in display order that are visible given current answers. */
export function visibleQuestions(questionnaire: Questionnaire, answers: AnswerMap): QuestionDef[] {
  return questionnaire.questions.filter((q) => isQuestionVisible(q, answers));
}

export interface Screen {
  /** All visible questions on this screen, in display order. */
  questions: QuestionDef[];
  /** Index of the first question within the full visible list. */
  startIndex: number;
  /** Title from the screen's first question's groupTitle. */
  title: string;
}

/**
 * Splits the visible question list into screens: runs of consecutive questions
 * sharing the same `screen` value (questions without one get their own screen).
 */
export function groupIntoScreens(visible: QuestionDef[]): Screen[] {
  const screens: Screen[] = [];
  let current: QuestionDef[] = [];
  let currentKey: string | undefined;
  const flush = () => {
    if (current.length > 0) {
      screens.push({ questions: current, startIndex: screens.reduce((n, s) => n + s.questions.length, 0), title: current[0].groupTitle });
    }
    current = [];
  };
  for (const q of visible) {
    const key = q.screen ?? `solo:${q.id}`;
    if (current.length > 0 && key !== currentKey) flush();
    currentKey = key;
    current.push(q);
  }
  flush();
  return screens;
}

export function getQuestionDef(questionnaire: Questionnaire, questionId: string): QuestionDef | undefined {
  return questionnaire.questions.find((q) => q.id === questionId);
}

/** Industry-specific hint for a question, or null when none applies. */
export function industryHintFor(q: QuestionDef, industryId: string | null): string | null {
  if (!industryId || !q.industryHints) return null;
  return q.industryHints[industryId] ?? null;
}

/**
 * Runtime option list for a question: static options, or values selected in
 * another question when `dynamicOptionsFrom` is set (labels carried over).
 */
export function effectiveOptions(questionnaire: Questionnaire, answers: AnswerMap, q: QuestionDef): QuestionOption[] {
  if (!q.dynamicOptionsFrom) return q.options;
  const source = getQuestionDef(questionnaire, q.dynamicOptionsFrom);
  const srcAnswer = answers[q.dynamicOptionsFrom];
  if (!source || !srcAnswer || srcAnswer.kind !== "multi") return [];
  return srcAnswer.value
    .filter((v) => v !== "other" || Boolean(srcAnswer.other_text?.trim()))
    .map((v) => ({
      id: v,
      label: v === "other" ? srcAnswer.other_text ?? "Other" : source.options.find((o) => o.id === v)?.label ?? v,
    }));
}

/** Required-and-visible questions that are still unanswered. */
export function missingRequired(questionnaire: Questionnaire, answers: AnswerMap): string[] {
  return visibleQuestions(questionnaire, answers)
    .filter((q) => q.required && answers[q.id] == null)
    .map((q) => q.id);
}

// ---------------------------------------------------------------- validation

export interface AnswerValidationError {
  question_id: string;
  error: string;
}

export function validateAnswerForQuestion(
  q: QuestionDef,
  answer: AnswerValue,
  resolvedOptions?: QuestionOption[],
): AnswerValidationError | null {
  const fail = (error: string): AnswerValidationError => ({ question_id: q.id, error });
  const options = resolvedOptions ?? q.options;
  if (answer.kind === "unknown") {
    return q.allowUnknown ? null : fail("This question does not offer a \u201cnot sure\u201d option.");
  }
  if (q.type === "scale5") {
    if (answer.kind !== "scale") return fail("Expected a 1\u20135 rating.");
    return null;
  }
  if (q.type === "single" || q.type === "band") {
    if (answer.kind !== "single") return fail("Expected a single choice.");
    const validIds = new Set(options.map((o) => o.id));
    if (answer.value !== "other" && !validIds.has(answer.value)) return fail("Unknown option.");
    if (answer.value === "other" && !q.allowOther) return fail("\u201cOther\u201d is not accepted here.");
    if ((answer.value === "other" || answer.other_text) && !answer.other_text?.trim())
      return fail("Please describe your \u201cother\u201d answer.");
    if (answer.other_text && answer.other_text.length > 200)
      return fail("Please keep the description under 200 characters.");
    return null;
  }
  // multi
  if (answer.kind !== "multi") return fail("Expected one or more choices.");
  const validIds = new Set(options.map((o) => o.id));
  for (const v of answer.value) {
    if (v !== "other" && !validIds.has(v)) return fail(`Unknown option: ${v}`);
  }
  if (answer.value.includes("other") && !q.allowOther) return fail("\u201cOther\u201d is not accepted here.");
  if (answer.value.includes("other") && !answer.other_text?.trim())
    return fail("Please describe your \u201cother\u201d answer.");
  if (answer.other_text && answer.other_text.length > 200)
    return fail("Please keep the description under 200 characters.");
  const unique = new Set(answer.value);
  if (unique.size !== answer.value.length) return fail("Duplicate options.");
  if (q.minSelections && answer.value.length < q.minSelections) return fail(`Select at least ${q.minSelections}.`);
  if (q.maxSelections && answer.value.length > q.maxSelections) return fail(`Select at most ${q.maxSelections}.`);
  return null;
}

// ---------------------------------------------------------------- read helpers

export function getSingle(answers: AnswerMap, id: string): string | null {
  const a = answers[id];
  if (!a || a.kind !== "single") return null;
  return a.value;
}

export function getMulti(answers: AnswerMap, id: string): string[] {
  const a = answers[id];
  if (!a || a.kind !== "multi") return [];
  return a.value;
}

export function getScale(answers: AnswerMap, id: string): number | null {
  const a = answers[id];
  if (!a || a.kind !== "scale") return null;
  return a.value;
}

/** Midpoint of the chosen band option; null when unknown / unanswered. */
export function bandMidpoint(questionnaire: Questionnaire, answers: AnswerMap, id: string): number | null {
  const a = answers[id];
  if (!a || a.kind !== "single") return null;
  const q = getQuestionDef(questionnaire, id);
  const opt = q?.options.find((o) => o.id === a.value);
  return opt?.midpoint ?? null;
}

/** Display label of the chosen option(s), for report text. */
export function answerLabels(questionnaire: Questionnaire, answers: AnswerMap, id: string): string[] {
  const q = getQuestionDef(questionnaire, id);
  const a = answers[id];
  if (!q || !a || a.kind === "unknown") return ["Not sure"];
  const labelOf = (v: string) =>
    v === "other" ? (a.kind !== "scale" ? a.other_text : undefined) || "Other" : q.options.find((o) => o.id === v)?.label ?? v;
  if (a.kind === "single" || a.kind === "multi") {
    const vals = a.kind === "single" ? [a.value] : a.value;
    return vals.map(labelOf);
  }
  return [String(a.value)];
}
