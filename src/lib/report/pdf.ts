import PDFDocument from "pdfkit";
import type { ReportDoc } from "./schema";
import { formatAud, formatHours } from "@/lib/domain/value";

/** Renders the report to a clean A4 PDF using pdfkit's standard fonts. */
export function renderReportPdf(doc: ReportDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: "AI Opportunity Assessment" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    // ---- header
    pdf.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("AI Opportunity Assessment");
    pdf.moveDown(0.3).fontSize(9).fillColor("#64748b").text(
      `Generated ${new Date(doc.meta.generated_at).toLocaleString("en-AU")} · Engine ${doc.meta.engine_version} · Questionnaire ${doc.meta.questionnaire_version}`,
    );
    pdf.moveDown(0.2).moveTo(56, pdf.y).lineTo(539, pdf.y).lineWidth(1).strokeColor("#e2e8f0").stroke();
    pdf.moveDown(1);

    const h2 = (t: string) => {
      pdf.moveDown(0.8).font("Helvetica-Bold").fontSize(14).fillColor("#0f172a").text(t).moveDown(0.35);
      checkPage(28);
    };
    const p = (t: string, opts: { color?: string; size?: number } = {}) => {
      checkPage(40);
      pdf.font("Helvetica").fontSize(opts.size ?? 10).fillColor(opts.color ?? "#334155").text(t, { lineGap: 3 }).moveDown(0.3);
    };
    const bullets = (items: string[]) => {
      for (const item of items) {
        checkPage(24);
        pdf.fontSize(10).fillColor("#334155").text(`\u2022  ${item}`, { indent: 12, lineGap: 3 });
      }
      pdf.moveDown(0.35);
    };
    function checkPage(needed: number) {
      if (pdf.y + needed > pdf.page.maxY() - 56) pdf.addPage();
    }

    // ---- 1. executive summary
    h2("1 · Executive summary");
    p(doc.executive_summary.situation);
    p(`Goal: ${doc.executive_summary.goal}`);
    p(`Key finding: ${doc.executive_summary.headline}`, { color: "#0f172a" });
    for (const para of doc.executive_summary.narrative) p(para);

    // ---- 2. opportunities
    h2("2 · Opportunities matched to your answers");
    doc.opportunities.forEach((o, i) => {
      h2(`2.${i + 1} · ${o.name}`);
      p(`Match score ${o.score}/100 · feasibility: ${o.feasibility.replaceAll("_", " ")}`);
      p(`Problem: ${o.problem}`);
      p(`Today: ${o.current_process}`);
      p(`Expected improvement: ${o.expected_improvement}`);
      p(`Why it fits: ${o.fit_reason}`);
    });

    // ---- 3. priority concept
    h2("3 · Priority concept design");
    const c = doc.priority_concept;
    p(`${c.solution_name} — complexity: ${c.complexity_band}, feasibility: ${c.feasibility.replaceAll("_", " ")}`, { color: "#0f172a" });
    p(`Goal: ${c.business_goal}`);
    p(`Problem: ${c.current_problem}`);
    p(`Trigger: ${c.trigger}`);
    p(`Inputs: ${c.inputs.join("; ")}`);
    p("Steps:");
    bullets(c.steps);
    p(`Integrations: ${c.integrations.join("; ")}`);
    p(`Outputs: ${c.outputs}`);
    p("Human approval points:");
    bullets(c.human_approval_points);
    p("Exception paths:");
    bullets(c.exception_paths);
    p("Success metrics:");
    bullets(c.success_metrics);
    p("Assumptions:");
    bullets(c.assumptions);
    p("Risks:");
    bullets(c.risks);
    if (c.unresolved_questions.length > 0) {
      p("Open questions:");
      bullets(c.unresolved_questions);
    }

    // ---- 4. value estimate
    h2("4 · Value estimate (indicative)");
    const v = doc.value_estimates;
    if (v.annual_hours != null) p(`Current effort: about ${formatHours(v.annual_hours)} per year in this area.`);
    else p("Current annual effort could not be computed — key inputs missing (listed below).");
    p("Scenarios (planning assumptions, not promises):");
    const rows = v.scenarios.map(
      (s) =>
        `${s.name.padEnd(12)} release ${s.released_hours != null ? formatHours(s.released_hours) : "n/a"} of effort` +
        `${s.time_value_aud != null ? ` · indicative time value ${formatAud(s.time_value_aud)}` : ""}`,
    );
    bullets(rows);
    p("Formulas:");
    bullets(v.formulas);
    if (v.assumptions.length > 0) {
      p("Assumptions:");
      bullets(v.assumptions);
    }
    if (v.missing_data.length > 0) {
      p("Missing inputs:");
      bullets(v.missing_data);
    }
    p(`Confidence: ${v.confidence.level.toUpperCase()} — ${v.confidence.reasons.join(" ")}`);
    p("Released hours are an indicative internal time value (AUD, excl. GST), not a cash saving.", { color: "#64748b", size: 9 });

    // ---- 5. feasibility
    h2("5 · Feasibility");
    p(`Process: ${doc.feasibility_analysis.process}`);
    p(`Data: ${doc.feasibility_analysis.data}`);
    p(`Systems: ${doc.feasibility_analysis.systems}`);
    p(`People: ${doc.feasibility_analysis.people}`);

    // ---- 6. risks
    h2("6 · Risks & boundaries");
    for (const r of doc.risks_boundaries) p(`${r.risk} — mitigation: ${r.mitigation}`);

    // ---- 7. roadmap
    h2("7 · 90-day high-level roadmap");
    for (const phase of doc.roadmap) {
      p(`${phase.phase} — ${phase.focus}`, { color: "#0f172a" });
      bullets(phase.actions);
    }

    // ---- 8. next steps
    h2("8 · Next steps");
    p("Data to collect:");
    bullets(doc.next_steps.data_to_collect);
    p(doc.next_steps.cta);

    // ---- 9. method
    h2("9 · Method & limitations");
    p(doc.method_disclaimer, { size: 9, color: "#64748b" });

    pdf.end();
  });
}
