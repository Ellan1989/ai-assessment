import { getConfig } from "@/lib/config";

/**
 * Minimal OpenAI-compatible chat client. Used ONLY to phrase narrative text
 * from structured engine output — never to compute scores or financials.
 * Returns null (rather than throwing) when unavailable so callers degrade
 * to the deterministic template.
 */

export async function chatJson(system: string, user: string, timeoutMs = 45_000): Promise<unknown | null> {
  const config = getConfig();
  if (!config.llmApiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[llm] request failed", res.status);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  } catch (err) {
    console.error("[llm] error", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
