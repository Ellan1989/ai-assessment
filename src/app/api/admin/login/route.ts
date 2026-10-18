import { z } from "zod";
import { readJson } from "@/lib/api-helpers";
import { ADMIN_COOKIE, createAdminSessionValue, getClientIp, jsonError, rateLimit, sameOrigin, verifyAdminCredentials } from "@/lib/security";
import { audit } from "@/lib/services";

const LoginSchema = z.object({
  email: z.string().max(200),
  password: z.string().max(200),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-origin request rejected.");
  const rl = rateLimit(`admin-login:${getClientIp(req)}`, 10, 900_000);
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many attempts. Try again later.", { retry_after_sec: rl.retryAfterSec });

  const body = await readJson(req, LoginSchema);
  if ("error" in body) return body.error;

  if (!verifyAdminCredentials(body.data.email, body.data.password)) {
    audit("admin", "admin_login_failed", { ip: getClientIp(req) });
    return jsonError(401, "invalid_credentials", "Invalid email or password.");
  }

  const session = createAdminSessionValue();
  audit("admin", "admin_login_success");
  const secure = process.env.APP_BASE_URL?.startsWith("https://") ? " Secure;" : "";
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${ADMIN_COOKIE}=${session.value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${session.maxAgeSec};${secure}`,
    },
  });
}
