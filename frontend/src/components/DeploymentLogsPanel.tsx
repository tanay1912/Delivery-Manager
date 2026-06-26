import { useEffect, useState } from "react";
import DeploymentTerminal, { TerminalLine } from "./DeploymentTerminal";
import DeploymentErrorBanner from "./DeploymentErrorBanner";
import {
  deploymentErrorSummary,
  deploymentErrorTitle,
  isGitAuthDeploymentError,
} from "../utils/deploymentErrors";

const ENVIRONMENT_LABELS = {
  beta: "Staging",
  master: "Live",
} as const;

interface DeploymentLogsPanelProps {
  environment: "beta" | "master";
  deploymentFailed: boolean;
  mergeFailed: boolean;
  deploymentErrorMessage: string | null;
  deploymentFailureDetail: string | null;
  mergeErrorMessage: string | null;
  terminalLines: TerminalLine[];
  inProgress: boolean;
  retryingDeployment: boolean;
}

export default function DeploymentLogsPanel({
  environment,
  deploymentFailed,
  mergeFailed,
  deploymentErrorMessage,
  deploymentFailureDetail,
  mergeErrorMessage,
  terminalLines,
  inProgress,
  retryingDeployment,
}: DeploymentLogsPanelProps) {
  const environmentLabel = ENVIRONMENT_LABELS[environment];
  const [showDeploymentLogs, setShowDeploymentLogs] = useState(false);

  const hasDeploymentLogs =
    terminalLines.length > 0 || retryingDeployment || inProgress;

  const hasContent =
    inProgress ||
    retryingDeployment ||
    hasDeploymentLogs ||
    deploymentFailed ||
    mergeFailed;

  useEffect(() => {
    if (retryingDeployment || inProgress) {
      setShowDeploymentLogs(true);
    }
  }, [retryingDeployment, inProgress]);

  if (!hasContent) return null;

  return (
    <section className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-slate-900">{environmentLabel} deployment logs</h2>
        {(retryingDeployment || inProgress) && (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
            In progress
          </span>
        )}
      </div>

      {(inProgress || retryingDeployment) && (
        <div className="mb-5 rounded-lg border border-blue-300 bg-blue-50 p-4 flex items-start gap-3">
          <span className="mt-0.5 h-5 w-5 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin flex-shrink-0" />
          <div>
            <p className="font-semibold text-blue-900">{environmentLabel} deployment in progress</p>
            <p className="text-sm text-blue-800 mt-0.5">
              {retryingDeployment
                ? `Running ${environmentLabel.toLowerCase()} deployment commands — watch the output below for live progress.`
                : `Merging the ${environmentLabel.toLowerCase()} pull request and running deployment commands — watch the output below for live progress.`}
            </p>
          </div>
        </div>
      )}

      {deploymentFailed && !retryingDeployment && !inProgress && (
        <DeploymentErrorBanner
          title={
            environment === "beta"
              ? "Staging Deployment Failed"
              : deploymentErrorTitle(deploymentErrorMessage)
          }
          message={
            environment === "beta"
              ? 'The staging deployment commands did not complete successfully. Use "Deploy Now" on the pull request card to retry.'
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

      {mergeFailed && !deploymentFailed && (
        <div className="mb-5">
          <DeploymentErrorBanner
            title={`${environmentLabel} Pull Request Merge Failed`}
            message={
              mergeErrorMessage?.toLowerCase().includes("conflict")
                ? "This pull request has merge conflicts. Resolve them in Bitbucket, then try merging again."
                : "The merge request failed before deployment could start. Review the error and try again."
            }
            detail={mergeErrorMessage}
          />
        </div>
      )}

      {hasDeploymentLogs && (
        <div>
          <button
            type="button"
            onClick={() => setShowDeploymentLogs((open) => !open)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <span>Deployment commands</span>
            <span className="flex items-center gap-2 text-xs font-medium text-slate-500">
              {(retryingDeployment || inProgress) && (
                <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" />
              )}
              {showDeploymentLogs ? "Hide" : "Show"}
            </span>
          </button>
          {showDeploymentLogs && (
            <div className="mt-2">
              {terminalLines.length > 0 ? (
                <DeploymentTerminal lines={terminalLines} />
              ) : (
                <p className="text-sm text-slate-500 flex items-center gap-2 px-1 py-2">
                  <span className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
                  {retryingDeployment ? "Starting deployment commands…" : "Merge and deployment in progress…"}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
