import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Project } from "../api/client";

function SettingsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

interface ProjectListProps {
  projects: Project[];
  selectedKey: string | null;
  loading: boolean;
  total?: number;
  onSelect: (key: string | null) => void;
  onSearch?: (query: string) => void;
  emptyMessage?: string;
  configureHref?: string;
  showMappingSettings?: boolean;
}

export default function ProjectList({
  projects,
  selectedKey,
  loading,
  total,
  onSelect,
  onSearch,
  emptyMessage,
  configureHref,
  showMappingSettings,
}: ProjectListProps) {
  const [search, setSearch] = useState("");

  const filteredProjects = useMemo(() => {
    if (onSearch) return projects;
    const term = search.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter(
      (p) =>
        p.key.toLowerCase().includes(term) ||
        p.name.toLowerCase().includes(term),
    );
  }, [projects, search, onSearch]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearch?.(value);
  };

  if (loading && projects.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="px-3 py-3 border-b border-slate-200/60 flex-shrink-0">
          <div className="h-10 skeleton" />
        </div>
        <div className="p-3 space-y-2 overflow-y-auto flex-1 min-h-0">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-11 skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-3 border-b border-slate-200/60 flex-shrink-0">
        <div className="relative">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search projects..."
            className="block w-full rounded-xl border border-slate-200/80 bg-white pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <button
          onClick={() => onSelect(null)}
          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1 ${
            selectedKey === null
              ? "bg-brand-50/80 text-brand-700 ring-1 ring-brand-200/40 border-l-[3px] border-brand-600"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          All Projects
        </button>
        <ul className="space-y-0.5">
          {filteredProjects.map((project) => {
            const isSelected = selectedKey === project.key;
            return (
            <li key={project.id}>
              <div
                className={`flex items-center gap-1 rounded-xl transition-all ${
                  isSelected
                    ? "bg-brand-50/80 ring-1 ring-brand-200/40 border-l-[3px] border-brand-600"
                    : "hover:bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(project.key)}
                  className={`flex-1 min-w-0 text-left px-3 py-2.5 text-sm transition-all flex items-center gap-2.5 ${
                    isSelected
                      ? "text-brand-700 font-medium"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {project.avatar_url ? (
                    <img
                      src={project.avatar_url}
                      alt=""
                      className="w-7 h-7 rounded-lg flex-shrink-0 ring-1 ring-slate-200/80"
                    />
                  ) : (
                    <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 flex-shrink-0">
                      {project.key.slice(0, 2)}
                    </span>
                  )}
                  <span className="truncate min-w-0">
                    <span className="font-mono text-[11px] text-slate-400 mr-1.5">{project.key}</span>
                    <span className={isSelected ? "text-brand-800" : ""}>
                      {project.name}
                    </span>
                  </span>
                </button>
                {showMappingSettings && (
                  <Link
                    to={`/admin/mappings?project=${encodeURIComponent(project.key)}`}
                    className="flex-shrink-0 p-2 mr-0.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                    title="Edit mapping"
                    aria-label={`Edit mapping for ${project.key}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <SettingsIcon />
                  </Link>
                )}
              </div>
            </li>
            );
          })}
        </ul>
        {filteredProjects.length === 0 && !loading && (
          <div className="px-3 py-6 text-sm text-slate-500 text-center space-y-3">
            <p>{emptyMessage ?? (search.trim() ? "No projects match your search." : "No projects found.")}</p>
            {configureHref && !search.trim() && (
              <Link to={configureHref} className="inline-flex text-brand-600 hover:text-brand-700 font-medium">
                Open setup guide
              </Link>
            )}
          </div>
        )}
        {loading && projects.length > 0 && (
          <p className="px-3 py-2 text-xs text-slate-400 text-center animate-pulse">Searching...</p>
        )}
      </div>

      {total !== undefined && (
        <div className="mt-auto px-4 py-3 border-t border-slate-200/80 text-xs text-slate-500 flex-shrink-0 bg-slate-50/60 font-medium">
          {filteredProjects.length === total
            ? `${total} project${total === 1 ? "" : "s"}`
            : `${filteredProjects.length} of ${total} projects`}
        </div>
      )}
    </div>
  );
}
