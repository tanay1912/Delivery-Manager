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
}

export interface IssuesResponse {
  issues: Issue[];
  total: number;
  next_page_token?: string | null;
  is_last: boolean;
  max_results: number;
}

export interface IssueSummary {
  total: number;
  todo: number;
  in_progress: number;
  done: number;
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
}

export interface MappingsResponse {
  mappings: Mapping[];
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
  jira_status: string | null;
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
  changed_files: ChangedFile[];
  changed_files_refreshed_at: string | null;
  branch_name: string | null;
  pr_url: string | null;
  pr_id: number | null;
  beta_pr_url: string | null;
  beta_pr_id: number | null;
  master_pr_url: string | null;
  master_pr_id: number | null;
  beta_merged: boolean;
  master_merged: boolean;
  verifications: WebsiteVerification[];
  error_message: string | null;
  workflow_notice: string | null;
  jira_issue_url: string | null;
  jira_development_url: string | null;
  created_at: string;
  updated_at: string;
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
  getMappings: () => request<MappingsResponse>("/api/mappings"),
  createMapping: (body: MappingInput) =>
    request<Mapping>("/api/mappings", { method: "POST", body: JSON.stringify(body) }),
  updateMapping: (id: string, body: MappingInput) =>
    request<Mapping>(`/api/mappings/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteMapping: (id: string) =>
    request<void>(`/api/mappings/${id}`, { method: "DELETE" }),
  startRun: (issueKey: string) =>
    request<DeliveryRun>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ issue_key: issueKey }),
    }),
  getRunByIssue: (issueKey: string) =>
    request<DeliveryRun>(`/api/runs/by-issue/${encodeURIComponent(issueKey)}`),
  getRun: (id: string) => request<DeliveryRun>(`/api/runs/${id}`),
  prepareEstimation: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/prepare-estimation`, { method: "POST" }),
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
  mergeRun: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/merge`, { method: "POST" }),
  mergeBetaRun: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/merge/beta`, { method: "POST" }),
  mergeMasterRun: (id: string) =>
    request<DeliveryRun>(`/api/runs/${id}/merge/master`, { method: "POST" }),
  applyRevision: (id: string, prompt: string) =>
    request<DeliveryRun>(`/api/runs/${id}/apply-revision`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
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
