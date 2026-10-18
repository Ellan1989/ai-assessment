import { describe, expect, it } from "vitest";
import { evaluateAssessment } from "@/lib/domain/engine";
import { OPPORTUNITIES } from "@/lib/opportunities";
import { QUESTIONNAIRE_V1, fullTradesAnswers, minimalAnswers } from "../helpers";

const byId = (ev: ReturnType<typeof evaluateAssessment>, id: string) =>
  ev.opportunities.find((o) => o.opportunity_id === id);

describe("opportunity matching — positive and negative cases for every model (spec §13)", () => {
  for (const opp of OPPORTUNITIES) {
    it(`${opp.id}: never triggered by unrelated answers`, () => {
      const answers = minimalAnswers();
      answers.bottleneck = { kind: "multi", value: ["other"], other_text: "something else entirely" };
      const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
      expect(byId(ev, opp.id)).toBeUndefined();
    });
  }

  it("documents bottleneck triggers doc_processing", () => {
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, fullTradesAnswers());
    expect(byId(ev, "doc_processing")).toBeTruthy();
    expect(byId(ev, "enquiry_triage")).toBeTruthy();
  });

  it.each([
    ["customer-service", "customer_service_assist"],
    ["knowledge-lookup", "knowledge_retrieval"],
    ["cross-system-entry", "workflow_automation"],
    ["scheduling-dispatch", "workflow_automation"],
    ["invoicing-chasing", "workflow_automation"],
    ["reporting-analysis", "reporting_analysis"],
    ["meeting-followups", "meeting_followup"],
  ] as const)("%s triggers %s", (bottleneck, oppId) => {
    const answers = minimalAnswers();
    answers.bottleneck = { kind: "multi", value: [bottleneck] };
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    expect(byId(ev, oppId)).toBeTruthy();
  });
});

describe("scoring behaviour (spec §5.1)", () => {
  it("scores each opportunity independently — no single global score", () => {
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, fullTradesAnswers());
    expect(ev.opportunities.length).toBeGreaterThanOrEqual(2);
    expect(ev.opportunities[0].raw_score).toBeGreaterThanOrEqual(ev.opportunities[1].raw_score);
  });

  it("full-data trades case puts doc_processing in a solid band with complete dimensions", () => {
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, fullTradesAnswers());
    const doc = byId(ev, "doc_processing")!;
    expect(doc.raw_score).toBeGreaterThanOrEqual(45);
    expect(doc.unknown_dimensions).toEqual([]);
    // monthly_document_volume 21–100 → midpoint 60/mo ≈ 13.9/wk, minutes 23, cost 65
    expect(doc.value!.inputs.weekly_frequency).toBeCloseTo(60 / 4.33, 3);
    expect(doc.value!.annual_hours).toBeCloseTo((60 / 4.33) * 23 / 60 * 52, 1);
  });

  it("unknown inputs become flagged unknown dimensions, not zeros (spec §13)", () => {
    const answers = minimalAnswers(); // task_volume etc unknown, reporting bottleneck
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const reporting = byId(ev, "reporting_analysis")!;
    expect(reporting.unknown_dimensions).toContain("frequency");
    expect(reporting.value!.annual_hours).toBeNull();
    expect(reporting.value!.missing_inputs.length).toBeGreaterThanOrEqual(2);
    expect(reporting.data_completeness).toBeLessThan(1);
  });

  it("insufficient data caps the band at 'potential' even with a high raw score", () => {
    // Construct: strong pain + strong everything known except enough dims to stay < 60% completeness.
    const answers = minimalAnswers();
    answers.process_standardisation = { kind: "scale", value: 5 };
    answers.process_owner = { kind: "unknown" };
    answers.metrics_tracking = { kind: "unknown" };
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    for (const o of ev.opportunities) {
      if (o.insufficient_data) expect(o.band).not.toBe("priority_validate");
    }
  });

  it("selects up to 3 opportunities and names a priority", () => {
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, fullTradesAnswers());
    expect(ev.selected_ids.length).toBeGreaterThanOrEqual(2);
    expect(ev.selected_ids.length).toBeLessThanOrEqual(3);
    expect(ev.priority_id).toBeTruthy();
    expect(ev.selected_ids).toContain(ev.priority_id!);
  });

  it("flags the primary-bottleneck opportunity and notes shared inputs on the others", () => {
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, fullTradesAnswers());
    const doc = byId(ev, "doc_processing")!;
    const enquiry = byId(ev, "enquiry_triage")!;
    expect(doc.is_primary_bottleneck).toBe(true);
    expect(doc.notes.join(" ")).toMatch(/troubles you most/i);
    expect(enquiry.is_primary_bottleneck).toBe(false);
    expect(enquiry.notes.join(" ")).toMatch(/shared time and cost inputs/i);
  });

  it("a single bottleneck pick is primary without being asked", () => {
    const answers = minimalAnswers(); // bottleneck = [reporting-analysis]
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    expect(byId(ev, "reporting_analysis")!.is_primary_bottleneck).toBe(true);
  });
});
