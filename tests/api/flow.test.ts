import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { POST as createAssessment } from "@/app/api/assessments/route";
import { GET as getAssessment } from "@/app/api/assessments/[id]/route";
import { PUT as putAnswers } from "@/app/api/assessments/[id]/answers/route";
import { POST as evaluate } from "@/app/api/assessments/[id]/evaluate/route";
import { GET as getEvaluation } from "@/app/api/assessments/[id]/evaluation/route";
import { POST as postLead } from "@/app/api/assessments/[id]/lead/route";
import { POST as postReport } from "@/app/api/assessments/[id]/report/route";
import { GET as getReport } from "@/app/api/reports/[token]/route";
import { POST as adminLogin } from "@/app/api/admin/login/route";
import { GET as adminLeads } from "@/app/api/admin/leads/route";
import { PATCH as patchLead } from "@/app/api/admin/leads/[id]/route";
import { GET as exportCsv } from "@/app/api/admin/leads/export/route";
import { QUESTIONNAIRE_V1, fullTradesAnswers } from "../helpers";
import type { AnswerValue } from "@/lib/domain/questionnaire";

const BASE = "http://localhost:3000";

function req(url: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${url}`, init);
}

function ctx<P extends object>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

afterAll(() => {
  // tidy the throwaway test database
  try {
    fs.rmSync(process.env.DATABASE_PATH!, { force: true });
    fs.rmSync(`${process.env.DATABASE_PATH!}-wal`, { force: true });
    fs.rmSync(`${process.env.DATABASE_PATH!}-shm`, { force: true });
  } catch {
    /* best effort */
  }
});

describe("API: full happy path (spec §8 contract)", () => {
  const answers = fullTradesAnswers();
  let assessmentId = "";
  let sessionToken = "";
  let reportToken = "";

  it("creates an assessment and returns id + session token", async () => {
    const res = await createAssessment(req("/api/assessments", { method: "POST" }));
    expect(res.status).toBe(201);
    const data = await json<{ assessment_id: string; session_token: string }>(res);
    expect(data.assessment_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.session_token.length).toBeGreaterThanOrEqual(32);
    assessmentId = data.assessment_id;
    sessionToken = data.session_token;
  });

  it("rejects access without a session token", async () => {
    const res = await getAssessment(req(`/api/assessments/${assessmentId}`), ctx({ id: assessmentId }));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong session token", async () => {
    const res = await getAssessment(
      req(`/api/assessments/${assessmentId}`, { headers: { "x-session-token": "f".repeat(64) } }),
      ctx({ id: assessmentId }),
    );
    expect(res.status).toBe(401);
  });

  it("restores an assessment with the right token", async () => {
    const res = await getAssessment(
      req(`/api/assessments/${assessmentId}`, { headers: { "x-session-token": sessionToken } }),
      ctx({ id: assessmentId }),
    );
    expect(res.status).toBe(200);
    const data = await json<{ answers: Record<string, AnswerValue> }>(res);
    expect(data.answers).toEqual({});
  });

  it("saves answers in batches and rejects invalid ones", async () => {
    const entries = Object.entries(answers).slice(0, 10).map(([question_id, answer]) => ({ question_id, answer }));
    const res = await putAnswers(
      req(`/api/assessments/${assessmentId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-session-token": sessionToken },
        body: JSON.stringify({ answers: entries }),
      }),
      ctx({ id: assessmentId }),
    );
    expect(res.status).toBe(200);

    const bad = await putAnswers(
      req(`/api/assessments/${assessmentId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-session-token": sessionToken },
        body: JSON.stringify({ answers: [{ question_id: "employee_band", answer: { kind: "single", value: "999999" } }] }),
      }),
      ctx({ id: assessmentId }),
    );
    expect(bad.status).toBe(422);
  });

  it("rejects answers to questions not yet reachable (branch integrity)", async () => {
    // fresh assessment: no bottleneck answered yet → documents branch unreachable
    const create = await createAssessment(req("/api/assessments", { method: "POST" }));
    const fresh = await json<{ assessment_id: string; session_token: string }>(create);
    const res = await putAnswers(
      req(`/api/assessments/${fresh.assessment_id}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-session-token": fresh.session_token },
        body: JSON.stringify({ answers: [{ question_id: "document_type", answer: { kind: "multi", value: ["invoices-receipts"] } }] }),
      }),
      ctx({ id: fresh.assessment_id }),
    );
    expect(res.status).toBe(422);
    expect(await json<{ error: { code: string } }>(res)).toMatchObject({ error: { code: "invalid_answers" } });
  });

  it("saves all remaining answers, then evaluates and returns a preview", async () => {
    const entries = Object.entries(answers).map(([question_id, answer]) => ({ question_id, answer }));
    const res = await putAnswers(
      req(`/api/assessments/${assessmentId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-session-token": sessionToken },
        body: JSON.stringify({ answers: entries }),
      }),
      ctx({ id: assessmentId }),
    );
    expect(res.status).toBe(200);

    const ev = await evaluate(
      req(`/api/assessments/${assessmentId}/evaluate`, { method: "POST", headers: { "x-session-token": sessionToken } }),
      ctx({ id: assessmentId }),
    );
    expect(ev.status).toBe(200);
    const data = await json<{ preview: { headline_finding: string; opportunities: { name: string }[]; value_range: { baseline_aud: number | null } } }>(ev);
    expect(data.preview.opportunities.length).toBeGreaterThanOrEqual(2);
    expect(data.preview.value_range.baseline_aud).toBeGreaterThan(0);
    expect(data.preview.headline_finding).toMatch(/hours|conversation/i);

    // preview is retrievable (page reload)
    const again = await getEvaluation(
      req(`/api/assessments/${assessmentId}/evaluation`, { headers: { "x-session-token": sessionToken } }),
      ctx({ id: assessmentId }),
    );
    expect(again.status).toBe(200);
  });

  it("refuses the report before lead details exist", async () => {
    const res = await postReport(
      req(`/api/assessments/${assessmentId}/report`, { method: "POST", headers: { "x-session-token": sessionToken } }),
      ctx({ id: assessmentId }),
    );
    expect(res.status).toBe(409);
  });

  it("validates lead input (bad email rejected, consent required)", async () => {
    const bad = await postLead(
      req(`/api/assessments/${assessmentId}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": sessionToken },
        body: JSON.stringify({ work_email: "not-an-email", marketing_opt_in: false, consent_privacy_notice: true }),
      }),
      ctx({ id: assessmentId }),
    );
    expect(bad.status).toBe(422);

    const noConsent = await postLead(
      req(`/api/assessments/${assessmentId}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": sessionToken },
        body: JSON.stringify({ work_email: "owner@trades.example.com.au", marketing_opt_in: false, consent_privacy_notice: false }),
      }),
      ctx({ id: assessmentId }),
    );
    expect(noConsent.status).toBe(422);
  });

  it("accepts the lead without marketing consent", async () => {
    const res = await postLead(
      req(`/api/assessments/${assessmentId}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": sessionToken },
        body: JSON.stringify({
          name: "Dana Owner",
          work_email: "owner@trades.example.com.au",
          company_name: "Example Trades Pty Ltd",
          marketing_opt_in: false,
          consent_privacy_notice: true,
        }),
      }),
      ctx({ id: assessmentId }),
    );
    expect(res.status).toBe(200);
  });

  it("generates the report (deterministic generator without an LLM key)", async () => {
    const res = await postReport(
      req(`/api/assessments/${assessmentId}/report`, { method: "POST", headers: { "x-session-token": sessionToken } }),
      ctx({ id: assessmentId }),
    );
    expect(res.status).toBe(200);
    const data = await json<{ status: string; report_url: string; generator: string; email_sent: boolean }>(res);
    expect(data.status).toBe("ready");
    expect(data.generator).toBe("deterministic");
    expect(data.report_url).toMatch(/^\/report\/.+$/);
    reportToken = data.report_url.replace("/report/", "");
  });

  it("is idempotent: regenerating does not resend the email", async () => {
    const res = await postReport(
      req(`/api/assessments/${assessmentId}/report`, { method: "POST", headers: { "x-session-token": sessionToken } }),
      ctx({ id: assessmentId }),
    );
    expect(res.status).toBe(200);
    const data = await json<{ already_generated: boolean; email_sent: boolean }>(res);
    expect(data.already_generated).toBe(true);
    expect(data.email_sent).toBe(true); // already sent once — not sent again
  });

  it("serves the report JSON by token", async () => {
    const res = await getReport(req(`/api/reports/${reportToken}`), ctx({ token: reportToken }));
    expect(res.status).toBe(200);
    const data = await json<{ report: { meta: { generator: string }; opportunities: unknown[] } }>(res);
    expect(data.report.meta.generator).toBe("deterministic");
    expect(data.report.opportunities.length).toBeGreaterThanOrEqual(2);
  });

  it("serves the PDF by token", async () => {
    const res = await getReport(req(`/api/reports/${reportToken}?format=pdf`), ctx({ token: reportToken }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(4000);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rejects unknown report tokens", async () => {
    const res = await getReport(req(`/api/reports/${"z".repeat(43)}`), ctx({ token: "z".repeat(43) }));
    expect(res.status).toBe(404);
  });

  it("report numbers match the engine for the same answers", async () => {
    const { evaluateAssessment } = await import("@/lib/domain/engine");
    const ev = evaluateAssessment(QUESTIONNAIRE_V1, answers);
    const res = await getReport(req(`/api/reports/${reportToken}`), ctx({ token: reportToken }));
    const data = await json<{ report: { value_estimates: { annual_hours: number | null } } }>(res);
    const priority = ev.opportunities.find((o) => o.opportunity_id === ev.priority_id)!;
    expect(data.report.value_estimates.annual_hours).toBe(priority.value!.annual_hours);
  });
});

describe("API: admin portal", () => {
  let cookie = "";

  it("rejects bad credentials", async () => {
    const res = await adminLogin(
      req("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: BASE, host: "localhost:3000" },
        body: JSON.stringify({ email: "admin@test.local", password: "wrong" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin login (CSRF)", async () => {
    const res = await adminLogin(
      req("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "https://evil.example", host: "localhost:3000" },
        body: JSON.stringify({ email: "admin@test.local", password: "test-password-123" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("logs in with correct credentials and sets an HttpOnly cookie", async () => {
    const res = await adminLogin(
      req("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: BASE, host: "localhost:3000" },
        body: JSON.stringify({ email: "admin@test.local", password: "test-password-123" }),
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/);
    cookie = setCookie.split(";")[0];
  });

  it("lists leads with assessment context only when authenticated", async () => {
    const unauth = await adminLeads(req("/api/admin/leads"));
    expect(unauth.status).toBe(401);

    const res = await adminLeads(req("/api/admin/leads", { headers: { cookie } }));
    expect(res.status).toBe(200);
    const data = await json<{ total: number; leads: { work_email: string; primary_opportunity: string | null; budget_band: string | null; marketing_opt_in: boolean }[] }>(res);
    expect(data.total).toBe(1);
    const lead = data.leads[0];
    expect(lead.work_email).toBe("owner@trades.example.com.au");
    expect(lead.primary_opportunity).toBeTruthy();
    expect(lead.budget_band).toBeTruthy();
    expect(lead.marketing_opt_in).toBe(false);
  });

  it("updates follow-up status and notes", async () => {
    const list = await adminLeads(req("/api/admin/leads", { headers: { cookie } }));
    const data = await json<{ leads: { id: string }[] }>(list);
    const id = data.leads[0].id;

    const res = await patchLead(
      req(`/api/admin/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie, origin: BASE, host: "localhost:3000" },
        body: JSON.stringify({ follow_up_status: "contacted", internal_notes: "Called, interested in doc automation" }),
      }),
      ctx({ id }),
    );
    expect(res.status).toBe(200);

    const again = await adminLeads(req("/api/admin/leads?status=contacted", { headers: { cookie } }));
    const filtered = await json<{ total: number }>(again);
    expect(filtered.total).toBe(1);
  });

  it("exports CSV (authorised only)", async () => {
    const unauth = await exportCsv(req("/api/admin/leads/export"));
    expect(unauth.status).toBe(401);

    const res = await exportCsv(req("/api/admin/leads/export", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const text = await res.text();
    expect(text).toContain("work_email");
    expect(text).toContain("owner@trades.example.com.au");
  });
});
