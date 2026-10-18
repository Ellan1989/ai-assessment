import { getLatestEvaluation } from "@/lib/db/repositories";
import { requireAssessment } from "@/lib/api-helpers";
import { jsonError, jsonOk } from "@/lib/security";
import { track } from "@/lib/services";

/** Returns the stored preview for an evaluated assessment (used on page reload). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = requireAssessment(req, id);
  if ("error" in result) return result.error;

  const evaluation = getLatestEvaluation(id);
  if (!evaluation) return jsonError(404, "not_evaluated", "This assessment has not been evaluated yet.");

  let calculations: { preview?: unknown } = {};
  try {
    calculations = JSON.parse(evaluation.calculations_json);
  } catch {
    /* ignore */
  }
  if (!calculations.preview) return jsonError(404, "not_evaluated", "Preview data missing for this assessment.");
  track("preview_viewed", id);
  return jsonOk({
    engine_version: evaluation.engine_version,
    preview: calculations.preview,
  });
}
