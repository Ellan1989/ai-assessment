import Link from "next/link";

export const metadata = { title: "Privacy notice — AI Opportunity Assessment" };

export default function PrivacyPage() {
  return (
    <main className="flex-1 bg-slate-50">
      <article className="mx-auto max-w-2xl px-4 py-14">
        <Link href="/" className="text-sm text-blue-700 underline underline-offset-4">← Back</Link>
        <h1 className="mt-4 text-3xl font-bold text-slate-900">Privacy notice</h1>
        <p className="mt-2 text-xs text-slate-500">Version privacy-notice-v1</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="font-semibold text-slate-900">What we collect and why</h2>
            <p className="mt-2">
              The assessment collects only what is needed to match your business to automation and AI opportunities and to
              estimate value: your industry, size, priorities, bottleneck areas, task volumes, time and cost bands, systems,
              and readiness questions. Every question shows why it is asked. Numeric questions accept &ldquo;Not sure&rdquo; — you never
              have to guess.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-slate-900">Anonymity until you ask for your report</h2>
            <p className="mt-2">
              Your answers are stored against a random, anonymous assessment ID. We only receive your name, work email and
              company name when you choose to unlock the full report. The report delivery consent you give there is separate
              from marketing — the marketing option is never pre-ticked, and you get your report either way.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-slate-900">Retention and access</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Anonymous assessments expire after 7 days.</li>
              <li>Report links are unguessable and expire after 30 days.</li>
              <li>Ask us to delete your assessment, lead record and report at any time and we will.</li>
              <li>Access to lead records is restricted to authorised staff and is audit-logged.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-semibold text-slate-900">What we do not do</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>We do not connect to your business systems, read your customer files, or ask for passwords or API keys.</li>
              <li>We do not sell your data.</li>
              <li>We do not use your answers to train AI models.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-semibold text-slate-900">Australian Privacy Principles</h2>
            <p className="mt-2">
              We handle personal information with care consistent with Australian privacy law. This notice is an overview,
              not legal advice, and this tool is not a compliance product. If you have questions about our handling of your
              information, contact us before starting the assessment.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
