import { describe, expect, it } from "vitest";
import { evaluateAssessment } from "@/lib/domain/engine";
import { buildDeterministicReport } from "@/lib/report/deterministic";
import { ReportDocSchema } from "@/lib/report/schema";
import { QUESTIONNAIRE_V1, fullTradesAnswers, minimalAnswers } from "../helpers";

describe("deterministic report consistency (spec §13: numbers must match the engine exactly)", () => {
  it("report numbers are byte-identical to engine outputs", () => {
    const answers = fullTradesAnswers();
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const report = buildDeterministicReport({ evaluation: ev, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });

    expect(ReportDocSchema.safeParse(report).success).toBe(true);

    const priority = ev.opportunities.find((o) => o.opportunity_id === ev.priority_id)!;
    expect(report.value_estimates.annual_hours).toBe(priority.value!.annual_hours);
    expect(report.value_estimates.scenarios).toEqual(priority.value!.scenarios);
    expect(report.value_estimates.confidence).toEqual(ev.confidence);

    for (const ro of report.opportunities) {
      const engineOpp = ev.opportunities.find((o) => o.opportunity_id === ro.opportunity_id)!;
      expect(ro.score).toBe(engineOpp.raw_score);
      expect(ro.band).toBe(engineOpp.band);
      expect(ro.feasibility).toBe(engineOpp.feasibility);
      expect(ro.value).toEqual(engineOpp.value);
    }
  });

  it("always carries the method disclaimer and a 90-day roadmap of three phases", () => {
    const answers = fullTradesAnswers();
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const report = buildDeterministicReport({ evaluation: ev, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });
    expect(report.method_disclaimer).toMatch(/not a guarantee of savings/i);
    expect(report.roadmap).toHaveLength(3);
    expect(report.roadmap[0].phase).toMatch(/0–30/);
    expect(report.roadmap[2].phase).toMatch(/61–90/);
  });

  it("produces a valid concept card with human approval points even when gated", () => {
    const answers = fullTradesAnswers();
    answers.human_review = { kind: "single", value: "prefer-full-automation" };
    answers.sensitive_data = { kind: "multi", value: ["personal"] };
    answers.data_access_scope = { kind: "unknown" };
    answers.approval_person = { kind: "single", value: "manager" };
    answers.action_impact = { kind: "single", value: "high-critical" };
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const report = buildDeterministicReport({ evaluation: ev, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });
    expect(report.priority_concept.human_approval_points.join(" ")).toMatch(/human approval/i);
    expect(report.risks_boundaries.length).toBeGreaterThan(0);
  });

  it("handles the empty-match case without crashing", () => {
    const answers = minimalAnswers();
    answers.bottleneck = { kind: "multi", value: ["other"], other_text: "nothing standard" };
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const report = buildDeterministicReport({ evaluation: ev, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });
    expect(ReportDocSchema.safeParse(report).success).toBe(true);
    expect(report.opportunities).toHaveLength(0);
    expect(report.priority_concept.feasibility).toBe("needs_discovery");
  });
});
