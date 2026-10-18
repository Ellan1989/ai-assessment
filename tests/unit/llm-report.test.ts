import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateReport } from "@/lib/report/generate";
import { buildDeterministicReport } from "@/lib/report/deterministic";
import { evaluateAssessment } from "@/lib/domain/engine";
import { QUESTIONNAIRE_V1, fullTradesAnswers } from "../helpers";

// The LLM client is mocked: these tests pin the merge/retry/fallback contract
// of report generation (spec §7.3) without network access.

const chatJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/llm/client", () => ({
  chatJson: (...args: unknown[]) => chatJsonMock(...args),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, llmEnabled: () => true };
});

const VALID_LLM = {
  executive_summary: {
    situation: "LLM situation for this trades business",
    goal: "LLM goal",
    headline: "LLM headline finding",
    narrative: ["LLM narrative paragraph one."],
  },
  opportunities: [
    {
      opportunity_id: "doc_processing",
      problem: "LLM problem text",
      current_process: "LLM today text",
      expected_improvement: "LLM improvement text",
      fit_reason: "LLM fit text",
    },
  ],
  feasibility_analysis: { process: "LLM process", data: "LLM data", systems: "LLM systems", people: "LLM people" },
};

function setup() {
  const answers = fullTradesAnswers();
  const evaluation = evaluateAssessment(QUESTIONNAIRE_V1, answers);
  return { answers, evaluation };
}

beforeEach(() => {
  chatJsonMock.mockReset();
});

describe("LLM report generation (spec §7.3)", () => {
  it("merges valid LLM narrative and keeps every number identical to the engine", async () => {
    chatJsonMock.mockResolvedValueOnce(structuredClone(VALID_LLM));
    const { answers, evaluation } = setup();

    const report = await generateReport({ evaluation, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });
    const base = buildDeterministicReport({ evaluation, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });

    expect(report.meta.generator).toBe("llm");
    expect(report.executive_summary.headline).toBe("LLM headline finding");
    const doc = report.opportunities.find((o) => o.opportunity_id === "doc_processing")!;
    expect(doc.problem).toBe("LLM problem text");
    expect(doc.fit_reason).toBe("LLM fit text");

    // Numbers are engine-owned — identical to the deterministic skeleton.
    expect(report.value_estimates.annual_hours).toBe(base.value_estimates.annual_hours);
    expect(report.value_estimates.scenarios).toEqual(base.value_estimates.scenarios);
    expect(report.value_estimates.confidence).toEqual(base.value_estimates.confidence);
    for (const ro of report.opportunities) {
      const engineOpp = base.opportunities.find((o) => o.opportunity_id === ro.opportunity_id)!;
      expect(ro.score).toBe(engineOpp.score);
      expect(ro.band).toBe(engineOpp.band);
      expect(ro.value).toEqual(engineOpp.value);
    }
    // Untouched opportunity keeps template narrative (LLM only sent one).
    const untouched = report.opportunities.find((o) => o.opportunity_id === "enquiry_triage");
    if (untouched) expect(untouched.problem).toBe(base.opportunities.find((o) => o.opportunity_id === "enquiry_triage")!.problem);
  });

  it("retries exactly once on invalid LLM output, then succeeds", async () => {
    chatJsonMock
      .mockResolvedValueOnce({ nonsense: true }) // fails Zod validation
      .mockResolvedValueOnce(structuredClone(VALID_LLM));
    const { answers, evaluation } = setup();

    const report = await generateReport({ evaluation, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });
    expect(chatJsonMock).toHaveBeenCalledTimes(2);
    expect(report.meta.generator).toBe("llm");
  });

  it("falls back to the deterministic report after two failures — no error reaches the user", async () => {
    chatJsonMock.mockResolvedValue({ nonsense: true });
    const { answers, evaluation } = setup();

    const report = await generateReport({ evaluation, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });
    expect(chatJsonMock).toHaveBeenCalledTimes(2);
    expect(report.meta.generator).toBe("deterministic");
    expect(report.executive_summary.headline).toBeTruthy();
  });

  it("falls back when the provider is unreachable (chatJson resolves null)", async () => {
    chatJsonMock.mockResolvedValue(null);
    const { answers, evaluation } = setup();

    const report = await generateReport({ evaluation, questionnaire: QUESTIONNAIRE_V1, answers, assessmentId: "a1" });
    expect(report.meta.generator).toBe("deterministic");
  });
});

describe("industry hints (display-layer personalisation)", () => {
  it("every hint key is a valid company_industry option id", async () => {
    const { industryHintFor } = await import("@/lib/domain/questionnaire");
    const industryQ = QUESTIONNAIRE_V1.questions.find((q) => q.id === "company_industry")!;
    const validIds = new Set(industryQ.options.map((o) => o.id));
    for (const q of QUESTIONNAIRE_V1.questions) {
      for (const key of Object.keys(q.industryHints ?? {})) {
        expect(validIds.has(key), `${q.id} has hint for unknown industry "${key}"`).toBe(true);
      }
    }
    expect(industryHintFor(industryQ, "trades-construction")).toBeNull(); // no hint on the industry question itself
    const bottleneck = QUESTIONNAIRE_V1.questions.find((q) => q.id === "bottleneck")!;
    expect(industryHintFor(bottleneck, "trades-construction")).toMatch(/supplier invoices/i);
    expect(industryHintFor(bottleneck, "retail-ecommerce")).toMatch(/order processing/i);
    expect(industryHintFor(bottleneck, null)).toBeNull();
  });
});
