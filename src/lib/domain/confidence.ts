import type { AnswerMap } from "@/lib/domain/questionnaire";

/**
 * Confidence levels (spec §6.2) are decided by deterministic rules only —
 * input completeness and whether the business tracks its numbers. The LLM
 * never self-assesses confidence.
 */

export type ConfidenceLevel = "low" | "medium" | "high";

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  reasons: string[];
  key_unknowns: string[];
}

const KEY_NUMERIC_QUESTIONS: { id: string; label: string }[] = [
  { id: "task_volume", label: "how often the main task happens" },
  { id: "minutes_per_task", label: "how long each task takes" },
  { id: "hourly_cost", label: "the hourly cost involved" },
  { id: "error_or_loss", label: "how often errors occur" },
];

export function computeConfidence(answers: AnswerMap): ConfidenceAssessment {
  const unknowns: string[] = [];
  for (const q of KEY_NUMERIC_QUESTIONS) {
    const a = answers[q.id];
    if (!a || a.kind === "unknown") unknowns.push(q.label);
  }

  const metrics = answers["metrics_tracking"];
  const metricsWeak = !metrics || metrics.kind === "unknown" || (metrics.kind === "single" && metrics.value === "no");

  const reasons: string[] = [];
  if (unknowns.length > 0) reasons.push(`Key inputs unknown: ${unknowns.join("; ")}.`);
  if (metricsWeak) reasons.push("The business does not track numbers for this work (hours, conversion, errors or SLAs).");
  if (!metricsWeak) reasons.push("The business tracks at least rough numbers for this work.");

  const penalty = unknowns.length + (metricsWeak ? 1 : 0);
  const level: ConfidenceLevel = penalty === 0 ? "high" : penalty <= 2 ? "medium" : "low";

  return { level, reasons, key_unknowns: unknowns };
}
