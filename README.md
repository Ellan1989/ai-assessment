# AI Business Opportunity Assessment

A free self-assessment tool for Australian SMEs: a dynamic questionnaire, a deterministic
opportunity-matching and value engine, a personalised report (web + PDF), lead capture, and a
staff-only leads portal. Built to the MVP spec in `docs/spec.md` (中文设计书 v1.0).

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · SQLite via better-sqlite3
(migrations included; swap to PostgreSQL by replacing `src/lib/db`) · Zod 4 · pdfkit ·
pluggable LLM + email adapters.

## Quick start

```bash
npm install
cp .env.example .env.local        # then edit ADMIN_PASSWORD and APP_SECRET
npm run db:migrate                # optional — migrations also run on server boot
npm run db:seed                   # optional demo lead for the admin portal
npm run dev                       # http://localhost:3000
```

Sign in to the staff portal at `/admin/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (add `-- -p 3100` to change port) |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit + API integration tests (77 tests, Vitest) |
| `npm run test:e2e` | End-to-end journey against a **running** server — `BASE_URL=… ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run test:e2e` |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Insert one demo lead (idempotent) |

## How it works

1. **Landing → questionnaire.** `POST /api/assessments` mints an anonymous assessment id +
   session token (stored in `localStorage`; only its sha256 hash is persisted). Questions come
   from a versioned config (`src/lib/questionnaire/v1.ts`); branches appear based on the
   bottlenecks chosen, and a risk overlay appears when sensitive data or no-review automation
   is involved. Answers autosave in debounced batches.
2. **Deterministic engine** (`src/lib/domain/engine.ts`). Matches answers against 7 opportunity
   models, scores each on 6 weighted dimensions, applies hard risk gates that cannot be
   outweighed by scores, computes the value range from band midpoints + configured reduction
   assumptions, and assigns a rule-based confidence level. The LLM never computes numbers.
3. **Preview before email.** The preview shows a concrete finding and the indicative value
   range before any details are requested.
4. **Lead + report.** Email capture (marketing opt-in separate, never pre-ticked) → report
   generation (LLM narrative with Zod validation + one retry, falling back to the deterministic
   template) → web report + PDF by unguessable, expiring token → email adapter (console/Resend).
   Regeneration is idempotent: same link, no duplicate email.
5. **Admin portal.** Cookie-authenticated leads dashboard with funnel metrics, follow-up
   states, internal notes, CSV export and question drop-off analysis. All access is audit-logged.

See `docs/api.md` for the full API contract and `docs/business-rules.md` for the scoring
weights, risk gates and value formulas.

## Deployment & rollback

- **Deploy:** set env vars from `.env.example` (notably `APP_BASE_URL`, `APP_SECRET`,
  `ADMIN_EMAIL/PASSWORD`, `DATABASE_PATH`, and optionally `LLM_*` / `EMAIL_*`), then
  `npm ci && npm run build && npm start`. Migrations apply automatically on boot.
  The SQLite file and generated PDFs live under `.data/` — include it in backups.
- **Rollback:** redeploy the previous build; migrations are append-only, so an older build
  runs safely against a newer schema (unknown columns are ignored). Restore `.data/` from
  backup to roll back data.

## Security & privacy checklist

- [x] No secrets in client code; keys only in server env (`LLM_API_KEY`, `RESEND_API_KEY`).
- [x] Assessment access requires a session token (hash-compared); report links are 256-bit
      random, stored hashed + AES-GCM-encrypted, and expire (`REPORT_TTL_DAYS`, default 30).
- [x] All request bodies validated with Zod; output rendered as text (React escaping) — no
      raw model output is ever injected into HTML, SQL or commands.
- [x] Prompt-injection containment: user answers are passed to the LLM as JSON data with a
      system prompt that forbids new numbers; all numeric fields are overwritten from the
      engine before saving.
- [x] Admin: HMAC-signed HttpOnly SameSite=Strict cookie, constant-time credential compare,
      cross-origin mutation rejection, login rate limiting, audit log.
- [x] Rate limiting on all public mutating endpoints (in-memory; swap for Redis at scale).
- [x] Security headers (nosniff, DENY framing, referrer policy, permissions policy).
- [x] Privacy: anonymous until lead capture; marketing consent separate and unchecked;
      privacy notice version recorded per lead; answers expire with the assessment.
- [ ] Before production: legal review against Australian privacy obligations for your entity,
      threat modelling, dependency audit (`npm audit`), backup/restore drill.

## Known limitations (MVP scope)

- Single admin account via env vars (no SSO/multi-user — swap in your identity provider for
  `/api/admin/login` before real staff use, per spec §8).
- In-memory rate limiter and analytics are per-instance; SQLite is single-node. For
  multi-instance hosting, move to PostgreSQL + Redis.
- Marketing opt-in is recorded but no double opt-in email flow yet.
- The LLM path is optional; without `LLM_API_KEY` every report uses the deterministic
  template (fully functional, less personalised).
- Report email links use `APP_BASE_URL`; the console provider just logs them in dev.
- No automated browser E2E in CI yet (`npm run test:e2e` is a scripted journey over HTTP; UI
  was verified manually in-browser).

## Testing

```bash
npm test          # 77 tests: value formulas, gates, scoring, branching, report consistency, API flows
BASE_URL=http://localhost:3100 ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run test:e2e   # 20 checks
```

Test results on delivery: **77/77 unit+API, 20/20 E2E, production build clean.**
