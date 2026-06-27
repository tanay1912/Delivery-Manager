import { useState } from "react";
import { ChangedFile } from "../api/client";

function actionBadge(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("add") || a === "added") {
    return "rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700";
  }
  if (a.includes("delete") || a === "removed") {
    return "rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700";
  }
  return "rounded px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700";
}

interface ChangedFilesSectionProps {
  files: ChangedFile[];
  selectedPath: string | null;
  onSelect: (file: ChangedFile | null) => void;
  defaultExpanded?: boolean;
  /** Changes when the file list is refreshed — forces list remount. */
  listKey?: string | null;
}

export default function ChangedFilesSection({
  files,
  selectedPath,
  onSelect,
  defaultExpanded = false,
  listKey,
}: ChangedFilesSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (files.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm font-semibold text-slate-800 hover:text-brand-700 transition-colors"
      >
        <span className={`text-xs transition-transform ${expanded ? "rotate-180" : ""}`}>▼</span>
        Changed files ({files.length})
        <span className="text-xs font-normal text-slate-500">{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded && (
        <ul
          key={listKey ?? String(files.length)}
          className="mt-3 rounded-lg border border-slate-200/80 bg-white divide-y divide-slate-100 overflow-hidden max-h-72 overflow-y-auto"
        >
          {files.map((file) => {
            const isSelected = selectedPath === file.path;
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? null : file)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
                    isSelected ? "bg-brand-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="font-mono text-sm text-slate-800 truncate">{file.path}</span>
                  <span className={`flex-shrink-0 ${actionBadge(file.action)}`}>{file.action}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-slate-500 mt-2">Click a file to review its diff before merging.</p>
    </div>
  );
}
