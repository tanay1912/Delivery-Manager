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

export const PR_CREATION_STEP_IDS = [
  "commit_changes",
  "confirm_local_changes",
  "create_pr_beta",
  "create_pr_master",
] as const;

/** True when the generate_code pipeline step has finished (or was skipped for Cursor SDK). */
export function isCodeGenerationResolved(run: DeliveryRun): boolean {
  const status = latestStepStatus(run.steps_log ?? [], "generate_code");
  return status === "completed" || status === "skipped";
}

/** True when the cursor_development pipeline step has finished. */
export function isCursorDevelopmentResolved(run: DeliveryRun): boolean {
  const status = latestStepStatus(run.steps_log ?? [], "cursor_development");
  return status === "completed" || status === "skipped";
}

/** True when generated code is ready for review on Step 2 (before PRs exist). */
export function isImplementationReviewReady(run: DeliveryRun): boolean {
  if (run.workflow_phase === "local_development") {
    return run.status === "awaiting_approval" || run.status === "completed";
  }
  // Surface the review UI while the pipeline finishes after code generation.
  if (
    run.workflow_phase === "implementation" &&
    (run.status === "running" || run.status === "awaiting_approval") &&
    run.changed_files.length > 0 &&
    (isCodeGenerationResolved(run) || isCursorDevelopmentResolved(run))
  ) {
    return true;
  }
  return false;
}

export function arePrCreationStepsComplete(run: DeliveryRun): boolean {
  const stepsLog = run.steps_log ?? [];
  return PR_CREATION_STEP_IDS.every((stepId) => {
    const status = latestStepStatus(stepsLog, stepId);
    return status === "completed" || status === "skipped";
  });
}

function runHasOpenPrs(run: DeliveryRun): boolean {
  return Boolean(
    run.beta_pr_id ||
      run.pr_id ||
      run.beta_pr_url ||
      run.pr_url ||
      run.master_pr_id ||
      run.master_pr_url,
  );
}

function runHasPostMergeWork(run: DeliveryRun): boolean {
  return Boolean(run.pending_deploy_retry || run.beta_merged || run.master_merged);
}

/** True when the Pull Request step should be shown and navigable. */
export function isPrReviewReady(run: DeliveryRun): boolean {
  const phase = run.workflow_phase;
  const hasOpenPrs = runHasOpenPrs(run);
  const hasPostMergeWork = runHasPostMergeWork(run);

  if (hasPostMergeWork) return true;

  if (phase === "pr_review") {
    return arePrCreationStepsComplete(run) || hasOpenPrs;
  }

  if (run.status === "awaiting_approval" && phase !== "local_development") {
    return arePrCreationStepsComplete(run);
  }

  return false;
}

export function latestStepEntry(stepsLog: DeliveryRun["steps_log"], stepId: string) {
  const entries = stepsLog.filter((s) => s.step === stepId);
  return entries[entries.length - 1];
}

export function latestStepStatus(
  stepsLog: DeliveryRun["steps_log"],
  stepId: string,
): string | null {
  return latestStepEntry(stepsLog, stepId)?.status ?? null;
}

export function isVerifyStepResolved(run: DeliveryRun, stepId: "verify_beta" | "verify_master"): boolean {
  const status = latestStepStatus(run.steps_log ?? [], stepId);
  return status === "completed" || status === "skipped";
}

export function isMergeOrDeployRunning(run: DeliveryRun): boolean {
  if (run.status !== "running") return false;
  return ["merge_beta_pr", "merge_master_pr", "deploy_beta", "deploy_master"].some(
    (step) => latestStepStatus(run.steps_log ?? [], step) === "running",
  );
}

export function isVerifyStepRunning(run: DeliveryRun): boolean {
  if (run.pending_verification) return false;
  return ["verify_beta", "verify_master"].some(
    (step) => latestStepStatus(run.steps_log ?? [], step) === "running",
  );
}

export function isDeployStepSatisfied(
  run: DeliveryRun,
  target: "beta" | "master",
  deployStep: "deploy_beta" | "deploy_master",
): boolean {
  const status = latestStepStatus(run.steps_log ?? [], deployStep);
  if (status === "completed" || status === "skipped") return true;

  if (
    (run.deployment_history ?? []).some(
      (attempt) => attempt.environment === target && attempt.status === "completed",
    )
  ) {
    return true;
  }

  const commands = target === "beta" ? run.staging_deploy_commands : run.live_deploy_commands;
  const merged =
    target === "beta"
      ? Boolean(run.beta_merged)
      : Boolean(run.master_merged || (run.unified_deploy_target && run.beta_merged));
  if (merged && commands.length === 0) {
    return true;
  }

  return false;
}

export function inferNextVerificationTarget(run: DeliveryRun): "beta" | "master" | null {
  if (run.pending_verification || run.pending_deploy_retry) return null;

  const checks: Array<{
    target: "beta" | "master";
    deploy: "deploy_beta" | "deploy_master";
    verify: "verify_beta" | "verify_master";
    ready: boolean;
  }> = [
    {
      target: "beta",
      deploy: "deploy_beta",
      verify: "verify_beta",
      ready: Boolean(run.beta_merged),
    },
    {
      target: "master",
      deploy: "deploy_master",
      verify: "verify_master",
      ready: Boolean(run.master_merged || (run.unified_deploy_target && run.beta_merged)),
    },
  ];

  for (const { target, deploy, verify, ready } of checks) {
    if (!ready) continue;
    if (!isDeployStepSatisfied(run, target, deploy)) continue;
    if (isVerifyStepResolved(run, verify)) continue;
    return target;
  }

  return null;
}

export function canAccessVerificationStep(run: DeliveryRun): boolean {
  const verificationDone = run.workflow_phase === "completed" && run.status === "completed";
  if (verificationDone) return true;
  if (run.pending_verification || isVerifyStepRunning(run)) return true;
  if (inferNextVerificationTarget(run)) return true;
  if ((run.verifications ?? []).length > 0) return true;
  return false;
}

export function needsLivePrMergeStep(run: DeliveryRun): boolean {
  return Boolean(
    run.beta_merged &&
      (run.master_pr_id || run.master_pr_url) &&
      !run.master_merged &&
      isVerifyStepResolved(run, "verify_beta"),
  );
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
  if (isVerifyStepRunning(run)) return true;
  if (inferNextVerificationTarget(run)) return true;
  if ((run.verifications ?? []).length > 0) return true;
  if (isMergeOrDeployRunning(run)) return true;

  const stepsLog = run.steps_log ?? [];
  if (
    stepsLog.some(
      (entry) =>
        MERGE_DEPLOY_STEP_IDS.includes(entry.step as (typeof MERGE_DEPLOY_STEP_IDS)[number]) &&
        entry.status === "running",
    )
  ) {
    return true;
  }

  return false;
}

export function getActiveUiStep(run: DeliveryRun): number {
  const phase = run.workflow_phase;
  const estimationPosted = [
    "ready_for_implementation",
    "implementation",
    "local_development",
    "pr_review",
    "completed",
  ].includes(phase);
  const verificationDone = phase === "completed" && run.status === "completed";
  const prReviewReady = isPrReviewReady(run);

  let computed = 1;
  if (verificationDone) {
    computed = 4;
  } else if (isMergeOrDeployRunning(run) || run.pending_deploy_retry) {
    computed = 3;
  } else if (
    needsLivePrMergeStep(run) &&
    !run.pending_verification &&
    !isVerifyStepRunning(run)
  ) {
    computed = 3;
  } else if (
    run.pending_verification ||
    isVerifyStepRunning(run) ||
    inferNextVerificationTarget(run)
  ) {
    computed = 4;
  } else if ((run.verifications ?? []).length > 0) {
    computed = 4;
  } else if (prReviewReady) {
    computed = 3;
  } else if (estimationPosted || phase === "implementation" || phase === "local_development") {
    computed = 2;
  }

  const capForPrCreation = (step: number) =>
    prReviewReady || step <= 2 ? step : 2;

  if (run.ui_active_step && run.ui_active_step >= 1 && run.ui_active_step <= 4) {
    if (isMergeOrDeployRunning(run) || run.pending_deploy_retry) {
      return Math.min(run.ui_active_step, 3);
    }
    if (
      needsLivePrMergeStep(run) &&
      !run.pending_verification &&
      !isVerifyStepRunning(run)
    ) {
      return Math.min(run.ui_active_step, 3);
    }
    return capForPrCreation(Math.max(run.ui_active_step, computed));
  }

  return capForPrCreation(computed);
}

export function getMaxNavigableStep(run: DeliveryRun): number {
  const active = getActiveUiStep(run);
  if (canAccessVerificationStep(run)) {
    return Math.max(active, 4);
  }
  return active;
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
