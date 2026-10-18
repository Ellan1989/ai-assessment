/**
 * Seeds one demo lead so the admin portal has something to show.
 * Safe to re-run: skips if a demo lead already exists.
 * Loads .env.local so the seed uses the same database as the app.
 */
import { loadEnv } from "./load-env";
loadEnv();

import { getDb } from "@/lib/db";
import {
  createAssessment,
  getAnswers,
  insertEvaluation,
  updateAssessmentStatus,
  upsertAnswer,
  upsertLead,
} from "@/lib/db/repositories";
import { QUESTIONNAIRE_V1 } from "@/lib/questionnaire/v1";
import { AnswerMap, visibleQuestions } from "@/lib/domain/questionnaire";
import { buildPreview, evaluateAssessment, ENGINE_VERSION } from "@/lib/domain/engine";
import { newToken } from "@/lib/util";

const DEMO_ASSESSMENT_TAG = "seed-demo";

async function main() {
  getDb(); // runs migrations

  const existing = getDb()
    .prepare("SELECT assessment_id FROM leads WHERE work_email = ?")
    .get("dana@exampletrades.com.au") as { assessment_id: string } | undefined;
  if (existing) {
    console.log(`Demo lead already exists (assessment ${existing.assessment_id}). Nothing to do.`);
    return;
  }

  const { tokenHash } = newToken();
  const assessment = createAssessment({
    questionnaire_version: QUESTIONNAIRE_V1.version,
    session_token_hash: tokenHash,
    consent_version: null,
    expires_at: new Date(Date.now() + 7 * 86_400_000),
  });

  const answers: AnswerMap = {
    company_industry: { kind: "single", value: "trades-construction" },
    employee_band: { kind: "single", value: "5-19" },
    business_goal: { kind: "multi", value: ["reduce-admin", "faster-responses"] },
    bottleneck: { kind: "multi", value: ["documents", "enquiries-quotes"] },
    primary_bottleneck: { kind: "single", value: "documents" },
    task_volume: { kind: "single", value: "16-40" },
    minutes_per_task: { kind: "single", value: "16-30" },
    hourly_cost: { kind: "single", value: "51-80" },
    error_or_loss: { kind: "single", value: "occasionally" },
    process_standardisation: { kind: "scale", value: 3 },
    exception_rate: { kind: "single", value: "10-25" },
    data_location: { kind: "multi", value: ["email", "spreadsheets", "saas"] },
    current_software: { kind: "multi", value: ["servicem8", "xero"] },
    input_channels: { kind: "multi", value: ["phone", "email", "web-forms"] },
    metrics_tracking: { kind: "single", value: "yes-basic" },
    process_owner: { kind: "single", value: "side-duty" },
    human_review: { kind: "single", value: "always-review" },
    sensitive_data: { kind: "multi", value: ["none"] },
    document_type: { kind: "multi", value: ["invoices-receipts", "purchase-orders"] },
    monthly_document_volume: { kind: "single", value: "21-100" },
    document_formats: { kind: "multi", value: ["pdf-email", "scans-photos"] },
    document_error_consequence: { kind: "single", value: "delays" },
    enquiry_sources: { kind: "multi", value: ["email", "web-forms"] },
    weekly_enquiry_count: { kind: "single", value: "6-15" },
    current_response_time: { kind: "single", value: "1-2-days" },
    weekly_quote_count: { kind: "single", value: "6-15" },
    follow_up_method: { kind: "single", value: "spreadsheet" },
    budget_band: { kind: "single", value: "5-15k" },
    timing: { kind: "single", value: "immediately" },
  };

  for (const [qid, answer] of Object.entries(answers)) {
    upsertAnswer(assessment.id, qid, 1, JSON.stringify(answer));
  }

  const visibleIds = new Set(visibleQuestions(QUESTIONNAIRE_V1, answers).map((q) => q.id));
  const engineAnswers = Object.fromEntries(Object.entries(answers).filter(([k]) => visibleIds.has(k)));
  const evaluation = evaluateAssessment(QUESTIONNAIRE_V1, engineAnswers);
  insertEvaluation({
    assessment_id: assessment.id,
    engine_version: ENGINE_VERSION,
    opportunity_results_json: JSON.stringify(evaluation.opportunities),
    calculations_json: JSON.stringify({
      selected_ids: evaluation.selected_ids,
      priority_id: evaluation.priority_id,
      preview: buildPreview(evaluation),
    }),
    risk_flags_json: JSON.stringify({ global_risk_flags: evaluation.global_risk_flags }),
    confidence_json: JSON.stringify(evaluation.confidence),
  });
  updateAssessmentStatus(assessment.id, "lead_submitted");

  upsertLead({
    assessment_id: assessment.id,
    name: "Dana Owner",
    work_email: "dana@exampletrades.com.au",
    company_name: "Example Trades Pty Ltd",
    marketing_opt_in: false,
    privacy_notice_version: "privacy-notice-v1",
  });

  console.log(`Seeded demo lead (${DEMO_ASSESSMENT_TAG}): assessment ${assessment.id} with ${getAnswers(assessment.id).length} answers.`);
  console.log("Sign in at /admin/login to view it.");
}

void main();
