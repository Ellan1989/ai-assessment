"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  effectiveOptions,
  groupIntoScreens,
  industryHintFor,
  missingRequired,
  visibleQuestions,
  type AnswerMap,
  type AnswerValue,
  type QuestionDef,
  type Questionnaire,
} from "@/lib/domain/questionnaire";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function QuestionnaireWizard({ assessmentId }: { assessmentId: string }) {
  const router = useRouter();
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [cursor, setCursor] = useState(0); // index into the visible question list
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const saveQueue = useRef<{ question_id: string; answer: AnswerValue }[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------- load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = localStorage.getItem(`aoa_token_${assessmentId}`) ?? "";
      const [qRes, aRes] = await Promise.all([
        fetch("/api/questionnaire"),
        fetch(`/api/assessments/${assessmentId}`, { headers: { "x-session-token": token } }),
      ]);
      if (!token) {
        if (!cancelled) setLoadError("This assessment link doesn't include your session. Please start again from the home page.");
        return;
      }
      try {
        if (!qRes.ok) throw new Error("Could not load the questionnaire.");
        if (aRes.status === 401 || aRes.status === 404) throw new Error("Assessment not found — please start again.");
        if (aRes.status === 410) throw new Error("This assessment has expired (they last 7 days). Please start a new one.");
        if (!aRes.ok) throw new Error("Could not restore your assessment.");
        const qData = (await qRes.json()) as { questionnaire: Questionnaire };
        const aData = (await aRes.json()) as { answers: AnswerMap };
        if (cancelled) return;
        setQuestionnaire(qData.questionnaire);
        const restored = aData.answers ?? {};
        setAnswers(restored);
        const vis = visibleQuestions(qData.questionnaire, restored);
        const firstUnanswered = vis.findIndex((q) => restored[q.id] == null);
        setCursor(firstUnanswered === -1 ? vis.length : firstUnanswered);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  const getToken = useCallback(
    (): string | null => (typeof window === "undefined" ? null : localStorage.getItem(`aoa_token_${assessmentId}`)),
    [assessmentId],
  );

  // ---------------- autosave (debounced batch PUT)
  const flush = useCallback(async () => {
    const t = getToken();
    if (!t || saveQueue.current.length === 0) return;
    const batch = saveQueue.current;
    saveQueue.current = [];
    setSaveState("saving");
    try {
      const res = await fetch(`/api/assessments/${assessmentId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-session-token": t },
        body: JSON.stringify({ answers: batch }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaveState("saved");
    } catch {
      saveQueue.current = [...batch, ...saveQueue.current];
      setSaveState("error");
    }
  }, [assessmentId, getToken]);

  const queueSave = useCallback(
    (questionId: string, answer: AnswerValue) => {
      saveQueue.current = saveQueue.current.filter((i) => i.question_id !== questionId);
      saveQueue.current.push({ question_id: questionId, answer });
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("beforeunload", onHide);
    return () => window.removeEventListener("beforeunload", onHide);
  }, [flush]);

  // ---------------- derived
  const visible = useMemo(
    () => (questionnaire ? visibleQuestions(questionnaire, answers) : []),
    [questionnaire, answers],
  );
  const screens = useMemo(() => groupIntoScreens(visible), [visible]);
  const answeredCount = visible.filter((q) => answers[q.id] != null).length;
  const progress = visible.length === 0 ? 0 : Math.round((answeredCount / visible.length) * 100);
  const doneAll = questionnaire != null && cursor >= visible.length;
  const screenIndex = screens.findIndex((s) => cursor >= s.startIndex && cursor < s.startIndex + s.questions.length);
  const currentScreen = screenIndex >= 0 ? screens[screenIndex] : undefined;
  const industryId =
    answers["company_industry"]?.kind === "single" ? (answers["company_industry"] as { value: string }).value : null;

  // ---------------- answering (no auto-advance: navigation is screen-level)
  const setAnswer = useCallback(
    (q: QuestionDef, answer: AnswerValue) => {
      setAnswers((prev) => ({ ...prev, [q.id]: answer }));
      // "Other" without a description is a half-finished answer — keep it
      // client-side only until text arrives (the server would reject it).
      const isHalfOther =
        (answer.kind === "single" || answer.kind === "multi") &&
        answer.value.includes("other") &&
        !answer.other_text?.trim();
      if (!isHalfOther) queueSave(q.id, answer);
    },
    [queueSave],
  );

  const screenIncomplete = (currentScreen?.questions ?? []).some((q) => {
    const a = answers[q.id];
    if (q.required && a == null) return true;
    if (a && (a.kind === "single" || a.kind === "multi")) {
      if (a.kind === "multi" && a.value.length < (q.minSelections ?? 1)) return true;
      if (a.value.includes("other") && !a.other_text?.trim()) return true;
    }
    return false;
  });

  // ---------------- evaluate
  const evaluate = async () => {
    const t = getToken();
    if (!t) return;
    await flush();
    const miss = questionnaire ? missingRequired(questionnaire, answers) : [];
    if (miss.length > 0) {
      setMissing(miss);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/assessments/${assessmentId}/evaluate`, {
        method: "POST",
        headers: { "x-session-token": t },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string; missing?: string[] } } | null;
        if (body?.error?.missing) setMissing(body.error.missing);
        else setLoadError(body?.error?.message ?? "Evaluation failed — please try again.");
        setSubmitting(false);
        return;
      }
      router.push(`/assessment/${assessmentId}/preview`);
    } catch {
      setLoadError("Network error — your answers are saved, please retry.");
      setSubmitting(false);
    }
  };

  // ---------------- render
  if (loadError) {
    return (
      <Shell>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800">{loadError}</p>
          <Link href="/" className="mt-4 inline-block rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white">
            Start a new assessment
          </Link>
        </div>
      </Shell>
    );
  }
  if (!questionnaire || !currentScreen) {
    if (doneAll) {
      return (
        <Shell>
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <h2 className="text-xl font-semibold text-slate-900">You&apos;re ready to see your results</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              We&apos;ll match your answers against our opportunity library, run the value estimates and check the risk gates.
            </p>
            {missing.length > 0 && (
              <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                Still missing: {missing.map((m) => questionLabel(questionnaire!, m)).join(", ")}
                <button
                  className="ml-2 underline"
                  onClick={() => {
                    const idx = visible.findIndex((q) => q.id === missing[0]);
                    if (idx >= 0) setCursor(idx);
                    setMissing([]);
                  }}
                >
                  go back
                </button>
              </div>
            )}
            <button
              onClick={evaluate}
              disabled={submitting}
              className="mt-6 rounded-xl bg-blue-700 px-8 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {submitting ? "Crunching your answers…" : "Show my results"}
            </button>
          </div>
          <SaveBadge state={saveState} />
        </Shell>
      );
    }
    return (
      <Shell>
        <p className="animate-pulse text-center text-slate-500">Loading your assessment…</p>
      </Shell>
    );
  }

  const isLastScreen = screenIndex === screens.length - 1;

  return (
    <Shell>
      {/* progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="font-medium text-slate-700">{currentScreen.title}</span>
          <span>
            Step {screenIndex + 1} of {screens.length} · {answeredCount}/{visible.length} answered
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* questions on this screen */}
      <div className="space-y-4">
        {currentScreen.questions.map((q) => (
          <QuestionCard
            key={q.id}
            q={q}
            questionnaire={questionnaire}
            answers={answers}
            industryId={industryId}
            onAnswer={(a) => setAnswer(q, a)}
            onMultiToggle={(optionId) => {
              const prev = answers[q.id];
              const prevList: string[] = prev && prev.kind === "multi" ? prev.value : [];
              const prevOther = prev && prev.kind === "multi" ? prev.other_text : "";
              const max = q.maxSelections ?? Infinity;
              let next: string[];
              if (prevList.includes(optionId)) next = prevList.filter((v) => v !== optionId);
              else if (prevList.length >= max) next = prevList;
              else next = [...prevList, optionId];
              setAnswer(q, { kind: "multi", value: next, other_text: prevOther });
            }}
          />
        ))}
      </div>

      {/* screen-level navigation */}
      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => setCursor(screens[screenIndex - 1].startIndex)}
          disabled={screenIndex === 0}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
        >
          ← Back
        </button>
        <SaveBadge state={saveState} />
        <button
          onClick={() => setCursor(currentScreen.startIndex + currentScreen.questions.length)}
          disabled={screenIncomplete}
          className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {isLastScreen ? "Finish →" : "Next →"}
        </button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- one question

function QuestionCard({
  q,
  questionnaire,
  answers,
  industryId,
  onAnswer,
  onMultiToggle,
}: {
  q: QuestionDef;
  questionnaire: Questionnaire;
  answers: AnswerMap;
  industryId: string | null;
  onAnswer: (answer: AnswerValue) => void;
  onMultiToggle: (optionId: string) => void;
}) {
  const answer = answers[q.id];
  const selectedSingle = answer?.kind === "single" ? answer.value : null;
  const selectedMulti: string[] = answer?.kind === "multi" ? answer.value : [];
  const scaleValue = answer?.kind === "scale" ? answer.value : null;
  const isUnknown = answer?.kind === "unknown";
  const options = q.dynamicOptionsFrom ? effectiveOptions(questionnaire, answers, q) : q.options;
  const otherText = answer && (answer.kind === "single" || answer.kind === "multi") ? answer.other_text ?? "" : "";
  const hint = industryHintFor(q, industryId);
  const anchor = q.group === "capability" || q.group === "risk_overlay" ? anchorBottleneckLabel(questionnaire, answers) : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <h3 className="text-lg font-semibold leading-snug text-slate-900">{q.prompt}</h3>
      {q.helpText && <p className="mt-1.5 text-sm text-slate-500">{q.helpText}</p>}
      {anchor && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
          Asked about: {anchor}
        </p>
      )}
      {hint && <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">{hint}</p>}

      {q.type === "scale5" ? (
        <div className="mt-4 grid max-w-md grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => onAnswer({ kind: "scale", value: n })}
              className={`rounded-xl border py-4 text-lg font-semibold transition ${
                scaleValue === n ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-400"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      ) : (
        <div className={`mt-4 grid gap-2 ${q.type === "multi" ? "sm:grid-cols-2" : ""}`}>
          {options.map((opt) => {
            const activeS = q.type !== "multi" && selectedSingle === opt.id;
            const activeM = q.type === "multi" && selectedMulti.includes(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() =>
                  q.type === "multi" ? onMultiToggle(opt.id) : onAnswer({ kind: "single", value: opt.id })
                }
                className={`rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition ${
                  activeS || activeM
                    ? "border-blue-700 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-400"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          {q.allowOther && (
            <OtherField
              label="Other"
              text={otherText}
              multi={q.type === "multi"}
              checked={q.type === "multi" ? selectedMulti.includes("other") : selectedSingle === "other"}
              onText={(t) =>
                q.type === "multi"
                  ? onAnswer({ kind: "multi", value: selectedMulti.length > 0 ? selectedMulti : ["other"], other_text: t })
                  : onAnswer({ kind: "single", value: "other", other_text: t })
              }
              onToggle={() =>
                q.type === "multi"
                  ? onMultiToggle("other")
                  : onAnswer({ kind: "single", value: "other", other_text: otherText })
              }
            />
          )}
          {q.allowUnknown && (
            <button
              onClick={() => onAnswer({ kind: "unknown" })}
              className={`rounded-xl border border-dashed px-4 py-2.5 text-left text-sm transition ${
                isUnknown ? "border-slate-500 bg-slate-100 text-slate-800" : "border-slate-300 text-slate-500 hover:border-slate-500"
              }`}
            >
              {q.unknownLabel ?? "Not sure"} — that&apos;s fine, we&apos;ll flag what to measure
            </button>
          )}
        </div>
      )}

      {q.type === "multi" && q.maxSelections && (
        <p className="mt-2 text-xs text-slate-500">
          {selectedMulti.length}/{q.maxSelections} selected
          {selectedMulti.length >= q.maxSelections ? " — deselect one to change" : ""}
        </p>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">Why we ask: {q.purpose}</p>
    </div>
  );
}

// ---------------------------------------------------------------- helpers & small components

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">{children}</div>
    </main>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "idle") return <span />;
  const map: Record<SaveState, { text: string; cls: string }> = {
    idle: { text: "", cls: "" },
    saving: { text: "Saving…", cls: "text-slate-400" },
    saved: { text: "Saved ✓", cls: "text-emerald-600" },
    error: { text: "Save failed — retrying with your next answer", cls: "text-red-600" },
  };
  return <span className={`text-xs ${map[state].cls}`}>{map[state].text}</span>;
}

function OtherField(props: {
  label: string;
  text: string;
  multi: boolean;
  checked: boolean;
  onText: (t: string) => void;
  onToggle: () => void;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 transition ${props.checked ? "border-blue-700 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-400"}`}>
      <button onClick={props.onToggle} className="block w-full text-left text-sm font-medium text-slate-700">
        {props.label} (describe briefly)
      </button>
      {props.checked && (
        <input
          autoFocus
          value={props.text}
          onChange={(e) => props.onText(e.target.value.slice(0, 200))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && props.text.trim()) e.currentTarget.blur();
          }}
          placeholder="A few words is enough"
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
        />
      )}
    </div>
  );
}

function questionLabel(q: Questionnaire, id: string): string {
  return q.questions.find((x) => x.id === id)?.prompt ?? id;
}

/** Label of the area the generic workload/process questions are anchored to. */
function anchorBottleneckLabel(questionnaire: Questionnaire, answers: AnswerMap): string | null {
  const bottleneck = answers["bottleneck"];
  if (!bottleneck || bottleneck.kind !== "multi") return null;
  const primary = answers["primary_bottleneck"];
  let anchorId: string | null = null;
  if (primary && primary.kind === "single") anchorId = primary.value;
  else if (bottleneck.value.length === 1) anchorId = bottleneck.value[0];
  else return null; // several picks, worst not named yet — no anchor to show
  if (anchorId === "other") return bottleneck.other_text || "the area you described";
  const def = questionnaire.questions.find((q) => q.id === "bottleneck");
  return def?.options.find((o) => o.id === anchorId)?.label ?? null;
}
