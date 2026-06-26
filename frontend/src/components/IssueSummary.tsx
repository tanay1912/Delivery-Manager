import { IssueSummary as IssueSummaryData, StatusBreakdown } from "../api/client";
import { issueTypeItems, statusSummaryAccent, statusSummaryItems } from "../utils/statusSummary";

interface IssueSummaryProps {
  summary: IssueSummaryData | null;
  loading: boolean;
  projectLabel: string;
}

const STAT_ACCENT: Record<string, string> = {
  Total: "border-blue-500",
};

function IssueTypeBadges({ breakdown }: { breakdown?: StatusBreakdown }) {
  const types = issueTypeItems(breakdown);

  if (types.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {types.map((type) => (
        <span
          key={type.label}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${type.badgeClass}`}
        >
          {type.label}
          <span className="tabular-nums">{type.value}</span>
        </span>
      ))}
    </div>
  );
}

function StatItem({
  label,
  value,
  breakdown,
  loading,
  showDivider,
}: {
  label: string;
  value: number;
  breakdown?: StatusBreakdown;
  loading: boolean;
  showDivider: boolean;
}) {
  const accent = STAT_ACCENT[label] ?? statusSummaryAccent(label);
  const showIssueTypes = label !== "Total";

  const isTotal = label === "Total";

  return (
    <div
      className={`flex items-center py-3 ${
        isTotal
          ? "flex-none shrink-0 w-max px-3"
          : "flex-1 basis-0 min-w-[9.5rem] px-4 sm:px-5"
      } ${showDivider ? "border-l border-slate-200" : ""}`}
    >
      <div className={`border-l-[3px] min-w-0 ${isTotal ? "pl-2 w-max" : "pl-3"} ${accent}`}>
        {loading ? (
          <div className={`skeleton ${isTotal ? "h-8 w-8" : "h-8 w-12"}`} />
        ) : (
          <p
            className={`font-bold text-slate-900 tabular-nums tracking-tight leading-none ${
              isTotal ? "text-2xl" : "text-2xl sm:text-3xl"
            }`}
          >
            {value}
          </p>
        )}
        <div className={`mt-1 flex flex-wrap items-center gap-1.5 ${isTotal ? "whitespace-nowrap" : ""}`}>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
          {showIssueTypes && <IssueTypeBadges breakdown={breakdown} />}
        </div>
      </div>
    </div>
  );
}

export default function IssueSummary({ summary, loading, projectLabel }: IssueSummaryProps) {
  const stats = statusSummaryItems(summary);

  return (
    <div className="flex-shrink-0 bg-white">
      <div className="px-5 pt-4 pb-3">
        <p className="text-xs font-medium text-slate-500 tracking-wide">
          Ticket summary
          <span className="text-slate-300 mx-2" aria-hidden="true">
            ·
          </span>
          {projectLabel}
        </p>
      </div>
      {loading ? (
        <div className="border-t border-slate-200/80 px-5 py-3">
          <div className="h-10 w-full max-w-lg skeleton rounded" />
        </div>
      ) : stats.length > 0 ? (
        <div className="flex border-t border-slate-200/80 overflow-x-auto">
          {stats.map((stat, index) => (
            <StatItem
              key={stat.label}
              label={stat.label}
              value={stat.value}
              breakdown={stat.breakdown}
              loading={false}
              showDivider={index > 0}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
