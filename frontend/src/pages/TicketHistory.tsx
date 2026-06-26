import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, DeliveryRun, User } from "../api/client";
import IssueTypeIcon from "../components/IssueTypeIcon";
import Layout from "../components/Layout";
import ProjectList from "../components/ProjectList";
import {
  DashboardProjectProvider,
  useDashboardProjects,
} from "../context/DashboardProjectContext";
import { useToast } from "../context/ToastContext";
import { formatFullDate, formatRelativeTime } from "../utils/relativeTime";

function RefreshIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function runStatusBadge(run: DeliveryRun): string {
  if (run.status === "completed") return "badge-status-done";
  if (run.status === "failed") return "badge-neutral text-red-700 bg-red-50";
  if (run.status === "awaiting_approval") return "badge-status-progress";
  if (run.status === "running") return "badge-status-progress";
  return "badge-status-todo";
}

function runStatusLabel(run: DeliveryRun): string {
  if (run.workflow_phase_label) return run.workflow_phase_label;
  if (run.status === "completed") return "Completed";
  if (run.status === "failed") return "Failed";
  if (run.status === "awaiting_approval") return "Awaiting approval";
  return run.status.replace(/_/g, " ");
}

function TicketHistoryContent() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    projects,
    selectedProject,
    projectsLoading,
    projectsTotal,
    mappedProjectKeys,
    onSelect,
    onSearch,
  } = useDashboardProjects()!;

  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");
  const [runs, setRuns] = useState<DeliveryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    },
    [navigate, toast],
  );

  useEffect(() => {
    api
      .ensureAuth()
      .then((data) => {
        setUser(data.user);
        setSiteName(data.site_name);
      })
      .catch(handleAuthError);
  }, [handleAuthError]);

  const loadRuns = useCallback(
    (project: string | null) => {
      setLoading(true);
      setError(null);
      api
        .listRuns({ projectKey: project ?? undefined, limit: 50 })
        .then((data) => setRuns(data.runs))
        .catch(handleAuthError)
        .finally(() => setLoading(false));
    },
    [handleAuthError],
  );

  useEffect(() => {
    loadRuns(selectedProject);
  }, [selectedProject, loadRuns]);

  const handleReload = async () => {
    setReloading(true);
    try {
      const data = await api.listRuns({ projectKey: selectedProject ?? undefined, limit: 50 });
      setRuns(data.runs);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setReloading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      navigate("/login");
    }
  };

  const selectedProjectName =
    selectedProject === null
      ? "All projects"
      : projects.find((p) => p.key === selectedProject)?.name || selectedProject;

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:h-[calc(100vh-3.5rem)] lg:min-h-0">
        {error && (
          <div className="alert-error mb-4 flex-shrink-0 flex items-start gap-3">
            <svg className="h-5 w-5 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="lg:hidden mb-4 flex-shrink-0">
          <div className="card overflow-hidden max-h-64 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 flex-shrink-0">
              <h2 className="text-sm font-semibold text-slate-900">Configured projects</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {projectsLoading ? "Loading..." : `${projectsTotal} linked to Bitbucket`}
              </p>
            </div>
            <ProjectList
              projects={projects}
              selectedKey={selectedProject}
              loading={projectsLoading}
              total={projectsTotal}
              onSelect={onSelect}
              onSearch={onSearch}
              emptyMessage={
                mappedProjectKeys.size === 0
                  ? "No projects are linked to Bitbucket yet."
                  : "No configured projects match your search."
              }
              configureHref="/settings"
              showMappingSettings
            />
          </div>
        </div>

        <div className="card overflow-hidden flex flex-col lg:flex-1 lg:min-h-0">
          <div className="card-header flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="card-title">Ticket history</h2>
              <p className="card-subtitle">
                {selectedProjectName} · recent delivery runs
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReload}
                disabled={reloading || loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                title="Reload delivery history"
              >
                <RefreshIcon className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} />
                {reloading ? "Reloading…" : "Reload"}
              </button>
              {!loading && (
                <span className="badge-neutral tabular-nums">{runs.length} shown</span>
              )}
            </div>
          </div>

          <div className="lg:flex-1 lg:min-h-0 lg:overflow-auto">
            {loading && runs.length === 0 ? (
              <div className="p-6 space-y-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-12 skeleton rounded-lg" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-slate-700 font-semibold">No delivery runs yet</p>
                <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                  Start delivering tickets from{" "}
                  <Link to="/dashboard" className="text-blue-600 hover:text-blue-700 font-medium">
                    My tickets
                  </Link>{" "}
                  and they will appear here.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Ticket</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 hidden md:table-cell">Summary</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 hidden sm:table-cell">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 hidden lg:table-cell">Last updated</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runs.map((run) => (
                    <tr key={run.id} className="group hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <IssueTypeIcon
                            name={run.issue_type}
                            iconUrl={run.issue_type_icon}
                            className="h-4 w-4 flex-shrink-0"
                          />
                          <Link
                            to={`/deliver/${run.jira_issue_key}`}
                            className="font-mono text-sm font-medium text-blue-600 hover:text-blue-700"
                          >
                            {run.jira_issue_key}
                          </Link>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 md:hidden truncate max-w-[12rem]">
                          {run.summary}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-700 hidden md:table-cell max-w-xs truncate">
                        {run.summary}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={runStatusBadge(run)}>{runStatusLabel(run)}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden lg:table-cell whitespace-nowrap">
                        <span title={formatFullDate(run.updated_at)}>{formatRelativeTime(run.updated_at)}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link
                          to={`/deliver/${run.jira_issue_key}`}
                          className="inline-flex items-center justify-center rounded-full px-4 py-1.5 text-sm font-medium border border-blue-400 text-blue-600 bg-transparent hover:bg-blue-50 transition-colors opacity-90 group-hover:opacity-100"
                        >
                          {run.status === "completed" ? "View" : "Open"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function TicketHistory() {
  return (
    <DashboardProjectProvider>
      <TicketHistoryContent />
    </DashboardProjectProvider>
  );
}
