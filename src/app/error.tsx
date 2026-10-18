"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary. Questionnaire answers autosave server-side, so
 * any rendering error here is recoverable: reload resumes from the last saved
 * answer. removeChild-style errors are almost always caused by browser
 * extensions (page translation, grammar tools) mutating React-owned DOM.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-700">Something glitched</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">The page hit a rendering error</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Your answers are saved automatically as you go — nothing is lost. Reload this page to pick up
          exactly where you left off.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          If it keeps happening, this is usually caused by a browser extension (automatic page translation
          is the most common one). Try disabling translation for this site.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => reset()}
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Reload &amp; resume
          </button>
        </div>
        <Link href="/" className="mt-4 inline-block text-xs text-slate-400 underline underline-offset-2">
          or start a new assessment
        </Link>
      </div>
    </main>
  );
}
