import { ReactNode } from "react";
import { IssueSummary as IssueSummaryData } from "../api/client";

interface IssueSummaryProps {
  summary: IssueSummaryData | null;
  loading: boolean;
  projectLabel: string;
}

const STAT_CONFIG: Record<
  string,
  { tint: string; borderHover: string; iconBg: string; icon: ReactNode }
> = {
  Total: {
    tint: "bg-brand-50",
    borderHover: "hover:border-brand-300",
    iconBg: "bg-brand-100 text-brand-600",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  "To Do": {
    tint: "bg-[#f9fafb]",
    borderHover: "hover:border-slate-300",
    iconBg: "bg-slate-200 text-slate-600",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="9" strokeWidth={1.75} />
      </svg>
    ),
  },
  "In Progress": {
    tint: "bg-[#eff6ff]",
    borderHover: "hover:border-blue-300",
    iconBg: "bg-blue-100 text-blue-600",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  Done: {
    tint: "bg-[#f0fdf4]",
    borderHover: "hover:border-emerald-300",
    iconBg: "bg-emerald-100 text-emerald-600",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
};

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading: boolean;
}) {
  const config = STAT_CONFIG[label] ?? STAT_CONFIG.Total;

  return (
    <div
      className={`rounded-2xl border border-slate-200/80 px-5 py-5 flex items-center gap-4 min-w-0 shadow-sm transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5 ${config.tint} ${config.borderHover}`}
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0 ${config.iconBg}`}>
        {config.icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
        {loading ? (
          <div className="h-9 w-14 skeleton mt-1.5" />
        ) : (
          <p className="text-3xl font-extrabold text-slate-900 tabular-nums tracking-tight leading-none mt-1">
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

export default function IssueSummary({ summary, loading, projectLabel }: IssueSummaryProps) {
  const stats = [
    { label: "Total", value: summary?.total ?? 0 },
    { label: "To Do", value: summary?.todo ?? 0 },
    { label: "In Progress", value: summary?.in_progress ?? 0 },
    { label: "Done", value: summary?.done ?? 0 },
  ];

  return (
    <div className="flex-shrink-0 mb-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900 tracking-tight">Ticket summary</h2>
        <p className="text-sm text-slate-500 mt-0.5 font-normal">{projectLabel}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} loading={loading} />
        ))}
      </div>
    </div>
  );
}
