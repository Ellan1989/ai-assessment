# Business rules: opportunity scoring, risk gates, value & confidence

Everything in this document is implemented deterministically in
`src/lib/opportunities/index.ts`, `src/lib/domain/{risk,value,confidence,engine}.ts` and is
covered by unit tests. The LLM only re-phrases narrative text; it can never change a number.

## 1 · Opportunity library (7 models)

| id | name | trigger (bottleneck answers) |
| --- | --- | --- |
| `doc_processing` | Document processing & information extraction | documents |
| `enquiry_triage` | Enquiry triage & follow-up | enquiries-quotes |
| `customer_service_assist` | Customer service assistant | customer-service |
| `knowledge_retrieval` | Internal knowledge search | knowledge-lookup |
| `workflow_automation` | Operations workflow automation | cross-system-entry / scheduling-dispatch / invoicing-chasing |
| `reporting_analysis` | Reporting & data analysis | reporting-analysis |
| `meeting_followup` | Meeting & communication follow-up | meeting-followups |

Each model also declares exclusions, prerequisites, evidence requirements, typical
integrations, a risk-sensitivity profile and the value-input source (e.g. document volume for
`doc_processing`, manual copy frequency × 5/week for `workflow_automation`).

## 2 · Scoring (spec §5.1)

Each opportunity is scored independently — there is no global company score. Dimensions and
maxima:

| dimension | max | driven by (summary) |
| --- | --- | --- |
| pain match | 30 | bottleneck selection ± error frequency / consequence / response time |
| task frequency & workload | 20 | branch-specific volume bands, falling back to `task_volume` |
| process standardisation | 15 | 5-level scale × 3 |
| data availability | 15 | digital data sources, document formats, knowledge sources & freshness |
| system connectivity | 10 | known connectable software, API availability, channels |
| owner / readiness | 10 | process owner (dedicated 10 / side-duty 6 / nobody 2) |

- Missing data → the dimension is `unknown` (null), **not zero**: it is listed in
  `unknown_dimensions` and lowers confidence; ranking uses the raw sum of known dimensions.
- Data completeness = share of achievable maxima that is known. Below 60 % the band is capped
  at `potential` — a score built mostly on unknowns can never be labelled "priority".
- Bands (ordering aid, not an industry benchmark): `70–100 priority_validate` ·
  `45–69 potential` · `0–44 hold`.
- Selection: up to 3 opportunities, qualified bands first. The priority is the best
  non-gated one; if every selection is gated, the report switches to **governance-first**.

## 3 · Hard risk gates (spec §5.2)

A triggered gate marks the opportunity `not_recommended` regardless of its score:

| gate | fires when |
| --- | --- |
| `unreviewed_high_impact` | user prefers full automation **and** impact is financial/legal/safety-critical **and** the opportunity writes actions or touches sensitive data |
| `unclear_data_permissions` | sensitive data involved **and** the access scope a tool would need is unknown |
| `no_data_governance_owner` | sensitive data involved **and** nobody signs off data-handling changes |
| `high_consequence_no_review` | high error consequence **and** no human review planned (or unknown) |
| `systems_inaccessible` | cross-system automation **and** no API **and** no connectable software |

When gates fire, the recommendation becomes "fix process / permissions / data handling
first — or start with rules-based automation", never an unattended agent.

## 4 · Value engine (spec §6)

```
annual task hours   = tasks per week × minutes per task ÷ 60 × 52
released hours      = annual task hours × reduction ratio (per scenario)
indicative value    = released hours × hourly cost (AUD, excl. GST)
first-year ROI      = (benefit − implementation − run cost) ÷ (implementation + run cost)
```

- Inputs are **band midpoints** from the questionnaire config (never LLM guesses).
  Branch-specific frequency wins over the generic `task_volume` (e.g. monthly document
  volume ÷ 4.33).
- Reduction ratios are per-opportunity planning assumptions —
  conservative / baseline / optimistic (e.g. documents 25 % / 40 % / 60 %,
  workflow automation 30 % / 45 % / 65 %…). Every output labels them
  *"planning assumption — validate in a pilot"*.
- Time value is always presented as time value, never as cash savings.
- ROI is **not shown** in the free report: implementation and running costs are unscoped, so
  the formula returns null rather than a made-up percentage (`computeRoi` is unit-tested for
  when it would apply). Avoided-loss estimates require quantified loss data the questionnaire
  deliberately doesn't ask for; they are listed as "data to collect" instead.
- Unknown inputs are listed as `missing_inputs`; nothing defaults to zero.

## 5 · Confidence (spec §6.2)

Deterministic only — the LLM never self-assesses:

- penalty = number of unknown key inputs (`task_volume`, `minutes_per_task`, `hourly_cost`,
  `error_or_loss`) + 1 if numbers aren't tracked (`metrics_tracking` = no / not sure)
- penalty 0 → **high** · 1–2 → **medium** · ≥3 → **low**; reasons and unknowns are listed.

## 6 · Report guardrails (spec §7.3)

The LLM receives structured answers (as labels), engine results and an output schema. It must
not invent numbers, benchmarks, prices or capabilities, present anything as validated, or
ignore risk gates. Its output is Zod-validated; on failure it is retried once, then the
deterministic template is used. Before saving, every numeric field is overwritten from the
engine, so report numbers are always byte-identical to engine results (asserted by tests).
