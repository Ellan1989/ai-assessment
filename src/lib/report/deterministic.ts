import type { AnswerMap, Questionnaire } from "@/lib/domain/questionnaire";
import { answerLabels, getMulti, getScale, getSingle } from "@/lib/domain/questionnaire";
import type { EvaluationOutput, OpportunityResult } from "@/lib/domain/engine";
import type { ConceptCard, ReportDoc, ReportOpportunity } from "./schema";

/**
 * Deterministic report builder — the fallback generator and the skeleton the
 * LLM pass phrases on top of. Every number here comes from the engine.
 */

const DISCLAIMER =
  "This is an initial opportunity assessment based on your questionnaire answers, not a guarantee of savings and not a formal security, legal or compliance audit. " +
  "Time-value figures are indicative internal cost estimates in AUD (excl. GST), not cash savings. Reduction ratios are planning assumptions that must be validated in a pilot.";

export function buildDeterministicReport(params: {
  evaluation: EvaluationOutput;
  questionnaire: Questionnaire;
  answers: AnswerMap;
  assessmentId: string;
}): ReportDoc {
  const { evaluation: ev, questionnaire: q, answers, assessmentId } = params;
  const selected = ev.opportunities.filter((o) => ev.selected_ids.includes(o.opportunity_id));
  const priority = selected.find((o) => o.opportunity_id === ev.priority_id) ?? selected[0] ?? null;

  const opportunities: ReportOpportunity[] = selected.map((o) => ({
    opportunity_id: o.opportunity_id,
    name: o.name,
    problem: problemText(o, answers),
    current_process: currentProcessText(o, q, answers),
    expected_improvement: improvementText(o),
    fit_reason: fitReasonText(o),
    score: o.raw_score,
    band: o.band,
    feasibility: o.feasibility,
    value: o.value,
  }));

  const valueScenarios = priority?.value?.scenarios ?? [];

  return {
    meta: {
      assessment_id: assessmentId,
      generated_at: new Date().toISOString(),
      engine_version: ev.engine_version,
      questionnaire_version: ev.questionnaire_version,
      generator: "deterministic",
    },
    executive_summary: {
      situation: `${ev.profile_summary.industry.join(", ")} business, ${ev.profile_summary.employees.join("")} staff. Main pressure points named: ${ev.profile_summary.bottlenecks.join("; ")}.`,
      goal: `Stated priorities: ${ev.profile_summary.goals.join("; ")}.`,
      headline: ev.profile_summary.headline,
      narrative: [
        priority
          ? `Of the opportunities matched to your answers, ${priority.name} ranks first (match score ${priority.raw_score}/100, ${bandLabel(priority.band)}).`
          : "Your answers did not match a specific automation pattern strongly — a short discovery conversation will be more useful than a generic recommendation.",
        priority?.value?.annual_hours != null
          ? `Your answers imply roughly ${Math.round(priority.value.annual_hours).toLocaleString("en-AU")} hours a year of effort in this area today. The scenarios below use planning assumptions to show a range, not a promise.`
          : "A few key numbers were unknown, so the estimate below is shown as a range to fill in rather than a figure to rely on.",
        ev.governance_first
          ? "Important: hard risk gates fired for the top-ranked ideas. The recommendation is to fix process, permissions or data handling first — see Risks & boundaries."
          : "",
      ].filter(Boolean),
    },
    opportunities,
    priority_concept: priority ? buildConceptCard(priority, q, answers, ev) : emptyConcept(),
    value_estimates: {
      primary_opportunity_id: priority?.opportunity_id ?? null,
      annual_hours: priority?.value?.annual_hours ?? null,
      scenarios: valueScenarios,
      formulas: priority?.value?.formulas ?? [],
      assumptions: [priority?.value?.assumption_note ?? "No assumption applied — insufficient inputs."],
      missing_data: priority?.value?.missing_inputs ?? [],
      confidence: ev.confidence,
    },
    feasibility_analysis: feasibilityText(ev, q, answers),
    risks_boundaries: riskRows(ev),
    roadmap: buildRoadmap(ev, priority),
    next_steps: {
      data_to_collect: nextStepData(ev, priority),
      cta: "When you're ready, book a paid deep-dive audit: we validate the numbers against your real data and turn the top opportunity into a concrete implementation plan.",
    },
    method_disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------- concept card

function buildConceptCard(o: OpportunityResult, q: Questionnaire, answers: AnswerMap, ev: EvaluationOutput): ConceptCard {
  void ev;
  const goals = answerLabels(q, answers, "business_goal");
  const channels = [...answerLabels(q, answers, "input_channels"), ...answerLabels(q, answers, "enquiry_sources")];
  const std = getScale(answers, "process_standardisation");
  const gates = o.gates;

  const complexity: ConceptCard["complexity_band"] =
    gates.length > 0 || o.dimensions.connectivity != null && o.dimensions.connectivity <= 3
      ? "high"
      : (o.dimensions.connectivity ?? 0) >= 8 && (std ?? 0) >= 3
        ? "low"
        : "medium";

  const common: Omit<ConceptCard, "solution_name" | "trigger" | "inputs" | "steps" | "outputs"> = {
    business_goal: goals.join("; ") || "Operational improvement",
    current_problem: problemText(o, answers),
    integrations: o.typical_integrations,
    human_approval_points: approvalPoints(o),
    exception_paths: [
      "Anything the assistant is not confident about is flagged and handed to a person",
      "Suspected sensitive or unusual content bypasses automation entirely",
    ],
    success_metrics: o.evidence_requirements,
    assumptions: [o.value?.assumption_note ?? "Planning assumptions apply; validate in pilot.", ...o.notes],
    risks: gates.length > 0 ? gates.map((g) => g.title) : ["Draft quality will vary until tuned on your real examples"],
    unresolved_questions: o.value?.missing_inputs ?? [],
    complexity_band: complexity,
    feasibility: o.feasibility,
  };

  switch (o.opportunity_id) {
    case "doc_processing":
      return {
        ...common,
        solution_name: "Document Intake Assistant (concept)",
        trigger: `A new document arrives (${channels.filter((c) => /email|form/i.test(c)).join(" or ") || "email or form channel"})`,
        inputs: ["Incoming emails with attachments / scanned files", "Your field checklist (what to extract)", "Destination record type"],
        steps: [
          "Capture the document from the inbox or upload point",
          "Classify it (invoice, form, report…)",
          "Extract the agreed fields with confidence scores",
          "Create a draft record and flag low-confidence fields",
          "A person reviews and approves; the record is then committed",
        ],
        outputs: "Classified documents and draft records ready for one-click approval",
      };
    case "enquiry_triage":
      return {
        ...common,
        solution_name: "Enquiry Triage & Follow-up Assistant (concept)",
        trigger: "A new enquiry arrives by email or web form",
        inputs: ["Enquiry message", "Your service categories", "Response standards (who gets what, how fast)"],
        steps: [
          "Read the enquiry and classify type, urgency and fit",
          "Extract the key requirements (scope, location, timing)",
          "Draft a personalised acknowledgement and next-step reply",
          "Create a follow-up task with the right owner and due date",
          "Staff edit and send; unanswered follow-ups escalate",
        ],
        outputs: "Classified enquiries, draft replies and follow-up reminders in one place",
      };
    case "customer_service_assist":
      return {
        ...common,
        solution_name: "Service Reply Assistant (concept)",
        trigger: "A customer question arrives on a monitored channel",
        inputs: ["Approved knowledge base / FAQ", "Recent correct answers", "Escalation rules"],
        steps: [
          "Match the question against approved material",
          "Draft a reply with the source passage attached",
          "If confidence is low or the topic is sensitive, route to a person",
          "Staff review, adjust and send",
        ],
        outputs: "Drafted replies with sources, plus an escalation queue",
      };
    case "knowledge_retrieval":
      return {
        ...common,
        solution_name: "Internal Knowledge Assistant (concept)",
        trigger: "A team member asks a question in the assistant",
        inputs: ["Your written reference material", "Permission groups", "Freshness rules for stale pages"],
        steps: [
          "Search the approved sources for relevant passages",
          "Compose an answer that quotes the source and link",
          "Show \u201cnot found\u201d rather than guessing when coverage is thin",
          "Log unanswered questions to guide content updates",
        ],
        outputs: "Answers with citations, and a list of gaps to fill",
      };
    case "workflow_automation":
      return {
        ...common,
        solution_name: "Workflow Automation (concept)",
        trigger: "A defined business event occurs (job won, invoice due, form submitted)",
        inputs: ["Agreed trigger rules", "Field mappings between systems", "Exception criteria"],
        steps: [
          "Watch for the trigger event",
          "Validate and normalise the data against rules",
          "Create or update the record in the target system",
          "Notify the owner and log every action for audit",
        ],
        outputs: "Completed records and notifications without manual re-entry",
      };
    case "reporting_analysis":
      return {
        ...common,
        solution_name: "Recurring Reporting Assistant (concept)",
        trigger: "Reporting cadence reached (weekly / monthly)",
        inputs: ["Structured data exports", "Your report definitions", "Recipients"],
        steps: [
          "Pull the agreed datasets on schedule",
          "Compute the defined metrics consistently",
          "Draft the written summary with the numbers and notable changes",
          "Deliver to recipients and archive for comparison",
        ],
        outputs: "Consistent periodic reports and a written summary of what changed",
      };
    case "meeting_followup":
    default:
      return {
        ...common,
        solution_name: "Meeting Follow-up Assistant (concept)",
        trigger: "A meeting or customer call ends",
        inputs: ["Meeting recording or notes", "Your task categories and owners"],
        steps: [
          "Summarise the conversation and decisions",
          "Extract promised actions with owners and dates",
          "Draft tasks in your task system",
          "Owners confirm or adjust the tasks",
        ],
        outputs: "Summaries plus drafted tasks ready for confirmation",
      };
  }
}

function emptyConcept(): ConceptCard {
  return {
    solution_name: "Discovery conversation (concept)",
    business_goal: "Establish where value is real",
    current_problem: "No specific opportunity matched strongly yet",
    trigger: "A guided discovery session",
    inputs: ["Your time logs or job data", "A walkthrough of today's process"],
    steps: ["Map the actual workflow", "Quantify volumes and times", "Pick one candidate to pilot"],
    integrations: ["To be determined"],
    outputs: "A shortlist of validated candidates",
    human_approval_points: ["You decide what gets piloted"],
    exception_paths: ["—"],
    success_metrics: ["Agreed baseline numbers for one candidate process"],
    assumptions: ["—"],
    risks: ["Choosing on enthusiasm rather than numbers"],
    unresolved_questions: ["Current volumes and handling times"],
    complexity_band: "medium",
    feasibility: "needs_discovery",
  };
}

function approvalPoints(o: OpportunityResult): string[] {
  if (o.gates.length > 0) {
    return ["Every action passes a human approval step before it takes effect (required by risk gate)"];
  }
  return ["Drafts and records are approved by a person before anything is sent or committed"];
}

// ---------------------------------------------------------------- text builders

function bandLabel(band: OpportunityResult["band"]): string {
  return band === "priority_validate" ? "priority — validate next" : band === "potential" ? "potential — build the conditions first" : "needs more discovery";
}

function problemText(o: OpportunityResult, answers: AnswerMap): string {
  const err = getSingle(answers, "error_or_loss");
  const errText = err === "frequently" ? "Errors or rework come out of it frequently." : err === "occasionally" ? "Errors occasionally slip through." : "";
  return `This work was named as one of the most time-consuming parts of the business. ${errText}`.trim();
}

function currentProcessText(o: OpportunityResult, q: Questionnaire, answers: AnswerMap): string {
  const std = getScale(answers, "process_standardisation");
  const data = answerLabels(q, answers, "data_location");
  const owner = answerLabels(q, answers, "process_owner");
  const stdText =
    std == null ? "Process standardisation is unclear." : std >= 4 ? "The process is well standardised." : std <= 2 ? "The process largely isn't standardised yet." : "The process is partially standardised.";
  return `${stdText} Information lives in: ${data.join(", ")}. Ownership: ${owner.join(", ")}.`;
}

function improvementText(o: OpportunityResult): string {
  if (o.value?.annual_hours != null) {
    const baseline = o.value.scenarios.find((s) => s.name === "baseline");
    if (baseline?.released_hours != null) {
      return `Baseline planning scenario: roughly ${Math.round(baseline.released_hours).toLocaleString("en-AU")} of the current ${Math.round(o.value.annual_hours).toLocaleString("en-AU")} annual hours could be released for higher-value work, with a person still approving outputs.`;
    }
  }
  return "Expected improvement: less manual handling and fewer hand-off delays, sized after the missing numbers are filled in.";
}

function fitReasonText(o: OpportunityResult): string {
  const dims = o.dimensions;
  const bits: string[] = [];
  bits.push(
    `Match score ${o.raw_score}/100 (${bandLabel(o.band)}${o.is_primary_bottleneck ? ", your top-named problem area" : ""})`,
  );
  if (dims.standardisation != null && dims.standardisation >= 9) bits.push("the process is standardised enough to automate reliably");
  if (dims.dataAvailability != null && dims.dataAvailability >= 10) bits.push("the information is already in digital form");
  if (dims.connectivity != null && dims.connectivity >= 8) bits.push("your existing software can be connected");
  if (dims.connectivity != null && dims.connectivity <= 3) bits.push("connectivity is weak, so expect a manual-assist start rather than full automation");
  if (o.unknown_dimensions.length > 0) bits.push(`some dimensions could not be scored (${o.unknown_dimensions.join(", ")})`);
  return bits.join("; ") + ".";
}

function feasibilityText(ev: EvaluationOutput, q: Questionnaire, answers: AnswerMap) {
  const std = getScale(answers, "process_standardisation");
  const data = answerLabels(q, answers, "data_location");
  const software = answerLabels(q, answers, "current_software");
  const owner = answerLabels(q, answers, "process_owner");
  const digital = getMulti(answers, "data_location").some((d) => ["email", "spreadsheets", "saas", "shared-drives"].includes(d));
  return {
    process:
      std == null
        ? "Standardisation unknown — first step is writing the process down."
        : std >= 4
          ? "The process is documented and followed — a solid base for automation."
          : std >= 3
            ? "The process is reasonably consistent; tighten the edge cases before automating."
            : "The process varies between people. Standardise first, automate second.",
    data: digital
      ? `Information already lives in digital sources (${data.join(", ")}), which an assistant can reach.`
      : `Information is mostly non-digital (${data.join(", ")}); digitising comes before automating.`,
    systems:
      software.some((s) => /servicem8|simpro|tradify|jobber|xero|myob|quickbooks|hubspot|salesforce|zapier|microsoft|google/i.test(s))
        ? `You already run connectable systems (${software.join(", ")}) — integrations have somewhere to land.`
        : `System landscape is thin (${software.join(", ")}) — expect a lighter-touch start.`,
    people: `Process ownership: ${owner.join(", ")}. ${
      ev.confidence.level === "high" ? "Numbers are tracked, so results will be measurable." : "Numbers aren't well tracked yet — set a simple baseline as part of the pilot."
    }`,
  };
}

function riskRows(ev: EvaluationOutput): { risk: string; mitigation: string }[] {
  const rows = new Map<string, { risk: string; mitigation: string }>();
  for (const o of ev.opportunities) {
    for (const g of o.gates) rows.set(g.id, { risk: `${g.title} (${o.name})`, mitigation: g.mitigation });
  }
  for (const g of ev.global_risk_flags) rows.set(g.id, { risk: g.title, mitigation: g.mitigation });
  if (rows.size === 0) {
    rows.set("general", {
      risk: "AI outputs can be wrong or incomplete",
      mitigation: "Keep human approval points; log actions; revisit quality after real examples accumulate.",
    });
  }
  rows.set("privacy", {
    risk: "Personal or sensitive data handled by tools",
    mitigation: "Minimise what any tool can reach, respect today's permission boundaries, and confirm the data-handling basis before go-live.",
  });
  return [...rows.values()];
}

function buildRoadmap(ev: EvaluationOutput, priority: OpportunityResult | null) {
  const pilotName = priority ? priority.name.toLowerCase() : "the leading candidate process";
  return [
    {
      phase: "Days 0–30 · Validate",
      focus: "Prove the numbers and the fit",
      actions: [
        `Collect the missing data: ${priority?.value?.missing_inputs?.join("; ") || "volumes, handling times and hourly cost for one candidate process"}`,
        `Gather evidence: ${priority?.evidence_requirements.slice(0, 2).join("; ") || "20 real examples and current handling time"}`,
        "Confirm prerequisites and name the process owner",
      ],
    },
    {
      phase: "Days 31–60 · Pilot",
      focus: `Run ${pilotName} on a narrow slice with human review`,
      actions: [
        "Start with one document type / enquiry category / report",
        "Draft → human approval → commit; measure time and error rate against baseline",
        "Keep an exceptions log to tune rules and prompts",
      ],
    },
    {
      phase: "Days 61–90 · Evaluate & extend",
      focus: "Decide with numbers, then scale what worked",
      actions: [
        "Compare pilot results with the planning scenarios in this report",
        "Go/no-go decision with the process owner",
        "Extend to the next category or opportunity only after the numbers hold",
      ],
    },
  ];
}

function nextStepData(ev: EvaluationOutput, priority: OpportunityResult | null): string[] {
  const items = [...(priority?.value?.missing_inputs ?? [])];
  if (ev.confidence.level !== "high") items.push("a simple weekly measure of hours or volumes for this work");
  if (items.length === 0) items.push("quotes for implementation and running costs — needed before any ROI can be stated");
  return items;
}
