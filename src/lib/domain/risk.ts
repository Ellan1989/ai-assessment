import type { AnswerMap } from "@/lib/domain/questionnaire";
import { getMulti, getSingle } from "@/lib/domain/questionnaire";
import type { OpportunityDef } from "@/lib/opportunities";

/**
 * Hard risk gates (spec §5.2). A triggered gate cannot be outweighed by a high
 * opportunity score: the affected opportunity is marked not_recommended and
 * the report proposes governance / rules-first work instead.
 */

export type RiskGateId =
  | "unreviewed_high_impact"
  | "unclear_data_permissions"
  | "no_data_governance_owner"
  | "high_consequence_no_review"
  | "systems_inaccessible";

export interface RiskGate {
  id: RiskGateId;
  title: string;
  detail: string;
  mitigation: string;
}

const SENSITIVE_IDS = ["personal", "financial", "health", "legal", "employment", "confidential"];

export function evaluateRiskGates(answers: AnswerMap, opp: OpportunityDef): RiskGate[] {
  const gates: RiskGate[] = [];
  const sensitive = getMulti(answers, "sensitive_data").some((s) => SENSITIVE_IDS.includes(s));
  const humanReview = getSingle(answers, "human_review");
  const actionImpact = getSingle(answers, "action_impact");
  const dataScope = getSingle(answers, "data_access_scope");
  const approval = getSingle(answers, "approval_person");
  const api = getSingle(answers, "api_available");
  const software = getMulti(answers, "current_software");
  const docConsequence = getSingle(answers, "document_error_consequence");
  const knowledgeConsequence = getSingle(answers, "wrong_answer_consequence");

  const highConsequence =
    actionImpact === "high-critical" ||
    docConsequence === "financial-compliance" ||
    knowledgeConsequence === "compliance-legal";

  if (
    humanReview === "prefer-full-automation" &&
    highConsequence &&
    (opp.riskSensitivity.takesWriteActions || opp.riskSensitivity.needsSensitiveAccess)
  ) {
    gates.push({
      id: "unreviewed_high_impact",
      title: "Unreviewed automation of high-impact actions",
      detail:
        "You prefer automation without human review, and mistakes in this work have financial, legal or safety consequences.",
      mitigation: "Start with AI-assisted drafting plus a human approval step before anything is committed.",
    });
  }

  if (opp.riskSensitivity.needsSensitiveAccess && sensitive && dataScope == null) {
    gates.push({
      id: "unclear_data_permissions",
      title: "Data access scope unclear",
      detail: "This work involves sensitive information and it is not yet clear what a tool would need to access.",
      mitigation: "Map which data the solution truly needs and confirm the handling basis before building.",
    });
  }

  if (opp.riskSensitivity.needsSensitiveAccess && sensitive && approval === "nobody") {
    gates.push({
      id: "no_data_governance_owner",
      title: "No one accountable for data handling",
      detail: "Sensitive data is involved, but no one signs off on changes to how it is handled.",
      mitigation: "Name an accountable owner and document the data-handling arrangement first.",
    });
  }

  if (highConsequence && (humanReview === "prefer-full-automation" || humanReview == null)) {
    gates.push({
      id: "high_consequence_no_review",
      title: "High error consequence without review",
      detail: "Errors in this work are costly, and no human review or rollback is currently planned.",
      mitigation: "Design a review, audit log or rollback path into the very first version.",
    });
  }

  if (opp.id === "workflow_automation" && api === "no" && software.includes("none")) {
    gates.push({
      id: "systems_inaccessible",
      title: "Core systems not connectable",
      detail: "The systems involved cannot exchange data and no reasonable alternative path exists yet.",
      mitigation: "Either move the workflow into a connectable tool first, or scope manual-assist rather than full automation.",
    });
  }

  return gates;
}

/** Global flags shown in preview and report regardless of selected opportunity. */
export function evaluateGlobalRisks(answers: AnswerMap): RiskGate[] {
  const humanReview = getSingle(answers, "human_review");
  const actionImpact = getSingle(answers, "action_impact");
  if (humanReview === "prefer-full-automation" && actionImpact === "high-critical") {
    return [
      {
        id: "unreviewed_high_impact",
        title: "Unreviewed automation of high-impact actions",
        detail: "You prefer automation without human review for work with financial, legal or safety consequences.",
        mitigation: "Any recommended design will include human approval points despite that preference.",
      },
    ];
  }
  return [];
}
