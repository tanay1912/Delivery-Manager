import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, DeliveryRun, User } from "../api/client";
import FileDiffViewer from "../components/FileDiffViewer";
import Layout from "../components/Layout";

function phaseStatus(
  phase: string,
  target: string,
  completedPhases: string[],
): "completed" | "active" | "pending" {
  if (completedPhases.includes(target)) return "completed";
  if (phase === target) return "active";
  return "pending";
}

function StepIndicator({
  number,
  label,
  status,
}: {
  number: number;
  label: string;
  status: "completed" | "active" | "pending";
}) {
  const circleClass =
    status === "completed"
      ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
      : status === "active"
        ? "bg-brand-100 text-brand-700 ring-brand-200"
        : "bg-white text-slate-400 ring-slate-200";

  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ring-2 ${circleClass}`}
      >
        {status === "completed" ? "✓" : number}
      </span>
      <span
        className={`text-sm font-medium ${status === "active" ? "text-brand-700" : status === "completed" ? "text-slate-800" : "text-slate-400"}`}
      >
        {label}
      </span>
    </div>
  );
}

const REVISION_SUBSTEPS = [
  { id: "revision_prepare", label: "Prepare revision context" },
  { id: "revision_generate", label: "Generate code changes" },
  { id: "revision_commit", label: "Commit changes to branch" },
  { id: "revision_delete", label: "Remove requested files" },
  { id: "revision_refresh", label: "Refresh changed files" },
] as const;

function revisionStepStatus(
  stepId: string,
  stepsLog: DeliveryRun["steps_log"],
  revisionActive: boolean,
): "done" | "active" | "pending" | "failed" {
  const entries = stepsLog.filter((s) => s.step === stepId);
  const latest = entries[entries.length - 1];
  if (latest?.status === "failed") return "failed";
  if (latest?.status === "completed") return "done";
  if (latest?.status === "running") return "active";

  if (!revisionActive) return "pending";

  const order = REVISION_SUBSTEPS.map((s) => s.id);
  const idx = order.indexOf(stepId as (typeof order)[number]);
  if (idx <= 0) return "pending";
  const prev = order[idx - 1];
  const prevEntries = stepsLog.filter((s) => s.step === prev);
  const prevLatest = prevEntries[prevEntries.length - 1];
  if (prevLatest?.status === "completed") return "active";
  return "pending";
}

function RevisionStepsList({
  run,
  active,
}: {
  run: DeliveryRun;
  active: boolean;
}) {
  return (
    <ol className="space-y-2">
      {REVISION_SUBSTEPS.map((step) => {
        const status = revisionStepStatus(step.id, run.steps_log, active);
        return (
          <li
            key={step.id}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
              status === "active"
                ? "bg-white border border-brand-200 shadow-sm"
                : status === "done"
                  ? "bg-emerald-50/50 border border-emerald-100"
                  : status === "failed"
                    ? "bg-red-50/50 border border-red-100"
                    : "bg-slate-50/50 border border-transparent"
            }`}
          >
            <PrepareStepIcon
              status={status === "failed" ? "pending" : status === "done" ? "done" : status}
            />
            <span
              className={
                status === "active"
                  ? "font-medium text-brand-800"
                  : status === "done"
                    ? "text-emerald-800"
                    : status === "failed"
                      ? "text-red-700"
                      : "text-slate-400"
              }
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RevisionHistory({ stepsLog }: { stepsLog: DeliveryRun["steps_log"] }) {
  const revisions = stepsLog.filter((entry) => entry.step === "code_revision");
  if (revisions.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800 mb-2">Revision history</h3>
      <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {revisions.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="font-medium text-slate-800">Revision #{index + 1}</span>
              <span
                className={
                  entry.status === "completed"
                    ? "badge-success"
                    : entry.status === "failed"
                      ? "badge-neutral text-red-700 bg-red-50"
                      : entry.status === "running"
                        ? "badge-info"
                        : "badge-neutral"
                }
              >
                {entry.status === "completed"
                  ? "Completed"
                  : entry.status === "failed"
                    ? "Failed"
                    : entry.status === "running"
                      ? "In progress"
                      : entry.status}
              </span>
            </div>
            {entry.message && (
              <p className="text-slate-600 whitespace-pre-wrap break-words">{entry.message}</p>
            )}
            {entry.at && (
              <p className="text-xs text-slate-400 mt-1">
                {new Date(entry.at).toLocaleString()}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BranchNameLink({
  branchName,
  developmentUrl,
}: {
  branchName: string;
  developmentUrl: string | null;
}) {
  if (!developmentUrl) {
    return <span className="font-mono text-sm text-slate-800 break-all">{branchName}</span>;
  }

  return (
    <a
      href={developmentUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-sm text-brand-600 hover:text-brand-700 break-all"
      title="View branch, commits, and pull requests in Jira Development"
    >
      {branchName}
    </a>
  );
}

const PREPARE_STEPS = [
  { id: "fetch", label: "Loading ticket details from Jira" },
  { id: "status", label: "Updating Jira status to In Estimation" },
  { id: "ai", label: "AI is generating estimation and Jira comment" },
] as const;

function resolveDraftComment(run: DeliveryRun): string {
  if (run.draft_comment?.trim()) return run.draft_comment.trim();
  if (!run.estimation_prepared && run.estimation_hours == null) return "";

  const lines = [
    `Estimation for ${run.jira_issue_key}: ${run.summary}`,
    "",
    `Original estimate: ${run.estimation_hours ?? "n/a"} hours`,
    "",
    run.estimation_summary ? `Reasoning:\n${run.estimation_summary}` : "",
  ];
  return lines.join("\n").trim();
}

function PrepareStepIcon({ status }: { status: "done" | "active" | "pending" }) {
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

const IMPLEMENTATION_SUBSTEPS = [
  { id: "impact_analysis", label: "Write Impact Analysis to Jira" },
  { id: "transition_in_progress", label: "Move ticket to In Progress" },
  { id: "create_branch", label: "Create branch from Master" },
  { id: "cursor_development", label: "Develop with Cursor SDK" },
  { id: "commit_changes", label: "Commit changes to branch" },
  { id: "create_pr_beta", label: "Open Beta pull request" },
  { id: "create_pr_master", label: "Open Master pull request" },
] as const;

function implementationStepStatus(
  stepId: string,
  stepsLog: DeliveryRun["steps_log"],
): "done" | "active" | "pending" | "failed" {
  const entry = [...stepsLog].reverse().find((s) => s.step === stepId);
  if (entry?.status === "failed") return "failed";
  if (entry?.status === "completed") return "done";
  if (entry?.status === "running") return "active";
  const order = IMPLEMENTATION_SUBSTEPS.map((s) => s.id);
  const idx = order.indexOf(stepId as (typeof order)[number]);
  if (idx <= 0) return "pending";
  const prev = order[idx - 1];
  const prevEntry = stepsLog.find((s) => s.step === prev);
  if (prevEntry?.status === "completed") return "active";
  return "pending";
}

function ImplementationStepsList({ run }: { run: DeliveryRun }) {
  return (
    <ol className="space-y-2">
      {IMPLEMENTATION_SUBSTEPS.map((step) => {
        const status = implementationStepStatus(step.id, run.steps_log);
        return (
          <li
            key={step.id}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
              status === "active"
                ? "bg-white border border-brand-200 shadow-sm"
                : status === "done"
                  ? "bg-emerald-50/50 border border-emerald-100"
                  : status === "failed"
                    ? "bg-red-50/50 border border-red-100"
                    : "bg-slate-50/50 border border-transparent"
            }`}
          >
            <PrepareStepIcon
              status={status === "failed" ? "pending" : status === "done" ? "done" : status}
            />
            <span
              className={
                status === "active"
                  ? "font-medium text-brand-800"
                  : status === "done"
                    ? "text-emerald-800"
                    : status === "failed"
                      ? "text-red-700"
                      : "text-slate-400"
              }
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function EstimationPreparingLoader({ activeStep }: { activeStep: number }) {
  return (
    <div className="rounded-2xl border border-brand-100 bg-gradient-to-b from-brand-50/80 to-white p-8">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="relative mb-5">
          <span className="absolute inset-0 rounded-full bg-brand-400/20 animate-ping" />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 ring-4 ring-brand-50">
            <svg className="h-7 w-7 text-brand-600 animate-pulse" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
        <h3 className="text-base font-semibold text-slate-900">AI is preparing your estimation</h3>
        <p className="text-sm text-slate-500 mt-1.5 max-w-sm">
          Updating Jira and generating a comment for you to review. This usually takes a few seconds.
        </p>
      </div>

      <ol className="space-y-3 max-w-md mx-auto">
        {PREPARE_STEPS.map((step, index) => {
          const status =
            index < activeStep ? "done" : index === activeStep ? "active" : "pending";
          return (
            <li
              key={step.id}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
                status === "active"
                  ? "bg-white border border-brand-200 shadow-sm"
                  : status === "done"
                    ? "bg-emerald-50/50 border border-emerald-100"
                    : "bg-slate-50/50 border border-transparent"
              }`}
            >
              <PrepareStepIcon status={status} />
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
  );
}

export default function DeliveryPage() {
  const { issueKey } = useParams<{ issueKey: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");
  const [run, setRun] = useState<DeliveryRun | null>(
    (location.state as { run?: DeliveryRun } | null)?.run ?? null,
  );
  const [loading, setLoading] = useState(!(location.state as { run?: DeliveryRun } | null)?.run);
  const [apiOutdated, setApiOutdated] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareStep, setPrepareStep] = useState(0);
  const [posting, setPosting] = useState(false);
  const [requestingInfo, setRequestingInfo] = useState(false);
  const [implementing, setImplementing] = useState(false);
  const [mergingBeta, setMergingBeta] = useState(false);
  const [mergingMaster, setMergingMaster] = useState(false);
  const [applyingRevision, setApplyingRevision] = useState(false);
  const [decliningPr, setDecliningPr] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState<{ path: string; action: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [comment, setComment] = useState("");
  const [hours, setHours] = useState("");
  const [question, setQuestion] = useState("");
  const prepareStarted = useRef(false);
  const commentEdited = useRef(false);
  const hoursEdited = useRef(false);
  const questionEdited = useRef(false);

  const applyRunDrafts = useCallback((current: DeliveryRun) => {
    if (!commentEdited.current) {
      const resolvedComment = resolveDraftComment(current);
      if (resolvedComment) setComment(resolvedComment);
    }
    if (current.estimation_hours != null && !hoursEdited.current) {
      setHours(String(current.estimation_hours));
    }
    if (current.draft_question && !questionEdited.current) {
      setQuestion(current.draft_question);
    }
  }, []);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    },
    [navigate],
  );

  useEffect(() => {
    api
      .getHealth()
      .then((health) => {
        if (!health.features?.estimation_workflow) {
          setApiOutdated(true);
        }
      })
      .catch(() => {
        // Ignore health check failures; delivery endpoints will surface real errors.
      });
  }, []);

  const loadRun = useCallback(async () => {
    if (!issueKey) return;
    const seededRun = (location.state as { run?: DeliveryRun } | null)?.run;
    if (seededRun?.jira_issue_key === issueKey) {
      setRun(seededRun);
      applyRunDrafts(seededRun);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let current: DeliveryRun;
      try {
        current = await api.getRunByIssue(issueKey);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          current = await api.startRun(issueKey);
        } else {
          throw err;
        }
      }
      setRun(current);
      applyRunDrafts(current);
      if (current.workflow_notice && current.workflow_phase === "estimation") {
        prepareStarted.current = false;
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  }, [issueKey, handleAuthError, applyRunDrafts, location.state]);

  useEffect(() => {
    api.getMe().then((data) => {
      setUser(data.user);
      setSiteName(data.site_name);
    }).catch(handleAuthError);
  }, [handleAuthError]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (!run) return;

    const shouldPoll =
      implementing ||
      applyingRevision ||
      (run.status === "running" &&
        (run.workflow_phase === "implementation" || run.workflow_phase === "pr_review")) ||
      (run.status === "awaiting_approval" && run.workflow_phase === "pr_review");

    if (!shouldPoll) return;

    const poll = () => {
      api
        .getRun(run.id)
        .then((updated) => setRun(updated))
        .catch(() => {
          // Ignore transient poll errors; the active action will surface failures.
        });
    };

    poll();
    const intervalId = window.setInterval(poll, 2000);
    return () => window.clearInterval(intervalId);
  }, [run?.id, run?.status, run?.workflow_phase, implementing, applyingRevision]);

  useEffect(() => {
    if (!run || !selectedFile) return;
    const match = run.changed_files.find((file) => file.path === selectedFile.path);
    if (!match) {
      setSelectedFile(null);
      return;
    }
    if (match.action !== selectedFile.action) {
      setSelectedFile({ path: match.path, action: match.action });
    }
  }, [run, selectedFile?.path, selectedFile?.action]);

  useEffect(() => {
    if (!preparing) {
      setPrepareStep(0);
      return;
    }

    setPrepareStep(0);
    const timers = [
      setTimeout(() => setPrepareStep(1), 1200),
      setTimeout(() => setPrepareStep(2), 2800),
    ];
    return () => timers.forEach(clearTimeout);
  }, [preparing]);

  useEffect(() => {
    if (!run || prepareStarted.current) return;

    const needsPrepare =
      run.workflow_phase === "estimation" &&
      (!run.estimation_prepared || !resolveDraftComment(run));

    if (!needsPrepare) return;

    prepareStarted.current = true;
    setPreparing(true);
    api
      .prepareEstimation(run.id)
      .then((updated) => {
        setPrepareStep(PREPARE_STEPS.length);
        setTimeout(() => {
          setRun(updated);
          applyRunDrafts(updated);
          setPreparing(false);
        }, 600);
      })
      .catch((err) => {
        setPreparing(false);
        handleAuthError(err);
      });
  }, [run, handleAuthError, applyRunDrafts]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      navigate("/login");
    }
  };

  const handlePostEstimation = async () => {
    if (!run) return;
    const commentToPost = commentForDisplay.trim();
    const parsedHours = parseFloat(hours);
    if (!commentToPost || !parsedHours || parsedHours <= 0) {
      setError("Enter a valid comment and estimation hours");
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const updated = await api.postEstimation(run.id, commentToPost, parsedHours);
      setRun(updated);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setPosting(false);
    }
  };

  const handleRequestInfo = async () => {
    if (!run || !question.trim()) {
      setError("Enter a clarification question");
      return;
    }
    setRequestingInfo(true);
    setError(null);
    try {
      const updated = await api.requestInfo(run.id, question.trim());
      setRun(updated);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setRequestingInfo(false);
    }
  };

  const handleStartImplementation = async () => {
    if (!run) return;
    setImplementing(true);
    setError(null);
    try {
      const updated = await api.startImplementation(run.id);
      setRun(updated);
    } catch (err) {
      handleAuthError(err);
      try {
        const refreshed = await api.getRun(run.id);
        setRun(refreshed);
      } catch {
        // Keep the surfaced API error if refresh fails.
      }
    } finally {
      setImplementing(false);
    }
  };

  const handleMergeBeta = async () => {
    if (!run) return;
    setMergingBeta(true);
    setError(null);
    try {
      const updated = await api.mergeBetaRun(run.id);
      setRun(updated);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setMergingBeta(false);
    }
  };

  const handleMergeMaster = async () => {
    if (!run) return;
    setMergingMaster(true);
    setError(null);
    try {
      const updated = await api.mergeMasterRun(run.id);
      setRun(updated);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setMergingMaster(false);
    }
  };

  const handleApplyRevision = async () => {
    if (!run || !revisionPrompt.trim()) return;
    setApplyingRevision(true);
    setError(null);
    const prompt = revisionPrompt.trim();
    try {
      const updated = await api.applyRevision(run.id, prompt);
      setRun(updated);
      setRevisionPrompt("");
      if (updated.workflow_phase === "ready_for_implementation") {
        setRevisionPrompt("");
        setSelectedFile(null);
        applyRunDrafts(updated);
      } else if (updated.workflow_phase === "estimation") {
        prepareStarted.current = false;
        commentEdited.current = false;
        hoursEdited.current = false;
        setComment("");
        setHours("");
        applyRunDrafts(updated);
      }
    } catch (err) {
      handleAuthError(err);
      try {
        const refreshed = await api.getRun(run.id);
        setRun(refreshed);
      } catch {
        // Keep the surfaced API error if refresh fails.
      }
    } finally {
      setApplyingRevision(false);
    }
  };

  const handleDeclinePr = async () => {
    if (!run) return;
    const branchLabel = run.branch_name ? ` on \`${run.branch_name}\`` : "";
    const confirmed = window.confirm(
      "Restart development" + branchLabel + "? " +
        "The same feature branch will be reused. New code will be generated and new pull requests opened.",
    );
    if (!confirmed) return;

    setDecliningPr(true);
    setError(null);
    try {
      const updated = await api.declinePr(run.id, declineReason.trim());
      setRun(updated);
      setDeclineReason("");
      setRevisionPrompt("");
      setSelectedFile(null);
      applyRunDrafts(updated);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setDecliningPr(false);
    }
  };

  const merging = mergingBeta || mergingMaster;

  const phase = run?.workflow_phase ?? "estimation";
  const estimationPosted = ["ready_for_implementation", "implementation", "pr_review", "completed"].includes(phase);
  const prReviewReady = phase === "pr_review" || run?.status === "awaiting_approval";
  const verificationDone = phase === "completed" && run?.status === "completed";
  const implementationRunning =
    run?.status === "running" ||
    (phase === "implementation" && run?.status !== "failed");
  const revisionRunning =
    applyingRevision || (phase === "pr_review" && run?.status === "running");
  const resolvedComment = run ? resolveDraftComment(run) : "";
  const commentForDisplay = comment.trim() || resolvedComment;

  const completedPhases: string[] = [];
  if (estimationPosted) completedPhases.push("estimation");
  if (prReviewReady || verificationDone) completedPhases.push("implementation");
  if (verificationDone) completedPhases.push("pr_review");

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link to="/dashboard" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
            ← Back to tickets
          </Link>
        </div>

        {loading && (
          <div className="card p-12 text-center text-slate-500">Loading delivery workflow…</div>
        )}

        {!loading && run && (
          <>
            <div className="card mb-6">
              <div className="px-6 py-5 border-b border-slate-100">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                      Delivery workflow
                    </p>
                    <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                      <span className="font-mono text-brand-600">{run.jira_issue_key}</span>
                      <span className="text-slate-400 mx-2">·</span>
                      {run.summary}
                    </h1>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {run.jira_status && (
                      <span className="badge-info">Jira: {run.jira_status}</span>
                    )}
                    <span className="badge-neutral">{run.workflow_phase_label}</span>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 flex flex-col sm:flex-row gap-4 sm:gap-8 border-b border-slate-100 bg-slate-50/50">
                <StepIndicator
                  number={1}
                  label="Estimation"
                  status={phaseStatus(phase, "estimation", completedPhases)}
                />
                <StepIndicator
                  number={2}
                  label="Implementation"
                  status={
                    prReviewReady || verificationDone
                      ? "completed"
                      : implementationRunning
                        ? "active"
                        : estimationPosted
                          ? "active"
                          : "pending"
                  }
                />
                <StepIndicator
                  number={3}
                  label="Pull request"
                  status={
                    verificationDone
                      ? "completed"
                      : prReviewReady
                        ? "active"
                        : "pending"
                  }
                />
                <StepIndicator
                  number={4}
                  label="Verification"
                  status={
                    verificationDone ? "completed" : merging ? "active" : "pending"
                  }
                />
              </div>
            </div>

            {apiOutdated && (
              <div className="alert-error mb-4">
                Backend API is out of date (estimation endpoints missing). Restart the dev backend with{" "}
                <code className="font-mono text-sm">docker compose -f docker-compose.dev.yml up --build backend</code>
                {" "}or run <code className="font-mono text-sm">./dev.sh</code>.
              </div>
            )}

            {error && <div className="alert-error mb-4">{error}</div>}
            {run.error_message && <div className="alert-error mb-4">{run.error_message}</div>}
            {run.workflow_notice && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 mb-4">
                <p className="font-medium">
                  {run.workflow_phase === "ready_for_implementation"
                    ? "Ready to redevelop"
                    : "Delivery restarted"}
                </p>
                <p className="mt-1">{run.workflow_notice}</p>
                {run.branch_name && run.workflow_phase === "ready_for_implementation" && (
                  <p className="mt-2 text-xs text-amber-800">
                    Branch:{" "}
                    <BranchNameLink
                      branchName={run.branch_name}
                      developmentUrl={run.jira_development_url}
                    />
                  </p>
                )}
              </div>
            )}

            {/* Step 1: Estimation */}
            <section className="card mb-6">
              <div className="card-header">
                <h2 className="card-title">Step 1 — Estimation</h2>
                <p className="card-subtitle">
                  AI generates the Jira comment below — edit it if needed, then post
                </p>
              </div>
              <div className="p-6 space-y-5">
                {preparing && <EstimationPreparingLoader activeStep={prepareStep} />}

                {!preparing && (phase === "estimation" || phase === "waiting_for_info") && !estimationPosted && (
                  <>
                    {run.needs_clarification && phase === "estimation" && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <p className="text-sm font-medium text-amber-900 mb-2">
                          This ticket may need clarification before estimation
                        </p>
                        <label className="label mb-1.5" htmlFor="question">
                          Question to post in Jira
                        </label>
                        <textarea
                          id="question"
                          className="input min-h-[100px] resize-y"
                          value={question}
                          onChange={(e) => {
                            questionEdited.current = true;
                            setQuestion(e.target.value);
                          }}
                          placeholder="What information is missing from this ticket?"
                        />
                        <button
                          onClick={handleRequestInfo}
                          disabled={requestingInfo}
                          className="btn-secondary mt-3"
                        >
                          {requestingInfo ? "Posting…" : "Post question & set Waiting For Info"}
                        </button>
                      </div>
                    )}

                    <div>
                      <label className="label mb-1.5" htmlFor="hours">
                        Original estimate (hours)
                      </label>
                      <input
                        id="hours"
                        type="number"
                        min="0.5"
                        step="0.5"
                        className="input max-w-[160px]"
                        value={hours}
                        onChange={(e) => {
                          hoursEdited.current = true;
                          setHours(e.target.value);
                        }}
                      />
                      {run.estimation_summary && (
                        <p className="text-xs text-slate-500 mt-2">{run.estimation_summary}</p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <label className="label" htmlFor="comment">
                          Jira comment
                        </label>
                        {commentForDisplay && (
                          <span className="text-xs text-brand-600 font-medium">AI-generated — editable</span>
                        )}
                      </div>
                      <textarea
                        id="comment"
                        className="input min-h-[200px] resize-y text-sm leading-relaxed"
                        value={commentForDisplay}
                        placeholder="AI comment will appear here for you to review and edit"
                        onChange={(e) => {
                          commentEdited.current = true;
                          setComment(e.target.value);
                        }}
                      />
                    </div>

                    <button
                      onClick={handlePostEstimation}
                      disabled={posting || !commentForDisplay.trim()}
                      className="btn-primary"
                    >
                      {posting ? "Posting to Jira…" : "Post estimation to Jira"}
                    </button>
                  </>
                )}

                {phase === "waiting_for_info" && estimationPosted === false && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 mb-4">
                    <p className="font-medium mb-1">Waiting for info</p>
                    <p>
                      A clarification question may have been posted. You can still post an
                      estimation below when the ticket is ready.
                    </p>
                  </div>
                )}

                {estimationPosted && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="font-medium">Estimation posted</p>
                    <p className="mt-1">
                      {run.estimation_hours}h — status updated to Estimation Complete in Jira.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Step 2: Start implementation */}
            {(estimationPosted || phase === "waiting_for_info") && !prReviewReady && !verificationDone && (
              <section className="card mb-6">
                <div className="card-header">
                  <h2 className="card-title">Step 2 — Start implementation</h2>
                  <p className="card-subtitle">
                    Writes Impact Analysis, moves to In Progress, creates a branch from Master,
                    runs Cursor SDK development, then opens Beta and Master pull requests
                  </p>
                </div>
                <div className="p-6 space-y-5">
                  {implementing || implementationRunning ? (
                    <>
                      <div className="flex items-center gap-3 text-sm text-slate-600">
                        <span className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin" />
                        <div>
                          <p className="font-medium">Implementation in progress…</p>
                          <p className="text-slate-500 mt-0.5">
                            Branch creation, Cursor SDK development, and PR setup
                          </p>
                        </div>
                      </div>
                      {run && <ImplementationStepsList run={run} />}
                    </>
                  ) : (
                    <button onClick={handleStartImplementation} className="btn-primary">
                      Start implementation
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* Step 3: PR review & approval */}
            {prReviewReady && !verificationDone && (
              <section className="card mb-6">
                <div className="card-header">
                  <h2 className="card-title">Step 3 — Review pull requests</h2>
                  <p className="card-subtitle">
                    Review the changes and changed files below, then approve to merge PRs and verify websites
                  </p>
                </div>
                <div className="p-6 space-y-5">
                  <div className="grid sm:grid-cols-2 gap-4">
                    {run.branch_name && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <p className="text-xs text-slate-500 mb-1">Feature branch (from Master)</p>
                        <BranchNameLink
                          branchName={run.branch_name}
                          developmentUrl={run.jira_development_url}
                        />
                        {run.jira_development_url && (
                          <p className="text-xs text-slate-500 mt-2">
                            Opens Jira Development — view commits and pull requests linked to this
                            ticket.
                          </p>
                        )}
                      </div>
                    )}
                    {(run.beta_pr_url || run.pr_url) && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <p className="text-xs text-slate-500 mb-1">Beta pull request</p>
                        <a
                          href={run.beta_pr_url || run.pr_url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-brand-600 hover:text-brand-700 break-all"
                        >
                          {run.beta_pr_url || run.pr_url}
                        </a>
                      </div>
                    )}
                    {run.master_pr_url && (
                      <div className="rounded-xl border border-slate-200 p-4 sm:col-span-2">
                        <p className="text-xs text-slate-500 mb-1">Live (Master) pull request</p>
                        <a
                          href={run.master_pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-brand-600 hover:text-brand-700 break-all"
                        >
                          {run.master_pr_url}
                        </a>
                      </div>
                    )}
                  </div>

                  {(run.beta_merged || run.master_merged) && (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {(run.beta_pr_id || run.pr_id) && (
                        <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm flex items-center justify-between gap-3">
                          <span className="font-medium text-slate-800">Beta</span>
                          <span className={run.beta_merged ? "badge-success" : "badge-neutral"}>
                            {run.beta_merged ? "Merged" : "Pending merge"}
                          </span>
                        </div>
                      )}
                      {run.master_pr_id && (
                        <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm flex items-center justify-between gap-3">
                          <span className="font-medium text-slate-800">Live</span>
                          <span className={run.master_merged ? "badge-success" : "badge-neutral"}>
                            {run.master_merged ? "Merged" : "Pending merge"}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {(run.verifications ?? []).length > 0 && !verificationDone && (
                    <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                      {(run.verifications ?? []).map((item) => (
                        <li key={item.environment} className="px-4 py-3 text-sm">
                          <div className="flex items-center justify-between gap-3 mb-1">
                            <span className="font-medium text-slate-800">{item.environment}</span>
                            <span className={item.passed ? "badge-success" : "badge-neutral"}>
                              {item.passed ? "Verified" : "Needs review"}
                            </span>
                          </div>
                          <p className="text-slate-600 break-all">{item.url}</p>
                          <p className="text-slate-700 mt-1">{item.summary}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <RevisionHistory stepsLog={run.steps_log} />

                  {run.changed_files.length > 0 && (
                    <div key={run.changed_files_refreshed_at ?? run.updated_at}>
                      <h3 className="text-sm font-semibold text-slate-800 mb-2">
                        Changed files ({run.changed_files.length})
                      </h3>
                      <p className="text-xs text-slate-500 mb-3">
                        Click a file to review its diff before merging.
                      </p>
                      <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden max-h-64 overflow-y-auto">
                        {run.changed_files.map((file) => {
                          const isSelected = selectedFile?.path === file.path;
                          return (
                            <li key={file.path}>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedFile(
                                    isSelected ? null : { path: file.path, action: file.action },
                                  )
                                }
                                className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-sm text-left transition-colors ${
                                  isSelected
                                    ? "bg-brand-50 text-brand-900"
                                    : "hover:bg-slate-50 text-slate-800"
                                }`}
                              >
                                <span className="font-mono truncate">{file.path}</span>
                                <span className="badge-neutral flex-shrink-0">{file.action}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {selectedFile && (
                    <FileDiffViewer
                      runId={run.id}
                      filePath={selectedFile.path}
                      action={selectedFile.action}
                      refreshKey={run.changed_files_refreshed_at ?? run.updated_at}
                      onClose={() => setSelectedFile(null)}
                    />
                  )}

                  {(run.status === "awaiting_approval" || revisionRunning) && (
                    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4 space-y-3">
                      <div>
                        <label className="label mb-1.5" htmlFor="revision-prompt">
                          Request additional changes
                        </label>
                        <p className="text-xs text-slate-500 mb-2">
                          Describe what to change in the generated code. A new commit will be pushed
                          to the feature branch and appear on the existing pull requests.
                        </p>
                        <textarea
                          id="revision-prompt"
                          className="input min-h-[120px] resize-y text-sm leading-relaxed"
                          value={revisionPrompt}
                          onChange={(e) => setRevisionPrompt(e.target.value)}
                          placeholder="e.g. Add error handling to the login form and update the button label to 'Sign in'"
                          disabled={revisionRunning || merging}
                        />
                      </div>
                      {revisionRunning && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 text-sm text-slate-600">
                            <span className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin" />
                            <div>
                              <p className="font-medium">Applying changes to branch…</p>
                              <p className="text-slate-500 mt-0.5">
                                Progress updates while commits are generated and pushed
                              </p>
                            </div>
                          </div>
                          <RevisionStepsList run={run} active />
                        </div>
                      )}
                      <button
                        onClick={handleApplyRevision}
                        disabled={revisionRunning || merging || !revisionPrompt.trim()}
                        className="btn-primary"
                      >
                        {revisionRunning ? "Applying changes…" : "Apply changes to branch"}
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {(run.beta_pr_url || run.pr_url) && (
                      <a
                        href={run.beta_pr_url || run.pr_url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary"
                      >
                        View Beta PR
                      </a>
                    )}
                    {run.master_pr_url && (
                      <a
                        href={run.master_pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary"
                      >
                        View Live PR
                      </a>
                    )}
                    {run.status === "awaiting_approval" && (run.beta_pr_id || run.pr_id) && !run.beta_merged && (
                      <button
                        onClick={handleMergeBeta}
                        disabled={merging || decliningPr || revisionRunning}
                        className="btn-success"
                      >
                        {mergingBeta ? "Merging Beta…" : "Merge Beta PR"}
                      </button>
                    )}
                    {run.status === "awaiting_approval" && run.master_pr_id && !run.master_merged && (
                      <button
                        onClick={handleMergeMaster}
                        disabled={merging || decliningPr || revisionRunning}
                        className="btn-success"
                      >
                        {mergingMaster ? "Merging Live…" : "Merge Live PR"}
                      </button>
                    )}
                    {run.status === "awaiting_approval" && (
                      <button
                        onClick={handleDeclinePr}
                        disabled={merging || applyingRevision || decliningPr || revisionRunning}
                        className="btn-secondary text-red-700 border-red-200 hover:bg-red-50"
                      >
                        {decliningPr ? "Restarting…" : "Restart development"}
                      </button>
                    )}
                  </div>

                  {run.status === "awaiting_approval" && (
                    <div className="rounded-xl border border-red-100 bg-red-50/40 p-4 space-y-3">
                      <div>
                        <label className="label mb-1.5 text-red-900" htmlFor="decline-reason">
                          Restart notes (optional)
                        </label>
                        <p className="text-xs text-slate-500 mb-2">
                          If the pull request was closed or the code needs rework, restart development
                          on the same branch{run.branch_name ? ` (${run.branch_name})` : ""}. Click
                          Start implementation again to regenerate code and open new PRs.
                        </p>
                        <textarea
                          id="decline-reason"
                          className="input min-h-[80px] resize-y text-sm leading-relaxed"
                          value={declineReason}
                          onChange={(e) => setDeclineReason(e.target.value)}
                          placeholder="Why are you declining? This is posted to Bitbucket and Jira."
                          disabled={decliningPr || merging || applyingRevision || revisionRunning}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Step 4: Website verification */}
            {verificationDone && (
              <section className="card mb-6">
                <div className="card-header">
                  <h2 className="card-title">Step 4 — Website verification</h2>
                  <p className="card-subtitle">
                    Beta and Master websites verified with screenshots attached in Jira
                  </p>
                </div>
                <div className="p-6 space-y-5">
                  {(run.verifications ?? []).length > 0 ? (
                    <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                      {(run.verifications ?? []).map((item) => (
                        <li key={item.environment} className="px-4 py-3 text-sm">
                          <div className="flex items-center justify-between gap-3 mb-1">
                            <span className="font-medium text-slate-800">{item.environment}</span>
                            <span className={item.passed ? "badge-success" : "badge-neutral"}>
                              {item.passed ? "Passed" : "Needs review"}
                            </span>
                          </div>
                          <p className="text-slate-600 break-all">{item.url}</p>
                          <p className="text-slate-700 mt-1">{item.summary}</p>
                          {item.screenshot_filename && (
                            <p className="text-xs text-slate-500 mt-1">
                              Screenshot attached in Jira: {item.screenshot_filename}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">No verification results recorded.</p>
                  )}

                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="font-medium">Delivery complete</p>
                    <p className="mt-1">Pull requests merged and websites verified.</p>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
