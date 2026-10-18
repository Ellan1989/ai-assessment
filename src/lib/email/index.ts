import { getConfig } from "@/lib/config";

/**
 * Pluggable email adapter (spec §2). "console" logs the link in development;
 * "resend" sends via the Resend API. Failures never block report delivery —
 * the UI always shows the direct link.
 */

export interface ReportEmailPayload {
  to: string;
  reportUrl: string;
}

export async function sendReportEmail(payload: ReportEmailPayload): Promise<{ sent: boolean; error?: string }> {
  const config = getConfig();
  if (config.emailProvider === "resend") {
    if (!config.resendApiKey) return { sent: false, error: "RESEND_API_KEY not configured" };
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.resendApiKey}` },
        body: JSON.stringify({
          from: config.emailFrom,
          to: payload.to,
          subject: "Your AI Opportunity Assessment report",
          text: `Thanks for completing the assessment.\n\nOpen or download your report:\n${payload.reportUrl}\n\nThe link stays valid for 30 days. This email was sent because you requested your report.\n\nAI Opportunity Assessment`,
        }),
      });
      if (!res.ok) return { sent: false, error: `resend responded ${res.status}` };
      return { sent: true };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : "send failed" };
    }
  }
  console.log(`[email:console] report link for ${payload.to}: ${payload.reportUrl}`);
  return { sent: true };
}
