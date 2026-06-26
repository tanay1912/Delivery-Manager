import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jira_credentials import jira_client_from_session
from app.db.models import DeliveryRun, ProjectRepoMapping
from app.db.session import get_db
from app.middleware.auth_guard import require_auth
from app.schemas.runs import (
    ApplyRevisionRequest,
    DeclinePrRequest,
    DeliveryRunResponse,
    FileDiffResponse,
    PostEstimationRequest,
    PostVerificationRequest,
    RequestInfoRequest,
    RetryDeploymentRequest,
    RunListResponse,
    StartRunRequest,
    run_to_response,
)
from app.services.deploy_commands import fetch_all_deploy_commands_from_db
from app.services.delivery_pipeline import (
    PipelineError,
    apply_code_revision,
    apply_local_code_revision,
    get_workflow_phase,
    approve_and_merge,
    confirm_local_and_create_prs,
    create_prs_from_local,
    decline_prs_and_restart,
    ensure_in_estimation_status,
    get_run_file_diff,
    has_pending_post_merge_work,
    merge_pr_target,
    post_estimation,
    post_website_verification,
    prepare_estimation,
    request_info,
    reset_run_to_estimation,
    reload_jira_issue,
    resume_open_pr_review_if_needed,
    resume_post_merge_workflow_if_needed,
    retry_deployment,
    start_implementation,
    sync_pr_review_state,
    sync_jira_workflow_state,
    verification_screenshot_file,
    _fetch_issue_snapshot,
)

router = APIRouter(prefix="/api/runs", tags=["runs"])

_OPEN_RUN_STATUSES = ("active", "running", "awaiting_approval", "failed")


async def _run_response(
    run: DeliveryRun,
    session: dict | None = None,
    db: AsyncSession | None = None,
) -> DeliveryRunResponse:
    if db is not None:
        await db.refresh(run)
    site_url = session.get("site_url") if session else None
    staging_deploy_commands: list[str] = []
    live_deploy_commands: list[str] = []
    if db is not None:
        ctx = run.context_data or {}
        phase = get_workflow_phase(run)
        if phase == "pr_review" or ctx.get("pending_deploy_retry") or has_pending_post_merge_work(run):
            commands = await fetch_all_deploy_commands_from_db(db, run.project_key)
            staging_deploy_commands = commands["beta"]
            live_deploy_commands = commands["master"]
    return run_to_response(
        run,
        site_url=site_url,
        staging_deploy_commands=staging_deploy_commands,
        live_deploy_commands=live_deploy_commands,
    )


async def _find_open_run(db: AsyncSession, issue_key: str) -> DeliveryRun | None:
    result = await db.execute(
        select(DeliveryRun)
        .where(
            DeliveryRun.jira_issue_key == issue_key,
            DeliveryRun.status.in_(_OPEN_RUN_STATUSES),
        )
        .order_by(DeliveryRun.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def _find_resumable_run(db: AsyncSession, issue_key: str) -> DeliveryRun | None:
    """Find an open run or the latest run with unfinished post-merge delivery work."""
    open_run = await _find_open_run(db, issue_key)
    if open_run:
        return open_run

    result = await db.execute(
        select(DeliveryRun)
        .where(DeliveryRun.jira_issue_key == issue_key)
        .order_by(DeliveryRun.created_at.desc())
        .limit(5)
    )
    for run in result.scalars().all():
        if has_pending_post_merge_work(run):
            return run
    return None


def _should_preserve_failed_run(run: DeliveryRun) -> bool:
    if has_pending_post_merge_work(run):
        return True
    return get_workflow_phase(run) in (
        "pr_review",
        "implementation",
        "local_development",
        "ready_for_implementation",
    )


def _apply_issue_to_run(run: DeliveryRun, snapshot: dict) -> None:
    run.jira_issue_id = snapshot["issue_id"]
    run.project_key = snapshot["project_key"]
    run.summary = snapshot["summary"]
    ctx = dict(run.context_data or {})
    ctx["summary"] = snapshot["summary"]
    ctx["description"] = snapshot["description"]
    ctx["status_name"] = snapshot["status_name"]
    ctx["issue_type"] = snapshot.get("issue_type") or ""
    ctx["issue_type_icon"] = snapshot.get("issue_type_icon") or ""
    ctx["jira_comments"] = snapshot["jira_comments"]
    run.context_data = ctx


def _reset_failed_run(run: DeliveryRun) -> None:
    reset_run_to_estimation(run)


@router.post("", response_model=DeliveryRunResponse, status_code=201)
async def start_run(
    body: StartRunRequest,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    issue_key = body.issue_key.strip().upper()
    jira = jira_client_from_session(session)

    try:
        snapshot = await _fetch_issue_snapshot(jira, issue_key)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Issue {issue_key} was not found or you do not have permission to view it. "
                    "If you use a scoped Jira API token, log out and log back in so the app can "
                    "use the correct Atlassian API URL."
                ),
            ) from exc
        raise HTTPException(status_code=502, detail=f"Could not load issue {issue_key} from Jira.") from exc
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Issue {issue_key} not found: {exc}") from exc

    synced_at = datetime.now(timezone.utc).isoformat()

    try:
        existing = await _find_resumable_run(db, issue_key)
        if existing:
            if existing.status == "failed" and _should_preserve_failed_run(existing):
                run = existing
                _apply_issue_to_run(run, snapshot)
            elif existing.status != "failed":
                run = existing
                _apply_issue_to_run(run, snapshot)
            else:
                _reset_failed_run(existing)
                _apply_issue_to_run(existing, snapshot)
                run = existing
            ctx = dict(run.context_data or {})
            ctx["jira_synced_at"] = synced_at
            run.context_data = ctx
        else:
            run = DeliveryRun(
                jira_issue_key=issue_key,
                jira_issue_id=snapshot["issue_id"],
                project_key=snapshot["project_key"],
                summary=snapshot["summary"],
                status="active",
                steps_log=[],
                context_data={
                    "workflow_phase": "estimation",
                    "summary": snapshot["summary"],
                    "description": snapshot["description"],
                    "status_name": snapshot["status_name"],
                    "issue_type": snapshot.get("issue_type") or "",
                    "issue_type_icon": snapshot.get("issue_type_icon") or "",
                    "jira_comments": snapshot["jira_comments"],
                    "jira_synced_at": synced_at,
                },
            )
            db.add(run)

        await db.commit()
        await db.refresh(run)
    except SQLAlchemyError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Could not save delivery run. Check database connectivity.",
        ) from exc

    run = await resume_post_merge_workflow_if_needed(db, run, session)
    run = await resume_open_pr_review_if_needed(db, run, session)
    if get_workflow_phase(run) == "pr_review" or has_pending_post_merge_work(run):
        return await _run_response(run, session, db)

    phase = get_workflow_phase(run)
    if phase in ("estimation", ""):
        status_name = snapshot["status_name"]
        try:
            new_status = await ensure_in_estimation_status(jira, issue_key, status_name)
            ctx = dict(run.context_data or {})
            ctx["status_name"] = new_status
            run.context_data = ctx
            await db.commit()
            await db.refresh(run)
        except PipelineError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except SQLAlchemyError as exc:
            await db.rollback()
            raise HTTPException(
                status_code=503,
                detail="Could not save delivery run after Jira status update.",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to update Jira status: {exc}",
            ) from exc

    return await _run_response(run, session, db)


@router.get("/by-issue/{issue_key}", response_model=DeliveryRunResponse)
async def get_run_by_issue(
    issue_key: str,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await _find_resumable_run(db, issue_key.strip().upper())
    if not run:
        raise HTTPException(status_code=404, detail="No active delivery run for this issue")
    run = await sync_jira_workflow_state(db, run, session)
    run = await sync_pr_review_state(db, run, session)
    return await _run_response(run, session, db)


@router.post("/{run_id}/reload-jira", response_model=DeliveryRunResponse)
async def reload_jira_endpoint(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="Cannot reload while a step is running")

    try:
        run = await reload_jira_issue(db, run, session)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/prepare-estimation", response_model=DeliveryRunResponse)
async def prepare_estimation_endpoint(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    try:
        run = await prepare_estimation(db, run, session)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/post-estimation", response_model=DeliveryRunResponse)
async def post_estimation_endpoint(
    run_id: uuid.UUID,
    body: PostEstimationRequest,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    try:
        run = await post_estimation(db, run, session, body.comment, body.hours)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/request-info", response_model=DeliveryRunResponse)
async def request_info_endpoint(
    run_id: uuid.UUID,
    body: RequestInfoRequest,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    try:
        run = await request_info(db, run, session, body.question)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/start-implementation", response_model=DeliveryRunResponse)
async def start_implementation_endpoint(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    phase = get_workflow_phase(run)
    if phase in ("implementation", "pr_review") and run.status != "failed":
        raise HTTPException(status_code=409, detail="Implementation is already in progress")
    if phase == "local_development":
        return await _run_response(run, session, db)
    if phase == "completed" or run.status == "awaiting_approval":
        return await _run_response(run, session, db)

    try:
        run = await start_implementation(db, run, session)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/confirm-local-changes", response_model=DeliveryRunResponse)
async def confirm_local_changes_endpoint(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    try:
        run = await create_prs_from_local(db, run, session)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/create-prs", response_model=DeliveryRunResponse)
async def create_prs_endpoint(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    try:
        run = await create_prs_from_local(db, run, session)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.get("/{run_id}", response_model=DeliveryRunResponse)
async def get_run(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run = await sync_jira_workflow_state(db, run, session)
    run = await sync_pr_review_state(db, run, session)
    return await _run_response(run, session, db)


@router.get("", response_model=RunListResponse)
async def list_runs(
    issue_key: str | None = Query(None),
    project_key: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    query = select(DeliveryRun).order_by(DeliveryRun.updated_at.desc())
    if issue_key:
        query = query.where(DeliveryRun.jira_issue_key == issue_key.strip().upper())
    if project_key:
        query = query.where(DeliveryRun.project_key == project_key.strip().upper())
    result = await db.execute(query.limit(limit))
    runs = list(result.scalars().all())
    responses = [await _run_response(run, session, db) for run in runs]
    return RunListResponse(runs=responses)


@router.post("/{run_id}/merge", response_model=DeliveryRunResponse)
async def merge_run_pr(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "awaiting_approval":
        raise HTTPException(status_code=400, detail="Run is not awaiting approval")

    ctx = dict(run.context_data or {})
    beta_pr_id = ctx.get("beta_pr_id") or run.pr_id
    master_pr_id = ctx.get("master_pr_id")
    if not beta_pr_id and not master_pr_id:
        raise HTTPException(status_code=400, detail="No pull requests to merge")

    result = await db.execute(
        select(ProjectRepoMapping).where(ProjectRepoMapping.jira_project_key == run.project_key)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(status_code=404, detail="Repo mapping not found")

    try:
        run = await approve_and_merge(db, run, session, mapping)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/merge/beta", response_model=DeliveryRunResponse)
async def merge_beta_pr(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "awaiting_approval":
        raise HTTPException(status_code=400, detail="Run is not awaiting approval")

    result = await db.execute(
        select(ProjectRepoMapping).where(ProjectRepoMapping.jira_project_key == run.project_key)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(status_code=404, detail="Repo mapping not found")

    try:
        run = await merge_pr_target(db, run, session, mapping, "beta")
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/merge/master", response_model=DeliveryRunResponse)
async def merge_master_pr(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "awaiting_approval":
        raise HTTPException(status_code=400, detail="Run is not awaiting approval")

    result = await db.execute(
        select(ProjectRepoMapping).where(ProjectRepoMapping.jira_project_key == run.project_key)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(status_code=404, detail="Repo mapping not found")

    try:
        run = await merge_pr_target(db, run, session, mapping, "master")
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/retry-deployment", response_model=DeliveryRunResponse)
async def retry_run_deployment(
    run_id: uuid.UUID,
    body: RetryDeploymentRequest | None = None,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    result = await db.execute(
        select(ProjectRepoMapping).where(ProjectRepoMapping.jira_project_key == run.project_key)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(status_code=404, detail="Repo mapping not found")

    try:
        run = await retry_deployment(
            db,
            run,
            session,
            mapping,
            body.target if body else None,
        )
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/post-verification", response_model=DeliveryRunResponse)
async def post_run_verification(
    run_id: uuid.UUID,
    body: PostVerificationRequest,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    try:
        run = await post_website_verification(db, run, session, body.comment)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.get("/{run_id}/verification-screenshot")
async def get_verification_screenshot(
    run_id: uuid.UUID,
    environment: str = Query(..., min_length=2),
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    screenshot = verification_screenshot_file(run_id, environment)
    if screenshot is None:
        raise HTTPException(status_code=404, detail="Verification screenshot not found")

    return FileResponse(screenshot, media_type="image/png")


@router.get("/jira-attachment/{attachment_id}")
async def get_jira_attachment(
    attachment_id: str,
    session: dict = Depends(require_auth),
):
    jira = jira_client_from_session(session)
    try:
        content, content_type = await jira.fetch_attachment_content(attachment_id)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=404, detail="Attachment not found") from exc

    return Response(content=content, media_type=content_type)


@router.post("/{run_id}/decline-pr", response_model=DeliveryRunResponse)
async def decline_pr_endpoint(
    run_id: uuid.UUID,
    body: DeclinePrRequest,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    run.error_message = None
    await db.commit()

    try:
        run = await decline_prs_and_restart(db, run, session, body.reason)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.post("/{run_id}/apply-revision", response_model=DeliveryRunResponse)
async def apply_revision_endpoint(
    run_id: uuid.UUID,
    body: ApplyRevisionRequest,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    try:
        phase = get_workflow_phase(run)
        if phase == "local_development":
            run = await apply_local_code_revision(db, run, session, body.prompt)
        else:
            run = await apply_code_revision(db, run, session, body.prompt)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await _run_response(run, session, db)


@router.get("/{run_id}/file-diff", response_model=FileDiffResponse)
async def get_run_file_diff_endpoint(
    run_id: uuid.UUID,
    path: str = Query(..., min_length=1),
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    try:
        diff = await get_run_file_diff(db, run, session, path)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return FileDiffResponse(**diff)
