import { QUESTIONNAIRE_V1 } from "@/lib/questionnaire/v1";
import { AnswerValueSchema, missingRequired, visibleQuestions, type AnswerMap } from "@/lib/domain/questionnaire";
import { getAnswers, insertEvaluation, updateAssessmentStatus } from "@/lib/db/repositories";
import { buildPreview, evaluateAssessment, ENGINE_VERSION } from "@/lib/domain/engine";
import { requireAssessment, sweepExpired } from "@/lib/api-helpers";
import { getClientIp, jsonError, jsonOk, rateLimit } from "@/lib/security";
import { track } from "@/lib/services";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  sweepExpired();
  const { id } = await ctx.params;
  const rl = rateLimit(`evaluate:${getClientIp(req)}`, 60, 3_600_000);
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many evaluations. Try again shortly.", { retry_after_sec: rl.retryAfterSec });

  const result = requireAssessment(req, id);
  if ("error" in result) return result.error;
  const assessment = result.assessment;
  if (assessment.status === "lead_submitted" || assessment.status === "report_ready") {
    return jsonError(409, "locked", "This assessment is already past the evaluation stage.");
  }

  const answers: AnswerMap = {};
  for (const row of getAnswers(id)) {
    const parsed = AnswerValueSchema.safeParse(JSON.parse(row.answer_json));
    if (parsed.success) answers[row.question_id] = parsed.data;
  }

  const missing = missingRequired(QUESTIONNAIRE_V1, answers);
  if (missing.length > 0) {
    return jsonError(422, "incomplete", "Some required questions are unanswered.", { missing });
  }

  // Only visible questions participate in the engine.
  const visibleIds = new Set(visibleQuestions(QUESTIONNAIRE_V1, answers).map((q) => q.id));
  const engineAnswers: AnswerMap = Object.fromEntries(Object.entries(answers).filter(([k]) => visibleIds.has(k)));

  const evaluation = evaluateAssessment(QUESTIONNAIRE_V1, engineAnswers);
  const preview = buildPreview(evaluation);
  insertEvaluation({
    assessment_id: id,
    engine_version: ENGINE_VERSION,
    opportunity_results_json: JSON.stringify(evaluation.opportunities),
    calculations_json: JSON.stringify({ selected_ids: evaluation.selected_ids, priority_id: evaluation.priority_id, preview }),
    risk_flags_json: JSON.stringify({ global_risk_flags: evaluation.global_risk_flags, gates_by_opportunity: Object.fromEntries(evaluation.opportunities.map((o) => [o.opportunity_id, o.gates])) }),
    confidence_json: JSON.stringify(evaluation.confidence),
  });
  updateAssessmentStatus(id, "evaluated");
  track("assessment_completed", id);
  return jsonOk({ preview });
}
