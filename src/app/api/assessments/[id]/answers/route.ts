import { z } from "zod";
import { QUESTIONNAIRE_V1 } from "@/lib/questionnaire/v1";
import {
  AnswerValueSchema,
  effectiveOptions,
  isQuestionVisible,
  getQuestionDef,
  validateAnswerForQuestion,
  type AnswerMap,
} from "@/lib/domain/questionnaire";
import { deleteAnswer, getAnswers, upsertAnswer } from "@/lib/db/repositories";
import { readJson, requireAssessment } from "@/lib/api-helpers";
import { getClientIp, jsonError, jsonOk, rateLimit } from "@/lib/security";
import { track } from "@/lib/services";

const PutAnswersSchema = z.object({
  answers: z
    .array(z.object({ question_id: z.string().max(64), answer: AnswerValueSchema }))
    .min(1)
    .max(30),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rl = rateLimit(`answers:${getClientIp(req)}`, 600, 3_600_000);
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many saves. Slow down a little.", { retry_after_sec: rl.retryAfterSec });

  const result = requireAssessment(req, id);
  if ("error" in result) return result.error;
  const assessment = result.assessment;
  if (assessment.status === "report_ready") {
    return jsonError(409, "already_final", "This assessment already has its report generated.");
  }

  const body = await readJson(req, PutAnswersSchema);
  if ("error" in body) return body.error;

  // Build the current answer map (stored + this batch, applied in order).
  const map: AnswerMap = {};
  for (const row of getAnswers(id)) {
    try {
      const parsed = AnswerValueSchema.safeParse(JSON.parse(row.answer_json));
      if (parsed.success) map[row.question_id] = parsed.data;
    } catch {
      /* skip */
    }
  }

  const rejected: { question_id: string; error: string }[] = [];
  const applied: string[] = [];
  for (const item of body.data.answers) {
    const q = getQuestionDef(QUESTIONNAIRE_V1, item.question_id);
    if (!q) {
      rejected.push({ question_id: item.question_id, error: "Unknown question." });
      continue;
    }
    if (q.version !== 1) {
      rejected.push({ question_id: item.question_id, error: "Question version mismatch." });
      continue;
    }
    const validation = validateAnswerForQuestion(q, item.answer, effectiveOptions(QUESTIONNAIRE_V1, map, q));
    if (validation) {
      rejected.push(validation);
      continue;
    }
    if (!isQuestionVisible(q, map)) {
      rejected.push({ question_id: item.question_id, error: "Question is not reachable with your current answers." });
      continue;
    }
    map[q.id] = item.answer;
    upsertAnswer(id, q.id, q.version, JSON.stringify(item.answer));
    applied.push(q.id);
  }

  if (rejected.length > 0) {
    return jsonError(422, "invalid_answers", "Some answers were rejected.", { rejected });
  }

  // Drop stored answers for questions no longer visible (branch changed).
  for (const q of QUESTIONNAIRE_V1.questions) {
    if (map[q.id] != null && !isQuestionVisible(q, map)) {
      delete map[q.id];
      deleteAnswer(id, q.id);
    }
  }

  for (const qid of applied) track("question_answered", id, qid);
  return jsonOk({ saved: applied.length });
}
