import { getReportByTokenHash } from "@/lib/db/repositories";
import { hashToken } from "@/lib/util";
import { renderReportPdf } from "@/lib/report/pdf";
import { ReportDocSchema } from "@/lib/report/schema";
import { setReportPdfKey } from "@/lib/db/repositories";
import { jsonError, jsonOk } from "@/lib/security";
import { readPdf, savePdf, track } from "@/lib/services";

/**
 * Report access by unguessable token (spec §8 GET /api/reports/:token).
 * `?format=pdf` streams the PDF (regenerating it lazily if missing).
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 20) return jsonError(400, "invalid_token", "Invalid report token.");

  const report = getReportByTokenHash(hashToken(token));
  if (!report) return jsonError(404, "not_found", "Report not found.");
  if (report.expires_at < new Date().toISOString()) {
    return jsonError(410, "expired", "This report link has expired. Contact us to have it re-issued.");
  }

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "pdf") {
    let bytes = report.pdf_storage_key ? readPdf(report.pdf_storage_key) : null;
    if (!bytes) {
      const doc = ReportDocSchema.safeParse(JSON.parse(report.report_json));
      if (!doc.success) return jsonError(500, "corrupt_report", "Stored report could not be rendered.");
      bytes = await renderReportPdf(doc.data);
      report.pdf_storage_key = savePdf(report.id, bytes);
      setReportPdfKey(report.id, report.pdf_storage_key);
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ai-opportunity-assessment.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  track("report_opened", report.assessment_id);
  return jsonOk(
    { report: JSON.parse(report.report_json), expires_at: report.expires_at },
    200,
  );
}
