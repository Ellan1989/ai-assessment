import { hmacSign, safeEqual } from "@/lib/util";
import { getConfig } from "@/lib/config";

// ---------------------------------------------------------------- rate limiting (in-memory; swap for Redis in production)

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, retryAfterSec: 0 };
}

// Periodic cleanup so the map cannot grow unbounded.
if (typeof setInterval === "function") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, hits] of buckets) {
      const alive = hits.filter((t) => now - t < 3_600_000);
      if (alive.length === 0) buckets.delete(k);
      else buckets.set(k, alive);
    }
  }, 600_000);
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// ---------------------------------------------------------------- request helpers

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** CSRF defence for cookie-authenticated mutations: Origin must match Host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (tests, curl) — cookie auth still required
  try {
    const originHost = new URL(origin).host;
    const host = req.headers.get("host");
    return !host || originHost === host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- admin session (HMAC-signed cookie)

export const ADMIN_COOKIE = "admin_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function createAdminSessionValue(): { value: string; maxAgeSec: number } {
  const config = getConfig();
  const expires = Date.now() + SESSION_TTL_MS;
  const nonce = Math.random().toString(36).slice(2);
  const payload = `${expires}.${nonce}`;
  return { value: `${payload}.${hmacSign(payload, config.appSecret)}`, maxAgeSec: SESSION_TTL_MS / 1000 };
}

export function verifyAdminSession(cookieValue: string | null | undefined): boolean {
  if (!cookieValue) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [expires, nonce, sig] = parts;
  const config = getConfig();
  if (!safeEqual(sig, hmacSign(`${expires}.${nonce}`, config.appSecret))) return false;
  return Number(expires) > Date.now();
}

export function verifyAdminCredentials(email: string, password: string): boolean {
  const config = getConfig();
  return safeEqual(email.trim().toLowerCase(), config.adminEmail.toLowerCase()) && safeEqual(password, config.adminPassword);
}
