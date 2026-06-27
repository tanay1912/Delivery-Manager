import { useState, type ReactNode } from "react";
import type { DeliveryRun } from "../api/client";
import { getRevisionHistoryEntries } from "../utils/deliverySteps";
import ChangedFilesSection from "./ChangedFilesSection";
import FileDiffViewer from "./FileDiffViewer";

interface LocalDevelopmentPanelProps {
  run: DeliveryRun;
  creatingPrs: boolean;
  applyingRevision?: boolean;
  revisionPrompt: string;
  onRevisionPromptChange: (value: string) => void;
  onApplyRevision: () => void;
  disabled?: boolean;
  onCreatePrs: () => void;
  /** When PRs already exist or were merged — adjust confirm button copy. */
  postPrUpdate?: boolean;
  /** PR creation substeps shown below the Create Pull Request button. */
  prSteps?: ReactNode;
}

function latestStepEntry(stepsLog: DeliveryRun["steps_log"], stepId: string) {
  const entries = stepsLog.filter((s) => s.step === stepId);
  return entries[entries.length - 1];
}

function stepCompleted(stepsLog: DeliveryRun["steps_log"], stepId: string): boolean {
  const entry = latestStepEntry(stepsLog, stepId);
  return entry?.status === "completed";
}

export default function LocalDevelopmentPanel({
  run,
  creatingPrs,
  applyingRevision = false,
  revisionPrompt,
  onRevisionPromptChange,
  onApplyRevision,
  disabled = false,
  onCreatePrs,
  postPrUpdate = false,
  prSteps,
}: LocalDevelopmentPanelProps) {
  const [selectedFile, setSelectedFile] = useState<{ path: string; action: string } | null>(null);
  const hasChangedFiles = run.changed_files.length > 0;
  const revisionHistory = getRevisionHistoryEntries(run.steps_log);
  const actionDisabled = disabled || creatingPrs || applyingRevision;
  const prsCreated = stepCompleted(run.steps_log, "confirm_local_changes");
  const commitDone = stepCompleted(run.steps_log, "commit_changes");
  const hasPendingChanges = hasChangedFiles && (!prsCreated || !commitDone);
  const showCreatePrs = hasPendingChanges;
  const confirmLabel = postPrUpdate
    ? creatingPrs
      ? "Pushing changes…"
      : "Push changes & update pull requests"
    : creatingPrs
      ? "Creating pull request…"
      : "Create Pull Request";

  return (
    <section className="card mb-6 overflow-hidden border-2 border-brand-400 shadow-brand-md">
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
        <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-700">
          Current Step
        </span>
        <h2 className="text-lg font-bold text-brand-600 mt-2">Review generated changes</h2>
        <p className="text-sm text-slate-600 mt-1">
          {postPrUpdate ? (
            <>
              Update code on branch{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-800">
                {run.branch_name || "feature branch"}
              </code>
              , then push to refresh open pull requests or open new ones if already merged.
            </>
          ) : (
            <>
              Review the generated code on branch{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-800">
                {run.branch_name || "feature branch"}
              </code>
              , then create pull requests when ready.
            </>
          )}
        </p>
      </div>

      <div className="p-6 space-y-5">
        {hasChangedFiles ? (
          <>
            <ChangedFilesSection
              files={run.changed_files}
              selectedPath={selectedFile?.path ?? null}
              defaultExpanded
              listKey={run.changed_files_refreshed_at ?? run.updated_at}
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
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800">No changed files yet</p>
            <p className="mt-1">
              Generated file changes will appear here once code generation completes.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <label className="label mb-1.5" htmlFor="local-revision-prompt">
              Update generated code
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Describe what to change. Updates are applied to the generated code preview above.
            </p>
            <textarea
              id="local-revision-prompt"
              className="input min-h-[120px] resize-y text-sm leading-relaxed"
              value={revisionPrompt}
              onChange={(e) => onRevisionPromptChange(e.target.value)}
              placeholder="e.g. Add validation to the email field and rename the submit button to Save"
              disabled={actionDisabled}
            />
          </div>
          {applyingRevision && (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin flex-shrink-0" />
              <div>
                <p className="font-medium">Applying your requested changes…</p>
                <p className="text-slate-500 mt-0.5">The file list will refresh when complete</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onApplyRevision}
            disabled={actionDisabled || !revisionPrompt.trim()}
            className="btn-secondary"
          >
            {applyingRevision ? "Updating code…" : "Update generated code"}
          </button>
        </div>

        {revisionHistory.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Revision history</h3>
            <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {revisionHistory.map((entry, index) => (
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
                  {entry.message && <p className="text-slate-600 whitespace-pre-wrap">{entry.message}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(showCreatePrs || creatingPrs) && (
          <div className="space-y-3 pt-1">
            {showCreatePrs && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onCreatePrs}
                  disabled={actionDisabled}
                  className="min-w-48 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {confirmLabel}
                </button>
              </div>
            )}
            {prSteps}
            {showCreatePrs && (
              <p className="text-xs text-slate-500">
                {postPrUpdate
                  ? "Commits changes to the feature branch. Open pull requests are updated automatically; new ones are created when the previous PR was merged."
                  : "Commits the generated changes to the feature branch and opens pull requests to Staging and Live."}
              </p>
            )}
          </div>
        )}
        {run.error_message && (
          <p className="text-sm text-red-700">{run.error_message}</p>
        )}
      </div>
    </section>
  );
}
