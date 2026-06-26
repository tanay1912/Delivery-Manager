import { ReactNode, useState } from "react";

interface DangerZoneProps {
  children: ReactNode;
}

export default function DangerZone({ children }: DangerZoneProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-red-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-red-50/50 transition-colors text-left"
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold text-red-700">
          <span aria-hidden="true">⚠️ </span>
          Danger Zone
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {expanded ? "Hide" : "Show"}
          <svg
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {expanded && <div className="px-4 pb-4 pt-0 border-t border-red-100">{children}</div>}
    </div>
  );
}
