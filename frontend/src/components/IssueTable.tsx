import { Issue } from "../api/client";
import { formatFullDate, formatRelativeTime } from "../utils/relativeTime";

interface IssueTableProps {
  issues: Issue[];
  loading: boolean;
  total: number;
  pageIndex: number;
  maxResults: number;
  hasNext: boolean;
  siteUrl?: string;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onDeliver?: (issue: Issue) => void;
}

function statusBadge(category?: string, status?: string): string {
  const s = (status || "").toLowerCase();
  const cat = (category || "").toLowerCase();

  if (s.includes("unit test")) return "badge-status-testing";
  if (s.includes("in progress") || cat.includes("indeterminate")) return "badge-status-progress";
  if (s.includes("to do") || s === "new" || cat.includes("new")) return "badge-status-todo";
  if (s.includes("done") || s.includes("complete") || cat.includes("done")) return "badge-status-done";

  if (cat.includes("progress")) return "badge-status-progress";
  if (cat.includes("todo")) return "badge-status-todo";
  return "badge-status-todo";
}

function PriorityLabel({ priority }: { priority?: string }) {
  if (!priority) return <span className="text-slate-400">—</span>;

  const p = priority.toLowerCase();
  let dotClass = "bg-slate-400";
  if (p.includes("high") || p.includes("highest") || p.includes("critical")) {
    dotClass = "bg-red-500";
  } else if (p.includes("medium")) {
    dotClass = "bg-amber-400";
  } else if (p.includes("low") || p.includes("lowest")) {
    dotClass = "bg-emerald-500";
  }

  return (
    <span className="inline-flex items-center gap-2 text-slate-700 font-normal">
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotClass}`} aria-hidden="true" />
      {priority}
    </span>
  );
}

function DeliverArrow() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

const ACTION_BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none opacity-90 group-hover:opacity-100";

function deliverAction(status?: string): { label: string; showArrow: boolean; className: string } {
  const s = (status || "").toLowerCase().trim();

  const startDelivery = `${ACTION_BTN_BASE} bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500`;
  const continueStyle = `${ACTION_BTN_BASE} border border-blue-400 text-blue-600 bg-transparent hover:bg-blue-50 focus-visible:ring-blue-400`;
  const reviewPr = `${ACTION_BTN_BASE} bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500`;
  const verify = `${ACTION_BTN_BASE} bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500`;
  const viewSummary = `${ACTION_BTN_BASE} border border-slate-300 text-slate-400 bg-transparent hover:bg-slate-50 focus-visible:ring-slate-400`;

  if (s === "to do" || s === "new") {
    return { label: "Start Delivery", showArrow: true, className: startDelivery };
  }
  if (s === "in estimation" || s.includes("in estimation")) {
    return { label: "Continue", showArrow: true, className: continueStyle };
  }
  if (
    s === "estimation completed" ||
    s === "estimation complete" ||
    (s.includes("estimation") && (s.includes("complete") || s.includes("completed")))
  ) {
    return { label: "Continue", showArrow: true, className: continueStyle };
  }
  if (s === "in progress" || s.includes("in progress")) {
    return { label: "Continue", showArrow: true, className: continueStyle };
  }
  if (s === "unit testing" || s.includes("unit test")) {
    return { label: "Continue", showArrow: true, className: continueStyle };
  }
  if (
    s === "pull request review" ||
    s.includes("pull request review") ||
    s === "awaiting review" ||
    s.includes("awaiting review")
  ) {
    return { label: "Review PR", showArrow: true, className: reviewPr };
  }
  if (s === "verification" || s.includes("verification")) {
    return { label: "Verify", showArrow: true, className: verify };
  }
  if (s === "done" || (s.includes("done") && !s.includes("estimation"))) {
    return { label: "View Summary", showArrow: false, className: viewSummary };
  }

  return { label: "Continue", showArrow: true, className: continueStyle };
}

export default function IssueTable({
  issues,
  loading,
  total,
  pageIndex,
  maxResults,
  hasNext,
  siteUrl,
  onNextPage,
  onPreviousPage,
  onDeliver,
}: IssueTableProps) {
  const page = pageIndex + 1;
  const showingFrom = pageIndex * maxResults + (issues.length ? 1 : 0);
  const showingTo = pageIndex * maxResults + issues.length;
  const atEnd = issues.length > 0 && !hasNext;

  if (loading) {
    return (
      <div className="px-6 py-6 space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-11 skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto pl-2">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <th className="table-header">Key</th>
              <th className="table-header">Summary</th>
              <th className="table-header hidden md:table-cell">Status</th>
              <th className="table-header hidden lg:table-cell">Priority</th>
              <th className="table-header hidden lg:table-cell">Assignee</th>
              <th className="table-header hidden sm:table-cell">Updated</th>
              {onDeliver && <th className="table-header text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, index) => {
              const action = onDeliver ? deliverAction(issue.status) : null;
              return (
              <tr
                key={issue.id}
                className={`group transition-colors hover:bg-slate-50/50 ${
                  index % 2 === 0 ? "bg-white" : "bg-brand-50/20"
                }`}
              >
                <td className="px-6 py-3.5 border-b border-slate-100">
                  <a
                    href={siteUrl ? `${siteUrl}/browse/${issue.key}` : `#`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    {issue.key}
                  </a>
                </td>
                <td className="px-6 py-3.5 max-w-xs border-b border-slate-100">
                  <span className="block truncate text-slate-800 font-normal" title={issue.summary}>
                    {issue.summary}
                  </span>
                </td>
                <td className="px-6 py-3.5 hidden md:table-cell border-b border-slate-100">
                  <span className={statusBadge(issue.status_category, issue.status)}>
                    {issue.status || "—"}
                  </span>
                </td>
                <td className="px-6 py-3.5 hidden lg:table-cell border-b border-slate-100">
                  <PriorityLabel priority={issue.priority} />
                </td>
                <td className="px-6 py-3.5 hidden lg:table-cell border-b border-slate-100">
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
                    <span className="text-slate-600 font-normal truncate max-w-[120px]">
                      {issue.assignee || "Unassigned"}
                    </span>
                  </div>
                </td>
                <td
                  className="px-6 py-3.5 text-slate-600 text-sm font-normal hidden sm:table-cell border-b border-slate-100"
                  title={formatFullDate(issue.updated)}
                >
                  {formatRelativeTime(issue.updated)}
                </td>
                {onDeliver && action && (
                  <td className="px-6 py-3.5 text-right border-b border-slate-100">
                    <button
                      onClick={() => onDeliver(issue)}
                      className={action.className}
                    >
                      {action.label}
                      {action.showArrow && <DeliverArrow />}
                    </button>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {issues.length === 0 && (
        <div className="py-16 px-6 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-400 mb-4">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          <p className="text-slate-700 font-semibold">No tickets assigned to you</p>
          <p className="text-sm text-slate-500 mt-1.5 font-normal max-w-xs mx-auto">
            Select a different project from the sidebar, or check back when new tickets are assigned.
          </p>
        </div>
      )}

      {atEnd && (
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/40 text-center">
          <p className="text-sm text-slate-500">
            You&apos;ve reached the end — {total} ticket{total === 1 ? "" : "s"} total.
          </p>
        </div>
      )}

      {(pageIndex > 0 || hasNext) && (
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-100 bg-slate-50/50">
          <span className="text-sm text-slate-600 tabular-nums font-normal">
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
            <span className="px-2 py-1 text-sm text-slate-500 tabular-nums font-normal">Page {page}</span>
            <button disabled={!hasNext} onClick={onNextPage} className="btn-secondary btn-sm">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
