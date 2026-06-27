export interface User {
  account_id: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
}

export interface MeResponse {
  user: User;
  site_name: string;
  site_url: string;
  bitbucket_configured?: boolean;
  bitbucket_username?: string | null;
  bitbucket_git_username?: string | null;
  bitbucket_git_configured?: boolean;
  openai_configured?: boolean;
  openai_model?: string | null;
  cursor_configured?: boolean;
  cursor_model?: string | null;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelsListResponse {
  models: ModelOption[];
  source: "api" | "fallback";
}

export interface BitbucketStatus {
  configured: boolean;
  username?: string | null;
  display_name?: string | null;
  git_username?: string | null;
  git_configured?: boolean;
}

export interface BitbucketConnectRequest {
  username: string;
  app_password: string;
  git_username?: string;
  git_password?: string;
}

export interface OpenAIStatus {
  configured: boolean;
  model: string;
}

export interface CursorStatus {
  configured: boolean;
  model: string;
}

export interface OpenAIConnectRequest {
  api_key: string;
  model: string;
}

export interface CursorConnectRequest {
  api_key: string;
  model: string;
}

export interface CredentialSecretResponse {
  api_key?: string;
  api_token?: string;
  git_password?: string;
}

export interface ConnectRequest {
  site_url: string;
  email: string;
  api_token: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  avatar_url?: string;
  project_type?: string;
}

export interface ProjectsResponse {
  projects: Project[];
  total: number;
  start_at: number;
  max_results: number;
}

export interface Issue {
  id: string;
  key: string;
  summary: string;
  status?: string;
  status_category?: string;
  priority?: string;
  assignee?: string;
  assignee_avatar?: string;
  updated?: string;
  project_key?: string;
  project_name?: string;
  issue_type?: string;
  issue_type_icon?: string;
}

export interface IssuesResponse {
  issues: Issue[];
  total: number;
  next_page_token?: string | null;
  is_last: boolean;
  max_results: number;
}

export interface StatusBreakdown {
  total: number;
  qis?: number;
  bug?: number;
  task?: number;
}

export interface IssueSummary {
  total: number;
  by_status?: Record<string, StatusBreakdown>;
  qis?: number;
  bug?: number;
  task?: number;
}

export interface ProjectSummariesResponse {
  summaries: Record<string, IssueSummary>;
}

export interface Mapping {
  id: string;
  jira_project_key: string;
  bitbucket_workspace: string;
  bitbucket_repo_slug: string;
  master_branch: string;
  beta_branch: string;
  beta_website_url: string;
  master_website_url: string;
  rules: string;
  skills: string;
  ssh_host: string;
  ssh_port: number;
  ssh_username: string;
  ssh_password_configured: boolean;
  ssh_private_key_configured: boolean;
  ssh_auth_type: "password" | "pem";
  ssh_use_sudo: boolean;
  project_root_directory: string;
  local_project_directory: string;
  beta_post_pr_merge_commands: string;
  master_post_pr_merge_commands: string;
  beta_post_merge_shell_preview: string;
  master_post_merge_shell_preview: string;
  created_at: string;
  updated_at: string;
}

export interface MappingInput {
  jira_project_key: string;
  bitbucket_workspace: string;
  bitbucket_repo_slug: string;
  master_branch: string;
  beta_branch: string;
  beta_website_url: string;
  master_website_url: string;
  rules: string;
  skills: string;
  ssh_host: string;
  ssh_port: number;
  ssh_username: string;
  ssh_password?: string;
  ssh_private_key?: string;
  ssh_auth_type: "password" | "pem";
  ssh_use_sudo: boolean;
  project_root_directory: string;
  local_project_directory: string;
  beta_post_pr_merge_commands: string;
  master_post_pr_merge_commands: string;
}

export interface MappingsResponse {
  mappings: Mapping[];
}

export interface AdminDatabaseSettings {
  jira_impact_analysis_field: string;
  jira_unit_testing_field: string;
  jira_admin_database_field: string;
  jira_impact_analysis_field_name: string;
  jira_unit_testing_field_name: string;
  jira_admin_database_field_name: string;
  env_jira_impact_analysis_field: string;
  env_jira_unit_testing_field: string;
  env_jira_admin_database_field: string;
  jira_fields_cache_total: number;
  jira_fields_cached_at: string | null;
  updated_at: string | null;
}

export interface AdminDatabaseSettingsInput {
  jira_impact_analysis_field: string;
  jira_unit_testing_field: string;
  jira_admin_database_field: string;
}

export interface JiraFieldItem {
  id: string;
  name: string;
  custom: boolean;
  schema_type?: string | null;
  clause_names?: string[];
}

export interface JiraFieldsResponse {
  fields: JiraFieldItem[];
  total: number;
  cached_at?: string | null;
  source?: string;
}

export interface SyncJiraFieldsResponse {
  fields: JiraFieldItem[];
  total: number;
  cached_at: string | null;
}

export interface RunStepLog {
  step: string;
  status: string;
  message: string;
  at: string;
}

export interface PipelineStepInfo {
  step: string;
  label: string;
  status: string;
}

export interface ChangedFile {
  path: string;
  action: string;
}

export interface JiraComment {
  author: string;
  created: string;
  body: string;
}

export interface FileDiff {
  path: string;
  action: string;
  base_ref: string;
  head_ref: string;
  old_content: string | null;
  new_content: string | null;
  unified_diff: string;
}

export interface WebsiteVerification {
  environment: string;
  url: string;
  passed: boolean;
  summary: string;
  findings: string[];
  screenshot_filename?: string | null;
  page_type?: string | null;
  page_reason?: string | null;
}

export interface PendingWebsiteVerification {
  environment: string;
  url: string;
  passed: boolean;
  summary: string;
  findings: string[];
  draft_comment: string;
  screenshot_filename?: string | null;
  admin_paths?: string[];
  page_type?: string | null;
  page_reason?: string | null;
}

export interface DeploymentCommand {
  index: number;
  command: string;
  status: string;
  output: string;
  at: string;
}

export interface DeploymentAttempt {
  id: string;
  environment: string;
  environment_label: string;
  trigger: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  planned_commands: string[];
  commands: DeploymentCommand[];
  output: string | null;
  error: string | null;
}

export interface DeliveryRun {
  id: string;
  jira_issue_key: string;
  jira_issue_id: string;
  project_key: string;
  summary: string;
  status: string;
  workflow_phase: string;
  workflow_phase_label: string;
  ui_active_step: number;
  jira_status: string | null;
  issue_type: string | null;
  issue_type_icon: string | null;
  current_step: string | null;
  next_step: string | null;
  next_step_label: string | null;
  pipeline_steps: PipelineStepInfo[];
  steps_log: RunStepLog[];
  estimation_hours: number | null;
  estimation_summary: string | null;
  draft_comment: string | null;
  draft_question: string | null;
  needs_clarification: boolean;
  estimation_prepared: boolean;
  description: string | null;
  jira_comments: JiraComment[];
  jira_synced_at: string | null;
  changed_files: ChangedFile[];
  changed_files_refreshed_at: string | null;
  branch_name: string | null;
  local_project_directory: string | null;
  pr_url: string | null;
  pr_id: number | null;
  beta_pr_url: string | null;
  beta_pr_id: number | null;
  master_pr_url: string | null;
  master_pr_id: number | null;
  beta_merged: boolean;
  master_merged: boolean;
  unified_deploy_target: boolean;
  pending_deploy_retry: string | null;
  staging_deploy_commands: string[];
  live_deploy_commands: string[];
  deployment_history: DeploymentAttempt[];
  verifications: WebsiteVerification[];
  pending_verification: PendingWebsiteVerification | null;
  error_message: string | null;
  workflow_notice: string | null;
  jira_issue_url: string | null;
  jira_development_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunListResponse {
  runs: DeliveryRun[];
}

export interface HealthResponse {
  status: string;
  api_version?: number;
  features?: {
    estimation_workflow?: boolean;
    by_issue?: boolean;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // ignore
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export const api = {
  getHealth: () => request<HealthResponse>("/api/health"),
  connect: (body: ConnectRequest) =>
    request<MeResponse & { ok: boolean }>("/api/auth/connect", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getMe: () => request<MeResponse>("/api/auth/me"),
  resume: () =>
    request<MeResponse & { ok: boolean }>("/api/auth/resume", {
      method: "POST",
    }),
  ensureAuth: async (): Promise<MeResponse> => {
    try {
      return await request<MeResponse>("/api/auth/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return await request<MeResponse & { ok: boolean }>("/api/auth/resume", {
          method: "POST",
        });
      }
      throw err;
    }
  },
  getBitbucketStatus: () => request<BitbucketStatus>("/api/auth/bitbucket"),
  connectBitbucket: (body: BitbucketConnectRequest) =>
    request<BitbucketStatus & { ok: boolean }>("/api/auth/bitbucket", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  disconnectBitbucket: () =>
    request<{ ok: boolean; configured: boolean }>("/api/auth/bitbucket", { method: "DELETE" }),
  revealBitbucketSecret: () => request<CredentialSecretResponse>("/api/auth/bitbucket/secret"),
  revealBitbucketGitSecret: () => request<CredentialSecretResponse>("/api/auth/bitbucket/git-secret"),
  getOpenAIStatus: () => request<OpenAIStatus>("/api/auth/openai"),
  connectOpenAI: (body: OpenAIConnectRequest) =>
    request<OpenAIStatus & { ok: boolean }>("/api/auth/openai", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  disconnectOpenAI: () =>
    request<{ ok: boolean; configured: boolean }>("/api/auth/openai", { method: "DELETE" }),
  revealOpenAISecret: () => request<CredentialSecretResponse>("/api/auth/openai/secret"),
  getOpenAIModels: (apiKey?: string) => {
    const params = apiKey?.trim() ? `?api_key=${encodeURIComponent(apiKey.trim())}` : "";
    return request<ModelsListResponse>(`/api/auth/openai/models${params}`);
  },
  getCursorStatus: () => request<CursorStatus>("/api/auth/cursor"),
  connectCursor: (body: CursorConnectRequest) =>
    request<CursorStatus & { ok: boolean }>("/api/auth/cursor", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  disconnectCursor: () =>
    request<{ ok: boolean; configured: boolean }>("/api/auth/cursor", { method: "DELETE" }),
  revealCursorSecret: () => request<CredentialSecretResponse>("/api/auth/cursor/secret"),
  getCursorModels: (apiKey?: string) => {
    const params = apiKey?.trim() ? `?api_key=${encodeURIComponent(apiKey.trim())}` : "";
    return request<ModelsListResponse>(`/api/auth/cursor/models${params}`);
  },
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  getProjects: (startAt = 0, maxResults = 100, query?: string) => {
    const params = new URLSearchParams({
      start_at: String(startAt),
      max_results: String(maxResults),
    });
    if (query?.trim()) params.set("query", query.trim());
    return request<ProjectsResponse>(`/api/projects?${params}`);
  },
  getAllProjects: async (query?: string) => {
    const all: Project[] = [];
    let startAt = 0;
    const maxResults = 100;
    while (true) {
      const data = await api.getProjects(startAt, maxResults, query);
      all.push(...data.projects);
      if (all.length >= data.total || data.projects.length === 0) break;
      startAt += data.projects.length;
    }
    return all;
  },
  getIssues: (
    project?: string,
    pageToken?: string | null,
    assignedToMe = true,
  ) => {
    const params = new URLSearchParams({
      max_results: "50",
      assigned_to_me: String(assignedToMe),
    });
    if (project) params.set("project", project);
    if (pageToken) params.set("page_token", pageToken);
    return request<IssuesResponse>(`/api/issues?${params}`);
  },
  getIssueSummary: (project?: string, assignedToMe = true) => {
    const params = new URLSearchParams({ assigned_to_me: String(assignedToMe) });
    if (project) params.set("project", project);
    return request<IssueSummary>(`/api/issues/summary?${params}`);
  },
  getProjectSummaries: (projectKeys: string[], assignedToMe = true) => {
    if (projectKeys.length === 0) {
      return Promise.resolve({ summaries: {} } as ProjectSummariesResponse);
    }
    const params = new URLSearchParams({
      projects: projectKeys.join(","),
      assigned_to_me: String(assignedToMe),
    });
    return request<ProjectSummariesResponse>(`/api/issues/project-summaries?${params}`);
  },
  getMappings: () => request<MappingsResponse>("/api/mappings"),
  createMapping: (body: MappingInput) =>
    request<Mapping>("/api/mappings", { method: "POST", body: JSON.stringify(body) }),
  updateMapping: (id: string, body: MappingInput) =>
    request<Mapping>(`/api/mappings/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteMapping: (id: string) =>
    request<void>(`/api/mappings/${id}`, { method: "DELETE" }),
  getAdminDatabaseSettings: () => request<AdminDatabaseSettings>("/api/admin/database"),
  updateAdminDatabaseSettings: (body: AdminDatabaseSettingsInput) =>
    request<AdminDatabaseSettings>("/api/admin/database", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  syncJiraFieldsCache: () =>
    request<SyncJiraFieldsResponse>("/api/admin/database/sync-jira-fields", {
      method: "POST",
    }),
  getJiraFields: (query = "", customOnly = true, refresh = false) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    params.set("custom_only", String(customOnly));
    if (refresh) params.set("refresh", "true");
    const suffix = params.toString();
    return request<JiraFieldsResponse>(`/api/jira/fields${suffix ? `?${suffix}` : ""}`);
  },
  startRun: (issueKey: string) =>
    request<DeliveryRun>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ issue_key: issueKey }),
    }),
  getRunByIssue: (issueKey: string) =>
    request<DeliveryRun>(`/api/runs/by-issue/${encodeURIComponent(issueKey)}`),
  listRuns: (params?: { issueKey?: string; projectKey?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.issueKey) search.set("issue_key", params.issueKey);
    if (params?.projectKey) search.set("project_key", params.projectKey);
    if (params?.limit) search.set("limit", String(params.limit));
    const query = search.toString();
    return request<RunListResponse>(`/api/runs${query ? `?${query}` : ""}`);
  },
  getRun: (id: string) => request<DeliveryRun>(`/api/runs/${id}`),
  reloadJira: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/reload-jira`, { method: "POST" }),
  prepareEstimation: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/prepare-estimation`, { method: "POST" }),
  prepareQuestion: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/prepare-question`, { method: "POST" }),
  reloadComment: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/reload-comment`, { method: "POST" }),
  postEstimation: (id: string, comment: string, hours: number) =>
    request<DeliveryRun>(`/api/runs/${id}/post-estimation`, {
      method: "POST",
      body: JSON.stringify({ comment, hours }),
    }),
  requestInfo: (id: string, question: string) =>
    request<DeliveryRun>(`/api/runs/${id}/request-info`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
  startImplementation: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/start-implementation`, { method: "POST" }),
  createPrs: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/create-prs`, { method: "POST" }),
  confirmLocalChanges: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/confirm-local-changes`, { method: "POST" }),
  mergeRun: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/merge`, { method: "POST" }),
  mergeBetaRun: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/merge/beta`, { method: "POST" }),
  mergeMasterRun: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/merge/master`, { method: "POST" }),
  retryDeploymentRun: (id: string, target?: "beta" | "master") =>
    request<DeliveryRun>(`/api/runs/${id}/retry-deployment`, {
      method: "POST",
      body: JSON.stringify(target ? { target } : {}),
    }),
  postVerification: (id: string, comment: string) =>
    request<DeliveryRun>(`/api/runs/${id}/post-verification`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  startVerification: (id: string, target?: "beta" | "master") =>
    request<DeliveryRun>(`/api/runs/${id}/start-verification`, {
      method: "POST",
      body: JSON.stringify(target ? { target } : {}),
    }),
  verificationScreenshotUrl: (id: string, environment: string) =>
    `/api/runs/${id}/verification-screenshot?environment=${encodeURIComponent(environment)}`,
  jiraAttachmentUrl: (attachmentId: string) => `/api/runs/jira-attachment/${encodeURIComponent(attachmentId)}`,
  applyRevision: (id: string, prompt: string, options?: { preview?: boolean }) =>
    request<DeliveryRun>(`/api/runs/${id}/apply-revision`, {
      method: "POST",
      body: JSON.stringify({ prompt, preview: options?.preview ?? false }),
    }),
  declinePr: (id: string, reason = "") =>
    request<DeliveryRun>(`/api/runs/${id}/decline-pr`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  getFileDiff: (id: string, path: string) => {
    const params = new URLSearchParams({ path });
    return request<FileDiff>(`/api/runs/${id}/file-diff?${params}`);
  },
};
