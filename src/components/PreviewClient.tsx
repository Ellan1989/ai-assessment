"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PreviewPayload } from "@/lib/domain/engine";

export default function PreviewClient({ assessmentId }: { assessmentId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = localStorage.getItem(`aoa_token_${assessmentId}`) ?? "";
      const res = await fetch(`/api/assessments/${assessmentId}/evaluation`, { headers: { "x-session-token": token } });
      if (!token) {
        if (!cancelled) setError("Session missing — please start again.");
        return;
      }
      if (res.status === 404) {
        if (!cancelled) setError("This assessment hasn't been evaluated yet.");
        return;
      }
      if (!res.ok) {
        if (!cancelled) setError("Could not load your results. Please try again.");
        return;
      }
      const data = (await res.json()) as { preview: PreviewPayload };
      if (!cancelled) setPreview(data.preview);
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!consent) {
      setFormError("Please acknowledge the privacy notice to receive your report.");
      return;
    }
    setSubmitting(true);
    const token = localStorage.getItem(`aoa_token_${assessmentId}`);
    try {
      const leadRes = await fetch(`/api/assessments/${assessmentId}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": token ?? "" },
        body: JSON.stringify({ work_email: email, name: name || undefined, company_name: company || undefined, marketing_opt_in: marketing, consent_privacy_notice: true }),
      });
      if (!leadRes.ok) {
        const body = (await leadRes.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Please check your details and try again.");
      }
      const reportRes = await fetch(`/api/assessments/${assessmentId}/report`, {
        method: "POST",
        headers: { "x-session-token": token ?? "" },
      });
      if (!reportRes.ok) {
        const body = (await reportRes.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Report generation failed — your answers are safe, please retry.");
      }
      const reportData = (await reportRes.json()) as { report_url: string };
      router.push(reportData.report_url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <main className="flex-1 bg-slate-50 px-4 py-20 text-center">
        <p className="text-slate-700">{error}</p>
        <Link href="/" className="mt-4 inline-block rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white">Start again</Link>
      </main>
    );
  }
  if (!preview) {
    return <main className="flex-1 bg-slate-50 px-4 py-20 text-center"><p className="animate-pulse text-slate-500">Loading your results…</p></main>;
  }

  const v = preview.value_range;
  return (
    <main className="flex-1 bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-700">Your preview</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">What stood out in your answers</h1>
        <p className="mt-3 text-slate-600">{preview.profile_summary.headline}</p>

        {/* concrete finding first (spec §3: value before email) */}
        <section className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-6">
          <h2 className="font-semibold text-blue-900">Your headline finding</h2>
          <p className="mt-2 text-blue-950">{preview.headline_finding}</p>
          {v.baseline_aud != null && (
            <p className="mt-3 text-sm text-blue-900">
              Indicative annual time value range: <strong>{aud(v.low_aud)} – {aud(v.high_aud)}</strong> (baseline {aud(v.baseline_aud)}) · time value, not cash savings
            </p>
          )}
          <p className="mt-2 text-xs text-blue-700">Confidence: {preview.confidence.level} — {preview.confidence.reasons.join(" ")}</p>
        </section>

        {/* opportunities */}
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Opportunities matched to your answers</h2>
          </div>
          <p className="-mt-2 text-xs leading-relaxed text-slate-500">
            The score (0–100) shows how well each opportunity fits your answers — pain, volume, process, data,
            systems and ownership. It ranks what to look at first; it is not an industry benchmark, a success
            rate or a return promise.
          </p>
          {preview.opportunities.map((o) => (
            <div key={o.opportunity_id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-slate-900">{o.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{o.summary}</p>
                  <p className="mt-2 text-sm text-slate-700">{o.one_line}</p>
                </div>
                <span
                  title={`Fit with your answers: ${o.score}/100 (${o.band.replaceAll("_", " ")})`}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    o.band === "priority_validate" ? "bg-emerald-100 text-emerald-800" : o.band === "potential" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {o.score}/100
                </span>
              </div>
            </div>
          ))}
        </section>

        {/* risks */}
        {preview.key_risks.length > 0 && (
          <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="font-semibold text-amber-900">Risks we&apos;ll design around</h2>
            <ul className="mt-3 space-y-2 text-sm text-amber-950">
              {preview.key_risks.map((r) => (
                <li key={r.title}><strong>{r.title}.</strong> {r.mitigation}</li>
              ))}
            </ul>
          </section>
        )}

        {/* lead capture */}
        <section className="mt-10 rounded-2xl border border-slate-300 bg-white p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-slate-900">Unlock your full report</h2>
          <p className="mt-2 text-sm text-slate-600">
            The full report includes the concept design for your priority opportunity, the complete value workings
            and formulas, feasibility analysis, the 90-day roadmap, and a PDF copy.
          </p>
          <form onSubmit={unlock} className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Work email *</span>
                <input
                  type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourbusiness.com.au"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none" />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Company name</span>
              <input value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none" />
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-600">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                I understand my email is used to send my report link and hold my assessment for follow-up, as described in the{" "}
                <Link href="/privacy" className="text-blue-700 underline underline-offset-2" target="_blank">privacy notice</Link>. *
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-600">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>Send me occasional practical notes on AI for small business (optional, separate from my report).</span>
            </label>
            {formError && <p className="text-sm text-red-700">{formError}</p>}
            <button
              type="submit" disabled={submitting}
              className="w-full rounded-xl bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {submitting ? "Generating your report…" : "Get my full report"}
            </button>
            <p className="text-center text-xs text-slate-400">No spam. Unsubscribe anytime. Your report works without the marketing box ticked.</p>
          </form>
        </section>
      </div>
    </main>
  );
}

function aud(n: number | null): string {
  if (n == null) return "n/a";
  return `AU$${Math.round(n).toLocaleString("en-AU")}`;
}
