import { IssueSummary, StatusBreakdown } from "../api/client";

const STATUS_SORT_PRIORITY: Record<string, number> = {
  "To Do": 10,
  "In Estimation": 20,
  "In Progress": 30,
  "Waiting for Information": 40,
  "Unit Testing": 50,
  Done: 90,
};

export const ISSUE_TYPE_CONFIG = [
  { key: "qis" as const, label: "QIS", badgeClass: "bg-violet-50 text-violet-700 ring-violet-200/60" },
  { key: "bug" as const, label: "Bug", badgeClass: "bg-red-50 text-red-700 ring-red-200/60" },
  { key: "task" as const, label: "Task", badgeClass: "bg-blue-50 text-blue-700 ring-blue-200/60" },
];

export function statusSummaryAccent(status: string): string {
  const normalized = status.toLowerCase();

  if (normalized.includes("unit test")) return "border-purple-500";
  if (normalized.includes("waiting")) return "border-orange-500";
  if (normalized.includes("in estimation") || (normalized.includes("estimation") && !normalized.includes("complete"))) {
    return "border-blue-500";
  }
  if (normalized.includes("in progress")) return "border-amber-500";
  if (normalized.includes("to do") || normalized === "new") return "border-slate-400";
  if (normalized.includes("done") || normalized.includes("complete")) return "border-emerald-500";

  return "border-slate-400";
}

export function statusSummaryTextClass(status: string): string {
  const normalized = status.toLowerCase();

  if (normalized.includes("unit test")) return "text-purple-700";
  if (normalized.includes("waiting")) return "text-orange-700";
  if (normalized.includes("in estimation") || (normalized.includes("estimation") && !normalized.includes("complete"))) {
    return "text-blue-700";
  }
  if (normalized.includes("in progress")) return "text-amber-700";
  if (normalized.includes("to do") || normalized === "new") return "text-slate-600";
  if (normalized.includes("done") || normalized.includes("complete")) return "text-emerald-700";

  return "text-slate-600";
}

function emptyBreakdown(): StatusBreakdown {
  return { total: 0, qis: 0, bug: 0, task: 0 };
}

function sortStatusEntries(entries: [string, StatusBreakdown][]): [string, StatusBreakdown][] {
  return [...entries].sort((a, b) => {
    const priorityA = STATUS_SORT_PRIORITY[a[0]] ?? 60;
    const priorityB = STATUS_SORT_PRIORITY[b[0]] ?? 60;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a[0].localeCompare(b[0]);
  });
}

export function issueTypeItems(breakdown?: StatusBreakdown) {
  if (!breakdown) return [];

  return ISSUE_TYPE_CONFIG.map(({ key, label, badgeClass }) => ({
    label,
    value: breakdown[key] ?? 0,
    badgeClass,
  })).filter((item) => item.value > 0);
}

export function issueTypeItemsFromSummary(summary?: IssueSummary | null) {
  if (!summary) return [];

  return ISSUE_TYPE_CONFIG.map(({ key, label, badgeClass }) => ({
    label,
    value: summary[key] ?? 0,
    badgeClass,
  })).filter((item) => item.value > 0);
}

export function aggregateProjectSummaries(summaries: Record<string, IssueSummary>): IssueSummary {
  const totals: IssueSummary = { total: 0, qis: 0, bug: 0, task: 0 };

  for (const summary of Object.values(summaries)) {
    totals.total += summary.total;
    totals.qis = (totals.qis ?? 0) + (summary.qis ?? 0);
    totals.bug = (totals.bug ?? 0) + (summary.bug ?? 0);
    totals.task = (totals.task ?? 0) + (summary.task ?? 0);
  }

  return totals;
}

export interface StatusSummaryItem {
  label: string;
  value: number;
  breakdown?: StatusBreakdown;
}

export function statusSummaryItems(summary?: IssueSummary | null): StatusSummaryItem[] {
  const items: StatusSummaryItem[] = [];

  const byStatus = summary?.by_status ?? {};
  for (const [status, breakdown] of sortStatusEntries(Object.entries(byStatus))) {
    if (breakdown.total > 0) {
      items.push({ label: status, value: breakdown.total, breakdown });
    }
  }

  return items;
}

export function mergeStatusSummaries(summaries: IssueSummary[]): Record<string, StatusBreakdown> {
  const merged: Record<string, StatusBreakdown> = {};

  for (const summary of summaries) {
    for (const [status, breakdown] of Object.entries(summary.by_status ?? {})) {
      const existing = merged[status] ?? emptyBreakdown();
      existing.total += breakdown.total;
      existing.qis = (existing.qis ?? 0) + (breakdown.qis ?? 0);
      existing.bug = (existing.bug ?? 0) + (breakdown.bug ?? 0);
      existing.task = (existing.task ?? 0) + (breakdown.task ?? 0);
      merged[status] = existing;
    }
  }

  return merged;
}
