import { IssueSummary as IssueSummaryData } from "../api/client";

interface IssueSummaryProps {
  summary: IssueSummaryData | null;
  loading: boolean;
  projectLabel: string;
}

function StatCard({
  label,
  value,
  accent,
  loading,
}: {
  label: string;
  value: number;
  accent: string;
  loading: boolean;
}) {
  return (
    <div className="card px-5 py-4 flex items-center gap-4 min-w-0">
      <div className={`h-10 w-1 rounded-full flex-shrink-0 ${accent}`} />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
        {loading ? (
          <div className="h-8 w-12 skeleton mt-1" />
        ) : (
          <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">{value}</p>
        )}
      </div>
    </div>
  );
}

export default function IssueSummary({ summary, loading, projectLabel }: IssueSummaryProps) {
  const stats = [
    { label: "Total", value: summary?.total ?? 0, accent: "bg-brand-500" },
    { label: "To Do", value: summary?.todo ?? 0, accent: "bg-slate-400" },
    { label: "In Progress", value: summary?.in_progress ?? 0, accent: "bg-sky-500" },
    { label: "Done", value: summary?.done ?? 0, accent: "bg-emerald-500" },
  ];

  return (
    <div className="flex-shrink-0 mb-5">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">Ticket summary</h2>
          <p className="text-sm text-slate-500 mt-0.5">{projectLabel}</p>
        </div>
        {!loading && summary && summary.total > 0 && (
          <p className="text-sm text-slate-500 hidden sm:block">
            {Math.round((summary.done / summary.total) * 100)}% completed
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            accent={stat.accent}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}
