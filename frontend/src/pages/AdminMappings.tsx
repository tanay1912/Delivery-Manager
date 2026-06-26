import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, Mapping, MappingInput, Project, User } from "../api/client";
import Layout from "../components/Layout";
import { useToast } from "../context/ToastContext";

const emptyForm = {
  jira_project_key: "",
  bitbucket_workspace: "",
  bitbucket_repo_slug: "",
  master_branch: "master",
  beta_branch: "beta",
  beta_website_url: "",
  master_website_url: "",
  rules: "",
  skills: "",
  ssh_host: "",
  ssh_port: 22,
  ssh_username: "",
  ssh_password: "",
  ssh_private_key: "",
  ssh_auth_type: "password" as "password" | "pem",
  ssh_use_sudo: false,
  project_root_directory: "",
  local_project_directory: "",
  beta_post_pr_merge_commands: [""] as string[],
  master_post_pr_merge_commands: [""] as string[],
};

function commandsFromStorage(raw: string): string[] {
  const commands = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return commands.length > 0 ? commands : [""];
}

function commandsToStorage(commands: string[]): string {
  return commands.map((command) => command.trim()).filter(Boolean).join("\n");
}

function buildPostMergeShellPreview(
  projectRoot: string,
  commands: string[],
  useSudo = false,
): string {
  const root = projectRoot.trim();
  const cleaned = commands.map((command) => command.trim()).filter(Boolean);
  let script: string;
  if (!root) {
    script = cleaned.join(" && ");
  } else {
    const quotedRoot = `'${root.replace(/'/g, `'\\''`)}'`;
    script = [`cd ${quotedRoot}`, ...cleaned].join(" && ");
  }
  if (useSudo && script) {
    const escaped = `'${script.replace(/'/g, `'\\''`)}'`;
    return `sudo su - root -c ${escaped}`;
  }
  return script;
}

type MappingConfigTab = "bitbucket" | "cursor" | "deployment";

const MAPPING_TABS: { id: MappingConfigTab; label: string; title: string; description: string }[] = [
  {
    id: "bitbucket",
    label: "Bitbucket",
    title: "Bitbucket configuration",
    description: "Connect this Jira project to its Bitbucket repository, branches, and website URLs.",
  },
  {
    id: "cursor",
    label: "Cursor SDK",
    title: "Cursor SDK configuration",
    description:
      "Rules and skills passed to Cursor SDK and OpenAI code generation as mandatory instructions.",
  },
  {
    id: "deployment",
    label: "Deployment",
    title: "Deployment configuration",
    description: "SSH access and environment-specific post-merge commands for Staging and Live deployments.",
  },
];

function normalizeProjectKey(key: string): string {
  return key.trim().toUpperCase();
}

function mappingToForm(mapping: Mapping) {
  return {
    jira_project_key: mapping.jira_project_key,
    bitbucket_workspace: mapping.bitbucket_workspace,
    bitbucket_repo_slug: mapping.bitbucket_repo_slug,
    master_branch: mapping.master_branch,
    beta_branch: mapping.beta_branch,
    beta_website_url: mapping.beta_website_url,
    master_website_url: mapping.master_website_url,
    rules: mapping.rules,
    skills: mapping.skills,
    ssh_host: mapping.ssh_host,
    ssh_port: mapping.ssh_port,
    ssh_username: mapping.ssh_username,
    ssh_password: "",
    ssh_private_key: "",
    ssh_auth_type: mapping.ssh_auth_type,
    ssh_use_sudo: mapping.ssh_use_sudo,
    project_root_directory: mapping.project_root_directory,
    local_project_directory: mapping.local_project_directory,
    beta_post_pr_merge_commands: commandsFromStorage(mapping.beta_post_pr_merge_commands),
    master_post_pr_merge_commands: commandsFromStorage(mapping.master_post_pr_merge_commands),
  };
}

function PencilIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

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

function ProjectAvatar({ project, size = "md" }: { project: { key: string; avatar_url?: string | null }; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "w-7 h-7 text-[10px]" : "w-10 h-10 text-xs";
  if (project.avatar_url) {
    return (
      <img
        src={project.avatar_url}
        alt=""
        className={`${sizeClass} rounded-lg flex-shrink-0 ring-1 ring-slate-200/80 object-cover`}
      />
    );
  }
  return (
    <span
      className={`${sizeClass} rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center font-bold text-slate-600 flex-shrink-0`}
    >
      {project.key.slice(0, 2)}
    </span>
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
  const [activeConfigTab, setActiveConfigTab] = useState<MappingConfigTab>("bitbucket");
  const [sshPasswordConfigured, setSshPasswordConfigured] = useState(false);
  const [sshPrivateKeyConfigured, setSshPrivateKeyConfigured] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    },
    [navigate],
  );

  const loadMappings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getMappings();
      setMappings(data.mappings);
      return data.mappings;
    } catch (err) {
      handleAuthError(err);
      return [];
    } finally {
      setLoading(false);
    }
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
      .ensureAuth()
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
    () => new Map(mappings.map((m) => [normalizeProjectKey(m.jira_project_key), m])),
    [mappings],
  );

  const applyProjectSelection = useCallback(
    (projectKey: string) => {
      const key = normalizeProjectKey(projectKey);
      if (!key) return;

      setSelectedProjectKey(key);
      const existing = mappingByKey.get(key);
      if (existing) {
        setEditingId(existing.id);
        setForm(mappingToForm(existing));
        setSshPasswordConfigured(existing.ssh_password_configured);
        setSshPrivateKeyConfigured(existing.ssh_private_key_configured);
      } else {
        setEditingId(null);
        setForm({
          ...emptyForm,
          jira_project_key: key,
        });
        setSshPasswordConfigured(false);
        setSshPrivateKeyConfigured(false);
      }
      setActiveConfigTab("bitbucket");
      setError(null);
    },
    [mappingByKey],
  );

  useEffect(() => {
    if (!selectedProjectKey || loading) return;
    const existing = mappingByKey.get(selectedProjectKey);
    if (!existing || editingId === existing.id) return;
    setEditingId(existing.id);
    setForm(mappingToForm(existing));
    setSshPasswordConfigured(existing.ssh_password_configured);
    setSshPrivateKeyConfigured(existing.ssh_private_key_configured);
  }, [mappingByKey, selectedProjectKey, loading, editingId]);

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
    const rows = allProjects.map((project) => {
      const projectKey = normalizeProjectKey(project.key);
      return {
        project,
        projectKey,
        mapping: mappingByKey.get(projectKey) ?? null,
      };
    });
    rows.sort((a, b) => {
      if (a.mapping && !b.mapping) return -1;
      if (!a.mapping && b.mapping) return 1;
      return a.projectKey.localeCompare(b.projectKey);
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
  const unconfiguredCount = allProjects.filter(
    (project) => !mappingByKey.has(normalizeProjectKey(project.key)),
  ).length;

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setSelectedProjectKey(null);
    setActiveConfigTab("bitbucket");
    setSshPasswordConfigured(false);
    setSshPrivateKeyConfigured(false);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const savedKey = normalizeProjectKey(form.jira_project_key);
    const payload: MappingInput = {
      jira_project_key: form.jira_project_key,
      bitbucket_workspace: form.bitbucket_workspace,
      bitbucket_repo_slug: form.bitbucket_repo_slug,
      master_branch: form.master_branch,
      beta_branch: form.beta_branch,
      beta_website_url: form.beta_website_url,
      master_website_url: form.master_website_url,
      rules: form.rules,
      skills: form.skills,
      ssh_host: form.ssh_host,
      ssh_port: form.ssh_port,
      ssh_username: form.ssh_username,
      ssh_auth_type: form.ssh_auth_type,
      ssh_use_sudo: form.ssh_use_sudo,
      project_root_directory: form.project_root_directory,
      local_project_directory: form.local_project_directory,
      beta_post_pr_merge_commands: commandsToStorage(form.beta_post_pr_merge_commands),
      master_post_pr_merge_commands: commandsToStorage(form.master_post_pr_merge_commands),
    };
    if (form.ssh_auth_type === "password" && form.ssh_password.trim()) {
      payload.ssh_password = form.ssh_password.trim();
    }
    if (form.ssh_auth_type === "pem" && form.ssh_private_key.trim()) {
      payload.ssh_private_key = form.ssh_private_key.trim();
    }
    try {
      const wasEditing = Boolean(editingId);
      const savedMapping = wasEditing
        ? await api.updateMapping(editingId!, payload)
        : await api.createMapping(payload);
      await loadMappings();
      setSelectedProjectKey(savedKey);
      setEditingId(savedMapping.id);
      setForm(mappingToForm(savedMapping));
      setSshPasswordConfigured(savedMapping.ssh_password_configured);
      setSshPrivateKeyConfigured(savedMapping.ssh_private_key_configured);
      toast(wasEditing ? "Mapping updated." : "Mapping created.", "success");
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
    setError(null);
    try {
      await api.deleteMapping(mapping.id);
      if (editingId === mapping.id) {
        resetForm();
      }
      setDeleteConfirmId(null);
      loadMappings();
      toast(`Mapping for ${mapping.jira_project_key} deleted.`, "success");
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
    ? allProjects.find((project) => normalizeProjectKey(project.key) === selectedProjectKey)
    : null;
  const selectedMapping = selectedProjectKey ? mappingByKey.get(selectedProjectKey) : null;
  const activeConfigTabMeta = MAPPING_TABS.find((tab) => tab.id === activeConfigTab)!;
  const betaPostMergeShellPreview = buildPostMergeShellPreview(
    form.project_root_directory,
    form.beta_post_pr_merge_commands,
    form.ssh_use_sudo,
  );
  const masterPostMergeShellPreview = buildPostMergeShellPreview(
    form.project_root_directory,
    form.master_post_pr_merge_commands,
    form.ssh_use_sudo,
  );

  const updatePostMergeCommand = (
    field: "beta_post_pr_merge_commands" | "master_post_pr_merge_commands",
    index: number,
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      [field]: current[field].map((command, i) => (i === index ? value : command)),
    }));
  };

  const addPostMergeCommand = (
    field: "beta_post_pr_merge_commands" | "master_post_pr_merge_commands",
  ) => {
    setForm((current) => ({
      ...current,
      [field]: [...current[field], ""],
    }));
  };

  const removePostMergeCommand = (
    field: "beta_post_pr_merge_commands" | "master_post_pr_merge_commands",
    index: number,
  ) => {
    setForm((current) => ({
      ...current,
      [field]:
        current[field].length === 1 ? [""] : current[field].filter((_, i) => i !== index),
    }));
  };

  const handlePemFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const pemContent = await file.text();
      setForm((current) => ({ ...current, ssh_private_key: pemContent }));
      setError(null);
    } catch {
      setError("Could not read the PEM file. Try pasting the key contents instead.");
    }
    event.target.value = "";
  };

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
            <div className="card overflow-hidden flex flex-col h-full min-h-0 bg-slate-50/70 border-r border-slate-200/90">
              <div className="card-header flex-shrink-0">
                <h2 className="card-title">All Jira projects</h2>
                <p className="card-subtitle">
                  {projectsLoading || loading
                    ? "Loading…"
                    : `${configuredCount} configured · ${unconfiguredCount} need setup`}
                </p>
              </div>

              {!projectsLoading && !loading && projectRows.length > 0 && (
                <div className="px-3 py-3 border-b border-slate-200/60 flex-shrink-0">
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
                    {filteredProjectRows.map(({ project, projectKey, mapping }) => (
                      <li key={project.id}>
                        <button
                          type="button"
                          onClick={() => handleProjectSelect(project)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2.5 ${
                            selectedProjectKey === projectKey
                              ? "bg-brand-50/80 text-brand-700 font-medium ring-1 ring-brand-200/40 border-l-[3px] border-brand-600"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          <ProjectAvatar project={project} size="sm" />
                          <span className="truncate min-w-0 flex-1">
                            <span className="font-mono text-[11px] text-slate-400 mr-1.5">{project.key}</span>
                            <span className={selectedProjectKey === projectKey ? "text-brand-800" : ""}>
                              {project.name}
                            </span>
                          </span>
                          {mapping ? (
                            <span className="badge-success flex-shrink-0 text-[10px] px-1.5 py-0.5">
                              Mapped
                            </span>
                          ) : (
                            <span className="badge-warning flex-shrink-0 text-[10px] px-1.5 py-0.5">
                              Setup
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!projectsLoading && !loading && projectRows.length > 0 && (
                <div className="px-4 py-2.5 border-t border-slate-200/80 text-xs text-slate-500 flex-shrink-0 bg-slate-50/60 font-medium">
                  {filteredProjectRows.length === projectRows.length
                    ? `${projectRows.length} project${projectRows.length === 1 ? "" : "s"}`
                    : `${filteredProjectRows.length} of ${projectRows.length} projects`}
                </div>
              )}
            </div>
          </aside>

          <section className="lg:col-span-4 flex flex-col min-h-0 gap-4">
            {!selectedProjectKey && (
            <div className="card overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="card-header flex items-center justify-between flex-shrink-0">
                <div>
                  <h2 className="card-title">Configured mappings</h2>
                  <p className="card-subtitle">
                    {loading ? "Loading…" : "Active project-to-repository links"}
                  </p>
                </div>
                {!loading && mappings.length > 0 && (
                  <span className="badge-neutral tabular-nums">
                    {mappings.length} total
                  </span>
                )}
              </div>
              {loading ? (
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-32 skeleton" />
                  ))}
                </div>
              ) : mappings.length === 0 ? (
                <div className="empty-state flex-1 py-16">
                  <div className="empty-state-icon">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.75}
                        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                      />
                    </svg>
                  </div>
                  <p className="text-base font-semibold text-slate-800">No mappings yet</p>
                  <p className="mt-1.5 text-sm text-slate-500 max-w-sm">
                    Add one to start delivering tickets from Jira to Bitbucket.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const first = allProjects[0];
                      if (first) handleConfigure(first);
                    }}
                    disabled={allProjects.length === 0}
                    className="btn-primary mt-6"
                  >
                    + Add mapping
                  </button>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-3 items-start content-start">
                  {mappings.map((mapping) => {
                    const mappingKey = normalizeProjectKey(mapping.jira_project_key);
                    const project = allProjects.find(
                      (item) => normalizeProjectKey(item.key) === mappingKey,
                    );
                    const isSelected = selectedProjectKey === mappingKey;
                    return (
                      <div
                        key={mapping.id}
                        className={`relative rounded-xl border p-4 transition-all hover:shadow-card-hover ${
                          isSelected
                            ? "border-brand-300 bg-slate-50/50 ring-1 ring-brand-200/70"
                            : "border-slate-200/80 bg-white hover:border-brand-200"
                        }`}
                      >
                        <div className="flex flex-col gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <ProjectAvatar
                              project={project ?? { key: mapping.jira_project_key }}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Jira project</p>
                              <p className="font-mono font-semibold text-slate-900">{mapping.jira_project_key}</p>
                              {project && (
                                <p className="text-xs text-slate-500 truncate">{project.name}</p>
                              )}
                            </div>
                          </div>

                          <div className="min-w-0 border-t border-slate-100 pt-3">
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Git repo</p>
                            <p className="font-mono text-sm text-slate-800 truncate">
                              <span className="text-slate-400">{mapping.bitbucket_workspace}/</span>
                              {mapping.bitbucket_repo_slug}
                            </p>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              <span className="badge-neutral font-mono text-[10px]">
                                {mapping.master_branch}
                              </span>
                              <span className="badge-info font-mono text-[10px]">
                                {mapping.beta_branch}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => handleEdit(mapping)}
                              className="btn-ghost btn-sm text-brand-600"
                              title="Edit mapping"
                            >
                              <PencilIcon />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(mapping.id)}
                              className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {deleteConfirmId === mapping.id && (
                          <div className="absolute right-4 top-full mt-1 z-20 w-56 rounded-xl border border-slate-200/80 bg-white shadow-lg p-3">
                            <p className="text-sm font-medium text-slate-800">Delete this mapping?</p>
                            <p className="text-xs text-slate-500 mt-1">This cannot be undone.</p>
                            <div className="flex gap-2 mt-3">
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId(null)}
                                className="btn-secondary btn-sm flex-1"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(mapping)}
                                className="btn-danger btn-sm flex-1"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {selectedProjectKey && (
              <div className="card overflow-hidden flex flex-col flex-1 min-h-0">
                <div className="card-header flex items-center gap-3 flex-shrink-0">
                  {selectedProject ? (
                    <ProjectAvatar project={selectedProject} />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600 flex-shrink-0">
                      <SettingsIcon className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="card-title">
                        {selectedProject?.name ?? selectedProjectKey}
                      </h2>
                      <span className="font-mono text-xs text-brand-600/80 bg-brand-50 px-2 py-0.5 rounded-md ring-1 ring-brand-100/80">
                        {selectedProjectKey}
                      </span>
                      {selectedMapping ? (
                        <span className="badge-success">Mapped</span>
                      ) : (
                        <span className="badge-warning">Needs setup</span>
                      )}
                    </div>
                    <p className="card-subtitle mt-0.5">
                      {selectedMapping
                        ? "Update the Bitbucket repository connection for this project."
                        : "Connect this project to its Bitbucket repository and deployment URLs."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="btn-secondary btn-sm flex-shrink-0"
                  >
                    Back to list
                  </button>
                </div>

                <div className="overflow-y-auto flex-1 min-h-0 flex flex-col">
                  <div
                    className="tab-list overflow-x-auto flex-shrink-0"
                    role="tablist"
                    aria-label="Project mapping configuration"
                  >
                    {MAPPING_TABS.map((tab) => {
                      const isActive = activeConfigTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          id={`mapping-tab-${tab.id}`}
                          aria-selected={isActive}
                          aria-controls={`mapping-panel-${tab.id}`}
                          className={isActive ? "tab-active" : "tab"}
                          onClick={() => setActiveConfigTab(tab.id)}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="px-4 sm:px-6 py-5 flex-1 min-h-0 overflow-y-auto">
                    <div className="mb-5">
                      <h3 className="text-sm font-semibold text-slate-900">{activeConfigTabMeta.title}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{activeConfigTabMeta.description}</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5 max-w-4xl">
                      {activeConfigTab === "bitbucket" && (
                        <div
                          role="tabpanel"
                          id="mapping-panel-bitbucket"
                          aria-labelledby="mapping-tab-bitbucket"
                          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
                        >
                          <label className="block space-y-1.5">
                            <span className="label">Jira project key</span>
                            <input
                              type="text"
                              required
                              placeholder="PROJ-A"
                              value={form.jira_project_key}
                              onChange={(e) => {
                                const key = normalizeProjectKey(e.target.value);
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
                              className="input font-mono"
                            />
                          </label>
                          <label className="block space-y-1.5">
                            <span className="label">Production branch</span>
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
                            <span className="label">Staging branch</span>
                            <input
                              type="text"
                              required
                              placeholder="beta"
                              value={form.beta_branch}
                              onChange={(e) => setForm({ ...form, beta_branch: e.target.value })}
                              className="input font-mono"
                            />
                          </label>
                          {form.beta_branch.trim().toLowerCase() ===
                            form.master_branch.trim().toLowerCase() &&
                            form.beta_branch.trim() !== "" && (
                            <p className="lg:col-span-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              Staging and live share the same target branch. One pull request is
                              created; merging deploys both servers and runs website testing on
                              staging and live URLs.
                            </p>
                          )}
                          <label className="block space-y-1.5 lg:col-span-2">
                            <span className="label">Staging website</span>
                            <input
                              type="url"
                              required
                              placeholder="https://beta.example.com"
                              value={form.beta_website_url}
                              onChange={(e) => setForm({ ...form, beta_website_url: e.target.value })}
                              className="input"
                            />
                          </label>
                          <label className="block space-y-1.5 lg:col-span-2">
                            <span className="label">Live website</span>
                            <input
                              type="url"
                              required
                              placeholder="https://www.example.com"
                              value={form.master_website_url}
                              onChange={(e) => setForm({ ...form, master_website_url: e.target.value })}
                              className="input"
                            />
                          </label>
                        </div>
                      )}

                      {activeConfigTab === "cursor" && (
                        <div
                          role="tabpanel"
                          id="mapping-panel-cursor"
                          aria-labelledby="mapping-tab-cursor"
                          className="space-y-4"
                        >
                          <label className="block space-y-1.5">
                            <span className="label">Rules</span>
                            <textarea
                              rows={8}
                              placeholder={"Follow Hyva and Tailwind conventions.\nKeep Magento Admin as the source of truth."}
                              value={form.rules}
                              onChange={(e) => setForm({ ...form, rules: e.target.value })}
                              className="input font-mono text-sm resize-y min-h-[10rem]"
                            />
                          </label>
                          <label className="block space-y-1.5">
                            <span className="label">Skills</span>
                            <textarea
                              rows={8}
                              placeholder={"When implementing checkout changes, follow the pass-generation workflow.\nUse Magewire for server-driven interactivity."}
                              value={form.skills}
                              onChange={(e) => setForm({ ...form, skills: e.target.value })}
                              className="input font-mono text-sm resize-y min-h-[10rem]"
                            />
                          </label>
                        </div>
                      )}

                      {activeConfigTab === "deployment" && (
                        <div
                          role="tabpanel"
                          id="mapping-panel-deployment"
                          aria-labelledby="mapping-tab-deployment"
                          className="space-y-5"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <label className="block space-y-1.5 sm:col-span-2">
                              <span className="label">SSH host</span>
                              <input
                                type="text"
                                placeholder="deploy.example.com"
                                value={form.ssh_host}
                                onChange={(e) => setForm({ ...form, ssh_host: e.target.value })}
                                className="input font-mono"
                              />
                            </label>
                            <label className="block space-y-1.5">
                              <span className="label">SSH port</span>
                              <input
                                type="number"
                                min={1}
                                max={65535}
                                value={form.ssh_port}
                                onChange={(e) =>
                                  setForm({ ...form, ssh_port: Number(e.target.value) || 22 })
                                }
                                className="input font-mono"
                              />
                            </label>
                            <label className="block space-y-1.5">
                              <span className="label">SSH username</span>
                              <input
                                type="text"
                                placeholder="deploy"
                                value={form.ssh_username}
                                onChange={(e) => setForm({ ...form, ssh_username: e.target.value })}
                                className="input font-mono"
                              />
                            </label>
                            <label className="block space-y-1.5 sm:col-span-3">
                              <span className="label">SSH authentication</span>
                              <div className="flex flex-wrap gap-4 pt-1">
                                <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="ssh_auth_type"
                                    value="password"
                                    checked={form.ssh_auth_type === "password"}
                                    onChange={() =>
                                      setForm({ ...form, ssh_auth_type: "password", ssh_private_key: "" })
                                    }
                                    className="text-brand-600 focus:ring-brand-500"
                                  />
                                  Password
                                </label>
                                <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="ssh_auth_type"
                                    value="pem"
                                    checked={form.ssh_auth_type === "pem"}
                                    onChange={() =>
                                      setForm({ ...form, ssh_auth_type: "pem", ssh_password: "" })
                                    }
                                    className="text-brand-600 focus:ring-brand-500"
                                  />
                                  PEM file
                                </label>
                              </div>
                            </label>
                          </div>

                          {form.ssh_auth_type === "password" ? (
                            <label className="block space-y-1.5 max-w-md">
                              <span className="label">SSH password</span>
                              <input
                                type="password"
                                placeholder={sshPasswordConfigured ? "Leave blank to keep existing" : "Enter SSH password"}
                                value={form.ssh_password}
                                onChange={(e) => setForm({ ...form, ssh_password: e.target.value })}
                                className="input font-mono"
                                autoComplete="new-password"
                              />
                              {sshPasswordConfigured && !form.ssh_password && (
                                <span className="text-xs text-emerald-600">Password saved</span>
                              )}
                            </label>
                          ) : (
                            <div className="space-y-4">
                              <label className="block space-y-1.5 max-w-lg">
                                <span className="label">Upload PEM file</span>
                                <input
                                  type="file"
                                  accept=".pem,.key,application/x-pem-file,text/plain"
                                  onChange={handlePemFileChange}
                                  className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
                                />
                                <span className="text-xs text-slate-500">
                                  Select a `.pem` or `.key` file from your server provider.
                                </span>
                              </label>

                              <label className="block space-y-1.5">
                                <span className="label">Or paste PEM contents</span>
                                <textarea
                                  rows={5}
                                  placeholder={
                                    sshPrivateKeyConfigured
                                      ? "Leave blank to keep existing PEM key"
                                      : "-----BEGIN RSA PRIVATE KEY-----\n..."
                                  }
                                  value={form.ssh_private_key}
                                  onChange={(e) => setForm({ ...form, ssh_private_key: e.target.value })}
                                  className="input font-mono text-sm resize-y min-h-[8rem]"
                                />
                                {sshPrivateKeyConfigured && !form.ssh_private_key && (
                                  <span className="text-xs text-emerald-600">PEM key saved</span>
                                )}
                              </label>
                            </div>
                          )}

                          <label className="block space-y-1.5">
                            <span className="label">Local project directory</span>
                            <input
                              type="text"
                              placeholder="/var/www/html/myproject"
                              value={form.local_project_directory}
                              onChange={(e) => setForm({ ...form, local_project_directory: e.target.value })}
                              className="input font-mono"
                            />
                            <span className="text-xs text-slate-500">
                              Path to this repo on your development machine. Shown in delivery workflow git commands.
                            </span>
                          </label>

                          <label className="block space-y-1.5">
                            <span className="label">Project root directory</span>
                            <input
                              type="text"
                              placeholder="/var/www/html/myproject"
                              value={form.project_root_directory}
                              onChange={(e) => setForm({ ...form, project_root_directory: e.target.value })}
                              className="input font-mono"
                            />
                            <span className="text-xs text-slate-500">
                              Deployment always starts by changing into this directory.
                            </span>
                          </label>

                          <label className="inline-flex items-start gap-3 rounded-xl border border-slate-200/80 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors">
                            <input
                              type="checkbox"
                              checked={form.ssh_use_sudo}
                              onChange={(e) => setForm({ ...form, ssh_use_sudo: e.target.checked })}
                              className="mt-0.5 text-brand-600 focus:ring-brand-500"
                            />
                            <span className="text-sm text-slate-700">
                              <span className="font-medium text-slate-800">Run commands as root via sudo</span>
                              <span className="block text-xs text-slate-500 mt-1">
                                Wraps each deployment command with{" "}
                                <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">
                                  sudo su - root -c
                                </code>
                                . Enable this when git, docker, or file permissions require root access on the server.
                              </span>
                            </span>
                          </label>

                          <div className="space-y-8">
                            {(
                              [
                                {
                                  field: "beta_post_pr_merge_commands" as const,
                                  title: "Staging deployment commands",
                                  description: `Runs after the Staging PR is merged (${form.beta_branch || "beta"}).`,
                                  placeholderFirst: `git pull origin ${form.beta_branch || "beta"}`,
                                  preview: betaPostMergeShellPreview,
                                },
                                {
                                  field: "master_post_pr_merge_commands" as const,
                                  title: "Live deployment commands",
                                  description: `Runs after the Live (Master) PR is merged (${form.master_branch || "master"}).`,
                                  placeholderFirst: `git pull origin ${form.master_branch || "master"}`,
                                  preview: masterPostMergeShellPreview,
                                },
                              ] as const
                            ).map((section) => (
                              <div key={section.field} className="space-y-3">
                                <div>
                                  <span className="label">{section.title}</span>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {section.description}                                     Each command runs in order after{" "}
                                    <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">
                                      cd {form.project_root_directory.trim() || "<project root>"}
                                    </code>
                                    . Do not include <code className="text-[11px]">cd</code> here.{" "}
                                    For <code className="text-[11px]">docker exec</code>, omit{" "}
                                    <code className="text-[11px]">-it</code> — commands run non-interactively over SSH.
                                  </p>
                                </div>

                                <div className="space-y-2">
                                  {form[section.field].map((command, index) => (
                                    <div key={index} className="flex gap-2 items-start">
                                      <span className="mt-2.5 text-xs font-mono text-slate-400 w-5 text-right flex-shrink-0">
                                        {index + 1}.
                                      </span>
                                      <input
                                        type="text"
                                        placeholder={
                                          index === 0
                                            ? section.placeholderFirst
                                            : "sudo docker exec php-fpm sh setup.sh"
                                        }
                                        value={command}
                                        onChange={(e) =>
                                          updatePostMergeCommand(section.field, index, e.target.value)
                                        }
                                        className="input font-mono flex-1"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => removePostMergeCommand(section.field, index)}
                                        className="btn-secondary btn-sm mt-0.5 flex-shrink-0"
                                        aria-label={`Remove ${section.title.toLowerCase()} command ${index + 1}`}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => addPostMergeCommand(section.field)}
                                  className="btn-secondary btn-sm"
                                >
                                  Add command
                                </button>

                                {section.preview && (
                                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3">
                                    <p className="text-xs font-medium text-slate-600 mb-1.5">
                                      Generated shell command
                                    </p>
                                    <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap break-all">
                                      {section.preview}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-200/80">
                        <button type="submit" disabled={saving} className="btn-primary">
                          {saving ? "Saving…" : editingId ? "Update mapping" : "Save mapping"}
                        </button>
                        {selectedMapping && (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(selectedMapping.id)}
                            className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200"
                          >
                            Delete mapping
                          </button>
                        )}
                        {selectedMapping && deleteConfirmId === selectedMapping.id && (
                          <div className="w-full rounded-xl border border-red-200 bg-red-50 p-4 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-medium text-red-900">Delete this mapping?</p>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setDeleteConfirmId(null)} className="btn-secondary btn-sm">
                                Cancel
                              </button>
                              <button type="button" onClick={() => handleDelete(selectedMapping)} className="btn-danger btn-sm">
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
