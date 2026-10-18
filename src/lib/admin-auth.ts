import { parseCookies } from "@/lib/api-helpers";
import { ADMIN_COOKIE, jsonError, verifyAdminSession } from "@/lib/security";

export function isAdminRequest(req: Request): boolean {
  const cookies = parseCookies(req.headers.get("cookie"));
  return verifyAdminSession(cookies[ADMIN_COOKIE]);
}

export function requireAdmin(req: Request): Response | null {
  if (!isAdminRequest(req)) {
    return jsonError(401, "unauthorized", "Admin authentication required.");
  }
  return null;
}
