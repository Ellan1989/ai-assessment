import { listLeads, type FollowUpStatus } from "@/lib/db/repositories";
import { enrichLeads } from "@/lib/admin-leads";
import { requireAdmin } from "@/lib/admin-auth";
import { jsonError, jsonOk } from "@/lib/security";
import { audit } from "@/lib/services";

const STATUSES: FollowUpStatus[] = ["new", "contacted", "discovery_booked", "qualified", "not_fit", "converted"];

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  if (status && !STATUSES.includes(status as FollowUpStatus)) {
    return jsonError(422, "invalid_status", "Unknown follow-up status filter.");
  }
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get("page_size") ?? "20") || 20));

  const { total, rows } = listLeads({ status: status ?? undefined, page, pageSize });
  audit("admin", "leads_listed", { page, status: status ?? "all" });
  return jsonOk({ total, page, page_size: pageSize, leads: enrichLeads(rows) });
}
