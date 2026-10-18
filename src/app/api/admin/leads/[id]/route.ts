import { z } from "zod";
import { updateLead } from "@/lib/db/repositories";
import { requireAdmin } from "@/lib/admin-auth";
import { readJson } from "@/lib/api-helpers";
import { jsonError, jsonOk, sameOrigin } from "@/lib/security";
import { audit } from "@/lib/services";

const PatchSchema = z.object({
  follow_up_status: z.enum(["new", "contacted", "discovery_booked", "qualified", "not_fit", "converted"]).optional(),
  internal_notes: z.string().max(2000).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-origin request rejected.");

  const { id } = await ctx.params;
  const body = await readJson(req, PatchSchema);
  if ("error" in body) return body.error;
  if (body.data.follow_up_status == null && body.data.internal_notes == null) {
    return jsonError(422, "empty_patch", "Nothing to update.");
  }

  updateLead(id, body.data);
  audit("admin", "lead_updated", { lead_id: id, ...body.data });
  return jsonOk({ ok: true });
}
