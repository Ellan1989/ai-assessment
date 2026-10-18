import { z } from "zod";
import { updateAssessmentStatus, upsertLead } from "@/lib/db/repositories";
import { CONSENT_VERSION } from "@/lib/questionnaire/v1";
import { readJson, requireAssessment } from "@/lib/api-helpers";
import { getClientIp, jsonError, jsonOk, rateLimit } from "@/lib/security";
import { normaliseEmail } from "@/lib/util";
import { audit, track } from "@/lib/services";

const LeadSchema = z.object({
  name: z.string().trim().max(120).optional(),
  work_email: z.email({ message: "A valid work email is required." }),
  company_name: z.string().trim().max(160).optional(),
  // Marketing consent must be explicit and separate — never defaulted on.
  marketing_opt_in: z.boolean(),
  consent_privacy_notice: z.literal(true, { message: "Please acknowledge the privacy notice." }),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rl = rateLimit(`lead:${getClientIp(req)}`, 20, 3_600_000);
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many submissions. Try again later.", { retry_after_sec: rl.retryAfterSec });

  const result = requireAssessment(req, id);
  if ("error" in result) return result.error;

  const body = await readJson(req, LeadSchema);
  if ("error" in body) return body.error;

  const lead = upsertLead({
    assessment_id: id,
    name: body.data.name || null,
    work_email: normaliseEmail(body.data.work_email),
    company_name: body.data.company_name || null,
    marketing_opt_in: body.data.marketing_opt_in === true,
    privacy_notice_version: CONSENT_VERSION,
  });
  updateAssessmentStatus(id, "lead_submitted");
  audit("system", "lead_submitted", { assessment_id: id, lead_id: lead.id, marketing_opt_in: body.data.marketing_opt_in });
  track("lead_submitted", id);
  return jsonOk({ ok: true });
}
