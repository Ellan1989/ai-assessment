"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ReportDoc } from "@/lib/report/schema";

export default function ReportClient({ token }: { token: string }) {
  const [report, setReport] = useState<ReportDoc | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "expired" | "notfound" | "error">("loading");

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/reports/${token}`);
      if (res.status === 410) return setState("expired");
      if (res.status === 404) return setState("notfound");
      if (!res.ok) return setState("error");
      const data = (await res.json()) as { report: ReportDoc };
      setReport(data.report);
      setState("ready");
    })();
  }, [token]);

  if (state === "loading") return <Wrap><p className="animate-pulse text-center text-slate-500">Opening your report…</p></Wrap>;
  if (state === "expired")
    return (
      <Wrap>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">This report link has expired</h1>
          <p className="mt-2 text-slate-600">Report links stay valid for 30 days. Reply to your report email and we&apos;ll re-issue it.</p>
        </Card>
      </Wrap>
    );
  if (state !== "ready" || !report)
    return (
      <Wrap>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Report not found</h1>
          <p className="mt-2 text-slate-600">Check the link in your email, or <Link href="/" className="text-blue-700 underline">start a new assessment</Link>.</p>
        </Card>
      </Wrap>
    );

  const v = report.value_estimates;

  return (
    <Wrap>
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-700">Your report</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">AI Opportunity Assessment</h1>
            <p className="mt-1 text-xs text-slate-500">
              Generated {new Date(report.meta.generated_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })} ·
              Engine {report.meta.engine_version} · {report.meta.generator === "llm" ? "AI-narrated, engine-computed" : "Template-narrated"}
            </p>
          </div>
          <div className="flex gap-2">
            <a href={`/api/reports/${token}?format=pdf`} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">
              Download PDF
            </a>
            <button onClick={() => window.print()} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Print
            </button>
          </div>
        </div>

        {/* 1. executive summary */}
        <Section n="1" title="Executive summary">
          <p className="text-slate-700">{report.executive_summary.situation}</p>
          <p className="mt-2 text-slate-700"><strong>Goal:</strong> {report.executive_summary.goal}</p>
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-900">Most important finding</p>
            <p className="mt-1 text-sm text-blue-950">{report.executive_summary.headline}</p>
          </div>
          {report.executive_summary.narrative.map((para, i) => (
            <p key={i} className="mt-3 text-slate-700">{para}</p>
          ))}
        </Section>

        {/* 2. opportunities */}
        <Section n="2" title="Opportunities matched to your answers">
          <p className="-mt-2 mb-4 text-xs leading-relaxed text-slate-500">
            The score (0–100) shows how well each opportunity fits your answers — pain, volume, process, data,
            systems and ownership. It ranks what to look at first; it is not an industry benchmark, a success
            rate or a return promise.
          </p>
          {report.opportunities.map((o, i) => (
            <div key={o.opportunity_id} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-slate-900">{i + 1}. {o.name}</h3>
                <Badge band={o.band} />
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <Row k="Problem">{o.problem}</Row>
                <Row k="Today">{o.current_process}</Row>
                <Row k="Expected improvement">{o.expected_improvement}</Row>
                <Row k="Why it fits">{o.fit_reason}</Row>
              </dl>
            </div>
          ))}
        </Section>

        {/* 3. concept card */}
        <Section n="3" title="Priority concept design">
          <div className="rounded-xl border-2 border-slate-900 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-slate-900">{report.priority_concept.solution_name}</h3>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                complexity: {report.priority_concept.complexity_band}
              </span>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <Row k="Goal">{report.priority_concept.business_goal}</Row>
              <Row k="Problem">{report.priority_concept.current_problem}</Row>
              <Row k="Trigger">{report.priority_concept.trigger}</Row>
              <Row k="Inputs"><List items={report.priority_concept.inputs} /></Row>
              <Row k="Steps"><OrderedList items={report.priority_concept.steps} /></Row>
              <Row k="Integrations"><List items={report.priority_concept.integrations} /></Row>
              <Row k="Outputs">{report.priority_concept.outputs}</Row>
              <Row k="Human approval"><List items={report.priority_concept.human_approval_points} /></Row>
              <Row k="Exceptions"><List items={report.priority_concept.exception_paths} /></Row>
              <Row k="Success metrics"><List items={report.priority_concept.success_metrics} /></Row>
              <Row k="Assumptions"><List items={report.priority_concept.assumptions} /></Row>
              <Row k="Risks"><List items={report.priority_concept.risks} /></Row>
              {report.priority_concept.unresolved_questions.length > 0 && (
                <Row k="Open questions"><List items={report.priority_concept.unresolved_questions} /></Row>
              )}
              <Row k="Feasibility">{report.priority_concept.feasibility.replaceAll("_", " ")}</Row>
            </dl>
          </div>
        </Section>

        {/* 4. value */}
        <Section n="4" title="Value estimate (indicative)">
          {v.annual_hours != null ? (
            <p className="text-slate-700">Current effort: about <strong>{hours(v.annual_hours)}</strong> per year in this area.</p>
          ) : (
            <p className="text-slate-700">Current annual effort couldn&apos;t be computed — key inputs are missing (listed below).</p>
          )}
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-slate-700">
                <tr><th className="px-4 py-2 font-semibold">Scenario</th><th className="px-4 py-2 font-semibold">Reduction</th><th className="px-4 py-2 font-semibold">Hours released</th><th className="px-4 py-2 font-semibold">Indicative time value</th></tr>
              </thead>
              <tbody>
                {v.scenarios.map((s) => (
                  <tr key={s.name} className="border-t border-slate-200">
                    <td className="px-4 py-2 capitalize">{s.name}</td>
                    <td className="px-4 py-2">{Math.round(s.reduction_ratio * 100)}%</td>
                    <td className="px-4 py-2">{s.released_hours != null ? hours(s.released_hours) : "n/a"}</td>
                    <td className="px-4 py-2">{s.time_value_aud != null ? aud(s.time_value_aud) : "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 space-y-1 text-xs text-slate-500">
            {v.formulas.map((f, i) => <p key={i}>{f}</p>)}
          </div>
          {v.assumptions.length > 0 && (
            <div className="mt-4"><p className="text-sm font-semibold text-slate-700">Assumptions</p><List items={v.assumptions} /></div>
          )}
          {v.missing_data.length > 0 && (
            <div className="mt-4"><p className="text-sm font-semibold text-slate-700">Missing inputs</p><List items={v.missing_data} /></div>
          )}
          <p className="mt-4 rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
            Confidence: <strong className="uppercase">{v.confidence.level}</strong> — {v.confidence.reasons.join(" ")} Released hours are an indicative internal time value (AUD, excl. GST), not a cash saving.
          </p>
        </Section>

        {/* 5. feasibility */}
        <Section n="5" title="Feasibility">
          <dl className="space-y-2 text-sm">
            <Row k="Process">{report.feasibility_analysis.process}</Row>
            <Row k="Data">{report.feasibility_analysis.data}</Row>
            <Row k="Systems">{report.feasibility_analysis.systems}</Row>
            <Row k="People">{report.feasibility_analysis.people}</Row>
          </dl>
        </Section>

        {/* 6. risks */}
        <Section n="6" title="Risks & boundaries">
          <ul className="space-y-2 text-sm">
            {report.risks_boundaries.map((r, i) => (
              <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <strong className="text-amber-900">{r.risk}</strong>
                <p className="text-amber-950">{r.mitigation}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* 7. roadmap */}
        <Section n="7" title="90-day high-level roadmap">
          <div className="grid gap-4 sm:grid-cols-3">
            {report.roadmap.map((phase) => (
              <div key={phase.phase} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-900">{phase.phase}</p>
                <p className="mt-1 text-xs font-medium text-blue-700">{phase.focus}</p>
                <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                  {phase.actions.map((a, i) => <li key={i}>• {a}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* 8. next steps */}
        <Section n="8" title="Next steps">
          <p className="text-sm font-semibold text-slate-700">Data to collect</p>
          <List items={report.next_steps.data_to_collect} />
          <div className="mt-4 rounded-xl border border-blue-700 bg-blue-700 p-5 text-white">
            <p className="font-semibold">Ready for the deep dive?</p>
            <p className="mt-1 text-sm text-blue-50">{report.next_steps.cta}</p>
          </div>
        </Section>

        {/* 9. method */}
        <Section n="9" title="Method & limitations">
          <p className="text-xs leading-relaxed text-slate-500">{report.method_disclaimer}</p>
        </Section>
      </div>
    </Wrap>
  );
}

// ---------------------------------------------------------------- small bits

function Wrap({ children }: { children: React.ReactNode }) {
  return <main className="flex-1 bg-slate-50 print:bg-white">{children}</main>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg px-4 py-20"><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">{children}</div></div>;
}
function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="border-b border-slate-200 pb-2 text-lg font-bold text-slate-900"><span className="text-blue-700">{n} ·</span> {title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
      <dt className="font-medium text-slate-500">{k}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}
function List({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-1 pl-5">{items.map((i, k) => <li key={k}>{i}</li>)}</ul>;
}
function OrderedList({ items }: { items: string[] }) {
  return <ol className="list-decimal space-y-1 pl-5">{items.map((i, k) => <li key={k}>{i}</li>)}</ol>;
}
function Badge({ band }: { band: string }) {
  const cls =
    band === "priority_validate" ? "bg-emerald-100 text-emerald-800" : band === "potential" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";
  return <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{band.replaceAll("_", " ")}</span>;
}
function aud(n: number) {
  return `AU$${Math.round(n).toLocaleString("en-AU")}`;
}
function hours(n: number) {
  return `${Math.round(n).toLocaleString("en-AU")} h`;
}
