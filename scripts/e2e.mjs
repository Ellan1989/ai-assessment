#!/usr/bin/env node
/**
 * End-to-end journey against a RUNNING server (npm run dev or npm start).
 * Usage: BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run test:e2e
 * Exits non-zero on any failure. Creates real records in the server's database.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? process.env.npm_config_env_admin_email ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-before-production";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const answers = {
  company_industry: { kind: "single", value: "trades-construction" },
  employee_band: { kind: "single", value: "5-19" },
  business_goal: { kind: "multi", value: ["reduce-admin", "reduce-errors"] },
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
  current_response_time: { kind: "single", value: "same-day" },
  weekly_quote_count: { kind: "single", value: "6-15" },
  follow_up_method: { kind: "single", value: "spreadsheet" },
  budget_band: { kind: "single", value: "5-15k" },
  timing: { kind: "single", value: "1-3-months" },
};

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

async function main() {
  console.log(`E2E against ${BASE}`);

  // 0. landing + questionnaire pages respond
  console.log("\n[1] Public pages");
  const landing = await fetch(`${BASE}/`);
  check("landing page renders", landing.status === 200 && (await landing.text()).includes("AI opportunity"));
  const questionnaire = await api("/api/questionnaire");
  check("questionnaire config served", questionnaire.status === 200 && questionnaire.body.questionnaire.questions.length >= 19);

  // 1. create assessment
  console.log("\n[2] Assessment lifecycle");
  const created = await api("/api/assessments", { method: "POST" });
  check("assessment created", created.status === 201 && created.body.session_token);
  const { assessment_id, session_token } = created.body;
  const auth = { "x-session-token": session_token };

  const noAuth = await api(`/api/assessments/${assessment_id}`);
  check("unauthenticated read rejected", noAuth.status === 401);

  const entries = Object.entries(answers).map(([question_id, answer]) => ({ question_id, answer }));
  const saved = await api(`/api/assessments/${assessment_id}/answers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ answers: entries }),
  });
  check("answers saved", saved.status === 200, JSON.stringify(saved.body));

  // "Other" free-text answers: filled text is accepted, empty text is rejected.
  const otherOk = await api(`/api/assessments/${assessment_id}/answers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ answers: [{ question_id: "employee_band", answer: { kind: "single", value: "5-19" } }, { question_id: "company_industry", answer: { kind: "single", value: "other", other_text: "IT & technology" } }] }),
  });
  check("other with description accepted", otherOk.status === 200, JSON.stringify(otherOk.body).slice(0, 200));
  const otherBad = await api(`/api/assessments/${assessment_id}/answers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ answers: [{ question_id: "company_industry", answer: { kind: "single", value: "other", other_text: "  " } }] }),
  });
  check("other without description rejected", otherBad.status === 422);
  // restore the canonical industry answer for the rest of the journey
  await api(`/api/assessments/${assessment_id}/answers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ answers: [{ question_id: "company_industry", answer: { kind: "single", value: "trades-construction" } }] }),
  });

  const evaluated = await api(`/api/assessments/${assessment_id}/evaluate`, { method: "POST", headers: auth });
  check(
    "evaluation returns preview with 2+ opportunities",
    evaluated.status === 200 && evaluated.body.preview?.opportunities?.length >= 2,
    JSON.stringify(evaluated.body).slice(0, 200),
  );
  check("preview shows a concrete finding with value", typeof evaluated.body.preview?.headline_finding === "string");

  // 2. lead + report
  console.log("\n[3] Lead capture & report");
  const lead = await api(`/api/assessments/${assessment_id}/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({
      name: "E2E Tester",
      work_email: "e2e@example.com.au",
      company_name: "E2E Test Co",
      marketing_opt_in: false,
      consent_privacy_notice: true,
    }),
  });
  check("lead accepted without marketing opt-in", lead.status === 200);

  const report = await api(`/api/assessments/${assessment_id}/report`, { method: "POST", headers: auth });
  check("report generated", report.status === 200 && report.body.report_url, JSON.stringify(report.body).slice(0, 200));
  const token = report.body.report_url.replace("/report/", "");

  const regen = await api(`/api/assessments/${assessment_id}/report`, { method: "POST", headers: auth });
  check("report regeneration is idempotent (same link)", regen.body.report_url === report.body.report_url && regen.body.already_generated === true);

  const reportJson = await api(`/api/reports/${token}`);
  check(
    "report JSON served by token",
    reportJson.status === 200 && reportJson.body.report?.executive_summary?.headline,
  );
  const annualHours = reportJson.body.report?.value_estimates?.annual_hours;
  check("report carries engine-computed annual hours", typeof annualHours === "number" && annualHours > 0);

  const pdf = await fetch(`${BASE}/api/reports/${token}?format=pdf`);
  const pdfHead = Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString();
  check("PDF served by token", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdfHead === "%PDF-");

  const badToken = await api(`/api/reports/${"x".repeat(43)}`);
  check("unknown report token rejected", badToken.status === 404);

  const reportPage = await fetch(`${BASE}/report/${token}`);
  check("report web page renders", reportPage.status === 200);

  // 3. admin
  console.log("\n[4] Admin portal");
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: BASE },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  check("admin login", login.status === 200, `status ${login.status} — check ADMIN_EMAIL/ADMIN_PASSWORD env`);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  const unauthLeads = await api("/api/admin/leads");
  check("admin API requires auth", unauthLeads.status === 401);

  if (cookie) {
    const leads = await api("/api/admin/leads", { headers: { cookie } });
    check("leads listed with context", leads.status === 200 && leads.body.leads?.some((l) => l.work_email === "e2e@example.com.au" && l.primary_opportunity));

    const leadId = leads.body.leads?.find((l) => l.work_email === "e2e@example.com.au")?.id;
    if (leadId) {
      const patched = await api(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie, origin: BASE },
        body: JSON.stringify({ follow_up_status: "contacted" }),
      });
      check("lead status updated", patched.status === 200);
    }

    const csv = await fetch(`${BASE}/api/admin/leads/export`, { headers: { cookie } });
    const csvText = await csv.text();
    check("CSV export", csv.status === 200 && csvText.includes("e2e@example.com.au"));
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
