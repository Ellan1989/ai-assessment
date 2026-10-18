import { describe, expect, it } from "vitest";
import { effectiveOptions, groupIntoScreens, missingRequired, validateAnswerForQuestion, visibleQuestions } from "@/lib/domain/questionnaire";
import { QUESTIONNAIRE_V1, fullTradesAnswers, minimalAnswers } from "../helpers";

describe("dynamic branching (spec §4.2)", () => {
  it("shows document branch only when documents is a bottleneck", () => {
    const withDocs = visibleQuestions(QUESTIONNAIRE_V1, fullTradesAnswers());
    expect(withDocs.map((q) => q.id)).toContain("document_type");

    const without = visibleQuestions(QUESTIONNAIRE_V1, minimalAnswers());
    expect(without.map((q) => q.id)).not.toContain("document_type");
    expect(without.map((q) => q.id)).not.toContain("enquiry_sources");
  });

  it("shows the risk overlay when sensitive data is present", () => {
    const answers = fullTradesAnswers();
    answers.sensitive_data = { kind: "multi", value: ["personal", "financial"] };
    const ids = visibleQuestions(QUESTIONNAIRE_V1, answers).map((q) => q.id);
    expect(ids).toContain("data_access_scope");
    expect(ids).toContain("approval_person");
    expect(ids).toContain("action_impact");
  });

  it("shows the risk overlay when full automation is preferred even without sensitive data", () => {
    const answers = fullTradesAnswers();
    answers.human_review = { kind: "single", value: "prefer-full-automation" };
    const ids = visibleQuestions(QUESTIONNAIRE_V1, answers).map((q) => q.id);
    expect(ids).toContain("action_impact");
  });

  it("risk overlay hidden when no sensitive data and human review accepted", () => {
    const ids = visibleQuestions(QUESTIONNAIRE_V1, minimalAnswers()).map((q) => q.id);
    expect(ids).not.toContain("data_access_scope");
  });

  it("reports missing required questions including branch questions", () => {
    const answers = fullTradesAnswers();
    delete answers.monthly_document_volume;
    expect(missingRequired(QUESTIONNAIRE_V1, answers)).toEqual(["monthly_document_volume"]);
    expect(missingRequired(QUESTIONNAIRE_V1, fullTradesAnswers())).toEqual([]);
  });

  it("asks which area is worst only when several bottlenecks are picked", () => {
    const answers = fullTradesAnswers();
    const several = visibleQuestions(QUESTIONNAIRE_V1, answers).map((q) => q.id);
    expect(several).toContain("primary_bottleneck");

    answers.bottleneck = { kind: "multi", value: ["documents"] };
    const single = visibleQuestions(QUESTIONNAIRE_V1, answers).map((q) => q.id);
    expect(single).not.toContain("primary_bottleneck");
  });

  it("builds the 'which is worst' options from the picked bottlenecks", () => {
    const q = QUESTIONNAIRE_V1.questions.find((x) => x.id === "primary_bottleneck")!;
    const answers = fullTradesAnswers();
    const opts = effectiveOptions(QUESTIONNAIRE_V1, answers, q);
    expect(opts.map((o) => o.id).sort()).toEqual(["documents", "enquiries-quotes"]);
    // labels carry over from the bottleneck question
    expect(opts.find((o) => o.id === "documents")?.label).toMatch(/documents, forms/i);

    // validation accepts a picked bottleneck but rejects one that wasn't picked
    expect(validateAnswerForQuestion(q, { kind: "single", value: "documents" }, opts)).toBeNull();
    expect(validateAnswerForQuestion(q, { kind: "single", value: "meeting-followups" }, opts)?.error).toMatch(/Unknown option/);

    // a custom "other" bottleneck appears with its own text
    answers.bottleneck = { kind: "multi", value: ["documents", "other"], other_text: "stock control" };
    const withOther = effectiveOptions(QUESTIONNAIRE_V1, answers, q);
    expect(withOther.find((o) => o.id === "other")?.label).toBe("stock control");
  });

  it("groups questions into multi-question screens (one topic per screen)", () => {
    const visible = visibleQuestions(QUESTIONNAIRE_V1, fullTradesAnswers());
    const screens = groupIntoScreens(visible);
    // 29 visible questions for two bottlenecks collapse into few screens
    expect(visible.length).toBe(29);
    expect(screens.length).toBeLessThanOrEqual(9);
    // every question appears exactly once, screens are consecutive
    const totalQs = screens.reduce((n, s) => n + s.questions.length, 0);
    expect(totalQs).toBe(visible.length);
    screens.forEach((s, i) => {
      const keys = new Set(s.questions.map((q) => q.screen ?? `solo:${q.id}`));
      expect(keys.size).toBe(1);
      const expected = screens.slice(0, i).reduce((n, x) => n + x.questions.length, 0);
      expect(s.startIndex).toBe(expected);
    });
    // the workload screen keeps the three value inputs together
    const workload = screens.find((s) => s.questions.some((q) => q.id === "task_volume"))!;
    expect(workload.questions.map((q) => q.id)).toEqual(["task_volume", "minutes_per_task", "hourly_cost", "error_or_loss"]);
    // a branch group stays together on its own screen
    const doc = screens.find((s) => s.questions.some((q) => q.id === "document_type"))!;
    expect(doc.questions).toHaveLength(4);
    expect(doc.questions.every((q) => q.screen === "branch-documents")).toBe(true);
  });

  it("single-bottleneck paths get fewer questions and screens", () => {
    const visible = visibleQuestions(QUESTIONNAIRE_V1, minimalAnswers());
    const screens = groupIntoScreens(visible);
    expect(visible.length).toBeLessThanOrEqual(24);
    expect(screens.length).toBeLessThanOrEqual(8);
  });
});

describe("answer validation", () => {
  const q = (id: string) => QUESTIONNAIRE_V1.questions.find((x) => x.id === id)!;

  it("rejects unknown options", () => {
    const err = validateAnswerForQuestion(q("employee_band"), { kind: "single", value: "bogus" });
    expect(err?.error).toMatch(/Unknown option/);
  });

  it("enforces multi-select limits", () => {
    const err = validateAnswerForQuestion(q("bottleneck"), {
      kind: "multi",
      value: ["documents", "enquiries-quotes", "customer-service", "reporting-analysis"],
    });
    expect(err?.error).toMatch(/at most 3/);
  });

  it("requires text when 'other' is selected", () => {
    const err = validateAnswerForQuestion(q("bottleneck"), { kind: "multi", value: ["other"] });
    expect(err?.error).toMatch(/describe/i);
  });

  it("rejects 'unknown' on questions without that option", () => {
    const err = validateAnswerForQuestion(q("timing"), { kind: "unknown" });
    expect(err?.error).toMatch(/not sure/);
  });

  it("accepts 'unknown' where offered", () => {
    const err = validateAnswerForQuestion(q("hourly_cost"), { kind: "unknown" });
    expect(err).toBeNull();
  });

  it("enforces the 1–5 range on scale questions", () => {
    expect(validateAnswerForQuestion(q("process_standardisation"), { kind: "scale", value: 3 })).toBeNull();
    expect(validateAnswerForQuestion(q("process_standardisation"), { kind: "single", value: "3" })).toMatchObject({
      question_id: "process_standardisation",
    });
  });

  it("caps other-text length", () => {
    const err = validateAnswerForQuestion(q("bottleneck"), {
      kind: "multi",
      value: ["other"],
      other_text: "x".repeat(201),
    });
    expect(err).toBeTruthy();
  });
});
