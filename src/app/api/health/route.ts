import { jsonOk } from "@/lib/security";

/** Liveness/health probe for deployment checks and uptime monitors. */
export async function GET() {
  return jsonOk({ status: "ok", service: "ai-assessment", time: new Date().toISOString() });
}
