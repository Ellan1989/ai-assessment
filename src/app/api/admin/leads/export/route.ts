import { listLeads } from "@/lib/db/repositories";
import { enrichLeads } from "@/lib/admin-leads";
import { requireAdmin } from "@/lib/admin-auth";
import { csvEscape } from "@/lib/util";
import { audit } from "@/lib/services";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { rows } = listLeads({ page: 1, pageSize: 50 });
  const columns = [
    "created_at", "name", "work_email", "company_name", "marketing_opt_in",
    "assessment_status", "primary_opportunity", "industry", "budget_band", "timing",
    "follow_up_status", "internal_notes",
  ];
  const lines = [columns.join(",")];
  for (const lead of enrichLeads(rows)) {
    const record = lead as unknown as Record<string, unknown>;
    lines.push(columns.map((c) => csvEscape(record[c])).join(","));
  }
  audit("admin", "leads_exported", { count: rows.length });
  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
