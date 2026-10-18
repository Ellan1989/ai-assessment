import Link from "next/link";
import StartButton from "@/components/StartButton";

export default function Home() {
  return (
    <main className="flex-1 bg-slate-50">
      {/* hero */}
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-700">Free assessment · No signup to start</p>
        <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
          Find your business&apos;s best AI opportunity — in about 7 minutes
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Answer plain-English questions about how your business actually runs. Get a personalised report:
          2–3 opportunities matched to your answers, an indicative value range, the risks that matter, and a
          90-day plan to validate them.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3">
          <StartButton />
          <p className="text-sm text-slate-500">
            Anonymous until you choose to receive your report · ~20 questions · &ldquo;Not sure&rdquo; always allowed
          </p>
        </div>
      </section>

      {/* what you get */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-14 sm:grid-cols-3">
          {[
            {
              title: "2–3 matched opportunities",
              body: "Not a generic AI pitch. Recommendations come from your industry, bottlenecks, data and systems — including the honest answer that rules-based automation or doing nothing may beat an AI agent.",
            },
            {
              title: "Transparent value estimate",
              body: "See the current annual hours behind the work, a conservative-to-optimistic range, and every assumption behind it. Time value is shown as time value — never dressed up as cash savings.",
            },
            {
              title: "Risks and a 90-day path",
              body: "Hard risk gates (sensitive data, no human review, high-stakes errors) are surfaced before recommendations. Then a validate → pilot → decide roadmap, sized for an SME.",
            },
          ].map((card) => (
            <div key={card.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <h2 className="font-semibold text-slate-900">{card.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-2xl font-semibold text-slate-900">How it works</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-4">
          {[
            ["1", "Answer ~20 questions", "Multiple choice, with sensible bands. Progress autosaves — you can come back within 7 days."],
            ["2", "See your preview", "Your top finding, opportunities and value range appear before you hand over anything."],
            ["3", "Get the full report", "Enter your email to unlock the full report — web page plus PDF, sent as a secure link."],
            ["4", "Decide with numbers", "Validate the assumptions, run a small pilot, then scale what actually works."],
          ].map(([n, title, body]) => (
            <li key={n} className="relative rounded-2xl border border-slate-200 bg-white p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">{n}</span>
              <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* privacy strip */}
      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-sm text-slate-600">
            We only collect what the assessment needs. Your answers stay anonymous until you ask for your report.
            Marketing emails are opt-in only and never pre-ticked.
          </p>
          <Link href="/privacy" className="text-sm font-medium text-blue-700 underline underline-offset-4">
            Read the privacy notice
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50 py-8 text-center text-xs text-slate-500">
        An initial opportunity assessment — not a guarantee of savings, and not a formal security, legal or compliance audit.
      </footer>
    </main>
  );
}
