import { getAnswers } from "@/lib/db/repositories";
import { requireAssessment, sweepExpired } from "@/lib/api-helpers";
import { jsonOk } from "@/lib/security";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  sweepExpired();
  const { id } = await ctx.params;
  const result = requireAssessment(req, id);
  if ("error" in result) return result.error;

  const answers: Record<string, unknown> = {};
  for (const row of getAnswers(id)) {
    try {
      answers[row.question_id] = JSON.parse(row.answer_json);
    } catch {
      /* skip malformed row */
    }
  }
  return jsonOk({
    assessment: {
      id: result.assessment.id,
      status: result.assessment.status,
      questionnaire_version: result.assessment.questionnaire_version,
      expires_at: result.assessment.expires_at,
    },
    answers,
  });
}
