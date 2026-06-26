import { DeliveryRun } from "../api/client";

const REVISION_STEP_IDS = [
  "code_revision",
  "revision_prepare",
  "revision_generate",
  "revision_commit",
  "revision_delete",
  "revision_refresh",
] as const;

const MERGE_DEPLOY_STEP_IDS = [
  "merge_beta_pr",
  "merge_master_pr",
  "deploy_beta",
  "deploy_master",
  "verify_beta",
  "verify_master",
] as const;

function latestStepEntry(stepsLog: DeliveryRun["steps_log"], stepId: string) {
  const entries = stepsLog.filter((s) => s.step === stepId);
  return entries[entries.length - 1];
}

/** Each revision logs a "running" start entry and a final "completed"/"failed" entry. */
export function getRevisionHistoryEntries(
  stepsLog: DeliveryRun["steps_log"],
): DeliveryRun["steps_log"] {
  const revisions = (stepsLog ?? []).filter((entry) => entry.step === "code_revision");
  return revisions.filter((entry, index) => {
    if (entry.status !== "running") return true;
    return index === revisions.length - 1;
  });
}

export function hasExecutedAnyStep(run: DeliveryRun): boolean {
  return (run.steps_log ?? []).some((entry) => entry.status === "completed");
}

export function isRevisionInProgress(run: DeliveryRun, applyingRevision = false): boolean {
  if (applyingRevision) return true;
  return REVISION_STEP_IDS.some((step) => latestStepEntry(run.steps_log ?? [], step)?.status === "running");
}

export function hasDeploymentAttempt(run: DeliveryRun): boolean {
  if (
    (run.deployment_history ?? []).some(
      (attempt) => attempt.status === "completed" || attempt.status === "failed",
    )
  ) {
    return true;
  }
  return (run.steps_log ?? []).some(
    (entry) =>
      (entry.step === "deploy_beta" || entry.step === "deploy_master") &&
      (entry.status === "completed" || entry.status === "failed"),
  );
}

export function isVerificationInProgress(run: DeliveryRun): boolean {
  const phase = run.workflow_phase;
  const verificationDone = phase === "completed" && run.status === "completed";
  if (verificationDone) return false;

  if (run.pending_verification || run.pending_deploy_retry) return true;
  if ((run.verifications ?? []).length > 0) return true;
  if (hasDeploymentAttempt(run)) return true;

  const stepsLog = run.steps_log ?? [];
  if (
    stepsLog.some(
      (entry) => MERGE_DEPLOY_STEP_IDS.includes(entry.step as (typeof MERGE_DEPLOY_STEP_IDS)[number]) &&
        entry.status === "running",
    )
  ) {
    return true;
  }

  if (run.status === "running" && phase === "pr_review" && !isRevisionInProgress(run)) {
    return stepsLog.some((entry) =>
      ["merge_beta_pr", "merge_master_pr", "deploy_beta", "deploy_master"].includes(entry.step),
    );
  }

  return false;
}

export function getActiveUiStep(run: DeliveryRun): number {
  if (run.ui_active_step && run.ui_active_step >= 1 && run.ui_active_step <= 4) {
    return run.ui_active_step;
  }

  const phase = run.workflow_phase;
  const hasOpenPrs = Boolean(
    run.beta_pr_id ||
      run.pr_id ||
      run.beta_pr_url ||
      run.pr_url ||
      run.master_pr_id ||
      run.master_pr_url,
  );
  const hasPostMergeWork = Boolean(
    run.pending_deploy_retry || run.beta_merged || run.master_merged,
  );
  const estimationPosted = [
    "ready_for_implementation",
    "implementation",
    "local_development",
    "pr_review",
    "completed",
  ].includes(phase);
  const verificationDone = phase === "completed" && run.status === "completed";
  const prReviewReady =
    phase === "pr_review" ||
    (run.status === "awaiting_approval" && phase !== "local_development") ||
    hasOpenPrs ||
    hasPostMergeWork;
  const verificationInProgress = isVerificationInProgress(run);

  if (verificationDone || verificationInProgress) return 4;
  if (prReviewReady) return 3;
  if (estimationPosted || phase === "implementation" || phase === "local_development") return 2;
  return 1;
}

export function stepStorageKey(issueKey: string): string {
  return `delivery:active-step:${issueKey}`;
}

export function readStoredUiStep(issueKey: string): number | null {
  try {
    const raw = sessionStorage.getItem(stepStorageKey(issueKey));
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return parsed >= 1 && parsed <= 4 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredUiStep(issueKey: string, step: number): void {
  try {
    sessionStorage.setItem(stepStorageKey(issueKey), String(step));
  } catch {
    // Ignore storage failures.
  }
}

export function resolveUiStepForRun(run: DeliveryRun, issueKey: string): number {
  const computed = getActiveUiStep(run);
  if (!hasExecutedAnyStep(run)) return 1;
  const stored = readStoredUiStep(issueKey);
  if (stored == null) return computed;
  return Math.max(stored, computed);
}
