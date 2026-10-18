import { getConfig } from "@/lib/config";
import { QUESTIONNAIRE_V1 } from "@/lib/questionnaire/v1";
import { AnswerValueSchema, visibleQuestions, type AnswerMap } from "@/lib/domain/questionnaire";
import { evaluateAssessment } from "@/lib/domain/engine";
import { generateReport } from "@/lib/report/generate";
import { renderReportPdf } from "@/lib/report/pdf";
import { ReportDocSchema } from "@/lib/report/schema";
import {
  getAnswers,
  getLeadByAssessment,
  getLatestEvaluation,
  getReportByAssessment,
  insertReport,
  markReportEmailSent,
  replaceReportToken,
  setReportPdfKey,
  updateAssessmentStatus,
} from "@/lib/db/repositories";
import { requireAssessment } from "@/lib/api-helpers";
import { getClientIp, jsonError, jsonOk, rateLimit } from "@/lib/security";
import { decryptToken, encryptToken, newId, newToken } from "@/lib/util";
import { sendReportEmail } from "@/lib/email";
import { audit, savePdf, track } from "@/lib/services";

/**
 * Report generation — idempotent (spec §8): a repeat call re-uses the stored
 * report content, re-mints the access link, and never re-sends an email that
 * already went out.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rl = rateLimit(`report:${getClientIp(req)}`, 20, 3_600_000);
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many report requests. Try again later.", { retry_after_sec: rl.retryAfterSec });

  const result = requireAssessment(req, id);
  if ("error" in result) return result.error;
  const assessment = result.assessment;

  if (assessment.status === "in_progress" || assessment.status === "evaluated") {
    return jsonError(409, "lead_required", "Submit your details first to receive the full report.");
  }
  const lead = getLeadByAssessment(id);
  if (!lead) return jsonError(409, "lead_required", "Lead details missing.");
  if (!getLatestEvaluation(id)) {
    return jsonError(409, "not_evaluated", "Run the evaluation first.");
  }

  const config = getConfig();

  // ---- idempotent path: reuse stored content and the SAME link, never a duplicate email
  const existing = getReportByAssessment(id);
  if (existing) {
    let token = existing.access_token_enc ? decryptToken(existing.access_token_enc, config.appSecret) : null;
    if (!token) {
      // secret rotated or legacy row — mint a fresh credential
      const fresh = newToken();
      token = fresh.token;
      replaceReportToken(existing.id, fresh.tokenHash, encryptToken(token, config.appSecret), new Date(Date.now() + config.reportTtlDays * 86_400_000));
    }
    let emailSent = Boolean(existing.email_sent_at);
    let emailError: string | null = null;
    if (!emailSent) {
      const res = await sendReportEmail({ to: lead.work_email, reportUrl: `${config.baseUrl}/report/${token}` });
      emailSent = res.sent;
      emailError = res.error ?? null;
      if (res.sent) markReportEmailSent(existing.id);
    }
    audit("system", "report_regenerated", { assessment_id: id });
    return jsonOk({
      status: "ready",
      already_generated: true,
      report_url: `/report/${token}`,
      expires_at: existing.expires_at,
      email_sent: emailSent,
      email_error: emailError,
    });
  }

  // ---- first generation: rebuild the deterministic evaluation from stored answers
  const answers: AnswerMap = {};
  for (const row of getAnswers(id)) {
    const parsed = AnswerValueSchema.safeParse(JSON.parse(row.answer_json));
    if (parsed.success) answers[row.question_id] = parsed.data;
  }
  const visibleIds = new Set(visibleQuestions(QUESTIONNAIRE_V1, answers).map((q) => q.id));
  const engineAnswers = Object.fromEntries(Object.entries(answers).filter(([k]) => visibleIds.has(k)));
  const evaluation = evaluateAssessment(QUESTIONNAIRE_V1, engineAnswers);

  // LLM narrative with deterministic fallback baked in (spec §7.3).
  const report = ReportDocSchema.parse(
    await generateReport({ evaluation, questionnaire: QUESTIONNAIRE_V1, answers: engineAnswers, assessmentId: id }),
  );

  const { token, tokenHash } = newToken();
  const reportRow = insertReport({
    id: newId(),
    assessment_id: id,
    report_json: JSON.stringify(report),
    pdf_storage_key: null,
    access_token_hash: tokenHash,
    access_token_enc: encryptToken(token, config.appSecret),
    expires_at: new Date(Date.now() + config.reportTtlDays * 86_400_000).toISOString(),
    email_sent_at: null,
  });

  // PDF eagerly; failure here never blocks delivery of the web report.
  try {
    const bytes = await renderReportPdf(report);
    const key = savePdf(reportRow.id, bytes);
    setReportPdfKey(reportRow.id, key);
  } catch (err) {
    console.error("[report] pdf generation failed (web report unaffected)", err);
  }

  const reportUrl = `${config.baseUrl}/report/${token}`;
  const emailResult = await sendReportEmail({ to: lead.work_email, reportUrl });
  if (emailResult.sent) markReportEmailSent(reportRow.id);

  updateAssessmentStatus(id, "report_ready");
  audit("system", "report_generated", { assessment_id: id, generator: report.meta.generator, email_sent: emailResult.sent });
  track("report_generated", id);

  return jsonOk({
    status: "ready",
    report_url: `/report/${token}`,
    expires_at: reportRow.expires_at,
    email_sent: emailResult.sent,
    email_error: emailResult.error ?? null,
    generator: report.meta.generator,
  });
}
