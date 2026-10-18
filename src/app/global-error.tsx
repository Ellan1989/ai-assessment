"use client";

/** Root-layout error boundary — rarest case, must render its own <html>. */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[global-error]", error);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ maxWidth: 420, textAlign: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 32 }}>
            <h1 style={{ fontSize: 18, color: "#0f172a" }}>The page hit an unexpected error</h1>
            <p style={{ fontSize: 13, color: "#475569" }}>Your assessment answers are saved. Reload to resume.</p>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 20, background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 12, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}
            >
              Reload &amp; resume
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
