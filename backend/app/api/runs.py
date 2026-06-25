import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
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
    RequestInfoRequest,
    RunListResponse,
    StartRunRequest,
    run_to_response,
)
from app.services.delivery_pipeline import (
    PipelineError,
    apply_code_revision,
    approve_and_merge,
    decline_prs_and_restart,
    ensure_in_estimation_status,
    get_run_file_diff,
    get_workflow_phase,
    merge_pr_target,
    post_estimation,
    prepare_estimation,
    request_info,
    reset_run_to_estimation,
    start_implementation,
    sync_pr_review_state,
)

router = APIRouter(prefix="/api/runs", tags=["runs"])

_OPEN_RUN_STATUSES = ("active", "running", "awaiting_approval", "failed")


def _run_response(run: DeliveryRun, session: dict | None = None) -> DeliveryRunResponse:
    site_url = session.get("site_url") if session else None
    return run_to_response(run, site_url=site_url)


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


def _apply_issue_to_run(run: DeliveryRun, issue: dict) -> None:
    fields = issue.get("fields", {})
    project = fields.get("project") or {}
    run.jira_issue_id = str(issue.get("id", ""))
    run.project_key = project.get("key", run.jira_issue_key.split("-")[0])
    run.summary = fields.get("summary") or run.jira_issue_key


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
        issue = await jira.get_issue(issue_key)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Issue {issue_key} not found: {exc}") from exc

    try:
        existing = await _find_open_run(db, issue_key)
        if existing:
            if existing.status != "failed":
                run = existing
            else:
                _reset_failed_run(existing)
                _apply_issue_to_run(existing, issue)
                run = existing
        else:
            fields = issue.get("fields", {})
            project = fields.get("project") or {}
            run = DeliveryRun(
                jira_issue_key=issue_key,
                jira_issue_id=str(issue.get("id", "")),
                project_key=project.get("key", issue_key.split("-")[0]),
                summary=fields.get("summary") or issue_key,
                status="active",
                steps_log=[],
                context_data={"workflow_phase": "estimation"},
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

    phase = get_workflow_phase(run)
    if phase in ("estimation", ""):
        fields = issue.get("fields", {})
        status_name = (fields.get("status") or {}).get("name", "")
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

    return _run_response(run, session)


@router.get("/by-issue/{issue_key}", response_model=DeliveryRunResponse)
async def get_run_by_issue(
    issue_key: str,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await _find_open_run(db, issue_key.strip().upper())
    if not run:
        raise HTTPException(status_code=404, detail="No active delivery run for this issue")
    run = await sync_pr_review_state(db, run, session)
    return _run_response(run, session)


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

    return _run_response(run, session)


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

    return _run_response(run, session)


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

    return _run_response(run, session)


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
    if phase == "completed" or run.status == "awaiting_approval":
        return _run_response(run, session)

    try:
        run = await start_implementation(db, run, session)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _run_response(run, session)


@router.get("/{run_id}", response_model=DeliveryRunResponse)
async def get_run(
    run_id: uuid.UUID,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run = await sync_pr_review_state(db, run, session)
    return _run_response(run, session)


@router.get("", response_model=RunListResponse)
async def list_runs(
    issue_key: str | None = Query(None),
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    query = select(DeliveryRun).order_by(DeliveryRun.created_at.desc())
    if issue_key:
        query = query.where(DeliveryRun.jira_issue_key == issue_key.strip().upper())
    result = await db.execute(query.limit(20))
    return RunListResponse(runs=[_run_response(r, session) for r in result.scalars().all()])


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

    return _run_response(run, session)


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

    return _run_response(run, session)


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

    return _run_response(run, session)


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

    return _run_response(run, session)


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
        run = await apply_code_revision(db, run, session, body.prompt)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _run_response(run, session)


@router.get("/{run_id}/file-diff", response_model=FileDiffResponse)
async def get_run_file_diff_endpoint(
    run_id: uuid.UUID,
    path: str = Query(..., min_length=1),
    _: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    try:
        diff = await get_run_file_diff(db, run, path)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return FileDiffResponse(**diff)
