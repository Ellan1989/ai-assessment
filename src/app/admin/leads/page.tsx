"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AdminLeadRow } from "@/lib/admin-leads";

const STATUS_OPTIONS = ["new", "contacted", "discovery_booked", "qualified", "not_fit", "converted"] as const;

interface Overview {
  events: Record<string, number>;
  assessment_funnel: Record<string, number>;
  lead_statuses: Record<string, number>;
  drop_off: { question_id: string; answered: number; is_last: number }[];
}

export default function AdminLeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<AdminLeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [denied, setDenied] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const fetchLeads = useCallback(
    async (page: number, status: string): Promise<AdminLeadRow[] | null> => {
      const res = await fetch(`/api/admin/leads?page=${page}${status ? `&status=${status}` : ""}`);
      if (res.status === 401) {
        setDenied(true);
        return null;
      }
      const data = (await res.json()) as { total: number; leads: AdminLeadRow[] };
      setTotal(data.total);
      setLeads(data.leads);
      return data.leads;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchLeads(page, status);
      const res = await fetch("/api/admin/overview");
      if (!cancelled && res.ok) setOverview((await res.json()) as Overview);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchLeads, page, status]);

  async function patchLead(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await fetchLeads(page, status);
  }

  if (denied) {
    return (
      <main className="flex flex-1 items-center justify-center bg-slate-100 px-4 py-20">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-slate-700">Please sign in first.</p>
          <Link href="/admin/login" className="mt-4 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Go to sign-in</Link>
        </div>
      </main>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / 20));

  return (
    <main className="flex-1 bg-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
          <div className="flex items-center gap-3">
            <Link href="/api/admin/leads/export" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Export CSV (first 50)
            </Link>
            <button
              onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); router.push("/admin/login"); }}
              className="text-sm text-slate-500 underline"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* funnel strip */}
        {overview && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Started", overview.events.assessment_started ?? 0],
              ["Completed", overview.events.assessment_completed ?? 0],
              ["Previews", overview.events.preview_viewed ?? 0],
              ["Leads", overview.events.lead_submitted ?? 0],
              ["Reports", overview.events.report_generated ?? 0],
              ["Opened", overview.events.report_opened ?? 0],
              ["Assessments (in progress)", overview.assessment_funnel.in_progress ?? 0],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-2xl font-bold text-slate-900">{value as number}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">{label as string}</p>
              </div>
            ))}
          </div>
        )}

        {/* filters */}
        <div className="mt-6 flex items-center gap-2">
          <span className="text-sm text-slate-500">Filter:</span>
          {["", ...STATUS_OPTIONS].map((s) => (
            <button
              key={s || "all"}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${status === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-300"}`}
            >
              {s ? s.replaceAll("_", " ") : "all"}
            </button>
          ))}
        </div>

        {/* table */}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Company / industry</th>
                <th className="px-4 py-3">Top opportunity</th>
                <th className="px-4 py-3">Intent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    {new Date(lead.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                    <div className="text-xs text-slate-400">{lead.assessment_status}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{lead.name ?? "—"}</div>
                    <a href={`mailto:${lead.work_email}`} className="text-xs text-blue-700 underline">{lead.work_email}</a>
                    {lead.marketing_opt_in && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">OPT-IN</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {lead.company_name ?? "—"}
                    <div className="text-xs text-slate-400">{lead.industry ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{lead.primary_opportunity ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {lead.budget_band && <div>💰 {lead.budget_band}</div>}
                    {lead.timing && <div>⏱ {lead.timing}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={lead.follow_up_status}
                      onChange={(e) => patchLead(lead.id, { follow_up_status: e.target.value })}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <textarea
                      value={notes[lead.id] ?? lead.internal_notes ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [lead.id]: e.target.value }))}
                      onBlur={() => {
                        const val = notes[lead.id];
                        if (val !== undefined && val !== lead.internal_notes) patchLead(lead.id, { internal_notes: val });
                      }}
                      placeholder="Internal note"
                      className="w-48 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400"
                      rows={2}
                    />
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No leads yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>{total} lead{total === 1 ? "" : "s"}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">← Prev</button>
            <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Next →</button>
          </div>
        </div>

        {overview && overview.drop_off.length > 0 && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-900">Where people stop (last question answered)</p>
            <ul className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              {overview.drop_off.map((d) => (
                <li key={d.question_id}>{d.question_id}: {d.is_last} stopped here ({d.answered} answered)</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
