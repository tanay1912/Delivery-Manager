import { useState } from "react";
import { DeliveryRun, WebsiteVerification } from "../api/client";
import DeploymentTerminal, { TerminalLine } from "./DeploymentTerminal";
import DeploymentErrorBanner from "./DeploymentErrorBanner";
import {
  deploymentErrorSummary,
  deploymentErrorTitle,
  isGitAuthDeploymentError,
} from "../utils/deploymentErrors";

interface VerificationPanelProps {
  run: DeliveryRun;
  isActive: boolean;
  deploymentFailed: boolean;
  mergeFailedTarget: "beta" | "master" | null;
  deploymentErrorMessage: string | null;
  deploymentFailureDetail: string | null;
  mergeErrorMessage: string | null;
  terminalLines: TerminalLine[];
  mergeInProgress: boolean;
  retryingDeployment: boolean;
  retryDisabled: boolean;
  showDeployButton: boolean;
  onRunDeploy?: () => void;
}

function VerifyChecklistItem({
  item,
  manualChecked,
  onToggle,
}: {
  item: WebsiteVerification;
  manualChecked: boolean;
  onToggle: () => void;
}) {
  const verified = item.passed || manualChecked;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={verified}
          onChange={onToggle}
          disabled={item.passed}
          className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          aria-label={`Mark ${item.environment} as verified`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">Verify {item.environment} website</span>
            {item.passed ? (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                Verified
              </span>
            ) : (
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                Pending
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 break-all mt-1">{item.url}</p>
          {item.summary && <p className="text-sm text-slate-700 mt-1">{item.summary}</p>}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Open &amp; Verify {item.environment} →
          </a>
        </div>
      </div>
    </div>
  );
}

function VerifyChecklist({ run }: { run: DeliveryRun }) {
  const [manualChecked, setManualChecked] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      {(run.verifications ?? []).map((item) => (
        <VerifyChecklistItem
          key={item.environment}
          item={item}
          manualChecked={Boolean(manualChecked[item.environment])}
          onToggle={() =>
            setManualChecked((prev) => ({
              ...prev,
              [item.environment]: !prev[item.environment],
            }))
          }
        />
      ))}
    </div>
  );
}

function statusIndicator({
  deploymentFailed,
  mergeFailedTarget,
  mergeInProgress,
  retryingDeployment,
}: {
  deploymentFailed: boolean;
  mergeFailedTarget: "beta" | "master" | null;
  mergeInProgress: boolean;
  retryingDeployment: boolean;
}): { label: string; className: string } {
  if (retryingDeployment || mergeInProgress) {
    return { label: "In progress", className: "bg-blue-100 text-blue-700" };
  }
  if (deploymentFailed) {
    return { label: "Deployment failed", className: "bg-red-100 text-red-700" };
  }
  if (mergeFailedTarget) {
    return { label: "Merge failed", className: "bg-red-100 text-red-700" };
  }
  return { label: "Awaiting verification", className: "bg-amber-100 text-amber-800" };
}

function actionDescription({
  deploymentFailed,
  mergeFailedTarget,
  mergeInProgress,
}: {
  deploymentFailed: boolean;
  mergeFailedTarget: "beta" | "master" | null;
  mergeInProgress: boolean;
}): string {
  if (deploymentFailed) {
    return "Staging deployment failed. Retry to run SSH commands, then verify the staging website before approving live merge.";
  }
  if (mergeFailedTarget) {
    return "Pull request merge failed. Resolve conflicts in Bitbucket, then retry merging before verification can continue.";
  }
  if (mergeInProgress) {
    return "Merge and deployment are running. Watch command progress below, then verify each environment when deployment completes.";
  }
  return "Review deployment command output below, then open each website and confirm the changes look correct before approving.";
}

export default function VerificationPanel({
  run,
  isActive,
  deploymentFailed,
  mergeFailedTarget,
  deploymentErrorMessage,
  deploymentFailureDetail,
  mergeErrorMessage,
  terminalLines,
  mergeInProgress,
  retryingDeployment,
  retryDisabled,
  showDeployButton,
  onRunDeploy,
}: VerificationPanelProps) {
  const verifications = run.verifications ?? [];
  const hasContent =
    isActive ||
    terminalLines.length > 0 ||
    verifications.length > 0 ||
    deploymentFailed ||
    Boolean(mergeFailedTarget);

  if (!hasContent) return null;

  const status = statusIndicator({
    deploymentFailed,
    mergeFailedTarget,
    mergeInProgress,
    retryingDeployment,
  });
  const description = actionDescription({ deploymentFailed, mergeFailedTarget, mergeInProgress });

  return (
    <section
      className={`bg-white rounded-xl p-6 ${
        isActive
          ? "border-2 border-blue-500 shadow-lg"
          : "border border-slate-200/80 shadow-sm"
      }`}
    >
      {isActive && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
              Active Step
            </span>
            <h2 className="text-lg font-bold text-slate-900">Step 4 — Verification</h2>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>
            {status.label}
          </span>
        </div>
      )}

      {isActive && (
        <p className="text-sm text-slate-600 mb-5 leading-relaxed">{description}</p>
      )}

      {deploymentFailed && !retryingDeployment && !mergeInProgress && (
        <DeploymentErrorBanner
          title={
            run.pending_deploy_retry === "beta"
              ? "Staging Deployment Failed"
              : deploymentErrorTitle(deploymentErrorMessage)
          }
          message={
            run.pending_deploy_retry === "beta"
              ? 'The deployment commands did not complete successfully. Click "Retry Deployment" to run them again.'
              : deploymentErrorSummary(deploymentErrorMessage)
          }
          detail={
            deploymentFailureDetail ??
            (deploymentErrorMessage && !isGitAuthDeploymentError(deploymentErrorMessage)
              ? deploymentErrorMessage
              : null)
          }
        />
      )}

      {mergeFailedTarget && !deploymentFailed && (
        <DeploymentErrorBanner
          title="Pull Request Merge Failed"
          message={
            mergeErrorMessage?.toLowerCase().includes("conflict")
              ? "This pull request has merge conflicts. Resolve them in Bitbucket, then try merging again."
              : "The merge request failed before deployment could start. Review the error and try again."
          }
          detail={mergeErrorMessage}
        />
      )}

      {showDeployButton && onRunDeploy && !deploymentFailed && (
        <div className="mb-4">
          <button
            type="button"
            onClick={onRunDeploy}
            disabled={retryDisabled || retryingDeployment || mergeInProgress}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {retryingDeployment ? "Running…" : "Run Staging deployment commands"}
          </button>
        </div>
      )}

      {terminalLines.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Deployment commands</h3>
          <DeploymentTerminal lines={terminalLines} />
        </div>
      )}

      {retryingDeployment && terminalLines.length === 0 && (
        <p className="text-sm text-slate-500 flex items-center gap-2 mb-5">
          <span className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
          Starting deployment commands…
        </p>
      )}

      {verifications.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Website verification</h3>
          <VerifyChecklist run={run} />
        </div>
      )}

      {mergeInProgress && terminalLines.length === 0 && verifications.length === 0 && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <span className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
          Merge and deployment in progress…
        </p>
      )}
    </section>
  );
}
