import { useState } from "react";
import { DeliveryRun } from "../api/client";

function ExternalLinkIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

interface PullRequestDetailsCardProps {
  run: DeliveryRun;
  stagingDeployFailed: boolean;
  liveDeployFailed: boolean;
  stagingMergeFailed: boolean;
  liveMergeFailed: boolean;
}

type PrStatusVariant = "failed" | "success" | "neutral";

function resolvePrStatus(
  hasPr: boolean,
  merged: boolean,
  deployFailed: boolean,
  mergeFailed: boolean,
): { label: string; emoji: string; variant: PrStatusVariant } | null {
  if (!hasPr) return null;
  if (mergeFailed) return { label: "Merge conflict", emoji: "❌", variant: "failed" };
  if (deployFailed) return { label: "Deployment Failed", emoji: "❌", variant: "failed" };
  if (merged) return { label: "Merged", emoji: "✅", variant: "success" };
  return { label: "Open", emoji: "✅", variant: "success" };
}

const statusStyles: Record<PrStatusVariant, { card: string; status: string }> = {
  failed: {
    card: "border-l-4 border-red-500",
    status: "bg-red-50 border-t border-red-100 text-red-800",
  },
  success: {
    card: "border-l-4 border-green-500",
    status: "bg-green-50 border-t border-green-100 text-green-800",
  },
  neutral: {
    card: "border-l-4 border-gray-300",
    status: "bg-gray-50 border-t border-gray-100 text-gray-700",
  },
};

function PrCard({
  title,
  prUrl,
  status,
}: {
  title: string;
  prUrl: string | null | undefined;
  status: ReturnType<typeof resolvePrStatus>;
}) {
  if (!prUrl && !status) return null;

  const variant = status?.variant ?? "neutral";
  const styles = statusStyles[variant];

  return (
    <div className={`rounded-xl border border-gray-200 overflow-hidden flex flex-col ${status ? styles.card : ""}`}>
      <div className="p-4 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">{title}</p>
        {prUrl ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            View PR
            <ExternalLinkIcon />
          </a>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        )}
      </div>
      {status && (
        <div className={`px-4 py-3 text-sm ${styles.status}`}>
          <span className="font-medium text-slate-600">Status:</span>{" "}
          <span className="font-semibold">
            {status.emoji} {status.label}
          </span>
        </div>
      )}
    </div>
  );
}

function CopyBranchButton({ branchName }: { branchName: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(branchName);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — no-op
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="flex-shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-gray-50 transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function PullRequestDetailsCard({
  run,
  stagingDeployFailed,
  liveDeployFailed,
  stagingMergeFailed,
  liveMergeFailed,
}: PullRequestDetailsCardProps) {
  const stagingUrl = run.beta_pr_url || run.pr_url;
  const hasAnyPr = Boolean(run.branch_name || stagingUrl || run.master_pr_url);

  if (!hasAnyPr) return null;

  const stagingStatus = resolvePrStatus(
    Boolean(run.beta_pr_id || run.pr_id),
    run.beta_merged,
    stagingDeployFailed,
    stagingMergeFailed,
  );
  const liveStatus = resolvePrStatus(
    Boolean(run.master_pr_id),
    run.master_merged,
    liveDeployFailed,
    liveMergeFailed,
  );

  return (
    <div className="mb-6 space-y-4">
      {run.branch_name && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
          <p className="text-sm font-medium text-slate-700 mb-2">
            <span aria-hidden="true">🌿 </span>
            Feature Branch
          </p>
          <div className="flex items-start gap-3">
            <code className="flex-1 min-w-0 bg-gray-900 text-green-400 rounded-lg px-3 py-2 text-xs font-mono break-all">
              {run.branch_name}
            </code>
            <CopyBranchButton branchName={run.branch_name} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PrCard title="Staging PR" prUrl={stagingUrl} status={stagingStatus} />
        <PrCard title="Live PR" prUrl={run.master_pr_url} status={liveStatus} />
      </div>
    </div>
  );
}
