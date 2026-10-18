import { getDb } from "@/lib/db/index";
import { analyticsOverview, dropOffByQuestion } from "@/lib/db/repositories";
import { requireAdmin } from "@/lib/admin-auth";
import { jsonOk } from "@/lib/security";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const db = getDb();
  const funnel = db
    .prepare("SELECT status, COUNT(*) AS c FROM assessments GROUP BY status")
    .all() as { status: string; c: number }[];
  const leadStatuses = db
    .prepare("SELECT follow_up_status, COUNT(*) AS c FROM leads GROUP BY follow_up_status")
    .all() as { follow_up_status: string; c: number }[];

  return jsonOk({
    events: analyticsOverview(),
    assessment_funnel: Object.fromEntries(funnel.map((r) => [r.status, r.c])),
    lead_statuses: Object.fromEntries(leadStatuses.map((r) => [r.follow_up_status, r.c])),
    drop_off: dropOffByQuestion().filter((d) => d.is_last > 0).slice(0, 10),
  });
}
