import type { AnswerMap } from "@/lib/domain/questionnaire";
import { QUESTIONNAIRE_V1 } from "@/lib/questionnaire/v1";

/** A complete, realistic answer set (trades business, document + enquiry pain). */
export function fullTradesAnswers(): AnswerMap {
  return {
    company_industry: { kind: "single", value: "trades-construction" },
    employee_band: { kind: "single", value: "5-19" },
    business_goal: { kind: "multi", value: ["reduce-admin", "reduce-errors"] },
    bottleneck: { kind: "multi", value: ["documents", "enquiries-quotes"] },
    primary_bottleneck: { kind: "single", value: "documents" },
    task_volume: { kind: "single", value: "16-40" },
    minutes_per_task: { kind: "single", value: "16-30" },
    hourly_cost: { kind: "single", value: "51-80" },
    error_or_loss: { kind: "single", value: "occasionally" },
    process_standardisation: { kind: "scale", value: 3 },
    exception_rate: { kind: "single", value: "10-25" },
    data_location: { kind: "multi", value: ["email", "spreadsheets", "saas"] },
    current_software: { kind: "multi", value: ["servicem8", "xero"] },
    input_channels: { kind: "multi", value: ["phone", "email", "web-forms"] },
    metrics_tracking: { kind: "single", value: "yes-basic" },
    process_owner: { kind: "single", value: "side-duty" },
    human_review: { kind: "single", value: "always-review" },
    sensitive_data: { kind: "multi", value: ["none"] },
    document_type: { kind: "multi", value: ["invoices-receipts", "purchase-orders"] },
    monthly_document_volume: { kind: "single", value: "21-100" },
    document_formats: { kind: "multi", value: ["pdf-email", "scans-photos"] },
    document_error_consequence: { kind: "single", value: "delays" },
    enquiry_sources: { kind: "multi", value: ["email", "web-forms"] },
    weekly_enquiry_count: { kind: "single", value: "6-15" },
    current_response_time: { kind: "single", value: "same-day" },
    weekly_quote_count: { kind: "single", value: "6-15" },
    follow_up_method: { kind: "single", value: "spreadsheet" },
    budget_band: { kind: "single", value: "5-15k" },
    timing: { kind: "single", value: "1-3-months" },
  };
}

/** Minimal general-only answers (no branch groups reachable). */
export function minimalAnswers(): AnswerMap {
  return {
    company_industry: { kind: "single", value: "professional-services" },
    employee_band: { kind: "single", value: "1-4" },
    business_goal: { kind: "multi", value: ["reduce-costs"] },
    bottleneck: { kind: "multi", value: ["reporting-analysis"] },
    task_volume: { kind: "unknown" },
    minutes_per_task: { kind: "unknown" },
    hourly_cost: { kind: "unknown" },
    error_or_loss: { kind: "unknown" },
    process_standardisation: { kind: "scale", value: 2 },
    exception_rate: { kind: "single", value: "under-10" },
    data_location: { kind: "multi", value: ["spreadsheets"] },
    current_software: { kind: "multi", value: ["gworkspace"] },
    input_channels: { kind: "multi", value: ["email"] },
    metrics_tracking: { kind: "single", value: "no" },
    process_owner: { kind: "single", value: "nobody" },
    human_review: { kind: "single", value: "case-by-case" },
    sensitive_data: { kind: "multi", value: ["none"] },
    budget_band: { kind: "unknown" },
    timing: { kind: "single", value: "exploring" },
  };
}

export { QUESTIONNAIRE_V1 };
