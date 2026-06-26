import { DeliveryRun } from "../api/client";

export function hasExecutedAnyStep(run: DeliveryRun): boolean {
  return (run.steps_log ?? []).some((entry) => entry.status === "completed");
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
  const showMergeProgress = (run.steps_log ?? []).some((entry) =>
    ["merge_beta_pr", "merge_master_pr", "deploy_beta", "deploy_master"].includes(entry.step),
  );
  const verificationInProgress =
    hasPostMergeWork ||
    ((run.verifications ?? []).length > 0 && !verificationDone) ||
    (run.status === "running" && phase === "pr_review" && showMergeProgress);

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
