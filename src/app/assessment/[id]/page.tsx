import QuestionnaireWizard from "@/components/QuestionnaireWizard";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-slate-900">AI Opportunity Assessment</span>
          <span className="text-xs text-slate-400">Progress autosaves · 7-day resume window</span>
        </div>
      </header>
      <QuestionnaireWizard assessmentId={id} />
    </div>
  );
}
