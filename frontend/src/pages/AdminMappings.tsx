import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, Mapping, Project, User } from "../api/client";
import Layout from "../components/Layout";

const emptyForm = {
  jira_project_key: "",
  bitbucket_workspace: "",
  bitbucket_repo_slug: "",
  master_branch: "master",
  beta_branch: "beta",
  beta_website_url: "",
  master_website_url: "",
};

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

export default function AdminMappings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedDeepLinkRef = useRef(false);
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);

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

  const loadMappings = useCallback(() => {
    setLoading(true);
    api
      .getMappings()
      .then((data) => setMappings(data.mappings))
      .catch(handleAuthError)
      .finally(() => setLoading(false));
  }, [handleAuthError]);

  const loadProjects = useCallback(() => {
    setProjectsLoading(true);
    api
      .getAllProjects()
      .then(setAllProjects)
      .catch(handleAuthError)
      .finally(() => setProjectsLoading(false));
  }, [handleAuthError]);

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        setUser(data.user);
        setSiteName(data.site_name);
      })
      .catch(handleAuthError);
  }, [handleAuthError]);

  useEffect(() => {
    loadMappings();
    loadProjects();
  }, [loadMappings, loadProjects]);

  const mappingByKey = useMemo(
    () => new Map(mappings.map((m) => [m.jira_project_key, m])),
    [mappings],
  );

  const applyProjectSelection = useCallback(
    (projectKey: string) => {
      const key = projectKey.trim().toUpperCase();
      if (!key) return;

      setSelectedProjectKey(key);
      const existing = mappingByKey.get(key);
      if (existing) {
        setEditingId(existing.id);
        setForm({
          jira_project_key: existing.jira_project_key,
          bitbucket_workspace: existing.bitbucket_workspace,
          bitbucket_repo_slug: existing.bitbucket_repo_slug,
          master_branch: existing.master_branch,
          beta_branch: existing.beta_branch,
          beta_website_url: existing.beta_website_url,
          master_website_url: existing.master_website_url,
        });
      } else {
        setEditingId(null);
        setForm({
          ...emptyForm,
          jira_project_key: key,
        });
      }
      setError(null);
    },
    [mappingByKey],
  );

  useEffect(() => {
    const projectKey = searchParams.get("project")?.trim().toUpperCase();
    if (!projectKey || appliedDeepLinkRef.current || loading || projectsLoading) {
      return;
    }

    appliedDeepLinkRef.current = true;
    applyProjectSelection(projectKey);
    setSearchParams({}, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    loading,
    projectsLoading,
    applyProjectSelection,
  ]);

  const projectRows = useMemo(() => {
    const rows = allProjects.map((project) => ({
      project,
      mapping: mappingByKey.get(project.key) ?? null,
    }));
    rows.sort((a, b) => {
      if (a.mapping && !b.mapping) return -1;
      if (!a.mapping && b.mapping) return 1;
      return a.project.key.localeCompare(b.project.key);
    });
    return rows;
  }, [allProjects, mappingByKey]);

  const filteredProjectRows = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    if (!term) return projectRows;
    return projectRows.filter(
      ({ project, mapping }) =>
        project.key.toLowerCase().includes(term) ||
        project.name.toLowerCase().includes(term) ||
        mapping?.bitbucket_workspace.toLowerCase().includes(term) ||
        mapping?.bitbucket_repo_slug.toLowerCase().includes(term),
    );
  }, [projectRows, projectSearch]);

  const configuredCount = mappings.length;
  const unconfiguredCount = allProjects.filter((p) => !mappingByKey.has(p.key)).length;

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setSelectedProjectKey(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await api.updateMapping(editingId, form);
      } else {
        await api.createMapping(form);
      }
      resetForm();
      loadMappings();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleConfigure = (project: Project) => {
    applyProjectSelection(project.key);
  };

  const handleEdit = (mapping: Mapping) => {
    applyProjectSelection(mapping.jira_project_key);
  };

  const handleProjectSelect = (project: Project) => {
    handleConfigure(project);
  };

  const handleDelete = async (mapping: Mapping) => {
    if (!confirm(`Delete mapping for project ${mapping.jira_project_key}?`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteMapping(mapping.id);
      if (editingId === mapping.id) {
        resetForm();
      }
      loadMappings();
    } catch (err) {
      handleAuthError(err);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      navigate("/login");
    }
  };

  const selectedProject = selectedProjectKey
    ? allProjects.find((p) => p.key === selectedProjectKey)
    : null;
  const selectedMapping = selectedProjectKey ? mappingByKey.get(selectedProjectKey) : null;

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 h-[calc(100vh-4rem)] flex flex-col">
        <div className="mb-5 flex-shrink-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Project → Repository Mappings
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Select a Jira project on the left to configure its Bitbucket mapping.
          </p>
        </div>

        {error && <div className="alert-error mb-4 flex-shrink-0">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-6 flex-1 min-h-0">
          <aside className="lg:col-span-2 xl:col-span-1 flex flex-col min-h-0">
            <div className="card overflow-hidden flex flex-col h-full min-h-0">
              <div className="card-header flex-shrink-0">
                <h2 className="card-title">All Jira projects</h2>
                <p className="card-subtitle">
                  {projectsLoading || loading
                    ? "Loading…"
                    : `${configuredCount} configured · ${unconfiguredCount} need setup`}
                </p>
              </div>

              {!projectsLoading && !loading && projectRows.length > 0 && (
                <div className="px-3 py-3 border-b border-slate-100 flex-shrink-0">
                  <div className="relative">
                    <svg
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
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
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder="Search projects…"
                      className="input pl-9 py-2"
                    />
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {projectsLoading || loading ? (
                  <div className="p-3 space-y-2">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="h-11 skeleton" />
                    ))}
                  </div>
                ) : filteredProjectRows.length === 0 ? (
                  <div className="px-3 py-8 text-center">
                    <p className="text-sm text-slate-600 font-medium">
                      {projectSearch.trim() ? "No projects match your search." : "No Jira projects found"}
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {filteredProjectRows.map(({ project, mapping }) => (
                      <li key={project.id}>
                        <button
                          type="button"
                          onClick={() => handleProjectSelect(project)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2.5 ${
                            selectedProjectKey === project.key
                              ? "bg-brand-50 text-brand-700 font-medium shadow-sm ring-1 ring-brand-200/60"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
                          <span className="truncate min-w-0 flex-1">
                            <span className="font-mono text-[11px] text-slate-400 mr-1.5">{project.key}</span>
                            <span className={selectedProjectKey === project.key ? "text-brand-800" : ""}>
                              {project.name}
                            </span>
                          </span>
                          {mapping ? (
                            <span className="badge-success flex-shrink-0 text-[10px] px-1.5 py-0.5">OK</span>
                          ) : (
                            <span
                              className="flex-shrink-0 text-slate-400"
                              title="Needs configuration"
                              aria-label="Needs configuration"
                            >
                              <SettingsIcon />
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!projectsLoading && !loading && projectRows.length > 0 && (
                <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500 flex-shrink-0 bg-slate-50/50">
                  {filteredProjectRows.length === projectRows.length
                    ? `${projectRows.length} project${projectRows.length === 1 ? "" : "s"}`
                    : `${filteredProjectRows.length} of ${projectRows.length} projects`}
                </div>
              )}
            </div>
          </aside>

          <section className="lg:col-span-3 xl:col-span-4 flex flex-col min-h-0 gap-5 overflow-hidden">
            {selectedProjectKey && (
              <div className="card p-6 sm:p-8 flex-shrink-0 max-h-[42vh] overflow-y-auto">
                <div className="flex items-center gap-3 mb-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <SettingsIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="card-title">
                      {selectedProject
                        ? editingId
                          ? `Edit mapping · ${selectedProject.key}`
                          : `Configure mapping · ${selectedProject.key}`
                        : editingId
                          ? "Edit mapping"
                          : "Add mapping"}
                    </h2>
                    <p className="card-subtitle">
                      {selectedProject
                        ? selectedMapping
                          ? "Update the repository connection for this project."
                          : "Connect this project to its Bitbucket repo."
                        : "Select a project from the list, or enter a project key below."}
                    </p>
                  </div>
                </div>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <label className="block space-y-1.5">
                    <span className="label">Jira project key</span>
                    <input
                      type="text"
                      required
                      placeholder="PROJ-A"
                      value={form.jira_project_key}
                      onChange={(e) => {
                        const key = e.target.value.toUpperCase();
                        setForm({ ...form, jira_project_key: key });
                        setSelectedProjectKey(key || null);
                      }}
                      className="input font-mono"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="label">Bitbucket workspace</span>
                    <input
                      type="text"
                      required
                      placeholder="my-workspace"
                      value={form.bitbucket_workspace}
                      onChange={(e) => setForm({ ...form, bitbucket_workspace: e.target.value })}
                      className="input"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="label">Repository slug</span>
                    <input
                      type="text"
                      required
                      placeholder="my-repo"
                      value={form.bitbucket_repo_slug}
                      onChange={(e) => setForm({ ...form, bitbucket_repo_slug: e.target.value })}
                      className="input"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="label">Master branch</span>
                    <input
                      type="text"
                      required
                      placeholder="master"
                      value={form.master_branch}
                      onChange={(e) => setForm({ ...form, master_branch: e.target.value })}
                      className="input font-mono"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="label">Beta branch</span>
                    <input
                      type="text"
                      required
                      placeholder="beta"
                      value={form.beta_branch}
                      onChange={(e) => setForm({ ...form, beta_branch: e.target.value })}
                      className="input font-mono"
                    />
                  </label>
                  <label className="block space-y-1.5 sm:col-span-2">
                    <span className="label">Beta website URL</span>
                    <input
                      type="url"
                      required
                      placeholder="https://beta.example.com"
                      value={form.beta_website_url}
                      onChange={(e) => setForm({ ...form, beta_website_url: e.target.value })}
                      className="input"
                    />
                  </label>
                  <label className="block space-y-1.5 sm:col-span-2">
                    <span className="label">Master website URL</span>
                    <input
                      type="url"
                      required
                      placeholder="https://www.example.com"
                      value={form.master_website_url}
                      onChange={(e) => setForm({ ...form, master_website_url: e.target.value })}
                      className="input"
                    />
                  </label>
                  <div className="sm:col-span-2 flex flex-wrap gap-3 pt-1">
                    <button type="submit" disabled={saving} className="btn-primary">
                      {saving ? "Saving…" : editingId ? "Update mapping" : "Add mapping"}
                    </button>
                    {editingId && (
                      <button type="button" onClick={resetForm} className="btn-secondary">
                        Cancel edit
                      </button>
                    )}
                    {selectedMapping && (
                      <button
                        type="button"
                        onClick={() => handleDelete(selectedMapping)}
                        className="btn-ghost text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        Delete mapping
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            <div className="card overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="card-header flex-shrink-0">
                <h2 className="card-title">Configured mappings</h2>
                <p className="card-subtitle">
                  {loading ? "Loading…" : `${mappings.length} active mapping${mappings.length === 1 ? "" : "s"}`}
                </p>
              </div>
              {loading ? (
                <div className="p-6 space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-12 skeleton" />
                  ))}
                </div>
              ) : mappings.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-12 px-6 text-center">
                  <p className="text-sm text-slate-500">No mappings yet. Select a project to get started.</p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="min-w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-slate-100 bg-slate-50/95 backdrop-blur-sm">
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Project
                        </th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Bitbucket repo
                        </th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Branches
                        </th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Websites
                        </th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {mappings.map((mapping) => {
                        const project = allProjects.find((p) => p.key === mapping.jira_project_key);
                        return (
                          <tr
                            key={mapping.id}
                            onClick={() => handleEdit(mapping)}
                            className={`cursor-pointer transition-colors ${
                              selectedProjectKey === mapping.jira_project_key
                                ? "bg-brand-50/60"
                                : "hover:bg-brand-50/20"
                            }`}
                          >
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {project?.avatar_url ? (
                                  <img
                                    src={project.avatar_url}
                                    alt=""
                                    className="w-7 h-7 rounded-lg ring-1 ring-slate-200/80 flex-shrink-0"
                                  />
                                ) : (
                                  <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 flex-shrink-0">
                                    {mapping.jira_project_key.slice(0, 2)}
                                  </span>
                                )}
                                <div className="min-w-0">
                                  <p className="text-sm font-mono font-medium text-slate-900">
                                    {mapping.jira_project_key}
                                  </p>
                                  {project && (
                                    <p className="text-xs text-slate-500 truncate">{project.name}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-sm text-slate-700">
                              <span className="text-slate-500">{mapping.bitbucket_workspace}/</span>
                              {mapping.bitbucket_repo_slug}
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex flex-col gap-1">
                                <span className="badge-neutral font-mono w-fit text-[11px]">
                                  master: {mapping.master_branch}
                                </span>
                                <span className="badge-neutral font-mono w-fit text-[11px]">
                                  beta: {mapping.beta_branch}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-sm">
                              <div className="space-y-0.5">
                                <a
                                  href={mapping.beta_website_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="block text-brand-600 hover:text-brand-700 truncate max-w-[10rem]"
                                >
                                  Beta
                                </a>
                                <a
                                  href={mapping.master_website_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="block text-brand-600 hover:text-brand-700 truncate max-w-[10rem]"
                                >
                                  Master
                                </a>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEdit(mapping);
                                }}
                                className="btn-ghost btn-sm text-brand-600 hover:text-brand-700 hover:bg-brand-50"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
