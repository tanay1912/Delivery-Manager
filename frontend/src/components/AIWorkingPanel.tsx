import { useEffect, useState } from "react";

export type AIWorkingStep = { id: string; label: string };

function StepIcon({ status }: { status: "done" | "active" | "pending" }) {
  if (status === "done") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200">
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 111.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-6 w-6 items-center justify-center">
        <span className="h-5 w-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
      </span>
    );
  }
  return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 ring-1 ring-slate-200" />;
}

const DEFAULT_HINTS = [
  "Reading ticket description and acceptance criteria…",
  "Mapping scope against similar past deliveries…",
  "Estimating development effort and risk…",
  "Drafting the Jira estimation comment…",
  "Outlining test cases for verification…",
];

interface AIWorkingPanelProps {
  issueKey?: string;
  issueSummary?: string;
  headline?: string;
  subline?: string;
  steps: readonly AIWorkingStep[];
  activeStep: number;
  hints?: string[];
}

export default function AIWorkingPanel({
  issueKey,
  issueSummary,
  headline = "AI is working on your delivery",
  subline = "Hang tight — we're setting things up and generating your estimation.",
  steps,
  activeStep,
  hints = DEFAULT_HINTS,
}: AIWorkingPanelProps) {
  const [hintIndex, setHintIndex] = useState(0);
  const [typedChars, setTypedChars] = useState(0);

  const currentHint = hints[hintIndex % hints.length] ?? hints[0] ?? "";

  useEffect(() => {
    setHintIndex(0);
    setTypedChars(0);
  }, [issueKey]);

  useEffect(() => {
    if (!currentHint) return;
    if (typedChars < currentHint.length) {
      const timer = window.setTimeout(() => setTypedChars((n) => n + 1), 18);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setHintIndex((i) => (i + 1) % hints.length);
      setTypedChars(0);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [currentHint, typedChars, hints.length]);

  const displayedHint = currentHint.slice(0, typedChars);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-b from-brand-50/90 via-white to-white p-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgb(59 130 246 / 0.12), transparent 45%), radial-gradient(circle at 80% 0%, rgb(99 102 241 / 0.1), transparent 40%)",
        }}
      />

      <div className="relative">
        <div className="flex flex-col items-center text-center mb-8">
          {issueKey && (
            <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse" />
              <span className="font-mono">{issueKey}</span>
            </span>
          )}

          <div className="relative mb-5">
            <span className="absolute -inset-3 rounded-full bg-brand-400/15 animate-ping" />
            <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-brand-400/30 to-violet-400/20 blur-md animate-pulse" />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white ring-4 ring-brand-50 shadow-lg shadow-brand-100/80">
              <svg className="h-8 w-8 text-brand-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
              </svg>
            </span>
          </div>

          <h3 className="text-base font-semibold text-slate-900">{headline}</h3>
          <p className="text-sm text-slate-500 mt-1.5 max-w-md">{subline}</p>
          {issueSummary && (
            <p className="text-sm text-slate-600 mt-3 max-w-lg line-clamp-2" title={issueSummary}>
              {issueSummary}
            </p>
          )}
        </div>

        <div className="mx-auto mb-8 max-w-lg rounded-xl border border-brand-100/80 bg-white/70 px-4 py-3 text-left shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600 mb-1.5">Live insight</p>
          <p className="text-sm text-slate-700 min-h-[1.25rem] font-mono">
            {displayedHint}
            <span className="inline-block w-2 animate-pulse text-brand-500">|</span>
          </p>
        </div>

        <ol className="space-y-3 max-w-md mx-auto">
          {steps.map((step, index) => {
            const status =
              index < activeStep ? "done" : index === activeStep ? "active" : "pending";
            return (
              <li
                key={step.id}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-300 ${
                  status === "active"
                    ? "bg-white border border-brand-200 shadow-sm shadow-brand-100/50"
                    : status === "done"
                      ? "bg-emerald-50/50 border border-emerald-100"
                      : "bg-slate-50/50 border border-transparent"
                }`}
              >
                <StepIcon status={status} />
                <span
                  className={`text-sm ${
                    status === "active"
                      ? "font-medium text-brand-800"
                      : status === "done"
                        ? "text-emerald-800"
                        : "text-slate-400"
                  }`}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export const BOOT_STEPS: readonly AIWorkingStep[] = [
  { id: "open", label: "Opening delivery workspace" },
  { id: "sync", label: "Syncing ticket from Jira" },
  { id: "ready", label: "Preparing estimation workflow" },
] as const;

export const PREPARE_STEPS: readonly AIWorkingStep[] = [
  { id: "fetch", label: "Loading ticket details from Jira" },
  { id: "status", label: "Updating Jira status to In Estimation" },
  { id: "ai", label: "AI is generating estimation, development plan, and test cases" },
] as const;
