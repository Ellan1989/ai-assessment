import type { AnswerMap } from "@/lib/domain/questionnaire";
import { getMulti, getScale, getSingle } from "@/lib/domain/questionnaire";
import type { Questionnaire } from "@/lib/domain/questionnaire";

/**
 * Opportunity library v1 — fully deterministic. Each opportunity declares its
 * trigger/exclusion conditions, a scoring function (0..max per dimension) and
 * the value-engine inputs. LLM code never touches these numbers.
 */

export interface ScoreContext {
  questionnaire: Questionnaire;
  answers: AnswerMap;
}

export interface DimensionScores {
  pain: number | null;
  frequency: number | null;
  standardisation: number | null;
  dataAvailability: number | null;
  connectivity: number | null;
  readiness: number | null;
}

export interface ValueAssumptions {
  /** Share of current effort removable — [conservative, baseline, optimistic], planning assumptions. */
  reduction: [number, number, number];
  note: string;
}

export interface OpportunityDef {
  id: string;
  name: string;
  summary: string;
  /** Any-of: at least one condition set must match to become a candidate. */
  triggers: { question_id: string; values: string[] }[];
  exclusions: { question_id: string; values: string[] }[];
  riskSensitivity: { needsSensitiveAccess: boolean; takesWriteActions: boolean };
  assumptions: ValueAssumptions;
  prerequisites: string[];
  evidenceRequirements: string[];
  typicalIntegrations: string[];
  score: (ctx: ScoreContext) => DimensionScores;
  /** Weekly task frequency for the value engine, with the question it came from. */
  frequency: (ctx: ScoreContext) => { weekly: number | null; source: string };
}

export const MAX_WEIGHTS = {
  pain: 30,
  frequency: 20,
  standardisation: 15,
  dataAvailability: 15,
  connectivity: 10,
  readiness: 10,
} as const;

// ---------------------------------------------------------------- shared scoring helpers

const ERROR_EVIDENCE = new Set(["frequently", "occasionally"]);

function stdScore(ctx: ScoreContext): number | null {
  const level = getScale(ctx.answers, "process_standardisation");
  return level == null ? null : level * 3;
}

function ownerScore(ctx: ScoreContext): number | null {
  const owner = getSingle(ctx.answers, "process_owner");
  if (owner === "dedicated") return 10;
  if (owner === "side-duty") return 6;
  if (owner === "nobody") return 2;
  return null;
}

function bandScore(bandId: string | null, table: Record<string, number>): number | null {
  if (bandId == null) return null;
  return table[bandId] ?? null;
}

const TASK_VOLUME_SCORE: Record<string, number> = {
  "1-5": 8,
  "6-15": 12,
  "16-40": 16,
  "41-100": 19,
  "100-plus": 20,
};

const DOC_MONTHLY_SCORE: Record<string, number> = {
  "1-20": 8,
  "21-100": 14,
  "101-500": 18,
  "500-plus": 20,
};

const ENQUIRY_SCORE: Record<string, number> = {
  "1-5": 8,
  "6-15": 12,
  "16-40": 16,
  "41-100": 19,
  "100-plus": 20,
};

const DAILY_COPY_SCORE: Record<string, number> = {
  "1-5": 10,
  "6-20": 14,
  "21-50": 17,
  "50-plus": 20,
};

const KNOWN_CONNECTABLE_SOFTWARE = new Set([
  "servicem8", "tradify", "simpro", "jobber", "xero", "myob", "quickbooks",
  "hubspot", "salesforce", "zapier", "m365", "gworkspace",
]);

function softwareScore(ctx: ScoreContext, strong: string[], weak = 6): number | null {
  const sw = getMulti(ctx.answers, "current_software");
  if (sw.length === 0) return null;
  if (sw.includes("none")) return 3;
  if (sw.some((s) => strong.includes(s) || KNOWN_CONNECTABLE_SOFTWARE.has(s))) return 10;
  return weak;
}

function digitalDataCount(ctx: ScoreContext): number {
  const loc = getMulti(ctx.answers, "data_location");
  return loc.filter((l) => ["email", "spreadsheets", "saas", "shared-drives"].includes(l)).length;
}

function bandMidpointOr(ctx: ScoreContext, id: string, fallback: number | null): number | null {
  const a = ctx.answers[id];
  if (!a || a.kind !== "single") return fallback;
  const q = ctx.questionnaire.questions.find((qq) => qq.id === id);
  const mid = q?.options.find((o) => o.id === a.value)?.midpoint;
  return mid ?? fallback;
}

function bandId(ctx: ScoreContext, id: string): string | null {
  return getSingle(ctx.answers, id);
}

// ---------------------------------------------------------------- opportunities

const docProcessing: OpportunityDef = {
  id: "doc_processing",
  name: "Document processing & information extraction",
  summary: "Extract key fields from emails, PDFs and forms, classify them, and draft records for review.",
  triggers: [{ question_id: "bottleneck", values: ["documents"] }],
  exclusions: [],
  riskSensitivity: { needsSensitiveAccess: true, takesWriteActions: false },
  assumptions: {
    reduction: [0.25, 0.4, 0.6],
    note: "Planning assumption based on typical document-automation outcomes; validate in a pilot.",
  },
  prerequisites: [
    "Documents arrive in digital form for the majority of volume (email PDFs, scans, exports)",
    "Agreed list of fields to extract and where they land",
    "A person checks extracted records before they are committed",
  ],
  evidenceRequirements: [
    "Sample of 20 representative documents",
    "Current handling time per document",
    "Error rate in current manual entry",
  ],
  typicalIntegrations: ["Email inbox", "Document storage", "Accounting or job system (via API or export)"],
  score: (ctx) => {
    const errorOrLoss = getSingle(ctx.answers, "error_or_loss");
    const docConsequence = getSingle(ctx.answers, "document_error_consequence");
    let pain = 24;
    if (ERROR_EVIDENCE.has(errorOrLoss ?? "") || ["delays", "financial-compliance"].includes(docConsequence ?? "")) pain += 6;
    const formats = getMulti(ctx.answers, "document_formats");
    const digital = formats.some((f) => ["pdf-email", "scans-photos", "portal-downloads", "structured-exports"].includes(f));
    const dataAvailability = digital ? Math.min(15, 12 + digitalDataCount(ctx)) : formats.includes("paper") ? 5 : 8;
    return {
      pain,
      frequency: bandScore(bandId(ctx, "monthly_document_volume"), DOC_MONTHLY_SCORE) ?? bandScore(bandId(ctx, "task_volume"), TASK_VOLUME_SCORE),
      standardisation: stdScore(ctx),
      dataAvailability,
      connectivity: softwareScore(ctx, ["xero", "myob", "quickbooks", "servicem8", "simpro", "tradify", "jobber"]),
      readiness: ownerScore(ctx),
    };
  },
  frequency: (ctx) => {
    const monthly = bandMidpointOr(ctx, "monthly_document_volume", null);
    if (monthly != null) return { weekly: monthly / 4.33, source: "monthly_document_volume" };
    return { weekly: bandMidpointOr(ctx, "task_volume", null), source: "task_volume" };
  },
};

const enquiryTriage: OpportunityDef = {
  id: "enquiry_triage",
  name: "Enquiry triage & follow-up",
  summary: "Classify incoming enquiries, pull out requirements, draft replies and remind the right person to follow up.",
  triggers: [{ question_id: "bottleneck", values: ["enquiries-quotes"] }],
  exclusions: [],
  riskSensitivity: { needsSensitiveAccess: true, takesWriteActions: false },
  assumptions: {
    reduction: [0.2, 0.35, 0.5],
    note: "Planning assumption based on typical enquiry-handling automation; validate in a pilot.",
  },
  prerequisites: [
    "Enquiries reachable by email or a connected form/channel",
    "Agreed categories and response standards",
    "Someone owns follow-up on flagged enquiries",
  ],
  evidenceRequirements: [
    "Volume of enquiries by channel for a typical month",
    "Current response times",
    "Win rate on quoted work before/after",
  ],
  typicalIntegrations: ["Shared inbox", "CRM or job system", "Website forms"],
  score: (ctx) => {
    const responseTime = getSingle(ctx.answers, "current_response_time");
    const errorOrLoss = getSingle(ctx.answers, "error_or_loss");
    let pain = 22;
    if (["1-2-days", "3-plus-days"].includes(responseTime ?? "")) pain += 8;
    else if (ERROR_EVIDENCE.has(errorOrLoss ?? "")) pain += 6;
    const channels = getMulti(ctx.answers, "input_channels");
    const digitalChannels = channels.some((c) => ["email", "web-forms", "social", "sms-whatsapp"].includes(c));
    const sw = getMulti(ctx.answers, "current_software");
    const dataAvailability = (digitalChannels ? 11 : 6) + (sw.some((s) => ["hubspot", "salesforce"].includes(s)) ? 4 : 0);
    const connectivity = sw.some((s) => ["hubspot", "salesforce", "servicem8", "simpro", "tradify", "jobber"].includes(s))
      ? 10
      : channels.includes("email")
        ? 7
        : sw.includes("none")
          ? 3
          : 5;
    return {
      pain: Math.min(30, pain),
      frequency: bandScore(bandId(ctx, "weekly_enquiry_count"), ENQUIRY_SCORE) ?? bandScore(bandId(ctx, "task_volume"), TASK_VOLUME_SCORE),
      standardisation: stdScore(ctx),
      dataAvailability: Math.min(15, dataAvailability),
      connectivity,
      readiness: ownerScore(ctx),
    };
  },
  frequency: (ctx) => ({
    weekly: bandMidpointOr(ctx, "weekly_enquiry_count", bandMidpointOr(ctx, "task_volume", null)),
    source: ctx.answers["weekly_enquiry_count"] ? "weekly_enquiry_count" : "task_volume",
  }),
};

const customerServiceAssist: OpportunityDef = {
  id: "customer_service_assist",
  name: "Customer service assistant",
  summary: "Draft replies from an approved knowledge base, answer repeats, and escalate anything complex to a person.",
  triggers: [{ question_id: "bottleneck", values: ["customer-service"] }],
  exclusions: [],
  riskSensitivity: { needsSensitiveAccess: true, takesWriteActions: false },
  assumptions: {
    reduction: [0.15, 0.3, 0.45],
    note: "Planning assumption based on typical assisted-reply deployments; validate in a pilot.",
  },
  prerequisites: [
    "An approved answer source (knowledge base, past replies, FAQ)",
    "Escalation path to a human with clear boundaries",
    "Customer-facing replies checked before sending",
  ],
  evidenceRequirements: [
    "Top 20 repeated questions with answers",
    "Monthly ticket/question volume",
    "Current first-response time",
  ],
  typicalIntegrations: ["Shared inbox or helpdesk", "Knowledge base", "Website chat"],
  score: (ctx) => {
    let pain = 20;
    const repeat = getSingle(ctx.answers, "repeat_question_ratio");
    const escalation = getSingle(ctx.answers, "escalation_rate");
    if (repeat === "over-60") pain += 5;
    if (escalation === "over-30") pain += 5;
    else if (escalation === "10-30") pain += 2;
    const sources = getMulti(ctx.answers, "knowledge_sources");
    const digitalSources = sources.filter((s) => ["wiki", "shared-drives", "email-threads", "training-docs"].includes(s));
    let dataAvailability = 3;
    if (digitalSources.length >= 2) dataAvailability = 13;
    else if (digitalSources.length === 1) dataAvailability = 9;
    const update = getSingle(ctx.answers, "knowledge_update_frequency");
    if (update === "continuously" && dataAvailability > 3) dataAvailability = Math.min(15, dataAvailability + 2);
    if (update === "rarely" && dataAvailability > 3) dataAvailability -= 2;
    const channels = getMulti(ctx.answers, "cs_channels");
    const connectivity = channels.some((c) => ["email", "live-chat", "social", "sms-whatsapp"].includes(c)) ? 8 : 4;
    const freq = repeat === "over-60" ? 18 : repeat === "30-60" ? 14 : repeat === "under-30" ? 8 : null;
    return {
      pain: Math.min(30, pain),
      frequency: freq ?? bandScore(bandId(ctx, "task_volume"), TASK_VOLUME_SCORE),
      standardisation: stdScore(ctx),
      dataAvailability,
      connectivity,
      readiness: ownerScore(ctx),
    };
  },
  frequency: (ctx) => ({ weekly: bandMidpointOr(ctx, "task_volume", null), source: "task_volume" }),
};

const knowledgeRetrieval: OpportunityDef = {
  id: "knowledge_retrieval",
  name: "Internal knowledge search",
  summary: "Answer internal questions from your own documents, with the source shown for every answer.",
  triggers: [{ question_id: "bottleneck", values: ["knowledge-lookup"] }],
  exclusions: [],
  riskSensitivity: { needsSensitiveAccess: true, takesWriteActions: false },
  assumptions: {
    reduction: [0.2, 0.35, 0.5],
    note: "Planning assumption based on typical knowledge-search deployments; validate in a pilot.",
  },
  prerequisites: [
    "Reference material that exists in written form",
    "A refresh rhythm for stale material",
    "Access boundaries mirrored from today's permissions",
  ],
  evidenceRequirements: [
    "Inventory of key documents and their owners",
    "Frequency of \u201cwhere do I find\u2026\u201d questions",
    "Current time-to-answer",
  ],
  typicalIntegrations: ["Shared drive / wiki", "Microsoft 365 or Google Workspace", "Team chat"],
  score: (ctx) => {
    let pain = 22;
    const consequence = getSingle(ctx.answers, "wrong_answer_consequence");
    if (["customer-errors", "compliance-legal"].includes(consequence ?? "")) pain += 8;
    const sources = getMulti(ctx.answers, "knowledge_sources");
    const digitalSources = sources.filter((s) => ["wiki", "shared-drives", "email-threads", "training-docs"].includes(s));
    let dataAvailability = 3;
    if (digitalSources.length >= 2) dataAvailability = 15;
    else if (digitalSources.length === 1) dataAvailability = 10;
    const update = getSingle(ctx.answers, "knowledge_update_frequency");
    if (update === "rarely" && dataAvailability > 3) dataAvailability -= 3;
    const sw = getMulti(ctx.answers, "current_software");
    const connectivity = sw.some((s) => ["m365", "gworkspace", "hubspot", "salesforce"].includes(s)) ? 8 : sw.includes("none") ? 3 : 5;
    return {
      pain: Math.min(30, pain),
      frequency: bandScore(bandId(ctx, "task_volume"), TASK_VOLUME_SCORE),
      standardisation: stdScore(ctx),
      dataAvailability: Math.max(2, dataAvailability),
      connectivity,
      readiness: ownerScore(ctx),
    };
  },
  frequency: (ctx) => ({ weekly: bandMidpointOr(ctx, "task_volume", null), source: "task_volume" }),
};

const workflowAutomation: OpportunityDef = {
  id: "workflow_automation",
  name: "Operations workflow automation",
  summary: "Rule-based triggers, data checks, task creation and reminders across scheduling, invoicing and system entry.",
  triggers: [
    { question_id: "bottleneck", values: ["cross-system-entry", "scheduling-dispatch", "invoicing-chasing"] },
  ],
  exclusions: [],
  riskSensitivity: { needsSensitiveAccess: true, takesWriteActions: true },
  assumptions: {
    reduction: [0.3, 0.45, 0.65],
    note: "Planning assumption based on typical rule-based automation; validate in a pilot.",
  },
  prerequisites: [
    "The process steps are agreed and stable",
    "Source and target systems can exchange data (API, export or integration platform)",
    "Exception cases have a named owner",
  ],
  evidenceRequirements: [
    "Map of the current steps and systems",
    "Counts of re-keyed entries per week",
    "Error rate in manual transfers",
  ],
  typicalIntegrations: ["Job/accounting systems", "Email & calendars", "Zapier/Make or native integrations"],
  score: (ctx) => {
    const bottleneck = getMulti(ctx.answers, "bottleneck");
    let pain = 20;
    const api = getSingle(ctx.answers, "api_available");
    if (api === "yes-both") pain += 5;
    const exceptionRate = getSingle(ctx.answers, "exception_rate");
    if (exceptionRate === "under-10") pain += 5;
    else if (exceptionRate === "10-25") pain += 2;
    const crossEntry = bottleneck.includes("cross-system-entry");
    let dataAvailability: number;
    const digital = digitalDataCount(ctx);
    if (digital >= 2) dataAvailability = 13;
    else if (digital === 1) dataAvailability = 9;
    else dataAvailability = 4;
    const connectivity = api === "yes-both" ? 10 : api === "partial" ? 7 : api === "no" ? 2 : null;
    return {
      pain: Math.min(30, pain),
      frequency: crossEntry
        ? bandScore(bandId(ctx, "manual_copy_frequency"), DAILY_COPY_SCORE) ?? bandScore(bandId(ctx, "task_volume"), TASK_VOLUME_SCORE)
        : bandScore(bandId(ctx, "task_volume"), TASK_VOLUME_SCORE),
      standardisation: stdScore(ctx),
      dataAvailability,
      connectivity,
      readiness: ownerScore(ctx),
    };
  },
  frequency: (ctx) => {
    const crossEntry = getMulti(ctx.answers, "bottleneck").includes("cross-system-entry");
    if (crossEntry) {
      const daily = bandMidpointOr(ctx, "manual_copy_frequency", null);
      if (daily != null) return { weekly: daily * 5, source: "manual_copy_frequency" };
    }
    return { weekly: bandMidpointOr(ctx, "task_volume", null), source: "task_volume" };
  },
};

const reportingAnalysis: OpportunityDef = {
  id: "reporting_analysis",
  name: "Reporting & data analysis",
  summary: "Bring structured data together and generate the recurring business numbers and summaries automatically.",
  triggers: [{ question_id: "bottleneck", values: ["reporting-analysis"] }],
  exclusions: [],
  riskSensitivity: { needsSensitiveAccess: false, takesWriteActions: false },
  assumptions: {
    reduction: [0.3, 0.5, 0.7],
    note: "Planning assumption based on typical reporting automation; validate in a pilot.",
  },
  prerequisites: [
    "Data exists in structured form (software exports, spreadsheets)",
    "Agreed definitions for the key numbers",
    "A consumer for the reports (someone reads and acts on them)",
  ],
  evidenceRequirements: [
    "Current reporting cadence and hours spent",
    "List of reports and their sources",
    "Which numbers drive decisions today",
  ],
  typicalIntegrations: ["Accounting system", "Job/CRM system", "Spreadsheets"],
  score: (ctx) => {
    let pain = 20;
    const metrics = getSingle(ctx.answers, "metrics_tracking");
    const errorOrLoss = getSingle(ctx.answers, "error_or_loss");
    if (metrics === "yes-detailed") pain += 5;
    if (ERROR_EVIDENCE.has(errorOrLoss ?? "")) pain += 5;
    const digital = digitalDataCount(ctx);
    let dataAvailability: number;
    if (digital >= 2) dataAvailability = 14;
    else if (digital === 1) dataAvailability = 9;
    else dataAvailability = 3;
    const sw = getMulti(ctx.answers, "current_software");
    const connectivity = sw.some((s) => ["xero", "myob", "quickbooks", "simpro", "servicem8", "hubspot", "salesforce"].includes(s))
      ? 10
      : sw.includes("spreadsheets") || getMulti(ctx.answers, "data_location").includes("spreadsheets")
        ? 6
        : sw.includes("none")
          ? 3
          : 5;
    return {
      pain: Math.min(30, pain),
      frequency: bandScore(bandId(ctx, "task_volume"), TASK_VOLUME_SCORE),
      standardisation: stdScore(ctx),
      dataAvailability,
      connectivity,
      readiness: ownerScore(ctx),
    };
  },
  frequency: (ctx) => ({ weekly: bandMidpointOr(ctx, "task_volume", null), source: "task_volume" }),
};

const meetingFollowup: OpportunityDef = {
  id: "meeting_followup",
  name: "Meeting & communication follow-up",
  summary: "Summarise calls and meetings, extract the promised actions, and draft tasks for the right owners.",
  triggers: [{ question_id: "bottleneck", values: ["meeting-followups"] }],
  exclusions: [],
  riskSensitivity: { needsSensitiveAccess: true, takesWriteActions: false },
  assumptions: {
    reduction: [0.25, 0.4, 0.55],
    note: "Planning assumption based on typical meeting-summarisation deployments; validate in a pilot.",
  },
  prerequisites: [
    "Meetings/calls happen through a recordable channel (video tool, phone with consent)",
    "A single place tasks land",
    "Owners check drafted tasks before they count",
  ],
  evidenceRequirements: [
    "Meetings per week and average length",
    "Share that currently produce written actions",
    "Slippage rate on follow-up actions",
  ],
  typicalIntegrations: ["Video/phone platform", "Microsoft 365 or Google Workspace", "Task system"],
  score: (ctx) => {
    const errorOrLoss = getSingle(ctx.answers, "error_or_loss");
    let pain = 24;
    if (ERROR_EVIDENCE.has(errorOrLoss ?? "")) pain += 6;
    const channels = getMulti(ctx.answers, "input_channels");
    const data = getMulti(ctx.answers, "data_location");
    const dataAvailability = (channels.includes("email") || data.includes("email") ? 8 : 4) +
      (data.some((d) => ["saas", "shared-drives"].includes(d)) ? 4 : 0);
    const sw = getMulti(ctx.answers, "current_software");
    const connectivity = sw.some((s) => ["m365", "gworkspace"].includes(s)) ? 10 : sw.includes("none") ? 4 : 6;
    return {
      pain: Math.min(30, pain),
      frequency: bandScore(bandId(ctx, "task_volume"), TASK_VOLUME_SCORE),
      standardisation: stdScore(ctx),
      dataAvailability: Math.min(15, dataAvailability),
      connectivity,
      readiness: ownerScore(ctx),
    };
  },
  frequency: (ctx) => ({ weekly: bandMidpointOr(ctx, "task_volume", null), source: "task_volume" }),
};

export const OPPORTUNITIES: OpportunityDef[] = [
  docProcessing,
  enquiryTriage,
  customerServiceAssist,
  knowledgeRetrieval,
  workflowAutomation,
  reportingAnalysis,
  meetingFollowup,
];

export function getOpportunity(id: string): OpportunityDef | undefined {
  return OPPORTUNITIES.find((o) => o.id === id);
}
