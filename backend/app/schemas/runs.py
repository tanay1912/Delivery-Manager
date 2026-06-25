import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.services.delivery_pipeline import (
    IMPLEMENTATION_STEPS,
    PHASE_LABELS,
    get_workflow_phase,
    resolve_draft_comment,
)


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


class DeliveryRunResponse(BaseModel):
    id: uuid.UUID
    jira_issue_key: str
    jira_issue_id: str
    project_key: str
    summary: str
    status: str
    workflow_phase: str
    workflow_phase_label: str
    jira_status: str | None
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
    changed_files: list[ChangedFileInfo]
    changed_files_refreshed_at: str | None = None
    branch_name: str | None
    pr_url: str | None
    pr_id: int | None
    beta_pr_url: str | None = None
    beta_pr_id: int | None = None
    master_pr_url: str | None = None
    master_pr_id: int | None = None
    beta_merged: bool = False
    master_merged: bool = False
    verifications: list[WebsiteVerificationInfo] = []
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


def run_to_response(run, site_url: str | None = None) -> DeliveryRunResponse:
    ctx = run.context_data or {}
    phase = get_workflow_phase(run)

    step_status: dict[str, str] = {}
    for entry in run.steps_log or []:
        if isinstance(entry, dict) and entry.get("step"):
            step_status[entry["step"]] = entry.get("status", "pending")

    if phase in ("implementation", "completed", "pr_review"):
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
        )
        for v in (ctx.get("verifications") or [])
        if isinstance(v, dict)
    ]

    issue_url, development_url = _jira_urls(site_url, run.jira_issue_key)

    return DeliveryRunResponse(
        id=run.id,
        jira_issue_key=run.jira_issue_key,
        jira_issue_id=run.jira_issue_id,
        project_key=run.project_key,
        summary=run.summary,
        status=run.status,
        workflow_phase=phase,
        workflow_phase_label=PHASE_LABELS.get(phase, phase.replace("_", " ").title()),
        jira_status=ctx.get("status_name"),
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
        changed_files=changed_files,
        changed_files_refreshed_at=ctx.get("changed_files_refreshed_at"),
        branch_name=run.branch_name,
        pr_url=run.pr_url or ctx.get("beta_pr_url"),
        pr_id=run.pr_id or ctx.get("beta_pr_id"),
        beta_pr_url=ctx.get("beta_pr_url") or run.pr_url,
        beta_pr_id=ctx.get("beta_pr_id") or run.pr_id,
        master_pr_url=ctx.get("master_pr_url"),
        master_pr_id=ctx.get("master_pr_id"),
        beta_merged=bool(ctx.get("beta_merged")),
        master_merged=bool(ctx.get("master_merged")),
        verifications=verifications,
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


class DeclinePrRequest(BaseModel):
    reason: str = Field(default="", max_length=4000)


class RunListResponse(BaseModel):
    runs: list[DeliveryRunResponse]
