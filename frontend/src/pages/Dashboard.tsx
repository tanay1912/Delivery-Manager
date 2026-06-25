import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  ApiError,
  Issue,
  IssueSummary as IssueSummaryData,
  Project,
  User,
} from "../api/client";
import IssueSummary from "../components/IssueSummary";
import IssueTable from "../components/IssueTable";
import Layout from "../components/Layout";
import ProjectList from "../components/ProjectList";

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [mappedProjectKeys, setMappedProjectKeys] = useState<Set<string>>(new Set());
  const [projectsTotal, setProjectsTotal] = useState(0);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [summary, setSummary] = useState<IssueSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [pageTokens, setPageTokens] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deliveringKey, setDeliveringKey] = useState<string | null>(null);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    },
    [navigate],
  );

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        setUser(data.user);
        setSiteName(data.site_name);
        setSiteUrl(data.site_url);
      })
      .catch(handleAuthError);
  }, [handleAuthError]);

  const loadMappedProjects = useCallback(
    (query?: string) => {
      setProjectsLoading(true);
      Promise.all([api.getAllProjects(query), api.getMappings()])
        .then(([all, mappingsData]) => {
          const keys = new Set(mappingsData.mappings.map((m) => m.jira_project_key));
          setMappedProjectKeys(keys);
          const configured = all.filter((p) => keys.has(p.key));
          setProjects(configured);
          setProjectsTotal(configured.length);
        })
        .catch(handleAuthError)
        .finally(() => setProjectsLoading(false));
    },
    [handleAuthError],
  );

  useEffect(() => {
    loadMappedProjects();
  }, [loadMappedProjects]);

  const handleProjectSearch = useCallback(
    (query: string) => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        loadMappedProjects(query.trim() || undefined);
      }, 300);
    },
    [loadMappedProjects],
  );

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
          setSummary({ total: 0, todo: 0, in_progress: 0, done: 0 });
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
    loadSummary(selectedProject);
  }, [selectedProject, loadSummary]);

  useEffect(() => {
    loadIssues(selectedProject, pageTokens[pageIndex] ?? null, pageIndex);
  }, [selectedProject, pageIndex, loadIssues]);

  const handleProjectSelect = (key: string | null) => {
    setSelectedProject(key);
    setPageIndex(0);
    setPageTokens([null]);
  };

  const handleNextPage = () => {
    if (hasNext) {
      setPageIndex((prev) => prev + 1);
    }
  };

  const handlePreviousPage = () => {
    if (pageIndex > 0) {
      setPageIndex((prev) => prev - 1);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      navigate("/login");
    }
  };

  const handleDeliver = async (issue: Issue) => {
    setDeliveringKey(issue.key);
    setError(null);
    try {
      const run = await api.startRun(issue.key);
      navigate(`/deliver/${issue.key}`, { state: { run } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start delivery run");
    } finally {
      setDeliveringKey(null);
    }
  };

  const selectedProjectName =
    selectedProject === null
      ? "All projects · assigned to me"
      : `${projects.find((p) => p.key === selectedProject)?.name || selectedProject} · assigned to me`;

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 h-[calc(100vh-4rem)] flex flex-col">
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

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-6 flex-1 min-h-0">
          <aside className="lg:col-span-1 flex flex-col min-h-0">
            <div className="card overflow-hidden flex flex-col h-full min-h-0">
              <div className="card-header flex-shrink-0">
                <h2 className="card-title">Projects</h2>
                <p className="card-subtitle">
                  {projectsLoading && projects.length === 0
                    ? "Loading..."
                    : `${projectsTotal} with Bitbucket`}
                </p>
              </div>
              <ProjectList
                projects={projects}
                selectedKey={selectedProject}
                loading={projectsLoading}
                total={projectsTotal}
                onSelect={handleProjectSelect}
                onSearch={handleProjectSearch}
                emptyMessage={
                  mappedProjectKeys.size === 0
                    ? "No projects are linked to Bitbucket yet."
                    : "No configured projects match your search."
                }
                configureHref="/admin/mappings"
                showMappingSettings
              />
            </div>
          </aside>

          <section className="lg:col-span-4 flex flex-col min-h-0">
            <IssueSummary
              summary={summary}
              loading={summaryLoading}
              projectLabel={selectedProjectName}
            />

            <div className="card overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="card-header flex items-center justify-between flex-shrink-0">
                <div>
                  <h2 className="card-title">My tickets</h2>
                  <p className="card-subtitle">Assigned to you · sorted by last updated</p>
                </div>
                {!issuesLoading && (
                  <span className="badge-neutral tabular-nums">{issuesTotal} total</span>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <IssueTable
                  issues={issues}
                  loading={issuesLoading}
                  total={issuesTotal}
                  pageIndex={pageIndex}
                  maxResults={50}
                  hasNext={hasNext}
                  siteUrl={siteUrl}
                  deliveringKey={deliveringKey}
                  onDeliver={handleDeliver}
                  onNextPage={handleNextPage}
                  onPreviousPage={handlePreviousPage}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
