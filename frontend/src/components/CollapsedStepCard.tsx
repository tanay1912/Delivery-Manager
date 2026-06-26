import { ReactNode, useState } from "react";

interface CollapsedStepCardProps {
  title: string;
  summary: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}

function CheckIcon() {
  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 111.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

export default function CollapsedStepCard({
  title,
  summary,
  children,
  defaultExpanded = false,
}: CollapsedStepCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-left"
        aria-expanded={expanded}
      >
        <CheckIcon />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          <span className="text-sm text-slate-500 ml-2">{summary}</span>
        </div>
        <span
          className={`flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          aria-label={expanded ? "Collapse details" : "Expand details"}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {expanded && <div className="px-4 pb-4 pt-0 border-t border-gray-100">{children}</div>}
    </div>
  );
}
