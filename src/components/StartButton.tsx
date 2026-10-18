"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function StartButton({ label = "Start the assessment" }: { label?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/assessments", { method: "POST" });
      if (!res.ok) throw new Error(`Failed to start (${res.status})`);
      const data = (await res.json()) as { assessment_id: string; session_token: string };
      localStorage.setItem(`aoa_token_${data.assessment_id}`, data.session_token);
      router.push(`/assessment/${data.assessment_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={start}
        disabled={loading}
        className="rounded-xl bg-blue-700 px-8 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-60"
      >
        {loading ? "Starting…" : label}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
