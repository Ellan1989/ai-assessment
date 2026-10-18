import { describe, expect, it } from "vitest";
import { evaluateAssessment } from "@/lib/domain/engine";
import { QUESTIONNAIRE_V1, fullTradesAnswers } from "../helpers";

const byId = (ev: ReturnType<typeof evaluateAssessment>, id: string) =>
  ev.opportunities.find((o) => o.opportunity_id === id);

describe("hard risk gates (spec §5.2 — cannot be outweighed by a high score)", () => {
  it("a high score stays feasible when review is accepted", () => {
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, fullTradesAnswers());
    const doc = byId(ev, "doc_processing")!;
    expect(doc.gates).toHaveLength(0);
    expect(doc.feasibility).not.toBe("not_recommended");
  });

  it("prefer-full-automation + high impact → gate fires and overrides the score", () => {
    const answers = fullTradesAnswers();
    answers.human_review = { kind: "single", value: "prefer-full-automation" };
    answers.sensitive_data = { kind: "multi", value: ["personal", "financial"] };
    answers.data_access_scope = { kind: "single", value: "write-actions" };
    answers.approval_person = { kind: "single", value: "owner-director" };
    answers.action_impact = { kind: "single", value: "high-critical" };

    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const doc = byId(ev, "doc_processing")!;
    expect(doc.raw_score).toBeGreaterThanOrEqual(45); // still scores highly…
    expect(doc.gates.map((g) => g.id)).toContain("unreviewed_high_impact"); // …but is gated
    expect(doc.feasibility).toBe("not_recommended");
  });

  it("sensitive data without a clear access scope gates the opportunity", () => {
    const answers = fullTradesAnswers();
    answers.sensitive_data = { kind: "multi", value: ["health"] };
    answers.data_access_scope = { kind: "unknown" };
    answers.approval_person = { kind: "single", value: "manager" };
    answers.action_impact = { kind: "single", value: "medium" };

    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const doc = byId(ev, "doc_processing")!;
    expect(doc.gates.map((g) => g.id)).toContain("unclear_data_permissions");
    expect(doc.feasibility).toBe("not_recommended");
  });

  it("no accountable owner with sensitive data is its own gate", () => {
    const answers = fullTradesAnswers();
    answers.sensitive_data = { kind: "multi", value: ["legal"] };
    answers.data_access_scope = { kind: "single", value: "read-summary" };
    answers.approval_person = { kind: "single", value: "nobody" };
    answers.action_impact = { kind: "single", value: "low-reversible" };

    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    expect(byId(ev, "doc_processing")!.gates.map((g) => g.id)).toContain("no_data_governance_owner");
  });

  it("unconnectable systems gate workflow_automation", () => {
    const answers = fullTradesAnswers();
    answers.bottleneck = { kind: "multi", value: ["cross-system-entry"] };
    answers.current_software = { kind: "multi", value: ["none"] };
    answers.cross_system_pair = { kind: "single", value: "between-two-systems", other_text: "two old systems" };
    answers.api_available = { kind: "single", value: "no" };
    answers.manual_copy_frequency = { kind: "single", value: "6-20" };

    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const wf = byId(ev, "workflow_automation")!;
    expect(wf.gates.map((g) => g.id)).toContain("systems_inaccessible");
    expect(wf.feasibility).toBe("not_recommended");
  });

  it("when every selected opportunity is gated, the engine switches to governance-first", () => {
    const answers = fullTradesAnswers();
    answers.human_review = { kind: "single", value: "prefer-full-automation" };
    answers.sensitive_data = { kind: "multi", value: ["personal", "financial", "health", "legal"] };
    answers.data_access_scope = { kind: "unknown" };
    answers.approval_person = { kind: "single", value: "nobody" };
    answers.action_impact = { kind: "single", value: "high-critical" };

    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const selected = ev.opportunities.filter((o) => ev.selected_ids.includes(o.opportunity_id));
    expect(selected.every((o) => o.feasibility === "not_recommended")).toBe(true);
    expect(ev.governance_first).toBe(true);
  });
});
