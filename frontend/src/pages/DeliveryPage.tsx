import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, DeliveryRun, User } from "../api/client";
import ChangedFilesSection from "../components/ChangedFilesSection";
import CollapsedStepCard from "../components/CollapsedStepCard";
import ConfirmModal from "../components/ConfirmModal";
import DeliveryActionBar from "../components/DeliveryActionBar";
import { ErrorBanner, SuccessBanner } from "../components/FeedbackBanner";
import FileDiffViewer from "../components/FileDiffViewer";
import JiraCommentCard from "../components/JiraCommentCard";
import LinkifiedText from "../components/LinkifiedText";
import Layout from "../components/Layout";
import PipelineStepper from "../components/PipelineStepper";
import PullRequestDetailsCard from "../components/PullRequestDetailsCard";
import { TerminalLine } from "../components/DeploymentTerminal";
import VerificationPanel from "../components/VerificationPanel";
import { useToast } from "../context/ToastContext";

function phaseStatus(
  phase: string,
  target: string,
  completedPhases: string[],
): "completed" | "active" | "pending" {
  if (completedPhases.includes(target)) return "completed";
  if (phase === target) return "active";
  return "pending";
}

function implementationSummary(run: DeliveryRun): string {
  const parts: string[] = [];
  if (run.branch_name) parts.push("Branch created");
  if (run.beta_pr_url || run.pr_url || run.master_pr_url) parts.push("PR opened");
  return parts.length > 0 ? parts.join(" · ") : "Completed";
}

function toTerminalLines(items: MergeProgressItem[]): TerminalLine[] {
  return items.map((item) => ({
    id: item.id,
    text: item.detail ? `${item.label} — ${item.detail}` : item.label,
    status:
      item.status === "done"
        ? "done"
        : item.status === "failed"
          ? "failed"
          : item.status === "active"
            ? "active"
            : item.status === "skipped"
              ? "skipped"
              : "pending",
    nested: item.nested,
  }));
}

function LockIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function RefreshIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function ChevronLeftIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function BackToTicketsLink() {
  return (
    <Link
      to="/dashboard"
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-gray-100 transition-colors flex-shrink-0"
    >
      <ChevronLeftIcon className="h-4 w-4 text-slate-500" />
      <span>Tickets</span>
    </Link>
  );
}

function JiraTicketContent({ run }: { run: DeliveryRun }) {
  return (
    <div className="space-y-6">
      {run.jira_issue_url && (
        <a
          href={run.jira_issue_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          Open in Jira →
        </a>
      )}
      {run.description && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200/80 pb-2 mb-3">
            Description
          </h3>
          <p className="text-slate-700 leading-relaxed whitespace-pre-wrap break-words max-w-prose">
            <LinkifiedText text={run.description} />
          </p>
        </div>
      )}
      {run.jira_comments.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200/80 pb-2 mb-4">
            Comments ({run.jira_comments.length})
          </h3>
          <div>
            {run.jira_comments.map((jiraComment, index) => (
              <JiraCommentCard key={`${jiraComment.created}-${index}`} comment={jiraComment} />
            ))}
          </div>
        </div>
      )}
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
                ? "bg-white border border-brand-200"
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

function isJiraWaitingForInfo(status: string | null | undefined): boolean {
  if (!status) return false;
  const lowered = status.toLowerCase().replace(/-/g, " ");
  return lowered.includes("waiting") && lowered.includes("info");
}

const PREPARE_STEPS = [
  { id: "fetch", label: "Loading ticket details from Jira" },
  { id: "status", label: "Updating Jira status to In Estimation" },
  { id: "ai", label: "AI is generating estimation, development plan, and test cases" },
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
  { id: "repo_stack", label: "Detect repository stack" },
  { id: "cursor_development", label: "Develop with Cursor SDK" },
  { id: "commit_changes", label: "Commit changes to branch" },
  { id: "create_pr_beta", label: "Open Staging pull request" },
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
                ? "bg-white border border-brand-200"
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

type MergeProgressStatus = "done" | "active" | "pending" | "failed" | "skipped";

interface MergeProgressItem {
  id: string;
  label: string;
  detail?: string;
  status: MergeProgressStatus;
  nested?: boolean;
}

function latestStepEntry(stepsLog: DeliveryRun["steps_log"], stepId: string) {
  const entries = stepsLog.filter((s) => s.step === stepId);
  return entries[entries.length - 1];
}

function stepLogStatus(stepsLog: DeliveryRun["steps_log"], stepId: string): MergeProgressStatus {
  const entry = latestStepEntry(stepsLog, stepId);
  if (!entry) return "pending";
  if (entry.status === "failed") return "failed";
  if (entry.status === "completed") return "done";
  if (entry.status === "skipped") return "skipped";
  if (entry.status === "running") return "active";
  return "pending";
}

function deployCommandItems(
  stepsLog: DeliveryRun["steps_log"],
  deployStep: "deploy_beta" | "deploy_master",
  plannedCommands: string[] = [],
): MergeProgressItem[] {
  const prefix = `${deployStep}_cmd_`;
  const deployStatus = stepLogStatus(stepsLog, deployStep);
  const isRunning = deployStatus === "active";

  if (!isRunning && plannedCommands.length > 0) {
    const total = plannedCommands.length;
    return plannedCommands.map((command, index) => {
      const stepId = `${prefix}${index}`;
      const runningEntry = stepsLog.find((s) => s.step === stepId && s.status === "running");
      const latest = latestStepEntry(stepsLog, stepId);
      const status = runningEntry ? "active" : latest ? stepLogStatus(stepsLog, stepId) : "pending";
      return {
        id: stepId,
        label: runningEntry?.message || latest?.message || `(${index + 1}/${total}) ${command}`,
        status,
        nested: true,
      };
    });
  }

  const indices = [
    ...new Set(
      stepsLog
        .filter((s) => s.step.startsWith(prefix))
        .map((s) => Number.parseInt(s.step.slice(prefix.length), 10))
        .filter((n) => !Number.isNaN(n)),
    ),
  ].sort((a, b) => a - b);

  return indices.map((index) => {
    const stepId = `${prefix}${index}`;
    const runningEntry = stepsLog.find((s) => s.step === stepId && s.status === "running");
    const status = stepLogStatus(stepsLog, stepId);
    const latest = latestStepEntry(stepsLog, stepId);
    return {
      id: stepId,
      label: runningEntry?.message || latest?.message || `Command ${index + 1}`,
      status,
      nested: true,
    };
  });
}

function buildMergeProgressItems(
  run: DeliveryRun,
  mergingTarget: "beta" | "master" | null,
  deployOnly = false,
): MergeProgressItem[] {
  const { steps_log: stepsLog, unified_deploy_target: unified } = run;
  const items: MergeProgressItem[] = [];

  const addStep = (id: string, label: string) => {
    const entry = latestStepEntry(stepsLog, id);
    const status = stepLogStatus(stepsLog, id);
    items.push({
      id,
      label,
      status,
      detail: status === "failed" && entry?.message ? entry.message : undefined,
    });
  };

  const addDeployGroup = (deployStep: "deploy_beta" | "deploy_master", label: string) => {
    const deployStatus = stepLogStatus(stepsLog, deployStep);
    const deployEntry = latestStepEntry(stepsLog, deployStep);
    const plannedCommands =
      deployStep === "deploy_beta" ? run.staging_deploy_commands : run.live_deploy_commands;
    const commandItems = deployCommandItems(stepsLog, deployStep, plannedCommands);
    const deployDetail =
      deployStatus === "failed" && deployEntry?.message ? deployEntry.message : undefined;
    if (commandItems.length > 0) {
      items.push({ id: deployStep, label, status: deployStatus, detail: deployDetail });
      items.push(...commandItems);
      return;
    }
    if (deployStatus !== "pending") {
      items.push({ id: deployStep, label, status: deployStatus, detail: deployDetail });
    }
  };

  if (deployOnly) {
    const retryTarget = (run.pending_deploy_retry as "beta" | "master" | null) ?? mergingTarget;
    if (retryTarget === "beta" || (!retryTarget && (run.beta_merged || run.beta_pr_id || run.pr_id))) {
      addDeployGroup("deploy_beta", "Run Staging deployment commands");
      addStep("verify_beta", "Verify Staging website");
      if (unified) {
        addDeployGroup("deploy_master", "Run Live deployment commands");
        addStep("verify_master", "Verify Live website");
      }
    } else {
      addDeployGroup("deploy_master", "Run Live deployment commands");
      addStep("verify_master", "Verify Live website");
    }
    const transitionStatus = stepLogStatus(stepsLog, "transition_in_testing");
    if (transitionStatus !== "pending") {
      addStep("transition_in_testing", "Move ticket to Unit Testing");
    }
    return items;
  }

  if (mergingTarget === "beta" || stepsLog.some((s) => s.step === "merge_beta_pr")) {
    addStep("merge_beta_pr", "Merge Staging pull request");
    addDeployGroup("deploy_beta", "Run Staging deployment commands");
    addStep("verify_beta", "Verify Staging website");
    if (unified) {
      addDeployGroup("deploy_master", "Run Live deployment commands");
      addStep("verify_master", "Verify Live website");
    }
  }

  if (mergingTarget === "master" || stepsLog.some((s) => s.step === "merge_master_pr")) {
    addStep("merge_master_pr", "Merge Live pull request");
    addDeployGroup("deploy_master", "Run Live deployment commands");
    addStep("verify_master", "Verify Live website");
  }

  const transitionStatus = stepLogStatus(stepsLog, "transition_in_testing");
  if (transitionStatus !== "pending") {
    addStep("transition_in_testing", "Move ticket to Unit Testing");
  }

  return items;
}

function getMergeFailureTarget(run: DeliveryRun): "beta" | "master" | null {
  if ((run.beta_pr_id || run.pr_id) && !run.beta_merged) {
    if (stepLogStatus(run.steps_log, "merge_beta_pr") === "failed") return "beta";
  }
  if (run.master_pr_id && !run.master_merged) {
    if (stepLogStatus(run.steps_log, "merge_master_pr") === "failed") return "master";
  }
  return null;
}

function getMergeFailureMessage(run: DeliveryRun, target: "beta" | "master"): string | null {
  const step = target === "beta" ? "merge_beta_pr" : "merge_master_pr";
  const entry = latestStepEntry(run.steps_log, step);
  if (entry?.status === "failed" && entry.message) return entry.message;
  return run.error_message;
}

function getDeploymentFailureMessage(run: DeliveryRun): string | null {
  if (!run.pending_deploy_retry) return null;
  const failedAttempt = [...(run.deployment_history ?? [])]
    .reverse()
    .find(
      (attempt) =>
        attempt.status === "failed" && attempt.environment === run.pending_deploy_retry,
    );
  if (failedAttempt?.error) return failedAttempt.error;
  const deployStep = run.pending_deploy_retry === "beta" ? "deploy_beta" : "deploy_master";
  const entry = latestStepEntry(run.steps_log, deployStep);
  if (entry?.status === "failed" && entry.message) return entry.message;
  return run.error_message;
}

function EstimationPreparingLoader({ activeStep }: { activeStep: number }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-gradient-to-b from-brand-50/80 to-white p-8">
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
                  ? "bg-white border border-brand-200"
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
  const [retryingDeployment, setRetryingDeployment] = useState(false);
  const [applyingRevision, setApplyingRevision] = useState(false);
  const [decliningPr, setDecliningPr] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState<{ path: string; action: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadingJira, setReloadingJira] = useState(false);
  const [mergeConfirmTarget, setMergeConfirmTarget] = useState<"beta" | "master" | null>(null);
  const [declineConfirmOpen, setDeclineConfirmOpen] = useState(false);
  const { toast } = useToast();

  const [comment, setComment] = useState("");
  const [hours, setHours] = useState("");
  const [question, setQuestion] = useState("");
  const prepareStarted = useRef(false);
  const lastWorkflowPhase = useRef<string | null>(null);
  const deploymentRetryRef = useRef<HTMLDivElement | null>(null);
  const scrolledToDeployment = useRef(false);
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
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    },
    [navigate, toast],
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
    }

    setLoading(!seededRun || seededRun.jira_issue_key !== issueKey);
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
      if (
        current.workflow_notice ||
        (current.workflow_phase === "estimation" && !current.estimation_prepared) ||
        (current.workflow_phase === "waiting_for_info" && !current.estimation_prepared)
      ) {
        prepareStarted.current = false;
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  }, [issueKey, handleAuthError, applyRunDrafts, location.state]);

  useEffect(() => {
    api.ensureAuth().then((data) => {
      setUser(data.user);
      setSiteName(data.site_name);
    }).catch(handleAuthError);
  }, [handleAuthError]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (!run) return;

    const waitingForDeployRetry =
      Boolean(run.pending_deploy_retry) &&
      run.status === "awaiting_approval" &&
      run.workflow_phase === "pr_review" &&
      !retryingDeployment &&
      !mergingBeta &&
      !mergingMaster;

    const shouldPoll =
      implementing ||
      applyingRevision ||
      mergingBeta ||
      mergingMaster ||
      retryingDeployment ||
      (run.status === "running" &&
        (run.workflow_phase === "implementation" || run.workflow_phase === "pr_review")) ||
      (run.status === "awaiting_approval" &&
        run.workflow_phase === "pr_review" &&
        !waitingForDeployRetry);

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
  }, [run?.id, run?.status, run?.workflow_phase, implementing, applyingRevision, mergingBeta, mergingMaster, retryingDeployment]);

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
    if (!run) return;

    const phase = run.workflow_phase;
    if (lastWorkflowPhase.current === "waiting_for_info" && phase === "estimation") {
      prepareStarted.current = false;
      commentEdited.current = false;
      hoursEdited.current = false;
    }
    lastWorkflowPhase.current = phase;
  }, [run?.workflow_phase]);

  useEffect(() => {
    scrolledToDeployment.current = false;
  }, [run?.id]);

  useEffect(() => {
    if (!run || loading) return;
    const mergeFailed = getMergeFailureTarget(run);
    const deployFailed = Boolean(run.pending_deploy_retry) && !mergeFailed;
    const deployOnly =
      deployFailed && Boolean(run.beta_merged || run.master_merged);
    if (!deployOnly || scrolledToDeployment.current) return;
    const timer = window.setTimeout(() => {
      deploymentRetryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      scrolledToDeployment.current = true;
    }, 150);
    return () => window.clearTimeout(timer);
  }, [run, loading]);

  useEffect(() => {
    if (!run || prepareStarted.current) return;

    const inPrReview =
      run.workflow_phase === "pr_review" ||
      run.status === "awaiting_approval" ||
      Boolean(run.pending_deploy_retry) ||
      run.beta_merged ||
      run.master_merged ||
      Boolean(run.beta_pr_id || run.pr_id || run.master_pr_url || run.pr_url);

    const needsPrepare =
      !inPrReview &&
      (((!run.estimation_prepared || !resolveDraftComment(run)) &&
        run.workflow_phase === "estimation" &&
        !isJiraWaitingForInfo(run.jira_status)) ||
        (run.workflow_phase === "waiting_for_info" &&
          !!run.workflow_notice &&
          !run.estimation_prepared));

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
        prepareStarted.current = false;
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

  const handleReloadJira = async () => {
    if (!run) return;
    setReloadingJira(true);
    setError(null);
    try {
      const updated = await api.reloadJira(run.id);
      setRun(updated);
      if (
        updated.workflow_notice ||
        (updated.workflow_phase === "estimation" && !updated.estimation_prepared) ||
        (updated.workflow_phase === "waiting_for_info" && !updated.estimation_prepared)
      ) {
        prepareStarted.current = false;
        commentEdited.current = false;
        hoursEdited.current = false;
        applyRunDrafts(updated);
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      setReloadingJira(false);
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
      if (updated.error_message) {
        setError(updated.error_message);
        toast(updated.error_message, "error");
      } else {
        toast("Pull request merged — deployment started.", "success");
      }
    } catch (err) {
      handleAuthError(err);
      try {
        const refreshed = await api.getRun(run.id);
        setRun(refreshed);
        if (refreshed.error_message) {
          setError(refreshed.error_message);
        }
      } catch {
        // Keep the surfaced API error if refresh fails.
      }
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
      if (updated.error_message) {
        setError(updated.error_message);
        toast(updated.error_message, "error");
      } else {
        toast("Live pull request merged — deployment started.", "success");
      }
    } catch (err) {
      handleAuthError(err);
      try {
        const refreshed = await api.getRun(run.id);
        setRun(refreshed);
        if (refreshed.error_message) {
          setError(refreshed.error_message);
        }
      } catch {
        // Keep the surfaced API error if refresh fails.
      }
    } finally {
      setMergingMaster(false);
    }
  };

  const handleRetryDeployment = async () => {
    if (!run || !run.pending_deploy_retry) return;
    setRetryingDeployment(true);
    setError(null);
    const target = run.pending_deploy_retry as "beta" | "master";
    try {
      const updated = await api.retryDeploymentRun(run.id, target);
      setRun(updated);
      if (updated.error_message) {
        setError(updated.error_message);
      }
    } catch (err) {
      handleAuthError(err);
      try {
        const refreshed = await api.getRun(run.id);
        setRun(refreshed);
        if (refreshed.error_message) {
          setError(refreshed.error_message);
        }
      } catch {
        // Keep the surfaced API error if refresh fails.
      }
    } finally {
      setRetryingDeployment(false);
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
      setDeclineConfirmOpen(false);
    }
  };

  const merging = mergingBeta || mergingMaster || retryingDeployment;
  const mergingTarget: "beta" | "master" | null = mergingBeta
    ? "beta"
    : mergingMaster
      ? "master"
      : retryingDeployment && run?.pending_deploy_retry
        ? (run.pending_deploy_retry as "beta" | "master")
        : null;
  const mergeFailedTarget = run ? getMergeFailureTarget(run) : null;
  const deploymentFailed = Boolean(run?.pending_deploy_retry) && !mergeFailedTarget;
  const deploymentErrorMessage = run && deploymentFailed ? getDeploymentFailureMessage(run) : null;
  const deployOnlyMode =
    deploymentFailed && Boolean(run?.beta_merged || run?.master_merged);
  const mergeErrorMessage =
    run && mergeFailedTarget ? getMergeFailureMessage(run, mergeFailedTarget) : null;
  const phase = run?.workflow_phase ?? "estimation";
  const hasOpenPrs = Boolean(
    run?.beta_pr_id || run?.pr_id || run?.beta_pr_url || run?.pr_url || run?.master_pr_id || run?.master_pr_url,
  );
  const hasPostMergeWork = Boolean(
    run?.pending_deploy_retry || run?.beta_merged || run?.master_merged,
  );
  const estimationPosted = ["ready_for_implementation", "implementation", "pr_review", "completed"].includes(phase);
  const prReviewReady =
    phase === "pr_review" ||
    run?.status === "awaiting_approval" ||
    hasOpenPrs ||
    hasPostMergeWork;
  const mergeInProgress =
    merging ||
    retryingDeployment ||
    (run?.status === "running" &&
      phase === "pr_review" &&
      prReviewReady &&
      !deploymentFailed);
  const showMergeProgress =
    mergeInProgress ||
    deploymentFailed ||
    Boolean(mergeFailedTarget) ||
    (run?.steps_log ?? []).some((entry) =>
      ["merge_beta_pr", "merge_master_pr", "deploy_beta", "deploy_master"].includes(entry.step),
    );
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
  if (verificationDone || deployOnlyMode) completedPhases.push("pr_review");

  const step1Status = phaseStatus(phase, "estimation", completedPhases);
  const step2Status =
    prReviewReady || verificationDone
      ? "completed"
      : implementationRunning || phase === "implementation"
        ? "active"
        : estimationPosted
          ? "active"
          : "pending";
  const verificationInProgress =
    merging ||
    retryingDeployment ||
    deployOnlyMode ||
    ((run?.verifications ?? []).length > 0 && !verificationDone) ||
    (run?.status === "running" && phase === "pr_review" && showMergeProgress);

  const step3Status =
    verificationDone || verificationInProgress
      ? "completed"
      : prReviewReady
        ? "active"
        : "pending";

  const step4Status = verificationDone
    ? "completed"
    : verificationInProgress
      ? "active"
      : "pending";

  const confirmMerge = () => {
    setMergeConfirmTarget(null);
    if (mergeConfirmTarget === "beta") void handleMergeBeta();
    else if (mergeConfirmTarget === "master") void handleMergeMaster();
  };

  const mergeProgressItems = run
    ? buildMergeProgressItems(run, mergingTarget, deployOnlyMode)
    : [];
  const terminalLines = toTerminalLines(
    showMergeProgress ? mergeProgressItems : [],
  );
  const showActionBar = Boolean(run && prReviewReady && !verificationDone);
  const actionDisabled = merging || decliningPr || revisionRunning;

  const completedStepCount = run
    ? [step1Status, step2Status, step3Status, step4Status].filter((s) => s === "completed").length
    : 0;
  const progressPercent = (completedStepCount / 4) * 100;

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <div className={`w-full px-4 sm:px-6 lg:px-8 py-6 ${showActionBar ? "pb-28" : ""}`}>
        <div className="sticky top-16 z-40 -mx-4 sm:-mx-6 lg:-mx-8 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm mb-6">
          <div className="px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <BackToTicketsLink />
              {!loading && run ? (
                <>
                  <div className="hidden sm:block w-px h-8 bg-gray-200 flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-brand-600">{run.jira_issue_key}</span>
                      {run.jira_status && (
                        <span className="inline-flex items-center rounded-full bg-blue-500 px-2.5 py-0.5 text-xs font-semibold text-white">
                          {run.jira_status}
                        </span>
                      )}
                      <span className="inline-flex items-center rounded-full border border-purple-300 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                        {run.workflow_phase_label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 truncate mt-0.5">{run.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReloadJira}
                    disabled={reloadingJira || run.status === "running"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-gray-100 disabled:opacity-50 transition-colors flex-shrink-0"
                  >
                    <RefreshIcon className={`h-3.5 w-3.5 ${reloadingJira ? "animate-spin" : ""}`} />
                    {reloadingJira ? "Reloading…" : "Reload"}
                  </button>
                </>
              ) : (
                <span className="text-sm text-slate-500">{loading ? "Loading delivery…" : "Delivery"}</span>
              )}
            </div>
          </div>
          {!loading && run && (
            <div className="h-1 bg-gray-100" aria-hidden="true">
              <div
                className="h-full bg-purple-500 transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        {loading && (
          <div className="card p-8 space-y-4">
            <div className="h-6 w-48 skeleton" />
            <div className="h-4 w-full skeleton" />
            <div className="h-32 w-full skeleton rounded-xl" />
          </div>
        )}

        <ConfirmModal
          open={mergeConfirmTarget !== null}
          title="Approve and merge?"
          message="Are you sure you want to approve and merge this PR? This will deploy to the target environment and run verification."
          confirmLabel="Yes, merge"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={confirmMerge}
          onCancel={() => setMergeConfirmTarget(null)}
        />

        <ConfirmModal
          open={declineConfirmOpen}
          title="Restart development?"
          message={
            <>
              Are you sure? This closes PRs and regenerates code
              {run?.branch_name ? (
                <>
                  {" "}
                  on branch <code className="font-mono text-sm">{run.branch_name}</code>
                </>
              ) : null}
              .
            </>
          }
          confirmLabel="Restart"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => void handleDeclinePr()}
          onCancel={() => setDeclineConfirmOpen(false)}
        />

        {!loading && run && (
          <>
            <div className="card px-6 py-5 mb-6">
              <PipelineStepper
                steps={[
                  { number: 1, label: "Estimation", status: step1Status },
                  { number: 2, label: "Implementation", status: step2Status as "completed" | "active" | "pending" },
                  { number: 3, label: "Pull Request", status: step3Status as "completed" | "active" | "pending" },
                  { number: 4, label: "Verification", status: step4Status as "completed" | "active" | "pending" },
                ]}
              />
            </div>

            {(run.description || run.jira_comments.length > 0) && (
              prReviewReady ? (
                <div className="flex flex-col gap-3 mb-6">
                  <CollapsedStepCard
                    title="Jira ticket"
                    summary={`${run.jira_comments.length} comment${run.jira_comments.length === 1 ? "" : "s"} · synced from Jira`}
                  >
                    <JiraTicketContent run={run} />
                  </CollapsedStepCard>
                </div>
              ) : (
                <section className="card mb-6">
                  <div className="card-header">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="card-title">Jira ticket</h2>
                        {run.jira_synced_at && (
                          <p className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                            <RefreshIcon className="h-3 w-3" />
                            Synced {new Date(run.jira_synced_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                      {run.jira_issue_url && (
                        <a
                          href={run.jira_issue_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-brand-600 hover:text-brand-700"
                        >
                          Open in Jira →
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="p-6">
                    <JiraTicketContent run={run} />
                  </div>
                </section>
              )
            )}

            {apiOutdated && (
              <div className="alert-error mb-4">
                Backend API is out of date (estimation endpoints missing). Restart the dev backend with{" "}
                <code className="font-mono text-sm">docker compose -f docker-compose.dev.yml up --build backend</code>
                {" "}or run <code className="font-mono text-sm">./dev.sh</code>.
              </div>
            )}

            {error && (
              <div className="mb-4">
                <ErrorBanner message={error} />
              </div>
            )}
            {run.error_message && !error && (
              <div className="mb-4">
                <ErrorBanner message={run.error_message} />
              </div>
            )}
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
            {estimationPosted && (
              <div className="flex flex-col gap-3 mb-6">
                <CollapsedStepCard
                  title="Estimation"
                  summary={`${run.estimation_hours ?? "?"} hours estimated · Posted to Jira`}
                >
                  <SuccessBanner>
                    <p className="font-medium">Estimation posted to Jira</p>
                    <p className="mt-0.5">
                      {run.estimation_hours}h — ticket moved to Estimation Complete.
                    </p>
                  </SuccessBanner>
                </CollapsedStepCard>
              </div>
            )}

            {!estimationPosted && !prReviewReady && (
            <section className={`card mb-6 overflow-hidden border-2 ${step1Status === "active" ? "border-brand-400 shadow-brand-md" : "border-transparent"}`}>
              {step1Status === "active" && (
                <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
                  <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-700">
                    Current Step
                  </span>
                  <h2 className="text-lg font-bold text-brand-600 mt-2">Step 1 — Estimation</h2>
                </div>
              )}
              {step1Status !== "active" && (
                <div className="px-6 py-4 border-b border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white">
                  <h2 className="card-title">Step 1 — Estimation</h2>
                  <p className="card-subtitle">
                    AI generates the Jira comment below — edit if needed, then post
                  </p>
                </div>
              )}
              <div className="p-6 space-y-5">
                {preparing && <EstimationPreparingLoader activeStep={prepareStep} />}

                {!preparing &&
                  run.status === "running" &&
                  !run.estimation_prepared &&
                  (phase === "estimation" || phase === "waiting_for_info") && (
                    <EstimationPreparingLoader activeStep={1} />
                  )}

                {!preparing &&
                  (phase === "estimation" ||
                    (phase === "waiting_for_info" && run.estimation_prepared)) &&
                  !estimationPosted && (
                  <>
                    {run.needs_clarification && (
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
                      className="w-full sm:w-auto min-w-48 rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-brand hover:bg-brand-700 hover:shadow-brand-md disabled:opacity-50 disabled:pointer-events-none transition-colors"
                    >
                      {posting ? "Posting to Jira…" : "Post estimation to Jira"}
                    </button>
                    <p className="text-xs text-slate-500">
                      Posts the comment and hours estimate to Jira and moves the ticket forward.
                    </p>
                  </>
                )}

                {phase === "waiting_for_info" && !estimationPosted && !run.estimation_prepared && !preparing && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-medium mb-1">Waiting for info</p>
                    <p>
                      The ticket is waiting for information in Jira. AI estimation will be
                      generated from the latest ticket details.
                    </p>
                  </div>
                )}

                {phase === "waiting_for_info" && run.estimation_prepared && !estimationPosted && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 mb-4">
                    <p className="font-medium mb-1">Waiting for info in Jira</p>
                    <p>
                      Review the updated estimation below. Post to Jira when the ticket is ready.
                    </p>
                  </div>
                )}

              </div>
            </section>
            )}

            {/* Step 2: Implementation — collapsed when PR review ready */}
            {prReviewReady && (
              <div className="flex flex-col gap-3 mb-6">
                <CollapsedStepCard title="Implementation" summary={implementationSummary(run)}>
                  {run.branch_name && (
                    <p className="text-sm text-slate-600">
                      Branch:{" "}
                      <code className="bg-gray-800 text-green-400 rounded px-2 py-0.5 text-xs font-mono">
                        {run.branch_name}
                      </code>
                    </p>
                  )}
                  <ImplementationStepsList run={run} />
                </CollapsedStepCard>
              </div>
            )}

            {estimationPosted && !prReviewReady && !verificationDone && (
              <section className={`card mb-6 overflow-hidden border-2 ${step2Status === "active" ? "border-brand-400 shadow-brand-md" : "border-transparent"}`}>
                {step2Status === "active" && (
                  <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
                    <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-700">
                      Current Step
                    </span>
                    <h2 className="text-lg font-bold text-brand-600 mt-2">Step 2 — Implementation</h2>
                  </div>
                )}
                {step2Status !== "active" && (
                  <div className="px-6 py-4 border-b border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white">
                    <h2 className="card-title">Step 2 — Implementation</h2>
                    <p className="card-subtitle">
                      Impact analysis, branch creation, Cursor development, and pull requests
                    </p>
                  </div>
                )}
                <div className="p-6 space-y-5">
                  {implementing || implementationRunning ? (
                    <>
                      <p className="text-sm italic text-slate-500 flex items-center gap-2">
                        <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin flex-shrink-0" />
                        System is running implementation — branch creation, Cursor SDK, and PR setup…
                      </p>
                      {run && <ImplementationStepsList run={run} />}
                    </>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={handleStartImplementation}
                        className="w-full sm:w-auto min-w-48 rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-brand hover:bg-brand-700 hover:shadow-brand-md transition-colors"
                      >
                        Start implementation
                      </button>
                      <p className="text-xs text-slate-500">
                        Creates a branch, runs Cursor development, and opens pull requests.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Steps 3–4: PR review, verification, and actions */}
            {prReviewReady && !verificationDone && (
              <>
                <PullRequestDetailsCard
                  run={run}
                  stagingDeployFailed={
                    run.pending_deploy_retry === "beta" && mergeFailedTarget !== "beta"
                  }
                  liveDeployFailed={
                    run.pending_deploy_retry === "master" && mergeFailedTarget !== "master"
                  }
                  stagingMergeFailed={mergeFailedTarget === "beta"}
                  liveMergeFailed={mergeFailedTarget === "master"}
                />

                <div ref={deploymentRetryRef} className="scroll-mt-24">
                  <VerificationPanel
                    run={run}
                    isActive={step4Status === "active"}
                    deploymentFailed={deploymentFailed}
                    mergeFailedTarget={mergeFailedTarget}
                    deploymentErrorMessage={deploymentErrorMessage}
                    mergeErrorMessage={mergeErrorMessage}
                    terminalLines={terminalLines}
                    mergeInProgress={mergeInProgress}
                    retryingDeployment={retryingDeployment}
                    onRetryDeployment={handleRetryDeployment}
                    retryDisabled={actionDisabled}
                    showDeployButton={deployOnlyMode}
                    onRunDeploy={handleRetryDeployment}
                  />
                </div>

                <ChangedFilesSection
                  files={run.changed_files}
                  selectedPath={selectedFile?.path ?? null}
                  onSelect={(file) =>
                    setSelectedFile(file ? { path: file.path, action: file.action } : null)
                  }
                />

                {selectedFile && (
                  <FileDiffViewer
                    runId={run.id}
                    filePath={selectedFile.path}
                    action={selectedFile.action}
                    refreshKey={run.changed_files_refreshed_at ?? run.updated_at}
                    onClose={() => setSelectedFile(null)}
                  />
                )}

                {!deployOnlyMode && (run.status === "awaiting_approval" || revisionRunning) && (
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3 mb-6">
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

                <RevisionHistory stepsLog={run.steps_log} />

                {run.status === "awaiting_approval" && !deployOnlyMode && (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4 space-y-3 mb-6">
                    <label className="label mb-1.5" htmlFor="decline-reason">
                      Restart notes (optional)
                    </label>
                    <textarea
                      id="decline-reason"
                      className="input min-h-[80px] resize-y text-sm leading-relaxed"
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      placeholder="Why are you declining? This is posted to Bitbucket and Jira."
                      disabled={decliningPr || merging || applyingRevision || revisionRunning}
                    />
                  </div>
                )}

                <DeliveryActionBar
                  primary={
                    deploymentFailed && run.status === "awaiting_approval" ? (
                      <button
                        type="button"
                        onClick={handleRetryDeployment}
                        disabled={actionDisabled || retryingDeployment}
                        className="w-full rounded-lg bg-purple-600 px-6 py-3.5 text-base font-semibold text-white shadow-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
                      >
                        {retryingDeployment ? "Retrying…" : "Retry Deployment"}
                      </button>
                    ) : run.status === "awaiting_approval" &&
                      run.beta_merged &&
                      run.master_pr_id &&
                      !run.master_merged ? (
                      <button
                        type="button"
                        onClick={() => setMergeConfirmTarget("master")}
                        disabled={actionDisabled}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3.5 text-base font-bold text-white shadow-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        <LockIcon />
                        {mergingMaster ? "Merging Live…" : "Approve & Merge Live PR"}
                      </button>
                    ) : run.status === "awaiting_approval" &&
                      (run.beta_pr_id || run.pr_id) &&
                      !run.beta_merged ? (
                      <button
                        type="button"
                        onClick={() => setMergeConfirmTarget("beta")}
                        disabled={actionDisabled}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-6 py-3.5 text-base font-bold text-white shadow-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
                      >
                        <LockIcon />
                        {mergingBeta
                          ? "Merging…"
                          : run.unified_deploy_target
                            ? "Approve & Merge PR"
                            : "Approve & Merge Staging PR"}
                      </button>
                    ) : null
                  }
                  secondary={
                    <>
                      {(run.beta_pr_url || run.pr_url) && (
                        <a
                          href={run.beta_pr_url || run.pr_url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 min-w-[8rem] inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50 transition-colors"
                        >
                          View Staging PR
                        </a>
                      )}
                      {run.master_pr_url && (
                        <a
                          href={run.master_pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 min-w-[8rem] inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50 transition-colors"
                        >
                          View Live PR
                        </a>
                      )}
                    </>
                  }
                  danger={
                    run.status === "awaiting_approval" ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => setDeclineConfirmOpen(true)}
                          disabled={actionDisabled || applyingRevision}
                          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                          title="Are you sure? This closes PRs and regenerates code."
                        >
                          {decliningPr ? "Restarting…" : "Restart Development"}
                        </button>
                        <p className="text-xs text-slate-500 mt-1.5">
                          Are you sure? This closes PRs and regenerates code.
                        </p>
                      </div>
                    ) : null
                  }
                />
              </>
            )}

            {/* Step 4: Website verification */}
            {verificationDone && (
              <section className="bg-white border-2 border-brand-400 rounded-xl shadow-brand-md p-6 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-green-700">
                    Complete
                  </span>
                  <h2 className="text-lg font-bold text-slate-900">Step 4 — Verification</h2>
                </div>
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
                    <p className="font-medium">Delivery complete — In Testing</p>
                    <p className="mt-1">
                      Pull request merged, websites verified, and Jira updated with testing screenshots.
                    </p>
                  </div>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
