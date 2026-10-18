import type { AnswerMap, Questionnaire } from "@/lib/domain/questionnaire";
import { answerLabels, getMulti, getSingle } from "@/lib/domain/questionnaire";
import { computeConfidence, type ConfidenceAssessment } from "@/lib/domain/confidence";
import { evaluateGlobalRisks, evaluateRiskGates, type RiskGate } from "@/lib/domain/risk";
import { bandMidpoint, getQuestionDef } from "@/lib/domain/questionnaire";
import { buildValueComputation, type ValueComputation } from "@/lib/domain/value";
import { MAX_WEIGHTS, OPPORTUNITIES, type DimensionScores } from "@/lib/opportunities";

export const ENGINE_VERSION = "1.0.0";

export type OpportunityBand = "priority_validate" | "potential" | "hold";
export type Feasibility = "feasible_with_conditions" | "needs_discovery" | "not_recommended";

export interface OpportunityResult {
  opportunity_id: string;
  name: string;
  summary: string;
  raw_score: number;
  band: OpportunityBand;
  data_completeness: number;
  insufficient_data: boolean;
  dimensions: DimensionScores;
  unknown_dimensions: string[];
  gates: RiskGate[];
  feasibility: Feasibility;
  prerequisites: string[];
  evidence_requirements: string[];
  typical_integrations: string[];
  notes: string[];
  value: ValueComputation | null;
  /** True when this opportunity's trigger includes the user's primary bottleneck. */
  is_primary_bottleneck: boolean;
}

export interface ProfileSummary {
  industry: string[];
  employees: string[];
  goals: string[];
  bottlenecks: string[];
  headline: string;
}

export interface EvaluationOutput {
  engine_version: string;
  questionnaire_version: string;
  profile_summary: ProfileSummary;
  opportunities: OpportunityResult[];
  selected_ids: string[];
  priority_id: string | null;
  governance_first: boolean;
  global_risk_flags: RiskGate[];
  confidence: ConfidenceAssessment;
}

export function evaluateAssessment(questionnaire: Questionnaire, answers: AnswerMap): EvaluationOutput {
  const ctx = { questionnaire, answers };
  const results: OpportunityResult[] = [];

  // The primary bottleneck anchors the generic workload/process questions.
  // With a single selection it is that one; with several, the user names it.
  const primaryBottleneck = resolvePrimaryBottleneck(answers);

  for (const opp of OPPORTUNITIES) {
    const hitValues = new Set<string>();
    const triggered = opp.triggers.some((t) => {
      const a = answers[t.question_id];
      const values = a && a.kind === "multi" ? a.value : a && a.kind === "single" ? [a.value] : [];
      const hit = values.some((v) => t.values.includes(v));
      if (hit) t.values.forEach((v) => hitValues.add(v));
      return hit;
    });
    if (!triggered) continue;
    const isPrimaryBottleneck = primaryBottleneck != null && [...hitValues].some((v) => v === primaryBottleneck);

    const dimensions = opp.score(ctx);
    const unknownDimensions = (Object.keys(dimensions) as (keyof DimensionScores)[]).filter((k) => dimensions[k] == null);
    const knownMax = (Object.keys(MAX_WEIGHTS) as (keyof DimensionScores)[]).reduce(
      (sum, k) => sum + (dimensions[k] == null ? 0 : MAX_WEIGHTS[k]),
      0,
    );
    const rawScore = (Object.keys(dimensions) as (keyof DimensionScores)[]).reduce(
      (sum, k) => sum + (dimensions[k] ?? 0),
      0,
    );
    const dataCompleteness = knownMax / 100;
    const insufficientData = dataCompleteness < 0.6;

    let band: OpportunityBand;
    if (rawScore >= 70) band = "priority_validate";
    else if (rawScore >= 45) band = "potential";
    else band = "hold";
    // Missing data caps the band: an unknown-heavy score cannot be "priority".
    if (insufficientData && band === "priority_validate") band = "potential";

    const gates = evaluateRiskGates(answers, opp);
    const feasibility: Feasibility = gates.length > 0 ? "not_recommended" : band === "hold" || insufficientData ? "needs_discovery" : "feasible_with_conditions";

    const freq = opp.frequency(ctx);
    const value = buildValueComputation({
      inputs: {
        weekly_frequency: freq.weekly,
        frequency_source: freq.source,
        minutes_per_task: bandMidpoint(questionnaire, answers, "minutes_per_task"),
        hourly_cost_aud: bandMidpoint(questionnaire, answers, "hourly_cost"),
      },
      reduction: opp.assumptions.reduction,
      assumptionNote: opp.assumptions.note,
    });

    const notes: string[] = [];
    if (unknownDimensions.length > 0) notes.push(`Not enough data to score: ${unknownDimensions.join(", ")}.`);
    if (insufficientData) notes.push("Data completeness below 60% — treat ranking as provisional.");
    if (isPrimaryBottleneck) notes.push("Matches the problem area you named as the one that troubles you most.");
    else if (primaryBottleneck != null)
      notes.push("Estimated using the shared time and cost inputs plus this area's own volume questions.");

    results.push({
      opportunity_id: opp.id,
      name: opp.name,
      summary: opp.summary,
      raw_score: rawScore,
      band,
      data_completeness: dataCompleteness,
      insufficient_data: insufficientData,
      dimensions,
      unknown_dimensions: unknownDimensions,
      gates,
      feasibility,
      prerequisites: opp.prerequisites,
      evidence_requirements: opp.evidenceRequirements,
      typical_integrations: opp.typicalIntegrations,
      notes,
      value,
      is_primary_bottleneck: isPrimaryBottleneck,
    });
  }

  // Rank by score; the primary bottleneck breaks ties.
  results.sort((a, b) => b.raw_score - a.raw_score || Number(b.is_primary_bottleneck) - Number(a.is_primary_bottleneck));

  // Identify 2–3 opportunities (spec §1.1): qualified ones first, then best remaining.
  const qualified = results.filter((r) => r.band !== "hold");
  const selected = qualified.length >= 2 ? qualified.slice(0, 3) : results.slice(0, Math.min(3, Math.max(1, results.length)));
  const selectedIds = selected.map((r) => r.opportunity_id);

  const viable = selected.filter((r) => r.feasibility !== "not_recommended");
  const priorityId = viable.length > 0 ? viable[0].opportunity_id : selected.length > 0 ? selected[0].opportunity_id : null;
  const governanceFirst = viable.length === 0 && selected.length > 0;

  return {
    engine_version: ENGINE_VERSION,
    questionnaire_version: questionnaire.version,
    profile_summary: buildProfileSummary(questionnaire, answers),
    opportunities: results,
    selected_ids: selectedIds,
    priority_id: priorityId,
    governance_first: governanceFirst,
    global_risk_flags: evaluateGlobalRisks(answers),
    confidence: computeConfidence(answers),
  };
}

function resolvePrimaryBottleneck(answers: AnswerMap): string | null {
  const primary = getSingle(answers, "primary_bottleneck");
  if (primary) return primary;
  const bottleneck = answers["bottleneck"];
  // Single selection: it is the primary by definition.
  if (bottleneck?.kind === "multi" && bottleneck.value.length === 1) return bottleneck.value[0];
  return null;
}

function buildProfileSummary(questionnaire: Questionnaire, answers: AnswerMap): ProfileSummary {
  const bottlenecks = answerLabels(questionnaire, answers, "bottleneck");
  const industry = answerLabels(questionnaire, answers, "company_industry");
  const employees = answerLabels(questionnaire, answers, "employee_band");
  const goals = answerLabels(questionnaire, answers, "business_goal");

  const responseTime = getSingle(answers, "current_response_time");
  const slowResponse = ["1-2-days", "3-plus-days"].includes(responseTime ?? "");
  const headline = buildHeadline(bottlenecks, slowResponse, answers);
  return { industry, employees, goals, bottlenecks, headline };
}

function buildHeadline(bottlenecks: string[], slowResponse: boolean, answers: AnswerMap): string {
  if (bottlenecks.length === 0) return "Your answers point to an exploratory conversation rather than a specific quick win yet.";
  const first = bottlenecks[0].toLowerCase();
  let extra = "";
  if (slowResponse) extra = " Enquiry response times are also slow enough to be costing work.";
  const manual = getMulti(answers, "data_location").some((d) => d === "heads" || d === "paper");
  if (manual) extra += " A fair share of the information still lives on paper or in people's heads, which caps what automation can safely reach today.";
  return `The biggest pressure point you named is ${first}.${extra}`;
}

// ---------------------------------------------------------------- preview shape

export interface PreviewPayload {
  profile_summary: ProfileSummary;
  confidence: ConfidenceAssessment;
  headline_finding: string;
  opportunities: {
    opportunity_id: string;
    name: string;
    summary: string;
    score: number;
    band: OpportunityBand;
    feasibility: Feasibility;
    one_line: string;
  }[];
  value_range: { low_aud: number | null; high_aud: number | null; baseline_aud: number | null; annual_hours: number | null };
  key_risks: { title: string; mitigation: string }[];
}

export function buildPreview(evaluation: EvaluationOutput): PreviewPayload {
  const selected = evaluation.opportunities.filter((o) => evaluation.selected_ids.includes(o.opportunity_id));
  const priority =
    selected.find((o) => o.opportunity_id === evaluation.priority_id) ?? selected[0] ?? null;

  const oneLineFor = (o: OpportunityResult): string => {
    if (o.value?.annual_hours != null && o.value.scenarios[1]?.time_value_aud != null) {
      const baseline = o.value.scenarios[1];
      return `About ${Math.round(o.value.annual_hours).toLocaleString("en-AU")} hours a year go into this today; the baseline scenario could release roughly ${Math.round(baseline.released_hours ?? 0).toLocaleString("en-AU")} hours (indicative time value).`;
    }
    return `${o.name}: matched to your answers, but the size of the prize needs a few more numbers from you.`;
  };

  const scenarios = priority?.value?.scenarios ?? [];
  const conservative = scenarios.find((s) => s.name === "conservative")?.time_value_aud ?? null;
  const baseline = scenarios.find((s) => s.name === "baseline")?.time_value_aud ?? null;
  const optimistic = scenarios.find((s) => s.name === "optimistic")?.time_value_aud ?? null;

  const keyRisks: { title: string; mitigation: string }[] = [];
  const seen = new Set<string>();
  for (const o of evaluation.opportunities) {
    for (const g of o.gates) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      keyRisks.push({ title: g.title, mitigation: g.mitigation });
    }
  }
  for (const g of evaluation.global_risk_flags) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    keyRisks.push({ title: g.title, mitigation: g.mitigation });
  }

  return {
    profile_summary: evaluation.profile_summary,
    confidence: evaluation.confidence,
    headline_finding: priority ? oneLineFor(priority) : evaluation.profile_summary.headline,
    opportunities: selected.map((o) => ({
      opportunity_id: o.opportunity_id,
      name: o.name,
      summary: o.summary,
      score: o.raw_score,
      band: o.band,
      feasibility: o.feasibility,
      one_line: oneLineFor(o),
    })),
    value_range: {
      low_aud: conservative,
      baseline_aud: baseline,
      high_aud: optimistic,
      annual_hours: priority?.value?.annual_hours ?? null,
    },
    key_risks: keyRisks,
  };
}

// Re-exported for convenience of route handlers.
export { getQuestionDef };
