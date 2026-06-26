import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  ApiError,
  Issue,
  IssueSummary as IssueSummaryData,
  User,
} from "../api/client";
import IssueSummary from "../components/IssueSummary";
import IssueTable from "../components/IssueTable";
import ConfiguredProjectsPanel from "../components/ConfiguredProjectsPanel";
import Layout from "../components/Layout";
import {
  DashboardProjectProvider,
  useDashboardProjects,
} from "../context/DashboardProjectContext";
import { useToast } from "../context/ToastContext";

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

function DashboardContent() {
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
  const [siteUrl, setSiteUrl] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [summary, setSummary] = useState<IssueSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [pageTokens, setPageTokens] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectSummaries, setProjectSummaries] = useState<Record<string, IssueSummaryData>>({});
  const [projectSummariesLoading, setProjectSummariesLoading] = useState(true);
  const [reloadingTickets, setReloadingTickets] = useState(false);

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
        setSiteUrl(data.site_url);
      })
      .catch(handleAuthError);
  }, [handleAuthError]);

  useEffect(() => {
    setPageIndex(0);
    setPageTokens([null]);
  }, [selectedProject]);

  const loadSummary = useCallback(
    (project: string | null) => {
      setSummaryLoading(true);
      api
        .getIssueSummary(project ?? undefined)
        .then(setSummary)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            handleAuthError(err);
            return;
          }
          setSummary({ total: 0, by_status: {}, qis: 0, bug: 0, task: 0 });
        })
        .finally(() => setSummaryLoading(false));
    },
    [handleAuthError],
  );

  const loadIssues = useCallback(
    (project: string | null, token: string | null, currentPageIndex: number) => {
      setIssuesLoading(true);
      setError(null);
      api
        .getIssues(project ?? undefined, token ?? undefined)
        .then((data) => {
          setIssues(data.issues);
          setIssuesTotal(data.total);
          setHasNext(!data.is_last && Boolean(data.next_page_token));
          if (data.next_page_token) {
            setPageTokens((prev) => {
              const next = [...prev];
              next[currentPageIndex + 1] = data.next_page_token ?? null;
              return next;
            });
          }
        })
        .catch(handleAuthError)
        .finally(() => setIssuesLoading(false));
    },
    [handleAuthError],
  );

  useEffect(() => {
    if (projects.length === 0) {
      setProjectSummaries({});
      setProjectSummariesLoading(false);
      return;
    }

    setProjectSummariesLoading(true);
    api
      .getProjectSummaries(projects.map((p) => p.key))
      .then((data) => setProjectSummaries(data.summaries))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          handleAuthError(err);
          return;
        }
        setProjectSummaries({});
      })
      .finally(() => setProjectSummariesLoading(false));
  }, [projects, handleAuthError]);

  useEffect(() => {
    loadSummary(selectedProject);
  }, [selectedProject, loadSummary]);

  useEffect(() => {
    loadIssues(selectedProject, pageTokens[pageIndex] ?? null, pageIndex);
  }, [selectedProject, pageIndex, loadIssues]);

  const handleNextPage = () => {
    if (hasNext) setPageIndex((prev) => prev + 1);
  };

  const handlePreviousPage = () => {
    if (pageIndex > 0) setPageIndex((prev) => prev - 1);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      navigate("/login");
    }
  };

  const handleReloadTickets = useCallback(async () => {
    setReloadingTickets(true);
    setError(null);
    const token = pageTokens[pageIndex] ?? null;
    try {
      const [summaryData, issuesData, projectSummaryData] = await Promise.all([
        api.getIssueSummary(selectedProject ?? undefined),
        api.getIssues(selectedProject ?? undefined, token ?? undefined),
        projects.length > 0
          ? api.getProjectSummaries(projects.map((p) => p.key))
          : Promise.resolve({ summaries: {} }),
      ]);
      setSummary(summaryData);
      setProjectSummaries(projectSummaryData.summaries);
      setIssues(issuesData.issues);
      setIssuesTotal(issuesData.total);
      setHasNext(!issuesData.is_last && Boolean(issuesData.next_page_token));
      if (issuesData.next_page_token) {
        setPageTokens((prev) => {
          const next = [...prev];
          next[pageIndex + 1] = issuesData.next_page_token ?? null;
          return next;
        });
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      setReloadingTickets(false);
    }
  }, [selectedProject, pageIndex, pageTokens, handleAuthError, projects]);

  const handleDeliver = (issue: Issue) => {
    setError(null);
    navigate(`/deliver/${issue.key}`, {
      state: { starting: true, issueSummary: issue.summary },
    });
  };

  const selectedProjectRecord = projects.find((p) => p.key === selectedProject);
  const selectedProjectName =
    selectedProject === null
      ? "All projects · assigned to me"
      : selectedProjectRecord
        ? `${selectedProjectRecord.key} · ${selectedProjectRecord.name} · assigned to me`
        : `${selectedProject} · assigned to me`;

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

        <div className="flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-slate-200/80 shadow-card bg-white flex-shrink-0 overflow-hidden">
            <IssueSummary
              summary={summary}
              loading={summaryLoading}
              projectLabel={selectedProjectName}
            />
          </div>

          <div className="mt-6 flex-shrink-0">
            <ConfiguredProjectsPanel
              projects={projects}
              selectedKey={selectedProject}
              loading={projectsLoading}
              total={projectsTotal}
              summaries={projectSummaries}
              summariesLoading={projectSummariesLoading}
              onSelect={onSelect}
              onSearch={onSearch}
              emptyMessage={
                mappedProjectKeys.size === 0
                  ? "No projects are linked to Bitbucket yet."
                  : "No configured projects match your search."
              }
            />
          </div>

          <div className="mt-6 pt-6 border-t border-slate-200/80 flex flex-col lg:flex-1 lg:min-h-0">
            <div className="rounded-xl border border-slate-200/80 shadow-card bg-white overflow-hidden flex flex-col lg:flex-1 lg:min-h-0">
              <div className="px-5 py-3.5 border-b border-slate-100 bg-white flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="card-title">My tickets</h2>
                <p className="card-subtitle">Assigned to you · sorted by last updated</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReloadTickets}
                  disabled={reloadingTickets || issuesLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                  title="Reload tickets from Jira"
                >
                  <RefreshIcon className={`h-3.5 w-3.5 ${reloadingTickets ? "animate-spin" : ""}`} />
                  {reloadingTickets ? "Reloading…" : "Reload"}
                </button>
                {!issuesLoading && (
                  <span className="badge-neutral tabular-nums">{issuesTotal} total</span>
                )}
              </div>
            </div>
            <div className="lg:flex-1 lg:min-h-0 lg:overflow-auto">
              <IssueTable
                issues={issues}
                loading={issuesLoading}
                total={issuesTotal}
                pageIndex={pageIndex}
                maxResults={50}
                hasNext={hasNext}
                siteUrl={siteUrl}
                onDeliver={handleDeliver}
                onNextPage={handleNextPage}
                onPreviousPage={handlePreviousPage}
              />
            </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function Dashboard() {
  return (
    <DashboardProjectProvider>
      <DashboardContent />
    </DashboardProjectProvider>
  );
}
