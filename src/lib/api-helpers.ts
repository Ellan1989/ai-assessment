import { z } from "zod";
import type { Questionnaire } from "@/lib/domain/questionnaire";
import { AnswerValueSchema, isQuestionVisible } from "@/lib/domain/questionnaire";
import { hashToken } from "@/lib/util";
import { getAssessment, expireStaleAssessments, type AssessmentRow } from "@/lib/db/repositories";
import { jsonError } from "@/lib/security";

/** Verifies the caller holds the assessment's session token. */
export function requireAssessment(req: Request, id: string): { assessment: AssessmentRow } | { error: Response } {
  const token = req.headers.get("x-session-token");
  if (!token) return { error: jsonError(401, "missing_token", "Session token required.") };
  const assessment = getAssessment(id);
  if (!assessment) return { error: jsonError(404, "not_found", "Assessment not found.") };
  if (assessment.session_token_hash !== hashToken(token)) {
    return { error: jsonError(401, "invalid_token", "Session token does not match this assessment.") };
  }
  if (assessment.expires_at < new Date().toISOString() || assessment.status === "expired") {
    return { error: jsonError(410, "expired", "This assessment has expired. Please start a new one.") };
  }
  return { assessment };
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<{ data: T } | { error: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: jsonError(400, "invalid_json", "Request body must be valid JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { error: jsonError(422, "validation_failed", "Request body failed validation.", { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }) };
  }
  return { data: parsed.data };
}

export function sweepExpired(): void {
  try {
    expireStaleAssessments();
  } catch {
    /* best effort */
  }
}

/** Filter answers to questions visible under current answers (branch integrity). */
export function visibleAnswerMap(questionnaire: Questionnaire, answers: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const q of questionnaire.questions) {
    const raw = answers[q.id];
    if (raw == null) continue;
    const parsed = AnswerValueSchema.safeParse(raw);
    if (!parsed.success) continue;
    // re-check visibility with the map built so far (questions are ordered)
    if (isQuestionVisible(q, map as never)) map[q.id] = parsed.data;
  }
  return map;
}
