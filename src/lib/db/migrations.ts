/**
 * Sequential SQL migrations. Append new entries — never edit applied ones.
 * Each entry runs once, tracked in schema_migrations.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "init_core_tables",
    sql: `
      CREATE TABLE assessments (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('in_progress','evaluated','lead_submitted','report_ready','expired')),
        questionnaire_version TEXT NOT NULL,
        session_token_hash TEXT NOT NULL,
        consent_version TEXT,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_assessments_status ON assessments(status);

      CREATE TABLE answers (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL,
        question_version INTEGER NOT NULL,
        answer_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (assessment_id, question_id)
      );

      CREATE TABLE evaluation_results (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        engine_version TEXT NOT NULL,
        opportunity_results_json TEXT NOT NULL,
        calculations_json TEXT NOT NULL,
        risk_flags_json TEXT NOT NULL,
        confidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_evaluations_assessment ON evaluation_results(assessment_id, created_at DESC);

      CREATE TABLE leads (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,
        name TEXT,
        work_email TEXT NOT NULL,
        company_name TEXT,
        marketing_opt_in INTEGER NOT NULL DEFAULT 0,
        privacy_notice_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        follow_up_status TEXT NOT NULL DEFAULT 'new'
          CHECK (follow_up_status IN ('new','contacted','discovery_booked','qualified','not_fit','converted')),
        internal_notes TEXT
      );
      CREATE INDEX idx_leads_status ON leads(follow_up_status, created_at DESC);

      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,
        report_json TEXT NOT NULL,
        pdf_storage_key TEXT,
        access_token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        email_sent_at TEXT
      );
      CREATE INDEX idx_reports_token ON reports(access_token_hash);

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE analytics_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        assessment_id TEXT,
        question_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_analytics_name ON analytics_events(name, created_at DESC);
    `,
  },
  {
    id: 2,
    name: "reports_token_enc",
    sql: `
      ALTER TABLE reports ADD COLUMN access_token_enc TEXT;
    `,
  },
];
