import { getDb } from "./index";
import { newId } from "@/lib/util";

// ---------------------------------------------------------------- types

export interface AssessmentRow {
  id: string;
  created_at: string;
  updated_at: string;
  status: "in_progress" | "evaluated" | "lead_submitted" | "report_ready" | "expired";
  questionnaire_version: string;
  session_token_hash: string;
  consent_version: string | null;
  expires_at: string;
}

export interface AnswerRow {
  id: string;
  assessment_id: string;
  question_id: string;
  question_version: number;
  answer_json: string;
  updated_at: string;
}

export interface EvaluationRow {
  id: string;
  assessment_id: string;
  engine_version: string;
  opportunity_results_json: string;
  calculations_json: string;
  risk_flags_json: string;
  confidence_json: string;
  created_at: string;
}

export interface LeadRow {
  id: string;
  assessment_id: string;
  name: string | null;
  work_email: string;
  company_name: string | null;
  marketing_opt_in: number;
  privacy_notice_version: string;
  created_at: string;
  follow_up_status: "new" | "contacted" | "discovery_booked" | "qualified" | "not_fit" | "converted";
  internal_notes: string | null;
}

export interface ReportRow {
  id: string;
  assessment_id: string;
  report_json: string;
  pdf_storage_key: string | null;
  access_token_hash: string;
  access_token_enc: string | null;
  expires_at: string;
  generated_at: string;
  email_sent_at: string | null;
}

export type FollowUpStatus = LeadRow["follow_up_status"];

// ---------------------------------------------------------------- assessments

export function createAssessment(params: {
  questionnaire_version: string;
  session_token_hash: string;
  consent_version: string | null;
  expires_at: Date;
}): AssessmentRow {
  const now = new Date().toISOString();
  const row: AssessmentRow = {
    id: newId(),
    created_at: now,
    updated_at: now,
    status: "in_progress",
    questionnaire_version: params.questionnaire_version,
    session_token_hash: params.session_token_hash,
    consent_version: params.consent_version,
    expires_at: params.expires_at.toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO assessments (id, created_at, updated_at, status, questionnaire_version, session_token_hash, consent_version, expires_at)
       VALUES (@id, @created_at, @updated_at, @status, @questionnaire_version, @session_token_hash, @consent_version, @expires_at)`,
    )
    .run(row);
  return row;
}

export function getAssessment(id: string): AssessmentRow | undefined {
  return getDb().prepare("SELECT * FROM assessments WHERE id = ?").get(id) as AssessmentRow | undefined;
}

export function updateAssessmentStatus(id: string, status: AssessmentRow["status"]): void {
  getDb()
    .prepare("UPDATE assessments SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
}

export function expireStaleAssessments(): void {
  getDb()
    .prepare("UPDATE assessments SET status = 'expired' WHERE expires_at < ? AND status NOT IN ('expired','report_ready')")
    .run(new Date().toISOString());
}

// ---------------------------------------------------------------- answers

export function upsertAnswer(assessmentId: string, questionId: string, questionVersion: number, answerJson: string): void {
  getDb()
    .prepare(
      `INSERT INTO answers (id, assessment_id, question_id, question_version, answer_json, updated_at)
       VALUES (@id, @assessment_id, @question_id, @question_version, @answer_json, @updated_at)
       ON CONFLICT (assessment_id, question_id)
       DO UPDATE SET answer_json = excluded.answer_json, question_version = excluded.question_version, updated_at = excluded.updated_at`,
    )
    .run({
      id: newId(),
      assessment_id: assessmentId,
      question_id: questionId,
      question_version: questionVersion,
      answer_json: answerJson,
      updated_at: new Date().toISOString(),
    });
}

export function getAnswers(assessmentId: string): AnswerRow[] {
  return getDb()
    .prepare("SELECT * FROM answers WHERE assessment_id = ? ORDER BY updated_at")
    .all(assessmentId) as AnswerRow[];
}

export function deleteAnswer(assessmentId: string, questionId: string): void {
  getDb().prepare("DELETE FROM answers WHERE assessment_id = ? AND question_id = ?").run(assessmentId, questionId);
}

// ---------------------------------------------------------------- evaluations

export function insertEvaluation(row: Omit<EvaluationRow, "id" | "created_at">): EvaluationRow {
  const full: EvaluationRow = { ...row, id: newId(), created_at: new Date().toISOString() };
  getDb()
    .prepare(
      `INSERT INTO evaluation_results (id, assessment_id, engine_version, opportunity_results_json, calculations_json, risk_flags_json, confidence_json, created_at)
       VALUES (@id, @assessment_id, @engine_version, @opportunity_results_json, @calculations_json, @risk_flags_json, @confidence_json, @created_at)`,
    )
    .run(full);
  return full;
}

export function getLatestEvaluation(assessmentId: string): EvaluationRow | undefined {
  return getDb()
    .prepare("SELECT * FROM evaluation_results WHERE assessment_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(assessmentId) as EvaluationRow | undefined;
}

// ---------------------------------------------------------------- leads

export function upsertLead(params: {
  assessment_id: string;
  name: string | null;
  work_email: string;
  company_name: string | null;
  marketing_opt_in: boolean;
  privacy_notice_version: string;
}): LeadRow {
  const existing = getLeadByAssessment(params.assessment_id);
  const now = new Date().toISOString();
  if (existing) {
    getDb()
      .prepare(
        `UPDATE leads SET name = ?, work_email = ?, company_name = ?, marketing_opt_in = ?, privacy_notice_version = ? WHERE id = ?`,
      )
      .run(params.name, params.work_email, params.company_name, params.marketing_opt_in ? 1 : 0, params.privacy_notice_version, existing.id);
    return getLeadByAssessment(params.assessment_id)!;
  }
  const row: LeadRow = {
    id: newId(),
    assessment_id: params.assessment_id,
    name: params.name,
    work_email: params.work_email,
    company_name: params.company_name,
    marketing_opt_in: params.marketing_opt_in ? 1 : 0,
    privacy_notice_version: params.privacy_notice_version,
    created_at: now,
    follow_up_status: "new",
    internal_notes: null,
  };
  getDb()
    .prepare(
      `INSERT INTO leads (id, assessment_id, name, work_email, company_name, marketing_opt_in, privacy_notice_version, created_at, follow_up_status, internal_notes)
       VALUES (@id, @assessment_id, @name, @work_email, @company_name, @marketing_opt_in, @privacy_notice_version, @created_at, @follow_up_status, @internal_notes)`,
    )
    .run(row);
  return row;
}

export function getLeadByAssessment(assessmentId: string): LeadRow | undefined {
  return getDb().prepare("SELECT * FROM leads WHERE assessment_id = ?").get(assessmentId) as LeadRow | undefined;
}

export function getLead(id: string): LeadRow | undefined {
  return getDb().prepare("SELECT * FROM leads WHERE id = ?").get(id) as LeadRow | undefined;
}

export function listLeads(params: { status?: string; page: number; pageSize: number }): { total: number; rows: LeadRow[] } {
  const db = getDb();
  const where = params.status ? "WHERE follow_up_status = ?" : "";
  const total = (
    params.status
      ? db.prepare(`SELECT COUNT(*) AS c FROM leads ${where}`).get(params.status)
      : db.prepare(`SELECT COUNT(*) AS c FROM leads`).get()
  ) as { c: number };
  const rows = (
    params.status
      ? db.prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      : db.prepare(`SELECT * FROM leads ORDER BY created_at DESC LIMIT ? OFFSET ?`)
  ).all(...(params.status ? [params.status] : []), params.pageSize, (params.page - 1) * params.pageSize) as LeadRow[];
  return { total: total.c, rows };
}

export function updateLead(id: string, patch: { follow_up_status?: FollowUpStatus; internal_notes?: string }): void {
  const existing = getLead(id);
  if (!existing) return;
  getDb()
    .prepare("UPDATE leads SET follow_up_status = ?, internal_notes = ? WHERE id = ?")
    .run(patch.follow_up_status ?? existing.follow_up_status, patch.internal_notes ?? existing.internal_notes, id);
}

// ---------------------------------------------------------------- reports

export function insertReport(row: Omit<ReportRow, "generated_at">): ReportRow {
  const full: ReportRow = { ...row, generated_at: new Date().toISOString() };
  getDb()
    .prepare(
      `INSERT INTO reports (id, assessment_id, report_json, pdf_storage_key, access_token_hash, access_token_enc, expires_at, generated_at, email_sent_at)
       VALUES (@id, @assessment_id, @report_json, @pdf_storage_key, @access_token_hash, @access_token_enc, @expires_at, @generated_at, @email_sent_at)`,
    )
    .run(full);
  return full;
}

export function getReportByAssessment(assessmentId: string): ReportRow | undefined {
  return getDb().prepare("SELECT * FROM reports WHERE assessment_id = ?").get(assessmentId) as ReportRow | undefined;
}

export function getReportByTokenHash(tokenHash: string): ReportRow | undefined {
  return getDb().prepare("SELECT * FROM reports WHERE access_token_hash = ?").get(tokenHash) as ReportRow | undefined;
}

/** Re-issues the access credential for an existing report when decryption fails (e.g. rotated secret). */
export function replaceReportToken(reportId: string, tokenHash: string, tokenEnc: string, expiresAt: Date): void {
  getDb()
    .prepare("UPDATE reports SET access_token_hash = ?, access_token_enc = ?, expires_at = ? WHERE id = ?")
    .run(tokenHash, tokenEnc, expiresAt.toISOString(), reportId);
}

export function markReportEmailSent(reportId: string): void {
  getDb().prepare("UPDATE reports SET email_sent_at = ? WHERE id = ?").run(new Date().toISOString(), reportId);
}

export function setReportPdfKey(reportId: string, key: string): void {
  getDb().prepare("UPDATE reports SET pdf_storage_key = ? WHERE id = ?").run(key, reportId);
}

// ---------------------------------------------------------------- audit & analytics

export function insertAuditEvent(actor: string, action: string, detail?: unknown): void {
  getDb()
    .prepare("INSERT INTO audit_events (id, actor, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), actor, action, detail ? JSON.stringify(detail) : null, new Date().toISOString());
}

export function listAuditEvents(limit = 100) {
  return getDb()
    .prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?")
    .all(limit) as { id: string; actor: string; action: string; detail_json: string | null; created_at: string }[];
}

export type AnalyticsEventName =
  | "assessment_started"
  | "question_answered"
  | "assessment_completed"
  | "preview_viewed"
  | "lead_submitted"
  | "report_generated"
  | "report_opened"
  | "discovery_clicked";

export function insertAnalyticsEvent(name: AnalyticsEventName, assessmentId?: string, questionId?: string): void {
  getDb()
    .prepare("INSERT INTO analytics_events (id, name, assessment_id, question_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), name, assessmentId ?? null, questionId ?? null, new Date().toISOString());
}

export function analyticsOverview(): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT name, COUNT(*) AS c FROM analytics_events GROUP BY name")
    .all() as { name: string; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.name, r.c]));
}

/** Drop-off counts per question (how many assessments answered it then stopped). */
export function dropOffByQuestion(): { question_id: string; answered: number; is_last: number }[] {
  return getDb()
    .prepare(
      `SELECT question_id, COUNT(*) AS answered, SUM(CASE WHEN rn = 1 THEN 1 ELSE 0 END) AS is_last
       FROM (
         SELECT question_id, ROW_NUMBER() OVER (PARTITION BY assessment_id ORDER BY updated_at DESC) AS rn
         FROM answers
       ) GROUP BY question_id ORDER BY is_last DESC`,
    )
    .all() as { question_id: string; answered: number; is_last: number }[];
}
