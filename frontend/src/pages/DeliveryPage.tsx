import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, DeliveryRun, User } from "../api/client";
import AIWorkingPanel, { BOOT_STEPS, PREPARE_STEPS } from "../components/AIWorkingPanel";
import ChangedFilesSection from "../components/ChangedFilesSection";
import ConfirmModal from "../components/ConfirmModal";
import DeliveryActionBar from "../components/DeliveryActionBar";
import { ErrorBanner, SuccessBanner } from "../components/FeedbackBanner";
import FileDiffViewer from "../components/FileDiffViewer";
import JiraCommentCard from "../components/JiraCommentCard";
import IssueTypeIcon from "../components/IssueTypeIcon";
import JiraRichText from "../components/JiraRichText";
import Layout from "../components/Layout";
import LocalDevelopmentPanel from "../components/LocalDevelopmentPanel";
import PipelineStepper from "../components/PipelineStepper";
import PullRequestDetailsCard from "../components/PullRequestDetailsCard";
import DeploymentLogsPanel from "../components/DeploymentLogsPanel";
import { TerminalLine } from "../components/DeploymentTerminal";
import VerificationPanel from "../components/VerificationPanel";
import { useToast } from "../context/ToastContext";
import {
  getActiveUiStep,
  getRevisionHistoryEntries,
  hasDeploymentAttempt,
  isRevisionInProgress,
  isVerificationInProgress,
  resolveUiStepForRun,
  writeStoredUiStep,
} from "../utils/deliverySteps";

type DeliveryNavState = {
  run?: DeliveryRun;
  starting?: boolean;
  issueSummary?: string;
};

const STEP_LABELS = ["Estimation", "Implementation", "Pull Request", "Verification"] as const;

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
    text: item.detail
      ? item.nested
        ? `${item.label}\n${item.detail}`
        : `${item.label} — ${item.detail}`
      : item.label,
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

function deploymentHistoryTerminalLines(
  history: DeliveryRun["deployment_history"],
  environment: "beta" | "master" | null,
  activeAttemptId: string | null,
): TerminalLine[] {
  if (!environment) return [];
  const lines: TerminalLine[] = [];
  const previousAttempts = (history ?? []).filter(
    (attempt) =>
      attempt.environment === environment &&
      attempt.id !== activeAttemptId &&
      attempt.status !== "running",
  );

  for (const attempt of previousAttempts) {
    const headerStatus: TerminalLine["status"] =
      attempt.status === "failed" ? "failed" : attempt.status === "completed" ? "done" : "pending";
    const when = attempt.started_at
      ? new Date(attempt.started_at).toLocaleString()
      : "unknown time";
    lines.push({
      id: `history-${attempt.id}-header`,
      text: `[Previous attempt · ${attempt.trigger}] ${attempt.environment_label} deployment — ${when}`,
      status: headerStatus,
    });

    const planned = plannedCommandsForAttempt(attempt, []);
    const commandsToShow =
      planned.length > 0
        ? planned.map((command, index) => ({
            command,
            record: attempt.commands.find((cmd) => cmd.index === index),
          }))
        : attempt.commands.map((record) => ({ command: record.command, record }));

    for (const { command, record } of commandsToShow) {
      const cmdStatus: TerminalLine["status"] = record
        ? record.status === "failed"
          ? "failed"
          : record.status === "completed"
            ? "done"
            : record.status === "running"
              ? "active"
              : "pending"
        : headerStatus;
      const output = record?.output?.trim();
      lines.push({
        id: `history-${attempt.id}-cmd-${record?.index ?? command}`,
        text: output ? `${command}\n${output}` : command,
        status: cmdStatus,
        nested: true,
      });
    }

    if (attempt.error?.trim()) {
      lines.push({
        id: `history-${attempt.id}-error`,
        text: attempt.error.trim(),
        status: "failed",
        nested: true,
      });
    }
  }

  return lines;
}

const STAGING_LOG_STEP_IDS = [
  "merge_beta_pr",
  "deploy_beta",
  "transition_in_testing",
  "verify_beta",
] as const;

const LIVE_LOG_STEP_IDS = ["merge_master_pr", "deploy_master", "verify_master"] as const;

function mergeProgressItemBelongsToEnvironment(id: string, environment: "beta" | "master"): boolean {
  if (environment === "beta") {
    return (
      id === "merge_beta_pr" ||
      id === "deploy_beta" ||
      id.startsWith("deploy_beta_cmd_") ||
      id === "transition_in_testing" ||
      id === "verify_beta"
    );
  }
  return (
    id === "merge_master_pr" ||
    id === "deploy_master" ||
    id.startsWith("deploy_master_cmd_") ||
    id === "verify_master"
  );
}

function filterMergeProgressItemsForEnvironment(
  items: MergeProgressItem[],
  environment: "beta" | "master",
): MergeProgressItem[] {
  return items.filter((item) => mergeProgressItemBelongsToEnvironment(item.id, environment));
}

function hasEnvironmentDeploymentHistory(
  history: DeliveryRun["deployment_history"],
  environment: "beta" | "master",
): boolean {
  return (history ?? []).some((attempt) => attempt.environment === environment);
}

function hasEnvironmentStepsLog(
  stepsLog: DeliveryRun["steps_log"],
  stepIds: readonly string[],
): boolean {
  return (stepsLog ?? []).some((entry) => stepIds.includes(entry.step));
}

function buildDeploymentTerminalLines(
  run: DeliveryRun,
  mergeProgressItems: MergeProgressItem[],
  environment: "beta" | "master",
  retryingDeployment: boolean,
  mergingTarget: "beta" | "master" | null,
): TerminalLine[] {
  const deployStep = environment === "beta" ? "deploy_beta" : "deploy_master";
  const mappingCommands =
    environment === "beta" ? run.staging_deploy_commands : run.live_deploy_commands;
  const isRetryingThisTarget = retryingDeployment && mergingTarget === environment;
  const activeAttempt = resolveActiveDeployAttempt(run.deployment_history, deployStep, {
    retrying: isRetryingThisTarget,
    plannedCommands: mappingCommands,
  });
  const historyLines = deploymentHistoryTerminalLines(
    run.deployment_history,
    environment,
    activeAttempt?.id ?? null,
  );
  const filteredItems = filterMergeProgressItemsForEnvironment(mergeProgressItems, environment);
  const currentLines = toTerminalLines(filteredItems);
  return [...historyLines, ...currentLines];
}

function ExternalLinkIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
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

function DeliveryStepNav({
  viewStep,
  maxNavigableStep,
  onSelect,
}: {
  viewStep: number;
  maxNavigableStep: number;
  onSelect: (step: number) => void;
}) {
  const prev = viewStep > 1 ? viewStep - 1 : null;
  const next = viewStep < maxNavigableStep ? viewStep + 1 : null;
  if (!prev && !next) return null;

  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {prev ? (
        <button
          type="button"
          onClick={() => onSelect(prev)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50 transition-colors"
        >
          <ChevronLeftIcon />
          {STEP_LABELS[prev - 1]}
        </button>
      ) : (
        <span />
      )}
      <span className="text-xs text-slate-500 hidden sm:inline">
        Step {viewStep} of {maxNavigableStep}
      </span>
      {next ? (
        <button
          type="button"
          onClick={() => onSelect(next)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50 transition-colors"
        >
          {STEP_LABELS[next - 1]}
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      ) : (
        <span />
      )}
    </div>
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

function JiraTicketContent({ run, showJiraLink = false }: { run: DeliveryRun; showJiraLink?: boolean }) {
  return (
    <div className="space-y-6">
      {showJiraLink && run.jira_issue_url && (
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
            <JiraRichText text={run.description} />
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
                  ? "bg-brand-50/50 border border-brand-100"
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
                    ? "text-brand-800"
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
  const revisions = getRevisionHistoryEntries(stepsLog);
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
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-brand-600 ring-1 ring-brand-200">
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
  { id: "generate_code", label: "Generate code changes" },
  { id: "commit_changes", label: "Commit changes to branch" },
  { id: "confirm_local_changes", label: "Create pull requests" },
  { id: "create_pr_beta", label: "Open Staging pull request" },
  { id: "create_pr_master", label: "Open Master pull request" },
] as const;

function implementationStepStatus(
  stepId: string,
  stepsLog: DeliveryRun["steps_log"],
): "done" | "active" | "pending" | "failed" {
  const entry = [...stepsLog].reverse().find((s) => s.step === stepId);
  if (entry?.status === "skipped") return "done";
  if (entry?.status === "failed") {
    if (stepId === "transition_in_progress") return "done";
    return "failed";
  }
  if (entry?.status === "completed") return "done";
  if (entry?.status === "running") return "active";
  const order = IMPLEMENTATION_SUBSTEPS.map((s) => s.id);
  const idx = order.indexOf(stepId as (typeof order)[number]);
  if (idx <= 0) return "pending";
  const prev = order[idx - 1];
  const prevEntry = stepsLog.find((s) => s.step === prev);
  if (prevEntry?.status === "completed" || prevEntry?.status === "skipped") return "active";
  if (prevEntry?.status === "failed" && prev === "transition_in_progress") return "active";
  return "pending";
}

function ImplementationStepsList({ run }: { run: DeliveryRun }) {
  return (
    <ol className="space-y-2">
      {IMPLEMENTATION_SUBSTEPS.map((step) => {
        const status = implementationStepStatus(step.id, run.steps_log);
        const entry = latestStepEntry(run.steps_log, step.id);
        const failureDetail =
          status === "failed" && entry?.message && entry.message !== step.label
            ? entry.message
            : null;
        return (
          <li
            key={step.id}
            className={`rounded-xl px-4 py-3 text-sm ${
              status === "active"
                ? "bg-white border border-brand-200"
                : status === "done"
                  ? "bg-brand-50/50 border border-brand-100"
                  : status === "failed"
                    ? "bg-red-50/50 border border-red-100"
                    : "bg-slate-50/50 border border-transparent"
            }`}
          >
            <div className="flex items-center gap-3">
              <PrepareStepIcon
                status={status === "failed" ? "pending" : status === "done" ? "done" : status}
              />
              <span
                className={
                  status === "active"
                    ? "font-medium text-brand-800"
                    : status === "done"
                      ? "text-brand-800"
                      : status === "failed"
                        ? "text-red-700 font-medium"
                        : "text-slate-400"
                }
              >
                {step.label}
              </span>
            </div>
            {failureDetail && (
              <p className="mt-2 ml-9 text-xs text-red-700 whitespace-pre-wrap break-words">
                {failureDetail}
              </p>
            )}
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

function effectiveMergeStepStatus(
  stepsLog: DeliveryRun["steps_log"],
  stepId: string,
): MergeProgressStatus {
  const status = stepLogStatus(stepsLog, stepId);
  if (stepId === "transition_in_testing" && status === "failed") {
    return "skipped";
  }
  return status;
}

function historyCommandStatus(status: string): MergeProgressStatus {
  if (status === "failed") return "failed";
  if (status === "completed") return "done";
  if (status === "running") return "active";
  return "pending";
}

function resolveActiveDeployAttempt(
  history: DeliveryRun["deployment_history"],
  deployStep: "deploy_beta" | "deploy_master",
  options?: { retrying?: boolean; plannedCommands?: string[] },
): DeliveryRun["deployment_history"][number] | null {
  const environment = deployStep === "deploy_beta" ? "beta" : "master";
  const envAttempts = (history ?? []).filter((attempt) => attempt.environment === environment);
  const running = envAttempts.find((attempt) => attempt.status === "running");
  if (running) return running;
  if (options?.retrying) {
    return {
      id: "optimistic-retry",
      environment,
      environment_label: environment === "beta" ? "Staging" : "Live",
      trigger: "retry",
      status: "running",
      started_at: new Date().toISOString(),
      completed_at: null,
      planned_commands: options.plannedCommands ?? [],
      commands: [],
      output: null,
      error: null,
    };
  }
  return envAttempts[envAttempts.length - 1] ?? null;
}

function stepsLogSince(
  stepsLog: DeliveryRun["steps_log"],
  sinceIso: string | null | undefined,
): DeliveryRun["steps_log"] {
  if (!sinceIso) return stepsLog;
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return stepsLog;
  return stepsLog.filter((entry) => {
    const at = Date.parse(entry.at);
    return !Number.isNaN(at) && at >= since;
  });
}

function plannedCommandsForAttempt(
  attempt: DeliveryRun["deployment_history"][number] | null,
  fallback: string[],
): string[] {
  if (attempt?.planned_commands?.length) return attempt.planned_commands;
  if (attempt?.commands?.length) {
    return [...attempt.commands]
      .sort((a, b) => a.index - b.index)
      .map((cmd) => cmd.command);
  }
  return fallback;
}

function deployCommandItems(
  stepsLog: DeliveryRun["steps_log"],
  deployStep: "deploy_beta" | "deploy_master",
  plannedCommands: string[] = [],
  attemptCommands: DeliveryRun["deployment_history"][number]["commands"] = [],
): MergeProgressItem[] {
  const prefix = `${deployStep}_cmd_`;

  if (plannedCommands.length > 0) {
    const total = plannedCommands.length;
    return plannedCommands.map((command, index) => {
      const stepId = `${prefix}${index}`;
      const latest = latestStepEntry(stepsLog, stepId);
      const runningEntry = latest?.status === "running" ? latest : undefined;
      const historyCmd = attemptCommands.find((cmd) => cmd.index === index);
      const logStatus = runningEntry
        ? "active"
        : latest
          ? stepLogStatus(stepsLog, stepId)
          : historyCmd
            ? historyCommandStatus(historyCmd.status)
            : "pending";
      const output = (historyCmd?.output || "").trim();
      const label =
        runningEntry?.message ||
        latest?.message ||
        `(${index + 1}/${total}) ${command}`;
      return {
        id: stepId,
        label,
        detail:
          output && (logStatus === "done" || logStatus === "failed") ? output : undefined,
        status: logStatus,
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
    const latest = latestStepEntry(stepsLog, stepId);
    const runningEntry = latest?.status === "running" ? latest : undefined;
    const status = stepLogStatus(stepsLog, stepId);
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
  retryingDeployment = false,
): MergeProgressItem[] {
  const { steps_log: stepsLog, unified_deploy_target: unified } = run;
  const items: MergeProgressItem[] = [];

  const addStep = (id: string, label: string) => {
    const entry = latestStepEntry(stepsLog, id);
    const status = effectiveMergeStepStatus(stepsLog, id);
    items.push({
      id,
      label,
      status,
      detail: status === "failed" && entry?.message ? entry.message : undefined,
    });
  };

  const addDeployGroup = (deployStep: "deploy_beta" | "deploy_master", label: string) => {
    const environment = deployStep === "deploy_beta" ? "beta" : "master";
    const mappingCommands =
      deployStep === "deploy_beta" ? run.staging_deploy_commands : run.live_deploy_commands;
    const isRetryingThisTarget = retryingDeployment && mergingTarget === environment;
    const activeAttempt = resolveActiveDeployAttempt(run.deployment_history, deployStep, {
      retrying: isRetryingThisTarget,
      plannedCommands: mappingCommands,
    });
    const scopedStepsLog =
      isRetryingThisTarget && activeAttempt?.id === "optimistic-retry"
        ? []
        : stepsLogSince(stepsLog, activeAttempt?.started_at);
    const plannedCommands = plannedCommandsForAttempt(activeAttempt, mappingCommands);
    const attemptCommands = activeAttempt?.commands ?? [];
    const deployStatus = stepLogStatus(scopedStepsLog, deployStep);
    const deployEntry = latestStepEntry(scopedStepsLog, deployStep);
    const commandItems = deployCommandItems(
      scopedStepsLog,
      deployStep,
      plannedCommands,
      attemptCommands,
    );
    const deployDetail =
      deployStatus === "failed" && deployEntry?.message ? deployEntry.message : undefined;
    const groupStatus =
      isRetryingThisTarget && deployStatus === "pending" ? "active" : deployStatus;
    if (commandItems.length > 0 || groupStatus !== "pending" || isRetryingThisTarget) {
      items.push({ id: deployStep, label, status: groupStatus, detail: deployDetail });
      items.push(...commandItems);
    }
  };

  if (deployOnly) {
    const retryTarget = (run.pending_deploy_retry as "beta" | "master" | null) ?? mergingTarget;
    if (retryTarget === "beta" || (!retryTarget && (run.beta_merged || run.beta_pr_id || run.pr_id))) {
      addDeployGroup("deploy_beta", "Run Staging deployment commands");
      const transitionStatus = effectiveMergeStepStatus(stepsLog, "transition_in_testing");
      if (transitionStatus !== "pending") {
        addStep("transition_in_testing", "Move ticket to Unit Testing");
      }
      addStep("verify_beta", "Verify Staging website");
      if (unified) {
        addDeployGroup("deploy_master", "Run Live deployment commands");
        addStep("verify_master", "Verify Live website");
      }
    } else {
      addDeployGroup("deploy_master", "Run Live deployment commands");
      addStep("verify_master", "Verify Live website");
    }
    return items;
  }

  if (mergingTarget === "beta" || stepsLog.some((s) => s.step === "merge_beta_pr")) {
    addStep("merge_beta_pr", "Merge Staging pull request");
    addDeployGroup("deploy_beta", "Run Staging deployment commands");
    const transitionStatus = effectiveMergeStepStatus(stepsLog, "transition_in_testing");
    if (transitionStatus !== "pending") {
      addStep("transition_in_testing", "Move ticket to Unit Testing");
    }
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

function resolveActiveDeploymentTarget(
  run: DeliveryRun,
  mergingTarget: "beta" | "master" | null,
  mergeInProgress: boolean,
): "beta" | "master" | null {
  if (mergingTarget) return mergingTarget;

  const runningAttempt = (run.deployment_history ?? []).find((attempt) => attempt.status === "running");
  if (runningAttempt?.environment === "beta" || runningAttempt?.environment === "master") {
    return runningAttempt.environment;
  }

  const stepsLog = run.steps_log ?? [];
  if (stepLogStatus(stepsLog, "deploy_master") === "active") return "master";
  if (stepLogStatus(stepsLog, "deploy_beta") === "active") return "beta";
  if (stepLogStatus(stepsLog, "merge_master_pr") === "active") return "master";
  if (stepLogStatus(stepsLog, "merge_beta_pr") === "active") return "beta";

  if (!mergeInProgress) return null;

  if (!run.beta_merged && (run.beta_pr_id || run.pr_id)) return "beta";
  if (run.master_pr_id && !run.master_merged) return "master";
  return null;
}

function getDeploymentFailureDetail(run: DeliveryRun): string | null {
  if (!run.pending_deploy_retry) return null;
  const failedAttempt = [...(run.deployment_history ?? [])]
    .reverse()
    .find(
      (attempt) =>
        attempt.status === "failed" && attempt.environment === run.pending_deploy_retry,
    );
  const failedCommand = [...(failedAttempt?.commands ?? [])]
    .reverse()
    .find((cmd) => cmd.status === "failed" && cmd.output?.trim());
  return failedCommand?.output?.trim() ?? null;
}

export default function DeliveryPage() {
  const { issueKey } = useParams<{ issueKey: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as DeliveryNavState | null) ?? {};
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");
  const [run, setRun] = useState<DeliveryRun | null>(navState.run ?? null);
  const [loading, setLoading] = useState(!navState.run);
  const [bootStep, setBootStep] = useState(0);
  const [apiOutdated, setApiOutdated] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareStep, setPrepareStep] = useState(0);
  const [posting, setPosting] = useState(false);
  const [requestingInfo, setRequestingInfo] = useState(false);
  const [implementing, setImplementing] = useState(false);
  const [confirmingLocal, setConfirmingLocal] = useState(false);
  const [mergingBeta, setMergingBeta] = useState(false);
  const [mergingMaster, setMergingMaster] = useState(false);
  const [retryingDeployment, setRetryingDeployment] = useState(false);
  const [deployRetryTarget, setDeployRetryTarget] = useState<"beta" | "master" | null>(null);
  const [postingVerification, setPostingVerification] = useState(false);
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
  const [viewStep, setViewStep] = useState(1);
  const prepareStarted = useRef(false);
  const lastWorkflowPhase = useRef<string | null>(null);
  const workflowStepRef = useRef(1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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

    const seededRun = navState.run;
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
  }, [issueKey, handleAuthError, applyRunDrafts, navState.run]);

  useEffect(() => {
    if (!loading) {
      setBootStep(0);
      return;
    }

    setBootStep(0);
    const timers = [
      setTimeout(() => setBootStep(1), 900),
      setTimeout(() => setBootStep(2), 2000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [loading]);

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
      confirmingLocal ||
      applyingRevision ||
      mergingBeta ||
      mergingMaster ||
      retryingDeployment ||
      (run.status === "running" &&
        (run.workflow_phase === "implementation" ||
          run.workflow_phase === "local_development" ||
          run.workflow_phase === "pr_review")) ||
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
  }, [run?.id, run?.status, run?.workflow_phase, implementing, confirmingLocal, applyingRevision, mergingBeta, mergingMaster, retryingDeployment]);

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

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const selectViewStep = useCallback(
    (step: number) => {
      setViewStep(step);
      if (issueKey) writeStoredUiStep(issueKey, step);
      scrollToTop();
    },
    [issueKey, scrollToTop],
  );

  useEffect(() => {
    if (!run || !issueKey || loading) return;
    const initial = resolveUiStepForRun(run, issueKey);
    setViewStep(initial);
    workflowStepRef.current = getActiveUiStep(run);
  }, [run?.id, issueKey, loading]);

  useEffect(() => {
    if (!run || !issueKey) return;
    const current = getActiveUiStep(run);
    if (current > workflowStepRef.current) {
      setViewStep(current);
      writeStoredUiStep(issueKey, current);
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
    workflowStepRef.current = current;
  }, [run, issueKey]);

  useEffect(() => {
    if (!run || !issueKey) return;
    if (run.pending_deploy_retry && !getMergeFailureTarget(run)) {
      setViewStep(3);
      writeStoredUiStep(issueKey, 3);
    }
  }, [run?.pending_deploy_retry, run?.id, issueKey]);

  useEffect(() => {
    if (!run || prepareStarted.current) return;

    const inPrReview =
      run.workflow_phase === "pr_review" ||
      (run.status === "awaiting_approval" && run.workflow_phase !== "local_development") ||
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

  const handleCreatePrs = async () => {
    if (!run) return;
    setConfirmingLocal(true);
    setError(null);
    try {
      const updated = await api.createPrs(run.id);
      setRun(updated);
      if (updated.error_message) {
        setError(updated.error_message);
        toast(updated.error_message, "error");
      } else {
        toast("Pull requests created.", "success");
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
      setConfirmingLocal(false);
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

  const handleRunDeployment = async (target: "beta" | "master") => {
    if (!run) return;
    setDeployRetryTarget(target);
    setRetryingDeployment(true);
    setError(null);
    try {
      const pollPromise = api.getRun(run.id).then((refreshed) => setRun(refreshed)).catch(() => {});
      const updated = await api.retryDeploymentRun(run.id, target);
      await pollPromise;
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
      setDeployRetryTarget(null);
    }
  };

  const handlePostVerification = async (comment: string) => {
    if (!run || !comment.trim()) return;
    setPostingVerification(true);
    setError(null);
    try {
      const updated = await api.postVerification(run.id, comment.trim());
      setRun(updated);
      if (updated.error_message) {
        setError(updated.error_message);
        toast(updated.error_message, "error");
      } else {
        toast("Verification posted to Jira.", "success");
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
      setPostingVerification(false);
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
      if (updated.workflow_phase === "local_development") {
        setSelectedFile(null);
      } else if (updated.workflow_phase === "ready_for_implementation") {
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
      : deployRetryTarget;
  const mergeFailedTarget = run ? getMergeFailureTarget(run) : null;
  const deploymentFailed =
    Boolean(run?.pending_deploy_retry) && !mergeFailedTarget && !retryingDeployment;
  const deployOnlyMode =
    (deploymentFailed || retryingDeployment) && Boolean(run?.beta_merged || run?.master_merged);
  const phase = run?.workflow_phase ?? "estimation";
  const hasOpenPrs = Boolean(
    run?.beta_pr_id || run?.pr_id || run?.beta_pr_url || run?.pr_url || run?.master_pr_id || run?.master_pr_url,
  );
  const hasPostMergeWork = Boolean(
    run?.pending_deploy_retry || run?.beta_merged || run?.master_merged,
  );
  const estimationPosted = [
    "ready_for_implementation",
    "implementation",
    "local_development",
    "pr_review",
    "completed",
  ].includes(phase);
  const localDevelopmentReady = phase === "local_development";
  const prReviewReady =
    phase === "pr_review" ||
    (run?.status === "awaiting_approval" && !localDevelopmentReady) ||
    hasOpenPrs ||
    hasPostMergeWork;
  const mergeInProgress =
    merging ||
    retryingDeployment ||
    (run?.status === "running" &&
      phase === "pr_review" &&
      prReviewReady &&
      !deploymentFailed);
  const verificationDone = phase === "completed" && run?.status === "completed";
  const implementationRunning =
    run?.status === "running" ||
    ((phase === "implementation" || phase === "local_development") && run?.status !== "failed");
  const revisionInProgress = run ? isRevisionInProgress(run, applyingRevision) : applyingRevision;
  const deploymentAttempted = run ? hasDeploymentAttempt(run) : false;
  const resolvedComment = run ? resolveDraftComment(run) : "";
  const commentForDisplay = comment.trim() || resolvedComment;

  const completedPhases: string[] = [];
  if (estimationPosted) completedPhases.push("estimation");
  if (prReviewReady || verificationDone) completedPhases.push("implementation");
  if (verificationDone || (run && isVerificationInProgress(run))) completedPhases.push("pr_review");

  const step1Status = phaseStatus(phase, "estimation", completedPhases);
  const step2Status =
    prReviewReady || verificationDone
      ? "completed"
      : implementationRunning || phase === "implementation" || phase === "local_development"
        ? "active"
        : estimationPosted
          ? "active"
          : "pending";
  const verificationInProgress =
    merging ||
    retryingDeployment ||
    Boolean(run && isVerificationInProgress(run));

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
    ? buildMergeProgressItems(run, mergingTarget, deployOnlyMode, retryingDeployment)
    : [];
  const activeDeploymentTarget = run
    ? resolveActiveDeploymentTarget(run, mergingTarget, mergeInProgress)
    : mergingTarget;
  const stagingInProgress =
    mergingBeta ||
    (retryingDeployment && mergingTarget === "beta") ||
    (mergeInProgress && activeDeploymentTarget === "beta");
  const liveInProgress =
    mergingMaster ||
    (retryingDeployment && mergingTarget === "master") ||
    (mergeInProgress && activeDeploymentTarget === "master");
  const stagingDeploymentFailed =
    run?.pending_deploy_retry === "beta" &&
    mergeFailedTarget !== "beta" &&
    !retryingDeployment;
  const liveDeploymentFailed =
    run?.pending_deploy_retry === "master" &&
    mergeFailedTarget !== "master" &&
    !retryingDeployment;
  const stagingRetryingDeployment = retryingDeployment && mergingTarget === "beta";
  const liveRetryingDeployment = retryingDeployment && mergingTarget === "master";
  const showStagingLogs = Boolean(
    run &&
      (stagingInProgress ||
        stagingDeploymentFailed ||
        mergeFailedTarget === "beta" ||
        hasEnvironmentStepsLog(run.steps_log, STAGING_LOG_STEP_IDS) ||
        hasEnvironmentDeploymentHistory(run.deployment_history, "beta")),
  );
  const showLiveLogs = Boolean(
    run &&
      (liveInProgress ||
        liveDeploymentFailed ||
        mergeFailedTarget === "master" ||
        hasEnvironmentStepsLog(run.steps_log, LIVE_LOG_STEP_IDS) ||
        hasEnvironmentDeploymentHistory(run.deployment_history, "master")),
  );
  const stagingTerminalLines =
    run && showStagingLogs
      ? buildDeploymentTerminalLines(
          run,
          mergeProgressItems,
          "beta",
          retryingDeployment,
          mergingTarget,
        )
      : [];
  const liveTerminalLines =
    run && showLiveLogs
      ? buildDeploymentTerminalLines(
          run,
          mergeProgressItems,
          "master",
          retryingDeployment,
          mergingTarget,
        )
      : [];
  const showActionBar = Boolean(run && prReviewReady && !verificationDone && viewStep === 3);
  const actionDisabled = merging || decliningPr || revisionInProgress || postingVerification;
  const showRequestChanges =
    run != null &&
    !deploymentAttempted &&
    !mergeInProgress &&
    !retryingDeployment &&
    (run.status === "awaiting_approval" || revisionInProgress);
  const showRestartDevelopment =
    run != null &&
    run.status === "awaiting_approval" &&
    deploymentAttempted &&
    !mergeInProgress &&
    !revisionInProgress;
  const canDeployStaging = Boolean(run?.beta_merged && run.staging_deploy_commands.length > 0);
  const canDeployLive = Boolean(run?.master_merged && run.live_deploy_commands.length > 0);

  const completedStepCount = run
    ? [step1Status, step2Status, step3Status, step4Status].filter((s) => s === "completed").length
    : 0;
  const progressPercent = (completedStepCount / 4) * 100;

  const showLiveMergeApprove =
    run?.status === "awaiting_approval" &&
    run.beta_merged &&
    Boolean(run.master_pr_id) &&
    !run.master_merged &&
    !deploymentFailed;
  const showStagingMergeApprove =
    run?.status === "awaiting_approval" &&
    Boolean(run.beta_pr_id || run.pr_id) &&
    !run.beta_merged &&
    !deploymentFailed;

  const workflowStep = run ? getActiveUiStep(run) : 1;
  const maxNavigableStep = workflowStep;
  const pipelineSteps = [
    { number: 1, label: "Estimation", status: step1Status },
    { number: 2, label: "Implementation", status: step2Status as "completed" | "active" | "pending" },
    { number: 3, label: "Pull Request", status: step3Status as "completed" | "active" | "pending" },
    { number: 4, label: "Verification", status: step4Status as "completed" | "active" | "pending" },
  ];

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <div className="flex flex-col flex-1 min-h-0 bg-gray-50">
        <div className="sticky top-0 z-40 flex-shrink-0 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm">
          <div className="max-w-5xl mx-auto px-6 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <BackToTicketsLink />
              {!loading && run ? (
                <>
                  <div className="hidden sm:block w-px h-8 bg-gray-200 flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <IssueTypeIcon
                        name={run.issue_type}
                        iconUrl={run.issue_type_icon}
                        className="h-4 w-4 flex-shrink-0"
                      />
                      <span className="font-mono text-sm font-semibold text-blue-600">{run.jira_issue_key}</span>
                      {run.jira_status && (
                        <span className="inline-flex items-center rounded-full bg-blue-500 px-2.5 py-0.5 text-xs font-semibold text-white">
                          {run.jira_status}
                        </span>
                      )}
                      <span className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                        {run.workflow_phase_label}
                      </span>
                      {mergeInProgress && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400 bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
                          {activeDeploymentTarget === "master" ? "Live deployment" : "Staging deployment"} in progress
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-900 truncate mt-0.5">{run.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReloadJira}
                    disabled={reloadingJira || run.status === "running"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-gray-100 disabled:opacity-50 transition-colors flex-shrink-0 ml-auto"
                  >
                    <RefreshIcon className={`h-3.5 w-3.5 ${reloadingJira ? "animate-spin" : ""}`} />
                    {reloadingJira ? "Reloading…" : "Reload"}
                  </button>
                </>
              ) : loading && issueKey ? (
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-blue-600">{issueKey}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse" />
                      Starting delivery
                    </span>
                  </div>
                  {navState.issueSummary && (
                    <p className="text-sm font-medium text-slate-900 truncate mt-0.5">{navState.issueSummary}</p>
                  )}
                </div>
              ) : (
                <span className="text-sm text-slate-500">{loading ? "Loading delivery…" : "Delivery"}</span>
              )}
            </div>
          </div>
          {(loading || preparing || mergeInProgress) ? (
            <div className="h-1 bg-gray-100" aria-hidden="true">
              <div className="h-full w-1/3 bg-blue-500 animate-pulse" />
            </div>
          ) : run ? (
            <div className="h-1 bg-gray-100" aria-hidden="true">
              <div
                className="h-full bg-blue-500 transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          ) : null}
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto"
        >
        <div className={`max-w-5xl mx-auto px-6 py-6 flex flex-col gap-4 ${showActionBar ? "pb-32" : ""}`}>

        {loading && (
          <div className="space-y-4">
            {error && (
              <div>
                <ErrorBanner message={error} />
              </div>
            )}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-6 py-5 opacity-90">
              <PipelineStepper
                steps={[
                  { number: 1, label: "Estimation", status: "active" },
                  { number: 2, label: "Implementation", status: "pending" },
                  { number: 3, label: "Pull Request", status: "pending" },
                  { number: 4, label: "Verification", status: "pending" },
                ]}
              />
            </div>
            <AIWorkingPanel
              issueKey={issueKey}
              issueSummary={navState.issueSummary ?? run?.summary}
              headline="Starting your delivery"
              subline="We're opening the workspace and syncing your ticket — AI estimation begins right after."
              steps={BOOT_STEPS}
              activeStep={bootStep}
            />
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
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-6 py-5">
              <PipelineStepper
                steps={pipelineSteps}
                selectedStep={viewStep}
                maxNavigableStep={maxNavigableStep}
                onStepSelect={selectViewStep}
              />
            </div>

            {(apiOutdated || error || run.error_message || run.workflow_notice) && (
              <div className="space-y-4">
                {apiOutdated && (
                  <div className="alert-error">
                    Backend API is out of date (estimation endpoints missing). Restart the dev backend with{" "}
                    <code className="font-mono text-sm">docker compose -f docker-compose.dev.yml up --build backend</code>
                    {" "}or run <code className="font-mono text-sm">./dev.sh</code>.
                  </div>
                )}
                {error && <ErrorBanner message={error} />}
                {run.error_message && !error && <ErrorBanner message={run.error_message} />}
                {run.workflow_notice && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
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
              </div>
            )}

            {viewStep === 1 && (
              <div className="space-y-4">
                {(run.description || run.jira_comments.length > 0) && (
                  <section className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
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
                )}

                {estimationPosted ? (
                  <section className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                    <div className="card-header">
                      <h2 className="card-title">Step 1 — Estimation</h2>
                      <p className="card-subtitle">Posted to Jira</p>
                    </div>
                    <div className="p-6">
                      <SuccessBanner>
                        <p className="font-medium">Estimation posted to Jira</p>
                        <p className="mt-0.5">
                          {run.estimation_hours}h — ticket moved to Estimation Complete.
                        </p>
                      </SuccessBanner>
                    </div>
                  </section>
                ) : (
                  <section className={`bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden ${step1Status === "active" ? "border-2 border-brand-400 shadow-brand-md" : ""}`}>
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
                {preparing && (
                  <AIWorkingPanel
                    issueKey={run.jira_issue_key}
                    issueSummary={run.summary}
                    headline="AI is preparing your estimation"
                    subline="Updating Jira and generating a comment for you to review. This usually takes a few seconds."
                    steps={PREPARE_STEPS}
                    activeStep={prepareStep}
                  />
                )}

                {!preparing &&
                  run.status === "running" &&
                  !run.estimation_prepared &&
                  (phase === "estimation" || phase === "waiting_for_info") && (
                    <AIWorkingPanel
                      issueKey={run.jira_issue_key}
                      issueSummary={run.summary}
                      headline="AI is preparing your estimation"
                      subline="Updating Jira and generating a comment for you to review. This usually takes a few seconds."
                      steps={PREPARE_STEPS}
                      activeStep={1}
                    />
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
                <DeliveryStepNav
                  viewStep={viewStep}
                  maxNavigableStep={maxNavigableStep}
                  onSelect={selectViewStep}
                />
              </div>
            )}

            {viewStep === 2 && (
              <div className="space-y-4">
                {prReviewReady ? (
                  <section className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                    <div className="card-header">
                      <h2 className="card-title">Step 2 — Implementation</h2>
                      <p className="card-subtitle">{implementationSummary(run)}</p>
                    </div>
                    <div className="p-6 space-y-4">
                      {run.branch_name && (
                        <p className="text-sm text-slate-600">
                          Branch:{" "}
                          <code className="bg-gray-800 text-green-400 rounded px-2 py-0.5 text-xs font-mono">
                            {run.branch_name}
                          </code>
                        </p>
                      )}
                      <ImplementationStepsList run={run} />
                    </div>
                  </section>
                ) : localDevelopmentReady ? (
                  <>
                    <section className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden border-2 border-brand-400 shadow-brand-md">
                      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
                        <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-700">
                          Current Step
                        </span>
                        <h2 className="text-lg font-bold text-brand-600 mt-2">Step 2 — Implementation</h2>
                        <p className="text-sm text-slate-500 mt-1">{implementationSummary(run)}</p>
                      </div>
                      <div className="p-6 space-y-4">
                        {run.branch_name && (
                          <p className="text-sm text-slate-600">
                            Branch:{" "}
                            <code className="bg-gray-800 text-green-400 rounded px-2 py-0.5 text-xs font-mono">
                              {run.branch_name}
                            </code>
                          </p>
                        )}
                        <ImplementationStepsList run={run} />
                      </div>
                    </section>
                    <LocalDevelopmentPanel
                      run={run}
                      creatingPrs={confirmingLocal}
                      applyingRevision={applyingRevision}
                      revisionPrompt={revisionPrompt}
                      onRevisionPromptChange={setRevisionPrompt}
                      onApplyRevision={() => void handleApplyRevision()}
                      disabled={confirmingLocal}
                      onCreatePrs={() => void handleCreatePrs()}
                    />
                  </>
                ) : (
                  <section className={`bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden ${step2Status === "active" ? "border-2 border-brand-400 shadow-brand-md" : ""}`}>
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
                          Creates a branch, then pauses for local development before opening pull requests
                        </p>
                      </div>
                    )}
                    <div className="p-6 space-y-5">
                      {implementing || implementationRunning ? (
                        <>
                          <p className="text-sm italic text-slate-500 flex items-center gap-2">
                            <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin flex-shrink-0" />
                            System is running implementation — generating code and preparing your review…
                          </p>
                          <ImplementationStepsList run={run} />
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
                            Creates a branch and generates code for review. Create pull requests when ready.
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                )}
                <DeliveryStepNav
                  viewStep={viewStep}
                  maxNavigableStep={maxNavigableStep}
                  onSelect={selectViewStep}
                />
              </div>
            )}

            {viewStep === 3 && prReviewReady && !verificationDone && (
              <div className="space-y-4">
                <PullRequestDetailsCard
                  run={run}
                  stagingDeployFailed={
                    run.pending_deploy_retry === "beta" &&
                    mergeFailedTarget !== "beta" &&
                    !retryingDeployment
                  }
                  liveDeployFailed={
                    run.pending_deploy_retry === "master" &&
                    mergeFailedTarget !== "master" &&
                    !retryingDeployment
                  }
                  stagingMergeFailed={mergeFailedTarget === "beta"}
                  liveMergeFailed={mergeFailedTarget === "master"}
                  deployingTarget={activeDeploymentTarget}
                  deployDisabled={actionDisabled}
                  onDeployStaging={canDeployStaging ? () => void handleRunDeployment("beta") : undefined}
                  onDeployLive={canDeployLive ? () => void handleRunDeployment("master") : undefined}
                />

                {(showStagingLogs || showLiveLogs) && (
                  <div className="space-y-4">
                    {showStagingLogs && (
                      <DeploymentLogsPanel
                        environment="beta"
                        deploymentFailed={stagingDeploymentFailed}
                        mergeFailed={mergeFailedTarget === "beta"}
                        deploymentErrorMessage={
                          stagingDeploymentFailed && run ? getDeploymentFailureMessage(run) : null
                        }
                        deploymentFailureDetail={
                          stagingDeploymentFailed && run ? getDeploymentFailureDetail(run) : null
                        }
                        mergeErrorMessage={
                          mergeFailedTarget === "beta" && run
                            ? getMergeFailureMessage(run, "beta")
                            : null
                        }
                        terminalLines={stagingTerminalLines}
                        inProgress={stagingInProgress}
                        retryingDeployment={stagingRetryingDeployment}
                      />
                    )}
                    {showLiveLogs && (
                      <DeploymentLogsPanel
                        environment="master"
                        deploymentFailed={liveDeploymentFailed}
                        mergeFailed={mergeFailedTarget === "master"}
                        deploymentErrorMessage={
                          liveDeploymentFailed && run ? getDeploymentFailureMessage(run) : null
                        }
                        deploymentFailureDetail={
                          liveDeploymentFailed && run ? getDeploymentFailureDetail(run) : null
                        }
                        mergeErrorMessage={
                          mergeFailedTarget === "master" && run
                            ? getMergeFailureMessage(run, "master")
                            : null
                        }
                        terminalLines={liveTerminalLines}
                        inProgress={liveInProgress}
                        retryingDeployment={liveRetryingDeployment}
                      />
                    )}
                  </div>
                )}

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

                {showRequestChanges && (
                  <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 space-y-3">
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
                        disabled={revisionInProgress || merging}
                      />
                    </div>
                    {revisionInProgress && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                          <span className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin" />
                          <div>
                            <p className="font-medium">Applying your requested changes…</p>
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
                      disabled={revisionInProgress || merging || !revisionPrompt.trim()}
                      className="btn-primary"
                    >
                      {revisionInProgress ? "Applying changes…" : "Apply changes to branch"}
                    </button>
                  </div>
                )}

                <RevisionHistory stepsLog={run.steps_log} />

                {showRestartDevelopment && (
                  <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Restart development</h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Close open pull requests and regenerate code from scratch. You will be asked to
                        confirm before anything changes.
                      </p>
                    </div>
                    <div>
                      <label className="label mb-1.5" htmlFor="decline-reason">
                        Notes (optional)
                      </label>
                      <textarea
                        id="decline-reason"
                        className="input min-h-[80px] resize-y text-sm leading-relaxed"
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="Why are you restarting? This is posted to Bitbucket and Jira."
                        disabled={decliningPr || merging || applyingRevision || revisionInProgress}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeclineConfirmOpen(true)}
                      disabled={actionDisabled || applyingRevision}
                      className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200"
                    >
                      {decliningPr ? "Restarting…" : "Restart development"}
                    </button>
                  </div>
                )}

                <DeliveryStepNav
                  viewStep={viewStep}
                  maxNavigableStep={maxNavigableStep}
                  onSelect={selectViewStep}
                />

                <DeliveryActionBar
                  left={
                    <>
                      {(run.beta_pr_url || run.pr_url) && (
                        <a
                          href={run.beta_pr_url || run.pr_url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50 transition-colors"
                        >
                          View Staging PR
                          <ExternalLinkIcon />
                        </a>
                      )}
                      {run.master_pr_url && (
                        <a
                          href={run.master_pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50 transition-colors"
                        >
                          View Live PR
                          <ExternalLinkIcon />
                        </a>
                      )}
                    </>
                  }
                  right={
                    deploymentFailed && run.status === "awaiting_approval" && !retryingDeployment ? (
                      <button
                        type="button"
                        onClick={() => void handleRunDeployment((run.pending_deploy_retry as "beta" | "master") ?? "beta")}
                        disabled={actionDisabled || retryingDeployment}
                        className="inline-flex items-center gap-2 max-w-xs rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        <RefreshIcon className={`h-4 w-4 ${retryingDeployment ? "animate-spin" : ""}`} />
                        {retryingDeployment ? "Retrying…" : "Retry Deployment"}
                      </button>
                    ) : null
                  }
                  bottom={
                    showLiveMergeApprove ? (
                      <button
                        type="button"
                        onClick={() => setMergeConfirmTarget("master")}
                        disabled={actionDisabled}
                        className="btn-primary w-full sm:w-auto px-8 py-3"
                      >
                        <LockIcon />
                        {mergingMaster ? "Merging Live…" : "Approve & Merge Live PR"}
                      </button>
                    ) : showStagingMergeApprove ? (
                      <button
                        type="button"
                        onClick={() => setMergeConfirmTarget("beta")}
                        disabled={actionDisabled}
                        className="btn-primary w-full sm:w-auto px-8 py-3"
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
                />
              </div>
            )}

            {viewStep === 4 && (
              <div className="space-y-4">
                {verificationDone ? (
                  <section className="bg-white border-2 border-brand-400 rounded-xl shadow-brand-md p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-700">
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

                    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900 mt-4">
                      <p className="font-medium">Delivery complete — In Testing</p>
                      <p className="mt-1">
                        Pull request merged, websites verified, and Jira updated with testing screenshots.
                      </p>
                    </div>
                  </section>
                ) : prReviewReady ? (
                  <VerificationPanel
                    run={run}
                    isActive={step4Status === "active"}
                    retryDisabled={actionDisabled}
                    retryingDeployment={retryingDeployment}
                    mergeInProgress={mergeInProgress}
                    onPostVerification={(comment) => void handlePostVerification(comment)}
                    postingVerification={postingVerification}
                  />
                ) : null}
                <DeliveryStepNav
                  viewStep={viewStep}
                  maxNavigableStep={maxNavigableStep}
                  onSelect={selectViewStep}
                />
              </div>
            )}
          </>
        )}
        </div>
        </div>
      </div>
    </Layout>
  );
}
