# API contract

Base URL: `APP_BASE_URL` (default `http://localhost:3000`). All bodies are JSON.
Errors use `{ "error": { "code", "message", …extra } }`. Mutating endpoints are rate-limited per IP.

## Public endpoints

### `POST /api/assessments`
Starts an anonymous assessment. → `201 { assessment_id, session_token, expires_at }`.
The client keeps `session_token` (localStorage) and sends it as `x-session-token` on every
assessment call. Rate limit: 20/h per IP.

### `GET /api/questionnaire`
Versioned questionnaire config (questions, options, bands + midpoints, branch rules,
data-usage notes). Public and cacheable.

### `GET /api/assessments/:id`  *(x-session-token)*
Resume payload: `{ assessment: { id, status, questionnaire_version, expires_at }, answers }`.
`401` wrong/missing token · `404` unknown id · `410` expired.

### `PUT /api/assessments/:id/answers`  *(x-session-token)*
`{ "answers": [{ question_id, answer }, …] }` (≤30 per call). Each answer is validated
against the question config (option ids, multi limits, other-text, unknown allowed) and
against branch reachability — answering a not-yet-visible question is rejected `422`
`{ error: { code: "invalid_answers", rejected: […] } }`. Answers whose question becomes
unreachable after a branch change are deleted server-side. Rate limit: 600/h.

Answer shapes: `{kind:"single", value:"option_id", other_text?}` · `{kind:"multi", value:[ids],
other_text?}` · `{kind:"scale", value:1..5}` · `{kind:"unknown"}` (only where offered).

### `POST /api/assessments/:id/evaluate`  *(x-session-token)*
Runs the deterministic engine. Requires every visible required question answered
(`422 { error: { missing: [question_ids] } }` otherwise). Stores the evaluation, sets status
`evaluated`, returns `{ preview }` (see below). `409` if the assessment is past evaluation.

### `GET /api/assessments/:id/evaluation`  *(x-session-token)*
Returns the stored `{ engine_version, preview }` for page reloads.

Preview shape:
```jsonc
{
  "profile_summary": { "industry": [], "employees": [], "goals": [], "bottlenecks": [], "headline": "…" },
  "confidence": { "level": "high|medium|low", "reasons": [], "key_unknowns": [] },
  "headline_finding": "About 276 hours a year go into this today; …",
  "opportunities": [{ "opportunity_id", "name", "summary", "score", "band", "feasibility", "one_line" }],
  "value_range": { "low_aud", "baseline_aud", "high_aud", "annual_hours" },
  "key_risks": [{ "title", "mitigation" }]
}
```

### `POST /api/assessments/:id/lead`  *(x-session-token)*
`{ work_email, name?, company_name?, marketing_opt_in: boolean, consent_privacy_notice: true }`.
Validates the email, requires the privacy acknowledgement (`422` otherwise), normalises the
address, upserts the lead, records the consent version, sets status `lead_submitted`.
Marketing consent is never implied. Rate limit: 20/h.

### `POST /api/assessments/:id/report`  *(x-session-token)*
Generates the report. Requires lead + evaluation (`409 lead_required` / `409 not_evaluated`).
**Idempotent**: a repeat call returns the same link and never re-sends an email that already
went out. → `{ status: "ready", report_url: "/report/<token>", expires_at, email_sent, email_error?, generator }`.
`generator` is `llm` or `deterministic` (fallback). Rate limit: 20/h.

### `GET /api/reports/:token`
Serves the report by unguessable token. `?format=pdf` streams the PDF (lazily regenerated if
the file is missing). `404` unknown token · `410` expired link. No session needed — the token
is the credential.

## Admin endpoints  *(cookie `admin_session`, HttpOnly SameSite=Strict)*

### `POST /api/admin/login` / `POST /api/admin/logout`
`{ email, password }` → sets/clears the HMAC-signed session cookie (7 days). Constant-time
compare, 10 attempts / 15 min per IP, origin-checked. All successes/failures audit-logged.

### `GET /api/admin/leads?status=&page=&page_size=`
Paged, filterable lead list enriched with assessment context: primary opportunity, industry,
budget band, timing, assessment status, marketing opt-in, follow-up status, notes.

### `PATCH /api/admin/leads/:id`
`{ follow_up_status?: "new"|"contacted"|"discovery_booked"|"qualified"|"not_fit"|"converted", internal_notes? }`.

### `GET /api/admin/leads/export`
CSV of the first 50 leads (same columns as the list). Audit-logged.

### `GET /api/admin/overview`
Funnel counters (analytics events), assessment status counts, lead status counts, and
per-question drop-off. `401` without a valid session on all admin routes.
