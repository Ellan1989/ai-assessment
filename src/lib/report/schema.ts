import { z } from "zod";

/** Report document schema (spec §7.1 / §7.2). Numbers are injected from the
 * deterministic engine after any LLM pass, so the LLM can never author them. */

export const ValueScenarioSchema = z.object({
  name: z.enum(["conservative", "baseline", "optimistic"]),
  reduction_ratio: z.number(),
  released_hours: z.number().nullable(),
  time_value_aud: z.number().nullable(),
});

export const ValueComputationSchema = z.object({
  inputs: z.object({
    weekly_frequency: z.number().nullable(),
    frequency_source: z.string(),
    minutes_per_task: z.number().nullable(),
    hourly_cost_aud: z.number().nullable(),
  }),
  annual_hours: z.number().nullable(),
  scenarios: z.array(ValueScenarioSchema),
  assumption_note: z.string(),
  missing_inputs: z.array(z.string()),
  formulas: z.array(z.string()),
  roi_percent: z.number().nullable(),
  roi_note: z.string(),
});

export const ConceptCardSchema = z.object({
  solution_name: z.string(),
  business_goal: z.string(),
  current_problem: z.string(),
  trigger: z.string(),
  inputs: z.array(z.string()),
  steps: z.array(z.string()),
  integrations: z.array(z.string()),
  outputs: z.string(),
  human_approval_points: z.array(z.string()),
  exception_paths: z.array(z.string()),
  success_metrics: z.array(z.string()),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  unresolved_questions: z.array(z.string()),
  complexity_band: z.enum(["low", "medium", "high"]),
  feasibility: z.enum(["feasible_with_conditions", "needs_discovery", "not_recommended"]),
});

export const ReportOpportunitySchema = z.object({
  opportunity_id: z.string(),
  name: z.string(),
  problem: z.string(),
  current_process: z.string(),
  expected_improvement: z.string(),
  fit_reason: z.string(),
  score: z.number(),
  band: z.enum(["priority_validate", "potential", "hold"]),
  feasibility: z.enum(["feasible_with_conditions", "needs_discovery", "not_recommended"]),
  value: ValueComputationSchema.nullable(),
});

export const ReportDocSchema = z.object({
  meta: z.object({
    assessment_id: z.string(),
    generated_at: z.string(),
    engine_version: z.string(),
    questionnaire_version: z.string(),
    generator: z.enum(["llm", "deterministic"]),
  }),
  executive_summary: z.object({
    situation: z.string(),
    goal: z.string(),
    headline: z.string(),
    narrative: z.array(z.string()),
  }),
  opportunities: z.array(ReportOpportunitySchema),
  priority_concept: ConceptCardSchema,
  value_estimates: z.object({
    primary_opportunity_id: z.string().nullable(),
    annual_hours: z.number().nullable(),
    scenarios: z.array(ValueScenarioSchema),
    formulas: z.array(z.string()),
    assumptions: z.array(z.string()),
    missing_data: z.array(z.string()),
    confidence: z.object({ level: z.enum(["low", "medium", "high"]), reasons: z.array(z.string()), key_unknowns: z.array(z.string()) }),
  }),
  feasibility_analysis: z.object({
    process: z.string(),
    data: z.string(),
    systems: z.string(),
    people: z.string(),
  }),
  risks_boundaries: z.array(z.object({ risk: z.string(), mitigation: z.string() })),
  roadmap: z.array(
    z.object({
      phase: z.string(),
      focus: z.string(),
      actions: z.array(z.string()),
    }),
  ),
  next_steps: z.object({
    data_to_collect: z.array(z.string()),
    cta: z.string(),
  }),
  method_disclaimer: z.string(),
});

export type ReportDoc = z.infer<typeof ReportDocSchema>;
export type ReportOpportunity = z.infer<typeof ReportOpportunitySchema>;
export type ConceptCard = z.infer<typeof ConceptCardSchema>;
