import { useEffect, useState } from "react";
import { DeliveryRun, PendingWebsiteVerification, WebsiteVerification, api } from "../api/client";
import {
  inferNextVerificationTarget,
  isVerifyStepRunning,
  needsLivePrMergeStep,
} from "../utils/deliverySteps";

interface VerificationPanelProps {
  run: DeliveryRun;
  isActive: boolean;
  retryDisabled: boolean;
  retryingDeployment: boolean;
  mergeInProgress: boolean;
  startingVerification?: boolean;
  onStartVerification?: () => void;
  onMoveToPullRequest?: () => void;
  onPostVerification?: (comment: string) => void;
  postingVerification?: boolean;
}

function VerificationScreenshot({
  runId,
  environment,
}: {
  runId: string;
  environment: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const load = async () => {
      try {
        const response = await fetch(api.verificationScreenshotUrl(runId, environment), {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Screenshot unavailable");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) setSrc(objectUrl);
      } catch {
        if (active) setFailed(true);
      }
    };

    void load();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [runId, environment]);

  if (failed) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-slate-500 text-center">
        Screenshot preview unavailable
      </div>
    );
  }

  if (!src) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 flex items-center justify-center">
        <span className="h-5 w-5 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={src}
        alt={`${environment} website screenshot`}
        className="w-full rounded-lg border border-gray-200 shadow-sm"
      />
    </a>
  );
}

function formatPageType(pageType?: string | null): string {
  if (!pageType) return "";
  return pageType.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function PendingVerificationReview({
  run,
  pending,
  disabled,
  posting,
  onPost,
}: {
  run: DeliveryRun;
  pending: PendingWebsiteVerification;
  disabled: boolean;
  posting: boolean;
  onPost?: (comment: string) => void;
}) {
  const [comment, setComment] = useState(pending.draft_comment);

  useEffect(() => {
    setComment(pending.draft_comment);
  }, [pending.draft_comment]);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-slate-900">Verify {pending.environment} website</h4>
          {pending.page_type && (
            <p className="text-xs font-medium text-blue-700 mt-0.5">
              Screenshot: {formatPageType(pending.page_type)} page
            </p>
          )}
          <p className="text-sm text-slate-600 break-all mt-0.5">{pending.url}</p>
          {pending.page_reason && (
            <p className="text-xs text-slate-500 mt-1">{pending.page_reason}</p>
          )}
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            pending.passed ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-800"
          }`}
        >
          {pending.passed ? "Looks good" : "Needs review"}
        </span>
      </div>

      {pending.summary && <p className="text-sm text-slate-700">{pending.summary}</p>}

      {pending.findings.length > 0 && (
        <ul className="text-sm text-slate-700 list-disc pl-5 space-y-1">
          {pending.findings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Website screenshot
        </p>
        <VerificationScreenshot runId={run.id} environment={pending.environment} />
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="text-sm font-semibold text-slate-800" htmlFor="verification-comment">
            Jira comment for Unit Testing
          </label>
          <span className="text-xs text-blue-600 font-medium">AI-generated — editable</span>
        </div>
        <textarea
          id="verification-comment"
          className="input min-h-[180px] resize-y text-sm leading-relaxed"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={disabled || posting}
        />
        <p className="text-xs text-slate-500 mt-2">
          Review the screenshot and comment above. The screenshot is uploaded to Jira only when you post.
          {pending.admin_paths && pending.admin_paths.length > 0 && (
            <>
              {" "}
              Admin-related paths will be written to the Admin/ Database field:{" "}
              {pending.admin_paths.join(", ")}.
            </>
          )}
        </p>
      </div>

      {onPost && (
        <button
          type="button"
          onClick={() => onPost(comment.trim())}
          disabled={disabled || posting || !comment.trim()}
          className="btn-primary"
        >
          {posting ? "Posting to Jira…" : "Post comment & screenshot to Jira"}
        </button>
      )}
    </div>
  );
}

function CompletedVerificationItem({ item }: { item: WebsiteVerification }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">Verify {item.environment} website</span>
        <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
          Posted to Jira
        </span>
      </div>
      <p className="text-sm text-slate-600 break-all mt-1">{item.url}</p>
      {item.summary && <p className="text-sm text-slate-700 mt-1">{item.summary}</p>}
      {item.screenshot_filename && (
        <p className="text-xs text-slate-500 mt-2">Screenshot: {item.screenshot_filename}</p>
      )}
    </div>
  );
}

function statusIndicator({
  pendingVerification,
  verifyStepRunning,
  readyToStart,
}: {
  pendingVerification: boolean;
  verifyStepRunning: boolean;
  readyToStart: boolean;
}): { label: string; className: string } {
  if (verifyStepRunning) {
    return { label: "In progress", className: "bg-blue-100 text-blue-700" };
  }
  if (pendingVerification) {
    return { label: "Review verification", className: "bg-amber-100 text-amber-800" };
  }
  if (readyToStart) {
    return { label: "Ready to test", className: "bg-brand-100 text-brand-700" };
  }
  return { label: "Awaiting verification", className: "bg-amber-100 text-amber-800" };
}

function actionDescription({
  pendingVerification,
  verifyingWebsite,
  readyToStart,
  nextTarget,
}: {
  pendingVerification: boolean;
  verifyingWebsite: boolean;
  readyToStart: boolean;
  nextTarget: "beta" | "master" | null;
}): string {
  if (verifyingWebsite) {
    return "Choosing the relevant page from the ticket, capturing a screenshot, and drafting a Jira comment for Unit Testing…";
  }
  if (pendingVerification) {
    return "Review the website screenshot and Jira comment below. Edit if needed, then post to Jira to continue.";
  }
  if (readyToStart) {
    const envLabel = nextTarget === "master" ? "Live" : "Staging";
    return `${envLabel} deployment finished. Start testing to capture a website screenshot and draft the Unit Testing comment.`;
  }
  return "After deployment completes, start testing to verify the website and prepare a Jira comment for your review.";
}

function verificationEnvironmentLabel(target: "beta" | "master" | null): string {
  if (target === "master") return "Live";
  return "Staging";
}

export default function VerificationPanel({
  run,
  isActive,
  retryDisabled,
  retryingDeployment,
  mergeInProgress,
  startingVerification = false,
  onStartVerification,
  onMoveToPullRequest,
  onPostVerification,
  postingVerification = false,
}: VerificationPanelProps) {
  const verifications = run.verifications ?? [];
  const pendingVerification = run.pending_verification;
  const nextVerificationTarget = inferNextVerificationTarget(run);
  const readyToStartTesting = Boolean(nextVerificationTarget && !pendingVerification && onStartVerification);
  const verifyStepRunning = isVerifyStepRunning(run) || startingVerification;
  const showLivePrMergePrompt = needsLivePrMergeStep(run) && !pendingVerification && !verifyStepRunning;
  const hasContent =
    isActive ||
    verifications.length > 0 ||
    Boolean(pendingVerification) ||
    verifyStepRunning ||
    readyToStartTesting ||
    showLivePrMergePrompt;

  if (!hasContent) return null;

  const status = statusIndicator({
    pendingVerification: Boolean(pendingVerification),
    verifyStepRunning,
    readyToStart: readyToStartTesting,
  });
  const description = actionDescription({
    pendingVerification: Boolean(pendingVerification),
    verifyingWebsite: verifyStepRunning,
    readyToStart: readyToStartTesting,
    nextTarget: nextVerificationTarget,
  });

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

      {verifyStepRunning && (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 flex items-center gap-3">
          <span className="h-5 w-5 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin flex-shrink-0" />
          <span>Choosing the relevant page and capturing a screenshot for Unit Testing…</span>
        </div>
      )}

      {readyToStartTesting && !verifyStepRunning && (
        <div className="mb-5">
          <button
            type="button"
            onClick={onStartVerification}
            disabled={retryDisabled || retryingDeployment || mergeInProgress || startingVerification}
            className="btn-primary"
          >
            {startingVerification
              ? "Starting testing…"
              : `Start Testing (${verificationEnvironmentLabel(nextVerificationTarget)})`}
          </button>
        </div>
      )}

      {pendingVerification && !verifyStepRunning && (
        <div className="mb-5">
          <PendingVerificationReview
            run={run}
            pending={pendingVerification}
            disabled={retryDisabled || retryingDeployment || mergeInProgress}
            posting={postingVerification}
            onPost={onPostVerification}
          />
        </div>
      )}

      {showLivePrMergePrompt && onMoveToPullRequest && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-3">
          <div>
            <h4 className="font-semibold text-slate-900">Staging verification posted</h4>
            <p className="text-sm text-slate-600 mt-1">
              Continue in the Pull Request step to approve and merge the Live pull request.
            </p>
          </div>
          <button type="button" onClick={onMoveToPullRequest} className="btn-primary">
            Move to Pull Request step — Merge Live PR
          </button>
        </div>
      )}

      {verifications.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Completed verifications</h3>
          <div className="space-y-3">
            {verifications.map((item) => (
              <CompletedVerificationItem key={item.environment} item={item} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
