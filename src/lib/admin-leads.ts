import { QUESTIONNAIRE_V1 } from "@/lib/questionnaire/v1";
import { answerLabels } from "@/lib/domain/questionnaire";
import { getAnswers, getAssessment, getLatestEvaluation, type FollowUpStatus, type LeadRow } from "@/lib/db/repositories";

export interface AdminLeadRow {
  id: string;
  created_at: string;
  name: string | null;
  work_email: string;
  company_name: string | null;
  marketing_opt_in: boolean;
  assessment_id: string;
  assessment_status: string;
  primary_opportunity: string | null;
  industry: string | null;
  budget_band: string | null;
  timing: string | null;
  follow_up_status: FollowUpStatus;
  internal_notes: string | null;
}

export function enrichLeads(rows: LeadRow[]): AdminLeadRow[] {
  return rows.map((lead) => {
    const assessment = getAssessment(lead.assessment_id);
    let primaryOpportunity: string | null = null;
    let industry: string | null = null;
    let budget: string | null = null;
    let timing: string | null = null;
    if (assessment) {
      const evaluation = getLatestEvaluation(lead.assessment_id);
      if (evaluation) {
        try {
          const opps = JSON.parse(evaluation.opportunity_results_json) as { opportunity_id: string; name: string }[];
          const calcs = JSON.parse(evaluation.calculations_json) as { priority_id?: string | null; selected_ids?: string[] };
          const priority = opps.find((o) => o.opportunity_id === (calcs.priority_id ?? calcs.selected_ids?.[0]));
          primaryOpportunity = priority?.name ?? null;
        } catch {
          /* ignore */
        }
      }
      const answerMap: Record<string, unknown> = {};
      for (const row of getAnswers(lead.assessment_id)) {
        try {
          answerMap[row.question_id] = JSON.parse(row.answer_json);
        } catch {
          /* ignore */
        }
      }
      const map = answerMap as Parameters<typeof answerLabels>[1];
      industry = answerLabels(QUESTIONNAIRE_V1, map, "company_industry").join(", ");
      const budgetRaw = answerLabels(QUESTIONNAIRE_V1, map, "budget_band").join(", ");
      const timingRaw = answerLabels(QUESTIONNAIRE_V1, map, "timing").join(", ");
      budget = budgetRaw && budgetRaw !== "Not sure" ? budgetRaw : null;
      timing = timingRaw && timingRaw !== "Not sure" ? timingRaw : null;
    }
    return {
      id: lead.id,
      created_at: lead.created_at,
      name: lead.name,
      work_email: lead.work_email,
      company_name: lead.company_name,
      marketing_opt_in: lead.marketing_opt_in === 1,
      assessment_id: lead.assessment_id,
      assessment_status: assessment?.status ?? "unknown",
      primary_opportunity: primaryOpportunity,
      industry,
      budget_band: budget,
      timing,
      follow_up_status: lead.follow_up_status,
      internal_notes: lead.internal_notes,
    };
  });
}
