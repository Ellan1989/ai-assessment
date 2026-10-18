import { getConfig } from "@/lib/config";
import { createAssessment } from "@/lib/db/repositories";
import { QUESTIONNAIRE_V1 } from "@/lib/questionnaire/v1";
import { newToken } from "@/lib/util";
import { getClientIp, jsonError, jsonOk, rateLimit } from "@/lib/security";
import { track } from "@/lib/services";

export async function POST(req: Request) {
  const rl = rateLimit(`create:${getClientIp(req)}`, 20, 3_600_000);
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many assessments from this address. Try again later.", { retry_after_sec: rl.retryAfterSec });

  const config = getConfig();
  const { token, tokenHash } = newToken();
  const assessment = createAssessment({
    questionnaire_version: QUESTIONNAIRE_V1.version,
    session_token_hash: tokenHash,
    consent_version: null,
    expires_at: new Date(Date.now() + config.assessmentTtlDays * 86_400_000),
  });
  track("assessment_started", assessment.id);
  return jsonOk({ assessment_id: assessment.id, session_token: token, expires_at: assessment.expires_at }, 201);
}
