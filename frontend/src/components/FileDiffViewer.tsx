import { useEffect, useState } from "react";
import { api, ApiError, FileDiff } from "../api/client";

function DiffLine({ line }: { line: string }) {
  let className = "text-slate-700";
  if (line.startsWith("+++") || line.startsWith("---")) {
    className = "text-slate-500 font-medium";
  } else if (line.startsWith("@@")) {
    className = "text-brand-600";
  } else if (line.startsWith("+")) {
    className = "text-emerald-800 bg-emerald-50";
  } else if (line.startsWith("-")) {
    className = "text-red-800 bg-red-50";
  }

  return (
    <div className={`font-mono text-xs leading-5 px-3 whitespace-pre-wrap break-all ${className}`}>
      {line || " "}
    </div>
  );
}

export default function FileDiffViewer({
  runId,
  filePath,
  action,
  refreshKey,
  onClose,
}: {
  runId: string;
  filePath: string;
  action: string;
  refreshKey?: string;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"diff" | "split">("diff");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDiff(null);

    api
      .getFileDiff(runId, filePath)
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load file diff");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId, filePath, refreshKey]);

  const diffAction = diff?.action ?? action;
  const isNewFile =
    diffAction === "add" || diffAction === "create" || action === "add" || action === "create";

  const diffLines = (() => {
    if (!diff) return [];
    if (diff.unified_diff?.trim()) {
      return diff.unified_diff.split("\n");
    }
    if (isNewFile && diff.new_content) {
      return diff.new_content.split("\n").map((line) => `+${line}`);
    }
    return [];
  })();

  useEffect(() => {
    if (isNewFile) {
      setView("diff");
    }
  }, [isNewFile, filePath]);

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 mb-0.5">File changes</p>
          <p className="font-mono text-sm text-slate-900 truncate">{filePath}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="badge-neutral">{action}</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setView("diff")}
              className={`btn-sm ${view === "diff" ? "bg-slate-100 text-slate-900" : "btn-ghost"}`}
            >
              Diff
            </button>
            <button
              type="button"
              onClick={() => setView("split")}
              className={`btn-sm ${view === "split" ? "bg-slate-100 text-slate-900" : "btn-ghost"}`}
            >
              Side by side
            </button>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">
            Close
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-8 text-center text-sm text-slate-500">Loading file diff…</div>
      )}

      {error && <div className="p-4 text-sm text-red-700 bg-red-50">{error}</div>}

      {!loading && !error && diff && view === "diff" && (
        <div className="max-h-[28rem] overflow-auto py-2">
          {isNewFile && diff.new_content && (
            <p className="px-4 pb-2 text-xs text-emerald-700 font-medium">
              New file — full contents ({diff.new_content.split("\n").length} lines)
            </p>
          )}
          {diffLines.length > 0 ? (
            diffLines.map((line, index) => <DiffLine key={`${index}-${line}`} line={line} />)
          ) : diff.new_content ? (
            diff.new_content.split("\n").map((line, index) => (
              <DiffLine key={`${index}-${line}`} line={`+${line}`} />
            ))
          ) : (
            <p className="px-4 py-6 text-sm text-slate-500">No content available for this file.</p>
          )}
        </div>
      )}

      {!loading && !error && diff && view === "split" && (
        <div className={`grid max-h-[28rem] overflow-auto ${isNewFile ? "grid-cols-1" : "md:grid-cols-2"}`}>
          {!isNewFile && (
            <div className="border-b md:border-b-0 md:border-r border-slate-100">
              <div className="sticky top-0 px-4 py-2 text-xs font-medium text-slate-500 bg-slate-50 border-b border-slate-100">
                Before ({diff.base_ref})
              </div>
              <pre className="p-4 text-xs font-mono text-slate-800 whitespace-pre-wrap break-all">
                {diff.old_content ?? "(empty)"}
              </pre>
            </div>
          )}
          <div>
            <div className="sticky top-0 px-4 py-2 text-xs font-medium text-slate-500 bg-slate-50 border-b border-slate-100">
              {isNewFile ? `New file (${diff.head_ref})` : `After (${diff.head_ref})`}
            </div>
            <pre className="p-4 text-xs font-mono text-slate-800 whitespace-pre-wrap break-all">
              {diff.new_content ?? (diffAction === "delete" ? "(deleted)" : "(empty)")}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
