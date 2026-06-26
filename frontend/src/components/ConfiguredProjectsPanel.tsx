import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IssueSummary, Project } from "../api/client";
import { aggregateProjectSummaries, issueTypeItemsFromSummary } from "../utils/statusSummary";

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

function PlusIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

interface ConfiguredProjectsPanelProps {
  projects: Project[];
  selectedKey: string | null;
  loading: boolean;
  total: number;
  summaries: Record<string, IssueSummary>;
  summariesLoading: boolean;
  onSelect: (key: string | null) => void;
  onSearch?: (query: string) => void;
  emptyMessage?: string;
}

function ProjectAvatar({ project }: { project: Project }) {
  if (project.avatar_url) {
    return (
      <img
        src={project.avatar_url}
        alt=""
        className="w-10 h-10 rounded-lg flex-shrink-0 ring-1 ring-slate-200/80"
      />
    );
  }

  return (
    <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">
      {project.key.slice(0, 2)}
    </span>
  );
}

function ProjectCardStats({
  summary,
  loading,
}: {
  summary?: IssueSummary;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="h-3.5 w-24 skeleton rounded" />
        <div className="h-5 w-32 skeleton rounded-full" />
      </div>
    );
  }

  const types = issueTypeItemsFromSummary(summary);

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[11px] text-slate-500 tabular-nums">
        <span className="font-semibold text-slate-900">{summary?.total ?? 0}</span>
        {" "}
        Total Tickets
      </p>
      {types.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {types.map((type) => (
            <span
              key={type.label}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${type.badgeClass}`}
            >
              {type.label}
              <span className="tabular-nums">{type.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ConfiguredProjectsPanel({
  projects,
  selectedKey,
  loading,
  total,
  summaries,
  summariesLoading,
  onSelect,
  onSearch,
  emptyMessage,
}: ConfiguredProjectsPanelProps) {
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

  const allProjectsSummary = useMemo(() => aggregateProjectSummaries(summaries), [summaries]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearch?.(value);
  };

  const showSearch = total > 1;

  return (
    <section aria-labelledby="configured-projects-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <h2 id="configured-projects-heading" className="text-base font-semibold text-slate-900">
            Configured Projects
          </h2>
          {!loading && (
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold tabular-nums">
              {total}
            </span>
          )}
        </div>
      </div>

      {showSearch && (
        <div className="relative mb-4 max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none"
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
            className="block w-full rounded-lg border border-slate-200/80 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      )}

      {loading && projects.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-[120px] skeleton rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`flex items-start gap-3 px-4 py-3.5 rounded-lg border bg-white shadow-sm text-left transition-all ${
              selectedKey === null
                ? "border-brand-300 ring-1 ring-brand-200/60 bg-brand-50/40"
                : "border-slate-200/80 hover:border-slate-300 hover:shadow-md"
            }`}
          >
            <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center flex-shrink-0">
              <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">All Projects</span>
              <span className="block text-xs text-slate-500 mt-0.5">Show tickets from every project</span>
              <ProjectCardStats summary={allProjectsSummary} loading={summariesLoading} />
            </span>
          </button>

          {filteredProjects.map((project) => {
            const isSelected = selectedKey === project.key;
            const projectSummary = summaries[project.key];
            return (
              <div
                key={project.id}
                className={`flex items-start gap-3 px-4 py-3.5 rounded-lg border bg-white shadow-sm transition-all ${
                  isSelected
                    ? "border-brand-300 ring-1 ring-brand-200/60 bg-brand-50/40"
                    : "border-slate-200/80 hover:border-slate-300 hover:shadow-md"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(project.key)}
                  className="flex items-start gap-3 min-w-0 flex-1 text-left"
                >
                  <ProjectAvatar project={project} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="font-mono text-xs font-semibold text-brand-600">{project.key}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-sm font-semibold text-slate-900 leading-snug">{project.name}</span>
                    </span>
                    <ProjectCardStats summary={projectSummary} loading={summariesLoading} />
                  </span>
                </button>
                <Link
                  to={`/admin/mappings?project=${encodeURIComponent(project.key)}`}
                  className="flex-shrink-0 p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                  title="Edit mapping"
                  aria-label={`Edit mapping for ${project.key}`}
                >
                  <SettingsIcon />
                </Link>
              </div>
            );
          })}

          <Link
            to="/admin/mappings"
            className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-sm font-medium text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            <PlusIcon />
            Add Project
          </Link>
        </div>
      )}

      {filteredProjects.length === 0 && !loading && (
        <p className="mt-3 text-sm text-slate-500">
          {emptyMessage ?? (search.trim() ? "No projects match your search." : "No projects found.")}
        </p>
      )}

      {loading && projects.length > 0 && (
        <p className="mt-3 text-xs text-slate-400 animate-pulse">Searching...</p>
      )}
    </section>
  );
}
