import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.services.delivery_pipeline import (
    IMPLEMENTATION_STEPS,
    PHASE_LABELS,
    _hydrate_merge_flags_from_steps,
    get_workflow_phase,
    is_unified_deploy_target,
    resolve_draft_comment,
    resolve_ui_active_step,
)
from app.services.local_git import build_local_git_commands


def _infer_pending_deploy_retry(run, ctx: dict) -> str | None:
    ctx = dict(ctx)
    _hydrate_merge_flags_from_steps(run, ctx)
    pending = ctx.get("pending_deploy_retry")
    if pending in ("beta", "master"):
        return pending
    if not (ctx.get("beta_merged") or ctx.get("master_merged")):
        return None
    for deploy_step, target in (("deploy_master", "master"), ("deploy_beta", "beta")):
        entries = [
            entry
            for entry in (run.steps_log or [])
            if isinstance(entry, dict) and entry.get("step") == deploy_step
        ]
        if entries and entries[-1].get("status") == "failed":
            return target
    return None


class RunStepLog(BaseModel):
    step: str
    status: str
    message: str
    at: str


class PipelineStepInfo(BaseModel):
    step: str
    label: str
    status: str


class ChangedFileInfo(BaseModel):
    path: str
    action: str = "modify"


class JiraCommentInfo(BaseModel):
    author: str
    created: str
    body: str


class FileDiffResponse(BaseModel):
    path: str
    action: str
    base_ref: str
    head_ref: str
    old_content: str | None = None
    new_content: str | None = None
    unified_diff: str


class WebsiteVerificationInfo(BaseModel):
    environment: str
    url: str
    passed: bool
    summary: str
    findings: list[str] = []
    screenshot_filename: str | None = None
    page_type: str | None = None
    page_reason: str | None = None


class PendingWebsiteVerificationInfo(BaseModel):
    environment: str
    url: str
    passed: bool
    summary: str
    findings: list[str] = []
    draft_comment: str
    screenshot_filename: str | None = None
    admin_paths: list[str] = []
    page_type: str | None = None
    page_reason: str | None = None


class DeploymentCommandInfo(BaseModel):
    index: int
    command: str
    status: str
    output: str = ""
    at: str = ""


class DeploymentAttemptInfo(BaseModel):
    id: str
    environment: str
    environment_label: str
    trigger: str
    status: str
    started_at: str
    completed_at: str | None = None
    planned_commands: list[str] = []
    commands: list[DeploymentCommandInfo] = []
    output: str | None = None
    error: str | None = None


class DeliveryRunResponse(BaseModel):
    id: uuid.UUID
    jira_issue_key: str
    jira_issue_id: str
    project_key: str
    summary: str
    status: str
    workflow_phase: str
    workflow_phase_label: str
    ui_active_step: int = 1
    jira_status: str | None
    issue_type: str | None = None
    issue_type_icon: str | None = None
    current_step: str | None
    next_step: str | None
    next_step_label: str | None
    pipeline_steps: list[PipelineStepInfo]
    steps_log: list[RunStepLog]
    estimation_hours: float | None
    estimation_summary: str | None
    draft_comment: str | None
    draft_question: str | None
    needs_clarification: bool
    estimation_prepared: bool
    description: str | None = None
    jira_comments: list[JiraCommentInfo] = []
    jira_synced_at: str | None = None
    changed_files: list[ChangedFileInfo]
    changed_files_refreshed_at: str | None = None
    branch_name: str | None
    local_project_directory: str | None = None
    local_git_commands: list[str] = []
    pr_url: str | None
    pr_id: int | None
    beta_pr_url: str | None = None
    beta_pr_id: int | None = None
    master_pr_url: str | None = None
    master_pr_id: int | None = None
    beta_merged: bool = False
    master_merged: bool = False
    unified_deploy_target: bool = False
    pending_deploy_retry: str | None = None
    staging_deploy_commands: list[str] = []
    live_deploy_commands: list[str] = []
    deployment_history: list[DeploymentAttemptInfo] = []
    verifications: list[WebsiteVerificationInfo] = []
    pending_verification: PendingWebsiteVerificationInfo | None = None
    error_message: str | None
    workflow_notice: str | None = None
    jira_issue_url: str | None = None
    jira_development_url: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


def _jira_urls(site_url: str | None, issue_key: str) -> tuple[str | None, str | None]:
    if not site_url or not issue_key:
        return None, None
    base = f"{site_url.rstrip('/')}/browse/{issue_key}"
    return base, f"{base}?devStatusDetailDialog=branch"


def run_to_response(
    run,
    site_url: str | None = None,
    *,
    staging_deploy_commands: list[str] | None = None,
    live_deploy_commands: list[str] | None = None,
) -> DeliveryRunResponse:
    ctx = dict(run.context_data or {})
    _hydrate_merge_flags_from_steps(run, ctx)
    phase = get_workflow_phase(run)
    if ctx.get("beta_merged") or ctx.get("master_merged") or ctx.get("pending_deploy_retry"):
        phase = "pr_review"

    step_status: dict[str, str] = {}
    for entry in run.steps_log or []:
        if isinstance(entry, dict) and entry.get("step"):
            step_status[entry["step"]] = entry.get("status", "pending")

    if phase in ("implementation", "local_development", "completed", "pr_review"):
        pipeline = [
            PipelineStepInfo(step=step, label=label, status=step_status.get(step, "pending"))
            for step, label in IMPLEMENTATION_STEPS
        ]
    else:
        pipeline = [
            PipelineStepInfo(step="estimation", label="Prepare estimation", status="completed" if ctx.get("estimation_prepared") else "pending"),
            PipelineStepInfo(
                step="post_estimation",
                label="Post to Jira",
                status="completed" if phase in ("ready_for_implementation", "implementation", "completed") else "pending",
            ),
            PipelineStepInfo(
                step="implementation",
                label="Implementation & PR",
                status="completed" if phase == "completed" else ("running" if phase == "implementation" else "pending"),
            ),
        ]

    steps_log = [
        RunStepLog(
            step=entry.get("step", ""),
            status=entry.get("status", ""),
            message=entry.get("message", ""),
            at=entry.get("at", ""),
        )
        for entry in (run.steps_log or [])
        if isinstance(entry, dict) and entry.get("step")
    ]

    changed_files = [
        ChangedFileInfo(path=f["path"], action=f.get("action", "modify"))
        for f in (ctx.get("changed_files") or [])
        if isinstance(f, dict) and f.get("path")
    ]

    verifications = [
        WebsiteVerificationInfo(
            environment=str(v.get("environment", "")),
            url=str(v.get("url", "")),
            passed=bool(v.get("passed")),
            summary=str(v.get("summary", "")),
            findings=[str(item) for item in (v.get("findings") or []) if str(item).strip()],
            screenshot_filename=v.get("screenshot_filename"),
            page_type=v.get("page_type"),
            page_reason=v.get("page_reason"),
        )
        for v in (ctx.get("verifications") or [])
        if isinstance(v, dict)
    ]

    pending_raw = ctx.get("pending_verification")
    pending_verification = None
    if isinstance(pending_raw, dict) and pending_raw.get("environment"):
        pending_verification = PendingWebsiteVerificationInfo(
            environment=str(pending_raw.get("environment", "")),
            url=str(pending_raw.get("url", "")),
            passed=bool(pending_raw.get("passed")),
            summary=str(pending_raw.get("summary", "")),
            findings=[str(item) for item in (pending_raw.get("findings") or []) if str(item).strip()],
            draft_comment=str(pending_raw.get("draft_comment") or ""),
            screenshot_filename=pending_raw.get("screenshot_filename"),
            admin_paths=[
                str(item)
                for item in (pending_raw.get("admin_paths") or [])
                if str(item).strip()
            ],
            page_type=pending_raw.get("page_type"),
            page_reason=pending_raw.get("page_reason"),
        )

    jira_comments = [
        JiraCommentInfo(
            author=str(c.get("author", "Unknown")),
            created=str(c.get("created", "")),
            body=str(c.get("body", "")),
        )
        for c in (ctx.get("jira_comments") or [])
        if isinstance(c, dict) and str(c.get("body") or "").strip()
    ]

    issue_url, development_url = _jira_urls(site_url, run.jira_issue_key)

    pending_deploy_retry = _infer_pending_deploy_retry(run, ctx)
    status = run.status
    if (
        status == "failed"
        and pending_deploy_retry
        and (ctx.get("beta_merged") or ctx.get("master_merged"))
    ):
        status = "awaiting_approval"

    deployment_history = [
        DeploymentAttemptInfo(
            id=str(item.get("id", "")),
            environment=str(item.get("environment", "")),
            environment_label=str(item.get("environment_label", "")),
            trigger=str(item.get("trigger", "")),
            status=str(item.get("status", "")),
            started_at=str(item.get("started_at", "")),
            completed_at=item.get("completed_at"),
            planned_commands=[
                str(command)
                for command in (item.get("planned_commands") or [])
                if str(command).strip()
            ],
            commands=[
                DeploymentCommandInfo(
                    index=int(cmd.get("index", 0)),
                    command=str(cmd.get("command", "")),
                    status=str(cmd.get("status", "")),
                    output=str(cmd.get("output", "")),
                    at=str(cmd.get("at", "")),
                )
                for cmd in (item.get("commands") or [])
                if isinstance(cmd, dict)
            ],
            output=item.get("output"),
            error=item.get("error"),
        )
        for item in (ctx.get("deployment_history") or [])
        if isinstance(item, dict)
    ]

    return DeliveryRunResponse(
        id=run.id,
        jira_issue_key=run.jira_issue_key,
        jira_issue_id=run.jira_issue_id,
        project_key=run.project_key,
        summary=run.summary,
        status=status,
        workflow_phase=phase,
        workflow_phase_label=PHASE_LABELS.get(phase, phase.replace("_", " ").title()),
        ui_active_step=resolve_ui_active_step(run, phase, ctx),
        jira_status=ctx.get("status_name"),
        issue_type=ctx.get("issue_type") or None,
        issue_type_icon=ctx.get("issue_type_icon") or None,
        current_step=run.current_step,
        next_step=None,
        next_step_label=None,
        pipeline_steps=pipeline,
        steps_log=steps_log,
        estimation_hours=run.estimation_hours,
        estimation_summary=run.estimation_summary,
        draft_comment=resolve_draft_comment(run, ctx),
        draft_question=ctx.get("draft_question"),
        needs_clarification=bool(ctx.get("needs_clarification")),
        estimation_prepared=bool(ctx.get("estimation_prepared")),
        description=ctx.get("description") or None,
        jira_comments=jira_comments,
        jira_synced_at=ctx.get("jira_synced_at"),
        changed_files=changed_files,
        changed_files_refreshed_at=ctx.get("changed_files_refreshed_at"),
        branch_name=run.branch_name,
        local_project_directory=(ctx.get("mapping") or {}).get("local_project_directory") or None,
        local_git_commands=build_local_git_commands(
            str((ctx.get("mapping") or {}).get("local_project_directory") or ""),
            run.branch_name or ctx.get("branch_name") or "",
            master_branch=str((ctx.get("mapping") or {}).get("master_branch") or "master"),
            issue_key=run.jira_issue_key,
        ),
        pr_url=run.pr_url or ctx.get("beta_pr_url"),
        pr_id=run.pr_id or ctx.get("beta_pr_id"),
        beta_pr_url=ctx.get("beta_pr_url") or run.pr_url,
        beta_pr_id=ctx.get("beta_pr_id") or run.pr_id,
        master_pr_url=ctx.get("master_pr_url"),
        master_pr_id=ctx.get("master_pr_id"),
        beta_merged=bool(ctx.get("beta_merged")),
        master_merged=bool(ctx.get("master_merged")),
        unified_deploy_target=is_unified_deploy_target(ctx.get("mapping") or {}),
        pending_deploy_retry=pending_deploy_retry,
        staging_deploy_commands=staging_deploy_commands or [],
        live_deploy_commands=live_deploy_commands or [],
        deployment_history=deployment_history,
        verifications=verifications,
        pending_verification=pending_verification,
        error_message=run.error_message,
        workflow_notice=ctx.get("workflow_notice"),
        jira_issue_url=issue_url,
        jira_development_url=development_url,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


class StartRunRequest(BaseModel):
    issue_key: str = Field(..., min_length=3, max_length=32)


class PostEstimationRequest(BaseModel):
    comment: str = Field(..., min_length=1)
    hours: float = Field(..., gt=0, le=1000)


class RequestInfoRequest(BaseModel):
    question: str = Field(..., min_length=1)


class ApplyRevisionRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    preview: bool = False


class DeclinePrRequest(BaseModel):
    reason: str = Field(default="", max_length=4000)


class RetryDeploymentRequest(BaseModel):
    target: str | None = Field(default=None, pattern="^(beta|master)$")


class PostVerificationRequest(BaseModel):
    comment: str = Field(..., min_length=1)


class StartVerificationRequest(BaseModel):
    target: str | None = Field(default=None, pattern="^(beta|master)$")


class RunListResponse(BaseModel):
    runs: list[DeliveryRunResponse]
