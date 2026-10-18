/**
 * Deterministic value engine (spec §6).
 * - Band midpoints come from the questionnaire config, never from the LLM.
 * - Time value is shown separately from cash savings and is labelled indicative.
 * - ROI is only computed when every required financial input exists.
 */

export interface ValueInputs {
  weekly_frequency: number | null;
  frequency_source: string;
  minutes_per_task: number | null;
  hourly_cost_aud: number | null;
}

export type ScenarioName = "conservative" | "baseline" | "optimistic";

export interface ScenarioResult {
  name: ScenarioName;
  reduction_ratio: number;
  released_hours: number | null;
  time_value_aud: number | null;
}

export interface ValueComputation {
  inputs: ValueInputs;
  annual_hours: number | null;
  scenarios: ScenarioResult[];
  assumption_note: string;
  missing_inputs: string[];
  formulas: string[];
  roi_percent: number | null;
  roi_note: string;
}

/** hours/year = tasks/week × minutes/task ÷ 60 × 52 — spec §6.1 */
export function computeAnnualHours(weeklyFrequency: number, minutesPerTask: number): number {
  return (weeklyFrequency * minutesPerTask) / 60 * 52;
}

/**
 * First-year ROI (spec §6.1). Returns null instead of a number whenever the
 * denominator is 0 or any input is missing — we never show a made-up ROI.
 */
export function computeRoi(
  firstYearBenefit: number | null,
  oneOffImplementationCost: number | null,
  firstYearRunCost: number | null,
): number | null {
  if (firstYearBenefit == null || oneOffImplementationCost == null || firstYearRunCost == null) return null;
  const denominator = oneOffImplementationCost + firstYearRunCost;
  if (denominator === 0) return null;
  return (firstYearBenefit - denominator) / denominator;
}

export function buildValueComputation(params: {
  inputs: ValueInputs;
  reduction: [number, number, number];
  assumptionNote: string;
}): ValueComputation {
  const { inputs, reduction, assumptionNote } = params;
  const missing: string[] = [];
  if (inputs.weekly_frequency == null) missing.push("how often the task happens (task volume)");
  if (inputs.minutes_per_task == null) missing.push("how long each task takes");
  if (inputs.hourly_cost_aud == null) missing.push("hourly cost of the people involved");

  const annualHours =
    inputs.weekly_frequency != null && inputs.minutes_per_task != null
      ? round1(computeAnnualHours(inputs.weekly_frequency, inputs.minutes_per_task))
      : null;

  const scenarioNames: ScenarioName[] = ["conservative", "baseline", "optimistic"];
  const scenarios: ScenarioResult[] = scenarioNames.map((name, i) => {
    const ratio = reduction[i];
    const releasedHours = annualHours != null ? round1(annualHours * ratio) : null;
    const timeValue = releasedHours != null && inputs.hourly_cost_aud != null ? round0(releasedHours * inputs.hourly_cost_aud) : null;
    return { name, reduction_ratio: ratio, released_hours: releasedHours, time_value_aud: timeValue };
  });

  return {
    inputs,
    annual_hours: annualHours,
    scenarios,
    assumption_note: assumptionNote,
    missing_inputs: missing,
    formulas: [
      "Current annual task hours = tasks per week × minutes per task ÷ 60 × 52",
      "Released hours = current annual hours × assumed reduction ratio",
      "Indicative time value = released hours × hourly cost (AUD, excl. GST)",
    ],
    roi_percent: null,
    roi_note:
      "A first-year ROI percentage is not shown because implementation and running costs have not been scoped yet. " +
      "Released hours are an indicative time value, not a cash saving.",
  };
}

export function formatAud(amount: number): string {
  return `AU$${Math.round(amount).toLocaleString("en-AU")}`;
}

export function formatHours(hours: number): string {
  return `${Math.round(hours).toLocaleString("en-AU")} h`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round0(n: number): number {
  return Math.round(n);
}
