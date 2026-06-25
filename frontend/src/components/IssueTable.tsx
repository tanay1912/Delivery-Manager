import { Issue } from "../api/client";

interface IssueTableProps {
  issues: Issue[];
  loading: boolean;
  total: number;
  pageIndex: number;
  maxResults: number;
  hasNext: boolean;
  siteUrl?: string;
  deliveringKey?: string | null;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onDeliver?: (issue: Issue) => void;
}

function statusBadge(category?: string, status?: string): string {
  const cat = (category || status || "").toLowerCase();
  if (cat.includes("done") || cat.includes("complete")) return "badge-success";
  if (cat.includes("progress") || cat.includes("indeterminate")) return "badge-info";
  if (cat.includes("todo") || cat.includes("new")) return "badge-neutral";
  return "badge-warning";
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function IssueTable({
  issues,
  loading,
  total,
  pageIndex,
  maxResults,
  hasNext,
  siteUrl,
  deliveringKey,
  onNextPage,
  onPreviousPage,
  onDeliver,
}: IssueTableProps) {
  const page = pageIndex + 1;
  const showingFrom = pageIndex * maxResults + (issues.length ? 1 : 0);
  const showingTo = pageIndex * maxResults + issues.length;

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-11 skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Key
              </th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Summary
              </th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 hidden md:table-cell">
                Status
              </th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 hidden lg:table-cell">
                Priority
              </th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 hidden lg:table-cell">
                Assignee
              </th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 hidden sm:table-cell">
                Updated
              </th>
              {onDeliver && (
                <th className="text-right px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Action
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {issues.map((issue) => (
              <tr key={issue.id} className="group hover:bg-brand-50/30 transition-colors">
                <td className="px-5 py-3.5">
                  <a
                    href={siteUrl ? `${siteUrl}/browse/${issue.key}` : `#`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm font-medium text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    {issue.key}
                  </a>
                </td>
                <td className="px-5 py-3.5 max-w-xs">
                  <span className="block truncate text-slate-800" title={issue.summary}>
                    {issue.summary}
                  </span>
                </td>
                <td className="px-5 py-3.5 hidden md:table-cell">
                  <span className={statusBadge(issue.status_category, issue.status)}>
                    {issue.status || "—"}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-slate-600 hidden lg:table-cell">
                  {issue.priority || "—"}
                </td>
                <td className="px-5 py-3.5 hidden lg:table-cell">
                  <div className="flex items-center gap-2.5">
                    {issue.assignee_avatar ? (
                      <img
                        src={issue.assignee_avatar}
                        alt=""
                        className="w-6 h-6 rounded-full ring-1 ring-slate-200"
                      />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-semibold text-slate-500">
                        ?
                      </span>
                    )}
                    <span className="text-slate-600 truncate max-w-[120px]">
                      {issue.assignee || "Unassigned"}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-slate-500 text-xs tabular-nums hidden sm:table-cell">
                  {formatDate(issue.updated)}
                </td>
                {onDeliver && (
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => onDeliver(issue)}
                      disabled={deliveringKey === issue.key}
                      className="btn-primary btn-sm opacity-90 group-hover:opacity-100"
                    >
                      {deliveringKey === issue.key ? "Opening…" : "Deliver"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {issues.length === 0 && (
        <div className="py-16 px-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-4">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
          <p className="text-slate-600 font-medium">No tickets assigned to you</p>
          <p className="text-sm text-slate-500 mt-1">Try selecting a different project.</p>
        </div>
      )}

      {(pageIndex > 0 || hasNext) && (
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-100 bg-slate-50/50">
          <span className="text-sm text-slate-600 tabular-nums">
            {issues.length > 0 ? (
              <>
                {showingFrom}–{showingTo} of {total}
              </>
            ) : (
              <>0 of {total}</>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={pageIndex === 0}
              onClick={onPreviousPage}
              className="btn-secondary btn-sm"
            >
              Previous
            </button>
            <span className="px-2 py-1 text-sm text-slate-500 tabular-nums">Page {page}</span>
            <button disabled={!hasNext} onClick={onNextPage} className="btn-secondary btn-sm">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
