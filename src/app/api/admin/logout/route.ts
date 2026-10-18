import { ADMIN_COOKIE, jsonError, sameOrigin } from "@/lib/security";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-origin request rejected.");
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    },
  });
}
