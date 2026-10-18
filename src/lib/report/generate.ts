import { z } from "zod";
import type { AnswerMap, Questionnaire } from "@/lib/domain/questionnaire";
import { answerLabels } from "@/lib/domain/questionnaire";
import type { EvaluationOutput } from "@/lib/domain/engine";
import { chatJson } from "@/lib/llm/client";
import { llmEnabled } from "@/lib/config";
import { buildDeterministicReport } from "./deterministic";
import { ReportDocSchema, type ReportDoc } from "./schema";

/**
 * Report generation (spec §7.3):
 * 1. Build the deterministic report (all numbers from the engine).
 * 2. If an LLM is configured, ask it to re-phrase narrative fields only.
 * 3. Validate with Zod; on failure retry once; on second failure keep the
 *    deterministic version. Users never see raw model errors.
 */

const LLMOutputSchema = z.object({
  executive_summary: z.object({
    situation: z.string().max(600),
    goal: z.string().max(400),
    headline: z.string().max(400),
    narrative: z.array(z.string().max(600)).min(1).max(6),
  }),
  opportunities: z.array(
    z.object({
      opportunity_id: z.string(),
      problem: z.string().max(600),
      current_process: z.string().max(600),
      expected_improvement: z.string().max(600),
      fit_reason: z.string().max(600),
    }),
  ),
  feasibility_analysis: z.object({
    process: z.string().max(600),
    data: z.string().max(600),
    systems: z.string().max(600),
    people: z.string().max(600),
  }),
});

const SYSTEM_PROMPT = `You are a conservative business analyst writing a short, personalised opportunity report for an Australian small business.

Hard rules — violating any of them makes the output useless:
- NEVER invent numbers, percentages, financial figures, ROI, prices, industry benchmarks or software capabilities. Numbers come only from the data we give you.
- NEVER present a recommendation as validated or proven. Use hedged language ("planning assumption", "subject to pilot").
- NEVER recommend tools or integrations that are not in the provided system list.
- Respect every risk gate we list: gated opportunities must be framed as "fix the precondition first", not as things to build now.
- Write in clear, plain Australian business English. No hype, no exclamation marks, no emojis.
- Return ONLY a JSON object matching the requested shape.`;

export async function generateReport(params: {
  evaluation: EvaluationOutput;
  questionnaire: Questionnaire;
  answers: AnswerMap;
  assessmentId: string;
}): Promise<ReportDoc> {
  const base = buildDeterministicReport(params);
  if (!llmEnabled()) return base;

  const userPayload = buildLlmInput(params);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJson(SYSTEM_PROMPT, JSON.stringify(userPayload));
    if (raw == null) continue;
    const parsed = LLMOutputSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[report] LLM output failed validation (attempt %d)", attempt + 1);
      continue;
    }
    return mergeNarrative(base, parsed.data);
  }
  return base;
}

function buildLlmInput(params: {
  evaluation: EvaluationOutput;
  questionnaire: Questionnaire;
  answers: AnswerMap;
}): unknown {
  const { evaluation: ev, questionnaire: q, answers } = params;
  const selected = ev.opportunities.filter((o) => ev.selected_ids.includes(o.opportunity_id));

  const labelPairs = (id: string) => ({ question: id, answer: answerLabels(q, answers, id) });
  return {
    task: "Rewrite the narrative fields of this assessment report. Keep every number we provide; do not add new ones.",
    user_answers: [
      labelPairs("company_industry"),
      labelPairs("employee_band"),
      labelPairs("business_goal"),
      labelPairs("bottleneck"),
      labelPairs("task_volume"),
      labelPairs("minutes_per_task"),
      labelPairs("hourly_cost"),
      labelPairs("error_or_loss"),
      labelPairs("process_standardisation"),
      labelPairs("exception_rate"),
      labelPairs("data_location"),
      labelPairs("current_software"),
      labelPairs("input_channels"),
      labelPairs("metrics_tracking"),
      labelPairs("process_owner"),
      labelPairs("human_review"),
      labelPairs("sensitive_data"),
    ],
    engine_results: {
      headline: ev.profile_summary.headline,
      selected_opportunities: selected.map((o) => ({
        opportunity_id: o.opportunity_id,
        name: o.name,
        score: o.raw_score,
        band: o.band,
        feasibility: o.feasibility,
        hard_risk_gates: o.gates.map((g) => ({ title: g.title, mitigation: g.mitigation })),
        annual_hours: o.value?.annual_hours ?? null,
        scenario_hours: o.value?.scenarios.map((s) => ({ name: s.name, released_hours: s.released_hours, time_value_aud: s.time_value_aud })) ?? [],
        unknown_dimensions: o.unknown_dimensions,
      })),
      confidence: ev.confidence,
      governance_first: ev.governance_first,
    },
    output_instructions: {
      executive_summary: "3–4 short paragraphs: their situation, their goal, the single most important finding, and (if governance_first) the gates that change the recommendation.",
      opportunities: "For EACH selected opportunity_id exactly as given: problem (their words), current_process (from their answers), expected_improvement (reference the scenario hours/time values we provided, verbatim numbers only), fit_reason (reference score and dimensions).",
      feasibility_analysis: "One sentence each for process, data, systems, people, grounded strictly in their answers.",
    },
  };
}

function mergeNarrative(base: ReportDoc, llm: z.infer<typeof LLMOutputSchema>): ReportDoc {
  const merged: ReportDoc = structuredClone(base);
  merged.meta.generator = "llm";
  merged.executive_summary = llm.executive_summary;

  for (const o of llm.opportunities) {
    const target = merged.opportunities.find((m) => m.opportunity_id === o.opportunity_id);
    if (!target) continue;
    target.problem = o.problem;
    target.current_process = o.current_process;
    target.expected_improvement = o.expected_improvement;
    target.fit_reason = o.fit_reason;
    // score/band/feasibility/value stay from the engine — never overwritten.
  }
  merged.feasibility_analysis = llm.feasibility_analysis;
  return ReportDocSchema.parse(merged);
}
