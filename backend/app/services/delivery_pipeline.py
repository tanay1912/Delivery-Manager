import asyncio
import difflib
import uuid
from datetime import datetime, timezone
from typing import Literal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jira_credentials import jira_client_from_session
from app.clients.bitbucket_client import BitbucketClient
from app.clients.cursor_client import CursorDevelopmentError, run_implementation_agent, run_revision_agent
from app.clients.jira_client import JiraClient
from app.clients.openai_client import OpenAIClient, slugify
from app.config import settings
from app.db.models import DeliveryRun, ProjectRepoMapping
from app.services.website_verifier import verify_website

WORKFLOW_PHASES: list[tuple[str, str]] = [
    ("estimation", "Estimation"),
    ("waiting_for_info", "Waiting for info"),
    ("ready_for_implementation", "Ready for implementation"),
    ("implementation", "Implementation"),
    ("pr_review", "Pull request review"),
    ("completed", "Completed"),
]

PHASE_LABELS = dict(WORKFLOW_PHASES)

IMPLEMENTATION_STEPS: list[tuple[str, str]] = [
    ("impact_analysis", "Write Impact Analysis"),
    ("transition_in_progress", "Move to In Progress"),
    ("resolve_mapping", "Resolve Bitbucket repo"),
    ("create_branch", "Create branch from Master"),
    ("repo_context", "Read repository context"),
    ("cursor_development", "Develop with Cursor SDK"),
    ("commit_changes", "Commit changes to branch"),
    ("create_pr_beta", "Create pull request to Beta"),
    ("create_pr_master", "Create pull request to Master"),
    ("verify_beta", "Verify Beta website"),
    ("verify_master", "Verify Master website"),
]

STEP_LABELS = dict(IMPLEMENTATION_STEPS)


class PipelineError(Exception):
    pass


def get_workflow_phase(run: DeliveryRun) -> str:
    ctx = run.context_data or {}
    return ctx.get("workflow_phase", "estimation")


def _is_todo_status(status_name: str) -> bool:
    lowered = status_name.lower().strip()
    return lowered in ("to do", "todo", "open", "backlog", "new")


def _is_in_estimation_status(status_name: str) -> bool:
    lowered = status_name.lower().strip()
    return "estimation" in lowered and "complete" not in lowered and "completed" not in lowered


_IN_ESTIMATION_EXACT_NAMES: tuple[str, ...] = ("In Estimation",)
_IN_ESTIMATION_KEYWORD_SETS: tuple[tuple[str, ...], ...] = (
    ("in", "estimation"),
    ("start", "estimation"),
    ("begin", "estimation"),
)
_IN_ESTIMATION_EXCLUDE: tuple[str, ...] = ("complete", "completed", "done")

_ESTIMATION_COMPLETE_EXACT_NAMES: tuple[str, ...] = (
    "Estimation Complete",
    "Estimation Completed",
)
_ESTIMATION_COMPLETE_KEYWORD_SETS: tuple[tuple[str, ...], ...] = (
    ("estimation", "complete"),
    ("estimation", "completed"),
    ("complete", "estimation"),
)


async def ensure_in_estimation_status(
    jira: JiraClient,
    issue_key: str,
    current_status: str,
) -> str:
    """Move issue to In Estimation unless it is already in an estimation status."""
    if _is_in_estimation_status(current_status):
        return current_status
    return await _transition_issue(
        jira,
        issue_key,
        keyword_sets=_IN_ESTIMATION_KEYWORD_SETS,
        exact_names=_IN_ESTIMATION_EXACT_NAMES,
        exclude_keywords=_IN_ESTIMATION_EXCLUDE,
        label="In Estimation",
    )


async def ensure_estimation_complete_status(
    jira: JiraClient,
    issue_key: str,
) -> str:
    """Move issue to Estimation Complete after posting estimation."""
    return await _transition_issue(
        jira,
        issue_key,
        keyword_sets=_ESTIMATION_COMPLETE_KEYWORD_SETS,
        exact_names=_ESTIMATION_COMPLETE_EXACT_NAMES,
        label="Estimation Complete",
    )


def _build_draft_comment(estimate: dict, issue_key: str, summary: str) -> str:
    jira_comment = str(estimate.get("jira_comment") or "").strip()
    if jira_comment:
        return jira_comment
    hours = estimate.get("hours", "n/a")
    story_points = estimate.get("story_points", "n/a")
    reasoning = estimate.get("reasoning", "")
    return (
        f"Estimation for {issue_key}: {summary}\n\n"
        f"Story points: {story_points}\n"
        f"Original estimate: {hours} hours\n\n"
        f"Reasoning:\n{reasoning}"
    )


def resolve_draft_comment(run: DeliveryRun, ctx: dict | None = None) -> str | None:
    """Return draft Jira comment, rebuilding from saved estimation if missing."""
    data = ctx if ctx is not None else (run.context_data or {})
    draft = str(data.get("draft_comment") or "").strip()
    if draft:
        return draft

    if not data.get("estimation_prepared") and run.estimation_hours is None:
        return None

    estimate = data.get("estimate") or {}
    return _build_draft_comment(
        {
            "jira_comment": "",
            "hours": run.estimation_hours if run.estimation_hours is not None else estimate.get("hours"),
            "story_points": estimate.get("story_points"),
            "reasoning": run.estimation_summary or estimate.get("reasoning", ""),
        },
        run.jira_issue_key,
        data.get("summary") or run.summary,
    )


def _step_completed(run: DeliveryRun, step: str) -> bool:
    for entry in run.steps_log or []:
        if isinstance(entry, dict) and entry.get("step") == step and entry.get("status") == "completed":
            return True
    return False


REVISION_STEPS: list[tuple[str, str]] = [
    ("revision_prepare", "Prepare revision context"),
    ("revision_generate", "Generate code changes"),
    ("revision_commit", "Commit changes to branch"),
    ("revision_delete", "Remove requested files"),
    ("revision_refresh", "Refresh changed files"),
]

REDEVELOPMENT_RESET_STEPS = frozenset({
    "repo_context",
    "cursor_development",
    "generate_code",
    "commit_changes",
    "create_pr_beta",
    "create_pr_master",
    "code_revision",
    "revision_prepare",
    "revision_generate",
    "revision_commit",
    "revision_delete",
    "revision_refresh",
    "decline_pr",
    "sync_pr_review",
    "implementation",
})


def _invalidate_steps(run: DeliveryRun, steps: frozenset[str]) -> None:
    run.steps_log = [
        entry
        for entry in (run.steps_log or [])
        if not (isinstance(entry, dict) and entry.get("step") in steps)
    ]


def reset_for_redevelopment(run: DeliveryRun, ctx: dict, *, notice: str = "") -> None:
    """Reset implementation/PR steps but keep estimation and the feature branch."""
    branch_name = run.branch_name or ctx.get("branch_name")
    preserved: dict = {
        "workflow_phase": "ready_for_implementation",
        "summary": ctx.get("summary") or run.summary,
        "description": ctx.get("description", ""),
        "status_name": ctx.get("status_name"),
        "mapping": ctx.get("mapping"),
        "estimation_prepared": ctx.get("estimation_prepared", True),
        "estimate": ctx.get("estimate"),
        "draft_comment": ctx.get("draft_comment"),
        "impact_analysis": ctx.get("impact_analysis"),
        "impact_analysis_field": ctx.get("impact_analysis_field"),
        "branch_name": branch_name,
    }
    if notice.strip():
        preserved["workflow_notice"] = notice.strip()

    _invalidate_steps(run, REDEVELOPMENT_RESET_STEPS)
    run.status = "active"
    run.error_message = None
    run.current_step = None
    run.pr_url = None
    run.pr_id = None
    run.branch_name = branch_name
    run.context_data = preserved


async def reset_after_pr_closed(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    reason: str = "",
    *,
    attempt_decline: bool = True,
    step_name: str = "redevelop",
) -> DeliveryRun:
    """Reset to re-run development on the same branch. Never fails if PRs are already closed."""
    ctx = dict(run.context_data or {})
    mapping = await _resolve_run_mapping(db, run, ctx)
    branch_name = run.branch_name or ctx.get("branch_name")
    message = reason.strip() or "Pull request closed — restarting development on the same branch"

    run.status = "running"
    run.error_message = None
    await _log_step(db, run, step_name, "running", "Resetting development on the same branch…")
    await db.commit()

    if attempt_decline and settings.bitbucket_configured and mapping:
        bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
        declined, already_closed = await _decline_tracked_prs(
            bitbucket, mapping, run, ctx, message
        )
        if declined or already_closed:
            parts: list[str] = []
            if declined:
                parts.append(f"Declined {', '.join(declined)}")
            if already_closed:
                parts.append(f"Skipped {', '.join(already_closed)} (already closed)")
            await _log_step(
                db,
                run,
                step_name,
                "running",
                "; ".join(parts),
            )

    reset_for_redevelopment(run, ctx, notice=message)

    jira = jira_client_from_session(session)
    try:
        await _jira_comment(
            jira,
            run.jira_issue_key,
            f"[Delivery Manager] Development restarted on the same branch\n\n"
            f"{message}\n\n"
            f"Branch: {branch_name or 'n/a'}\n\n"
            f"Start implementation again to regenerate code and open new pull requests.",
        )
    except Exception:
        pass

    completed = (
        f"Ready to redevelop on `{branch_name}`"
        if branch_name
        else "Ready to restart development"
    )
    await _log_step(db, run, step_name, "completed", completed)
    await db.commit()
    await db.refresh(run)
    return run


async def _persist_run_context(db: AsyncSession, run: DeliveryRun, ctx: dict) -> None:
    run.context_data = dict(ctx)
    run.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(run)


async def _log_step(
    db: AsyncSession,
    run: DeliveryRun,
    step: str,
    status: str,
    message: str,
    data: dict | None = None,
) -> None:
    run.current_step = step
    log = list(run.steps_log or [])
    entry: dict = {
        "step": step,
        "status": status,
        "message": message,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    if data:
        entry["data"] = data
    log.append(entry)
    run.steps_log = log
    run.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(run)


async def _jira_comment(jira: JiraClient, issue_key: str, body: str) -> None:
    try:
        await jira.add_comment(issue_key, body)
    except Exception as exc:
        raise PipelineError(f"Jira comment failed: {exc}") from exc


async def _transition_issue(
    jira: JiraClient,
    issue_key: str,
    *keywords: str,
    fallback_keywords: tuple[str, ...] | None = None,
    keyword_sets: tuple[tuple[str, ...], ...] | None = None,
    exact_names: tuple[str, ...] | None = None,
    exclude_keywords: tuple[str, ...] | None = None,
    label: str | None = None,
) -> str:
    try:
        transitions = await jira.get_transitions(issue_key)
    except Exception as exc:
        raise PipelineError(f"Could not load Jira transitions: {exc}") from exc

    sets_to_try: list[tuple[str, ...]] = []
    if keywords:
        sets_to_try.append(tuple(keywords))
    if fallback_keywords:
        sets_to_try.append(fallback_keywords)
    if keyword_sets:
        sets_to_try.extend(keyword_sets)

    transition = None
    if exact_names:
        transition = JiraClient.find_transition(
            transitions,
            exact_names=exact_names,
            exclude_keywords=exclude_keywords,
        )
    for kw in sets_to_try:
        if transition:
            break
        transition = JiraClient.find_transition(
            transitions,
            *kw,
            exclude_keywords=exclude_keywords,
        )

    if not transition:
        names = ", ".join(t.get("name", "") for t in transitions)
        target = label or ", ".join(keywords) or "requested status"
        raise PipelineError(
            f"No Jira transition to {target}. Available: {names or 'none'}"
        )

    try:
        await jira.transition_issue(issue_key, transition["id"])
    except Exception as exc:
        raise PipelineError(
            f"Jira transition to {transition.get('name', label or 'target status')} failed: {exc}"
        ) from exc
    return transition["name"]


async def prepare_estimation(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    if get_workflow_phase(run) not in ("estimation", ""):
        return run

    ctx = dict(run.context_data or {})
    if ctx.get("estimation_prepared"):
        if not str(ctx.get("draft_comment") or "").strip():
            ctx["draft_comment"] = resolve_draft_comment(run, ctx)
            run.context_data = ctx
            await db.commit()
            await db.refresh(run)
        return run

    if not settings.openai_configured:
        raise PipelineError("OPENAI_API_KEY is not configured")

    jira = jira_client_from_session(session)
    run.status = "running"
    run.error_message = None
    await db.commit()

    try:
        await _log_step(db, run, "fetch_issue", "running", "Loading ticket details...")
        issue = await jira.get_issue(run.jira_issue_key)
        fields = issue.get("fields", {})
        summary = fields.get("summary") or run.summary
        description = JiraClient.extract_description(issue)
        status_name = (fields.get("status") or {}).get("name", "")
        run.summary = summary
        ctx["summary"] = summary
        ctx["description"] = description
        ctx["status_name"] = status_name
        await db.commit()

        if not _is_in_estimation_status(status_name):
            new_status = await ensure_in_estimation_status(
                jira,
                run.jira_issue_key,
                status_name,
            )
            ctx["status_name"] = new_status
            await _log_step(
                db,
                run,
                "transition_in_estimation",
                "completed",
                f"Status updated to: {new_status}",
            )

        await _log_step(db, run, "estimate", "running", "Preparing AI estimation...")
        openai = OpenAIClient()
        estimate = await openai.estimate_issue(
            run.jira_issue_key,
            summary,
            description,
        )
        run.estimation_hours = estimate["hours"]
        run.estimation_summary = estimate["reasoning"]
        ctx["estimate"] = estimate
        ctx["draft_comment"] = _build_draft_comment(estimate, run.jira_issue_key, summary)
        ctx["draft_question"] = estimate.get("clarification_question", "")
        ctx["needs_clarification"] = estimate.get("needs_clarification", False)
        ctx["workflow_phase"] = "estimation"
        ctx["estimation_prepared"] = True
        ctx.pop("workflow_notice", None)
        run.context_data = ctx

        await _log_step(
            db,
            run,
            "estimate",
            "completed",
            f"Estimation ready: {estimate['hours']}h — review and post to Jira",
            data={"estimate": estimate},
        )
        run.status = "active"
        await db.commit()
        await db.refresh(run)
        return run

    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, "estimate", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise


async def post_estimation(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    comment: str,
    hours: float,
) -> DeliveryRun:
    phase = get_workflow_phase(run)
    if phase not in ("estimation", "waiting_for_info"):
        raise PipelineError("Estimation has already been posted")

    jira = jira_client_from_session(session)
    ctx = dict(run.context_data or {})
    run.status = "running"
    run.error_message = None
    await db.commit()

    try:
        seconds = int(float(hours) * 3600)
        estimate = ctx.get("estimate") or {}
        update_fields: dict = {
            "timetracking": {
                "originalEstimate": f"{hours}h",
                "originalEstimateSeconds": seconds,
            },
        }
        story_points = estimate.get("story_points")
        if story_points is not None:
            update_fields["customfield_10016"] = story_points
        try:
            await jira.update_issue(run.jira_issue_key, update_fields)
        except Exception:
            await jira.update_issue(
                run.jira_issue_key,
                {
                    "timetracking": {
                        "originalEstimate": f"{hours}h",
                        "originalEstimateSeconds": seconds,
                    }
                },
            )

        full_comment = f"[Delivery Manager] Estimation\n\n{comment.strip()}"
        await _jira_comment(jira, run.jira_issue_key, full_comment)

        new_status = await ensure_estimation_complete_status(jira, run.jira_issue_key)
        ctx["status_name"] = new_status
        ctx["workflow_phase"] = "ready_for_implementation"
        ctx["draft_comment"] = comment
        run.estimation_hours = hours
        run.context_data = ctx

        await _log_step(
            db,
            run,
            "post_estimation",
            "completed",
            f"Posted estimation ({hours}h). Status: {new_status}",
        )
        run.status = "active"
        await db.commit()
        await db.refresh(run)
        return run

    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, "post_estimation", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise


async def request_info(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    question: str,
) -> DeliveryRun:
    phase = get_workflow_phase(run)
    if phase not in ("estimation", "waiting_for_info"):
        raise PipelineError("Cannot request info at this stage")

    jira = jira_client_from_session(session)
    ctx = dict(run.context_data or {})
    run.status = "running"
    run.error_message = None
    await db.commit()

    try:
        full_comment = f"[Delivery Manager] Clarification needed\n\n{question.strip()}"
        await _jira_comment(jira, run.jira_issue_key, full_comment)

        new_status = await _transition_issue(
            jira,
            run.jira_issue_key,
            "waiting",
            "info",
            fallback_keywords=("wait", "info"),
        )
        ctx["status_name"] = new_status
        ctx["workflow_phase"] = "waiting_for_info"
        ctx["draft_question"] = question
        run.context_data = ctx

        await _log_step(
            db,
            run,
            "request_info",
            "completed",
            f"Posted clarification question. Status: {new_status}",
        )
        run.status = "active"
        await db.commit()
        await db.refresh(run)
        return run

    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, "request_info", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise


async def _step_write_impact_analysis(db, run, jira, ctx) -> tuple[str, dict]:
    if not settings.openai_configured:
        raise PipelineError("OPENAI_API_KEY is not configured")

    estimate = ctx.get("estimate") or {}
    openai = OpenAIClient()
    analysis = await openai.generate_impact_analysis(
        run.jira_issue_key,
        ctx.get("summary", run.summary),
        ctx.get("description", ""),
        run.estimation_hours,
        run.estimation_summary or estimate.get("reasoning", ""),
    )
    text = analysis.get("impact_analysis", "").strip()
    if not text:
        raise PipelineError("Impact analysis could not be generated")

    try:
        field_id = await jira.resolve_field_id(
            "Impact Analysis",
            settings.jira_impact_analysis_field or None,
        )
    except ValueError as exc:
        raise PipelineError(str(exc)) from exc

    try:
        await jira.set_paragraph_field(run.jira_issue_key, field_id, text)
    except Exception as exc:
        raise PipelineError(f"Failed to update Impact Analysis field: {exc}") from exc

    return (
        f"Impact Analysis updated on {run.jira_issue_key}",
        {"impact_analysis": text, "impact_analysis_field": field_id},
    )


async def start_implementation(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    phase = get_workflow_phase(run)
    resuming = phase == "implementation" and run.status == "failed"
    if phase not in ("ready_for_implementation", "waiting_for_info") and not resuming:
        raise PipelineError("Complete estimation before starting implementation")

    jira = jira_client_from_session(session)
    ctx = dict(run.context_data or {})
    run.status = "running"
    run.error_message = None
    ctx["workflow_phase"] = "implementation"
    run.context_data = ctx
    await db.commit()

    try:
        if not _step_completed(run, "impact_analysis"):
            result = await _step_write_impact_analysis(db, run, jira, ctx)
            await _log_step(db, run, "impact_analysis", "completed", result[0], data=result[1] or None)
            ctx.update(result[1] or {})

        if not _step_completed(run, "transition_in_progress"):
            new_status = await _transition_issue(
                jira,
                run.jira_issue_key,
                "progress",
                fallback_keywords=("in", "progress"),
                label="In Progress",
            )
            ctx["status_name"] = new_status
            await _log_step(db, run, "transition_in_progress", "completed", f"Status: {new_status}")

        if not _step_completed(run, "resolve_mapping"):
            result = await _step_resolve_mapping(db, run, jira, ctx)
            await _log_step(db, run, "resolve_mapping", "completed", result[0], data=result[1] or None)
            ctx.update(result[1] or {})

        if not _step_completed(run, "create_branch"):
            result = await _step_create_branch(db, run, jira, ctx)
            await _log_step(db, run, "create_branch", "completed", result[0], data=result[1] or None)
            ctx.update(result[1] or {})

        if not _step_completed(run, "repo_context"):
            result = await _step_repo_context(db, run, jira, ctx)
            await _log_step(db, run, "repo_context", "completed", result[0], data=result[1] or None)
            ctx.update(result[1] or {})

        if not _step_completed(run, "cursor_development"):
            result = await _step_cursor_development(db, run, jira, ctx)
            await _log_step(db, run, "cursor_development", "completed", result[0], data=result[1] or None)
            ctx.update(result[1] or {})

        if (ctx.get("development_result") or {}).get("source") != "cursor_sdk":
            if not _step_completed(run, "generate_code"):
                result = await _step_generate_code(db, run, jira, ctx)
                await _log_step(db, run, "generate_code", "completed", result[0], data=result[1] or None)
                ctx.update(result[1] or {})

            if not _step_completed(run, "commit_changes"):
                result = await _step_commit_changes(db, run, jira, ctx)
                await _log_step(db, run, "commit_changes", "completed", result[0], data=result[1] or None)
                ctx.update(result[1] or {})

        if not _step_completed(run, "create_pr_beta"):
            result = await _step_create_pr_beta(db, run, jira, ctx)
            await _log_step(db, run, "create_pr_beta", "completed", result[0], data=result[1] or None)
            ctx.update(result[1] or {})

        if not _step_completed(run, "create_pr_master"):
            result = await _step_create_pr_master(db, run, jira, ctx)
            await _log_step(db, run, "create_pr_master", "completed", result[0], data=result[1] or None)
            ctx.update(result[1] or {})

        mapping = ctx.get("mapping") or {}
        branch_name = run.branch_name or ctx.get("branch_name")
        if branch_name and mapping:
            bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
            changed = await bitbucket.list_changed_files(
                mapping["workspace"],
                mapping["repo_slug"],
                mapping["master_branch"],
                branch_name,
            )
            if changed:
                ctx["changed_files"] = changed
            elif (ctx.get("code_result") or {}).get("files"):
                ctx["changed_files"] = [
                    {"path": f["path"], "action": f.get("action", "modify")}
                    for f in (ctx.get("code_result") or {}).get("files", [])
                    if f.get("path")
                ]
            if ctx.get("changed_files"):
                ctx["changed_files_refreshed_at"] = datetime.now(timezone.utc).isoformat()

        ctx["workflow_phase"] = "pr_review"
        run.context_data = ctx
        run.status = "awaiting_approval"

        try:
            beta_pr = ctx.get("beta_pr_url") or run.pr_url or "n/a"
            master_pr = ctx.get("master_pr_url") or "n/a"
            file_count = len(ctx.get("changed_files") or [])
            await _jira_comment(
                jira,
                run.jira_issue_key,
                f"[Delivery Manager] Implementation ready for review\n\n"
                f"Branch: {run.branch_name}\n"
                f"Beta PR: {beta_pr}\n"
                f"Master PR: {master_pr}\n"
                f"Files changed: {file_count}\n\n"
                f"Approve and merge in Delivery Manager to deploy and verify websites.",
            )
        except Exception:
            pass

        await db.commit()
        await db.refresh(run)
        return run

    except PipelineError as exc:
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, "implementation", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, "implementation", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise PipelineError(str(exc)) from exc


MergeTarget = Literal["beta", "master"]


def _pr_ids_for_run(run: DeliveryRun, ctx: dict) -> tuple[int | None, int | None]:
    beta_pr_id = ctx.get("beta_pr_id") or run.pr_id
    master_pr_id = ctx.get("master_pr_id")
    return (
        int(beta_pr_id) if beta_pr_id else None,
        int(master_pr_id) if master_pr_id else None,
    )


async def _decline_tracked_prs(
    bitbucket: BitbucketClient,
    mapping: dict,
    run: DeliveryRun,
    ctx: dict,
    message: str,
) -> tuple[list[str], list[str]]:
    """Decline open PRs only. Returns (declined, already_closed) labels. Never raises."""
    workspace = mapping["workspace"]
    repo_slug = mapping["repo_slug"]
    declined: list[str] = []
    already_closed: list[str] = []
    beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)

    if beta_pr_id and not ctx.get("beta_merged"):
        outcome = await bitbucket.decline_pull_request_if_open(
            workspace, repo_slug, int(beta_pr_id), message
        )
        if outcome == "declined":
            declined.append(f"Beta PR #{beta_pr_id}")
        else:
            already_closed.append(f"Beta PR #{beta_pr_id}")

    if master_pr_id and not ctx.get("master_merged"):
        outcome = await bitbucket.decline_pull_request_if_open(
            workspace, repo_slug, int(master_pr_id), message
        )
        if outcome == "declined":
            declined.append(f"Live PR #{master_pr_id}")
        else:
            already_closed.append(f"Live PR #{master_pr_id}")

    return declined, already_closed


def _all_prs_merged(run: DeliveryRun, ctx: dict) -> bool:
    beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)
    beta_done = not beta_pr_id or bool(ctx.get("beta_merged"))
    master_done = not master_pr_id or bool(ctx.get("master_merged"))
    return beta_done and master_done


async def _finalize_completed_run(
    db: AsyncSession,
    run: DeliveryRun,
    jira: JiraClient,
    ctx: dict,
    merged_summary: list[str],
) -> DeliveryRun:
    try:
        transitions = await jira.get_transitions(run.jira_issue_key)
        done = JiraClient.find_transition(transitions, "done") or JiraClient.find_transition(
            transitions, "complete"
        )
        if done:
            await jira.transition_issue(run.jira_issue_key, done["id"])
            ctx["status_name"] = done["name"]
    except Exception:
        pass

    verification_lines = []
    for item in ctx.get("verifications") or []:
        if not isinstance(item, dict):
            continue
        env = item.get("environment", "Site")
        status = "passed" if item.get("passed") else "needs review"
        verification_lines.append(f"- {env}: {status} — {item.get('summary', '')}")
    verification_block = "\n".join(verification_lines) or "No website verification recorded."

    try:
        beta_url = ctx.get("beta_pr_url") or run.pr_url
        master_url = ctx.get("master_pr_url")
        await _jira_comment(
            jira,
            run.jira_issue_key,
            f"[Delivery Manager] Approved & merged\n\n"
            f"Merged: {', '.join(merged_summary)}\n"
            f"Beta PR: {beta_url or 'n/a'}\n"
            f"Master PR: {master_url or 'n/a'}\n\n"
            f"Website verification:\n{verification_block}",
        )
    except Exception:
        pass

    ctx["workflow_phase"] = "completed"
    run.context_data = ctx
    run.status = "completed"
    await db.commit()
    await db.refresh(run)
    return run


async def merge_pr_target(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    mapping: ProjectRepoMapping,
    target: MergeTarget,
) -> DeliveryRun:
    if run.status not in ("awaiting_approval", "running"):
        raise PipelineError("Run is not ready for merge")

    ctx = dict(run.context_data or {})
    beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)
    if not beta_pr_id and not master_pr_id:
        raise PipelineError("No pull requests to merge")

    if target == "beta":
        if not beta_pr_id:
            raise PipelineError("No Beta pull request to merge")
        if ctx.get("beta_merged"):
            raise PipelineError("Beta pull request is already merged")
        pr_id = beta_pr_id
        env_label = "Beta"
        merged_key = "beta_merged"
        step_name = "merge_beta_pr"
        verify_step = "verify_beta"
    else:
        if not master_pr_id:
            raise PipelineError("No Live (Master) pull request to merge")
        if ctx.get("master_merged"):
            raise PipelineError("Live pull request is already merged")
        pr_id = master_pr_id
        env_label = "Master"
        merged_key = "master_merged"
        step_name = "merge_master_pr"
        verify_step = "verify_master"

    jira = jira_client_from_session(session)
    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
    run.status = "running"
    run.error_message = None
    await db.commit()

    merged_label = f"{env_label} PR #{pr_id}"
    try:
        try:
            await bitbucket.merge_pull_request(
                mapping.bitbucket_workspace, mapping.bitbucket_repo_slug, pr_id
            )
            merge_message = f"Merged {merged_label}"
        except Exception:
            merge_message = f"{merged_label} (already merged)"

        ctx[merged_key] = True
        await _log_step(db, run, step_name, "completed", merge_message)

        result = await _step_verify_website(db, run, jira, ctx, env_label)
        await _log_step(db, run, verify_step, "completed", result[0], data=result[1] or None)
        ctx.update(result[1] or {})

        merged_summary: list[str] = []
        if ctx.get("beta_merged"):
            merged_summary.append(f"Beta PR #{beta_pr_id}" if beta_pr_id else "Beta")
        if ctx.get("master_merged"):
            merged_summary.append(f"Master PR #{master_pr_id}" if master_pr_id else "Master")

        if _all_prs_merged(run, ctx):
            return await _finalize_completed_run(db, run, jira, ctx, merged_summary)

        ctx["workflow_phase"] = "pr_review"
        run.context_data = ctx
        run.status = "awaiting_approval"
        await db.commit()
        await db.refresh(run)
        return run

    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, step_name, "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise


async def approve_and_merge(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    mapping: ProjectRepoMapping,
) -> DeliveryRun:
    if run.status != "awaiting_approval":
        raise PipelineError("Run is not awaiting approval")

    ctx = dict(run.context_data or {})
    beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)
    if not beta_pr_id and not master_pr_id:
        raise PipelineError("No pull requests to merge")

    run = await merge_pr_target(db, run, session, mapping, "beta") if beta_pr_id and not ctx.get("beta_merged") else run
    if run.status == "completed":
        return run

    ctx = dict(run.context_data or {})
    if master_pr_id and not ctx.get("master_merged"):
        run = await merge_pr_target(db, run, session, mapping, "master")

    return run


async def _resolve_run_mapping(
    db: AsyncSession,
    run: DeliveryRun,
    ctx: dict,
) -> dict | None:
    mapping = ctx.get("mapping")
    if mapping:
        return mapping
    result = await db.execute(
        select(ProjectRepoMapping).where(ProjectRepoMapping.jira_project_key == run.project_key)
    )
    mapping_row = result.scalar_one_or_none()
    if not mapping_row:
        return None
    return {
        "workspace": mapping_row.bitbucket_workspace,
        "repo_slug": mapping_row.bitbucket_repo_slug,
        "master_branch": mapping_row.master_branch,
        "beta_branch": mapping_row.beta_branch,
        "beta_website_url": mapping_row.beta_website_url,
        "master_website_url": mapping_row.master_website_url,
    }


async def _check_pr_review_stale(
    run: DeliveryRun,
    ctx: dict,
    mapping: dict,
    bitbucket: BitbucketClient,
) -> str | None:
    branch_name = run.branch_name or ctx.get("branch_name")
    if branch_name:
        if not await bitbucket.branch_exists(
            mapping["workspace"], mapping["repo_slug"], branch_name
        ):
            return "Feature branch was removed (pull request likely declined)"

    beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)
    tracked: list[tuple[str, int]] = []
    if beta_pr_id and not ctx.get("beta_merged"):
        tracked.append(("Beta", int(beta_pr_id)))
    if master_pr_id and not ctx.get("master_merged"):
        tracked.append(("Live", int(master_pr_id)))

    if not tracked:
        return None

    open_count = 0
    for label, pr_id in tracked:
        pr = await bitbucket.get_pull_request_safe(
            mapping["workspace"], mapping["repo_slug"], pr_id
        )
        if not pr:
            return f"{label} pull request #{pr_id} is no longer available"
        state = BitbucketClient.pull_request_state(pr)
        if state == "OPEN":
            open_count += 1
        elif state in ("DECLINED", "SUPERSEDED"):
            return f"{label} pull request #{pr_id} was declined"

    if open_count == 0:
        return "All pull requests are closed"

    return None


async def _load_branch_file_contents(
    bitbucket: BitbucketClient,
    mapping: dict,
    branch_name: str,
    changed_files: list,
    ctx: dict | None = None,
) -> list[dict]:
    contents: list[dict] = []
    for item in changed_files:
        if not isinstance(item, dict):
            continue
        path = item.get("path")
        if not path or item.get("action") == "delete":
            continue
        file_content = await bitbucket.get_file(
            mapping["workspace"],
            mapping["repo_slug"],
            path,
            branch_name,
        )
        if file_content is not None:
            contents.append({"path": path, "content": file_content, "action": item.get("action", "modify")})

    if contents or not ctx:
        return contents

    stored = {
        f["path"]: f
        for f in (ctx.get("code_result") or {}).get("files") or []
        if isinstance(f, dict) and f.get("path") and f.get("content")
    }
    for item in changed_files:
        if not isinstance(item, dict):
            continue
        path = item.get("path")
        if not path or item.get("action") == "delete":
            continue
        if path in stored and not any(c["path"] == path for c in contents):
            contents.append(
                {
                    "path": path,
                    "content": stored[path]["content"],
                    "action": item.get("action", stored[path].get("action", "modify")),
                }
            )
    return contents


async def _refresh_changed_files(
    bitbucket: BitbucketClient,
    mapping: dict,
    branch_name: str,
) -> list[dict[str, str]]:
    return await bitbucket.list_changed_files(
        mapping["workspace"],
        mapping["repo_slug"],
        mapping["master_branch"],
        branch_name,
    )


def _changed_files_equal(a: list, b: list) -> bool:
    def normalize(items: list) -> list[tuple[str, str]]:
        return sorted(
            (str(item.get("path", "")), str(item.get("action", "modify")))
            for item in items
            if isinstance(item, dict) and item.get("path")
        )

    return normalize(a) == normalize(b)


def _branch_paths_from_changed_files(changed_files: list) -> list[str]:
    return [
        str(item["path"])
        for item in changed_files
        if isinstance(item, dict) and item.get("path")
    ]


def _revision_prompt_requests_deletion(prompt: str) -> bool:
    lower = prompt.lower()
    hints = (
        "remove",
        "delete",
        "drop",
        "exclude",
        "get rid of",
        "don't need",
        "do not need",
        "no longer",
        "unused",
    )
    return any(hint in lower for hint in hints)


def _partition_revision_files(files: list) -> tuple[dict[str, str], list[str]]:
    file_map: dict[str, str] = {}
    deleted_paths: list[str] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        path = item.get("path")
        if not path:
            continue
        action = str(item.get("action", "modify")).lower()
        if action in ("delete", "remove", "deleted"):
            deleted_paths.append(path)
        elif item.get("content") is not None:
            file_map[path] = item["content"]
    return file_map, deleted_paths


def _update_code_result_files(
    ctx: dict,
    file_map: dict[str, str],
    deleted_paths: list[str],
    notes: str,
) -> None:
    existing_files = {
        f["path"]: f
        for f in (ctx.get("code_result") or {}).get("files", [])
        if isinstance(f, dict) and f.get("path")
    }
    for path in deleted_paths:
        existing_files.pop(path, None)
    for path, content in file_map.items():
        existing_files[path] = {
            "path": path,
            "content": content,
            "action": existing_files.get(path, {}).get("action", "modify"),
        }
    ctx["code_result"] = {
        **(ctx.get("code_result") or {}),
        "files": list(existing_files.values()),
        "implementation_notes": notes,
    }


async def _commit_revision_to_branch(
    bitbucket: BitbucketClient,
    mapping: dict,
    branch_name: str,
    commit_message: str,
    file_map: dict[str, str],
    deleted_paths: list[str],
) -> None:
    if not file_map and not deleted_paths:
        return
    parent_commit = await bitbucket.get_branch_commit(
        mapping["workspace"],
        mapping["repo_slug"],
        branch_name,
    )
    await bitbucket.commit_files(
        mapping["workspace"],
        mapping["repo_slug"],
        branch_name,
        commit_message,
        files=file_map or None,
        deleted_paths=deleted_paths or None,
        parent_commit=parent_commit,
    )


async def _apply_revision_deletions(
    bitbucket: BitbucketClient,
    mapping: dict,
    branch_name: str,
    revision_prompt: str,
    changed_files: list,
    issue_key: str,
    summary: str,
) -> tuple[list[str], str]:
    if not _revision_prompt_requests_deletion(revision_prompt):
        return [], ""
    if not settings.openai_configured:
        return [], ""

    branch_paths = _branch_paths_from_changed_files(changed_files)
    if not branch_paths:
        return [], ""

    openai = OpenAIClient()
    delete_paths = await openai.identify_files_to_delete(
        issue_key,
        summary,
        revision_prompt,
        branch_paths,
    )
    if not delete_paths:
        return [], ""

    commit_message = (
        f"{issue_key}: revision — remove files\n\n"
        f"Requested: {revision_prompt[:500]}\n\n"
        f"Removed {len(delete_paths)} file(s) from `{branch_name}`\n\n"
        f"Delivery Manager"
    )
    await _commit_revision_to_branch(
        bitbucket,
        mapping,
        branch_name,
        commit_message,
        {},
        delete_paths,
    )
    return delete_paths, f"Deleted {len(delete_paths)} file(s) from the branch"


async def _sync_pr_changed_files(
    db: AsyncSession,
    run: DeliveryRun,
    ctx: dict,
    mapping: dict,
    bitbucket: BitbucketClient,
) -> DeliveryRun:
    """Load the current PR diffstat from Bitbucket so the UI matches the open PR."""
    branch_name = run.branch_name or ctx.get("branch_name")
    stored = ctx.get("changed_files") or []

    refreshed: list[dict[str, str]] = []
    try:
        beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)
        pr_id = master_pr_id or beta_pr_id or run.pr_id or ctx.get("beta_pr_id")
        if pr_id:
            refreshed = await bitbucket.list_pull_request_changed_files(
                mapping["workspace"],
                mapping["repo_slug"],
                int(pr_id),
            )
        if not refreshed and branch_name:
            refreshed = await _refresh_changed_files(bitbucket, mapping, branch_name)
    except Exception:
        return run

    if not refreshed and stored:
        fresh_ctx = dict(ctx)
        fresh_ctx["changed_files_refreshed_at"] = datetime.now(timezone.utc).isoformat()
        run.context_data = fresh_ctx
        return run

    if not refreshed:
        code_files = (ctx.get("code_result") or {}).get("files") or []
        refreshed = [
            {"path": f["path"], "action": f.get("action", "modify")}
            for f in code_files
            if isinstance(f, dict) and f.get("path")
        ]

    refreshed_at = datetime.now(timezone.utc).isoformat()
    fresh_ctx = dict(ctx)
    fresh_ctx["changed_files"] = refreshed or []
    fresh_ctx["changed_files_refreshed_at"] = refreshed_at

    if not _changed_files_equal(stored, refreshed or []):
        await _persist_run_context(db, run, fresh_ctx)
    else:
        run.context_data = fresh_ctx

    return run


async def apply_code_revision(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    prompt: str,
) -> DeliveryRun:
    run = await sync_pr_review_state(db, run, session)
    if get_workflow_phase(run) != "pr_review":
        return run

    if run.status != "awaiting_approval":
        raise PipelineError("Run is not awaiting approval")

    ctx = dict(run.context_data or {})
    mapping = await _resolve_run_mapping(db, run, ctx)
    branch_name = run.branch_name or ctx.get("branch_name")
    if not mapping or not branch_name:
        raise PipelineError("Missing branch or repo mapping")
    if ctx.get("beta_merged") and ctx.get("master_merged"):
        raise PipelineError("All pull requests are already merged")

    if not settings.bitbucket_configured:
        raise PipelineError("Bitbucket credentials are not configured")

    revision_prompt = prompt.strip()
    if not revision_prompt:
        raise PipelineError("Revision prompt is required")

    run.status = "running"
    run.error_message = None
    revision_count = int(ctx.get("revision_count", 0)) + 1
    await _log_step(
        db,
        run,
        "code_revision",
        "running",
        f"Revision #{revision_count}: applying requested changes…",
    )
    await _log_step(db, run, "revision_prepare", "running", "Loading branch context…")
    await db.commit()

    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)

    try:
        changed_files = ctx.get("changed_files") or []
        if not changed_files:
            changed_files = await _refresh_changed_files(bitbucket, mapping, branch_name)
            ctx["changed_files"] = changed_files

        await _log_step(
            db,
            run,
            "revision_prepare",
            "completed",
            f"Ready to revise {len(changed_files)} file(s) on `{branch_name}`",
        )

        notes = ""
        used_cursor = False

        await _log_step(
            db,
            run,
            "revision_generate",
            "running",
            "Running Cursor agent…" if settings.cursor_configured else "Generating changes with AI…",
        )
        await db.commit()

        if settings.cursor_configured:
            repo_url = BitbucketClient.repo_html_url(mapping["workspace"], mapping["repo_slug"])
            try:
                result = run_revision_agent(
                    issue_key=run.jira_issue_key,
                    summary=ctx.get("summary", run.summary),
                    branch_name=branch_name,
                    master_branch=mapping["master_branch"],
                    repo_url=repo_url,
                    revision_prompt=revision_prompt,
                )
                notes = result.get("implementation_notes", "")
                used_cursor = True
                await _log_step(
                    db,
                    run,
                    "revision_generate",
                    "completed",
                    "Cursor agent committed changes to the feature branch",
                )
                await _log_step(
                    db,
                    run,
                    "revision_commit",
                    "completed",
                    "Commit handled by Cursor agent",
                )
            except CursorDevelopmentError:
                if not settings.openai_configured:
                    raise

        if not used_cursor:
            if not settings.openai_configured:
                raise PipelineError("CURSOR_API_KEY or OPENAI_API_KEY is required for code revisions")

            branch_paths = _branch_paths_from_changed_files(changed_files)
            current_files = await _load_branch_file_contents(
                bitbucket, mapping, branch_name, changed_files, ctx
            )
            if not current_files:
                stale_reason = await _check_pr_review_stale(run, ctx, mapping, bitbucket)
                if stale_reason:
                    return await reset_after_pr_closed(
                        db,
                        run,
                        session,
                        f"{stale_reason}.",
                        attempt_decline=False,
                        step_name="sync_pr_review",
                    )
                raise PipelineError(
                    "No file contents found on the feature branch. "
                    "The pull request may have been declined — use Decline PR & restart or reload the page."
                )

            openai = OpenAIClient()
            code_result = await openai.apply_code_revision(
                run.jira_issue_key,
                ctx.get("summary", run.summary),
                revision_prompt,
                current_files,
                branch_paths=branch_paths,
            )
            files = code_result.get("files", [])
            file_map, deleted_paths = _partition_revision_files(files)
            if not file_map and not deleted_paths:
                raise PipelineError("No file changes were generated for this revision")

            notes = code_result.get("implementation_notes", "")
            change_parts: list[str] = []
            if file_map:
                change_parts.append(f"updated {len(file_map)} file(s)")
            if deleted_paths:
                change_parts.append(f"deleted {len(deleted_paths)} file(s)")
            await _log_step(
                db,
                run,
                "revision_generate",
                "completed",
                f"Generated changes: {', '.join(change_parts)}",
            )

            commit_message = (
                f"{run.jira_issue_key}: revision\n\n"
                f"Requested: {revision_prompt[:500]}\n\n"
                f"{notes}\n\n"
                f"Delivery Manager"
            )
            await _log_step(db, run, "revision_commit", "running", f"Committing to `{branch_name}`…")
            await db.commit()

            await _commit_revision_to_branch(
                bitbucket,
                mapping,
                branch_name,
                commit_message,
                file_map,
                deleted_paths,
            )
            _update_code_result_files(ctx, file_map, deleted_paths, notes)
            commit_parts: list[str] = []
            if file_map:
                commit_parts.append(f"{len(file_map)} updated")
            if deleted_paths:
                commit_parts.append(f"{len(deleted_paths)} deleted")
            await _log_step(
                db,
                run,
                "revision_commit",
                "completed",
                f"Committed to `{branch_name}` ({', '.join(commit_parts)})",
            )
        elif _revision_prompt_requests_deletion(revision_prompt):
            if settings.openai_configured:
                await _log_step(
                    db,
                    run,
                    "revision_delete",
                    "running",
                    "Removing files requested in revision…",
                )
                await db.commit()

                paths_source = await _refresh_changed_files(bitbucket, mapping, branch_name)
                if not paths_source:
                    paths_source = changed_files

                delete_paths, delete_notes = await _apply_revision_deletions(
                    bitbucket,
                    mapping,
                    branch_name,
                    revision_prompt,
                    paths_source,
                    run.jira_issue_key,
                    ctx.get("summary", run.summary),
                )
                if delete_paths:
                    _update_code_result_files(ctx, {}, delete_paths, delete_notes)
                    if notes:
                        notes = f"{notes}\n\n{delete_notes}"
                    else:
                        notes = delete_notes
                    await _log_step(
                        db,
                        run,
                        "revision_delete",
                        "completed",
                        delete_notes,
                    )
                else:
                    await _log_step(
                        db,
                        run,
                        "revision_delete",
                        "completed",
                        "No additional file deletions were required",
                    )
            else:
                await _log_step(
                    db,
                    run,
                    "revision_delete",
                    "completed",
                    "File removal was requested; configure OPENAI_API_KEY to auto-delete files after Cursor revisions",
                )

        await _log_step(db, run, "revision_refresh", "running", "Refreshing changed files…")
        await db.commit()

        refreshed = await _refresh_changed_files(bitbucket, mapping, branch_name)
        if used_cursor and not refreshed:
            await asyncio.sleep(2)
            refreshed = await _refresh_changed_files(bitbucket, mapping, branch_name)

        stored = ctx.get("changed_files") or []
        if refreshed:
            ctx["changed_files"] = refreshed
        elif not stored:
            ctx["changed_files"] = []
        ctx["changed_files_refreshed_at"] = datetime.now(timezone.utc).isoformat()
        await _persist_run_context(db, run, ctx)

        await _log_step(
            db,
            run,
            "revision_refresh",
            "completed",
            f"Updated file list ({len(ctx['changed_files'])} changed file(s))",
        )

        ctx["revision_count"] = revision_count
        ctx["last_revision_prompt"] = revision_prompt
        ctx["workflow_phase"] = "pr_review"

        await _log_step(
            db,
            run,
            "code_revision",
            "completed",
            f"Revision #{revision_count} committed to `{branch_name}` — visible on existing PRs and in Jira Development\n\n{notes[:400]}",
        )

        run.status = "awaiting_approval"
        run.context_data = ctx
        await db.commit()
        await db.refresh(run)
        return run

    except PipelineError as exc:
        run.status = "awaiting_approval"
        run.error_message = str(exc)
        await _log_step(db, run, "code_revision", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise
    except Exception as exc:
        run.status = "awaiting_approval"
        run.error_message = str(exc)
        await _log_step(db, run, "code_revision", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise PipelineError(str(exc)) from exc


def reset_run_to_estimation(run: DeliveryRun, *, summary: str | None = None, notice: str = "") -> None:
    """Clear implementation/PR state and return the run to Step 1 (estimation)."""
    ctx = dict(run.context_data or {})
    run.status = "active"
    run.error_message = None
    run.current_step = None
    run.steps_log = []
    run.estimation_hours = None
    run.estimation_summary = None
    run.branch_name = None
    run.pr_url = None
    run.pr_id = None
    fresh_ctx = {
        "workflow_phase": "estimation",
        "summary": summary or ctx.get("summary") or run.summary,
    }
    if notice.strip():
        fresh_ctx["workflow_notice"] = notice.strip()
    run.context_data = fresh_ctx


async def restart_delivery_workflow(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    reason: str,
    *,
    decline_open_prs: bool = False,
    step_name: str = "restart_delivery",
) -> DeliveryRun:
    ctx = dict(run.context_data or {})
    mapping = await _resolve_run_mapping(db, run, ctx)
    beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)

    run.status = "running"
    run.error_message = None
    action = "Declining pull requests and restarting" if decline_open_prs else "Restarting delivery"
    await _log_step(db, run, step_name, "running", f"{action}…")
    await db.commit()

    jira = jira_client_from_session(session)
    message = reason.strip() or "Delivery workflow restarted from estimation"
    declined: list[str] = []
    already_closed: list[str] = []

    try:
        if settings.bitbucket_configured and mapping:
            bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
            workspace = mapping["workspace"]
            repo_slug = mapping["repo_slug"]

            if decline_open_prs:
                declined, already_closed = await _decline_tracked_prs(
                    bitbucket, mapping, run, ctx, message
                )

            branch_name = run.branch_name or ctx.get("branch_name")
            if branch_name:
                try:
                    await bitbucket.delete_branch(workspace, repo_slug, branch_name)
                except Exception:
                    pass

        try:
            new_status = await ensure_in_estimation_status(
                jira,
                run.jira_issue_key,
                ctx.get("status_name", ""),
            )
        except PipelineError:
            new_status = ctx.get("status_name")

        if decline_open_prs:
            try:
                reason_line = f"\n\nReason: {message}" if message else ""
                pr_summary = ", ".join(declined) if declined else "n/a"
                if already_closed:
                    pr_summary += (
                        f" ({', '.join(already_closed)} already closed)"
                        if pr_summary == "n/a"
                        else f"; {', '.join(already_closed)} already closed"
                    )
                await _jira_comment(
                    jira,
                    run.jira_issue_key,
                    f"[Delivery Manager] Pull request(s) declined — delivery restarted\n\n"
                    f"Declined: {pr_summary}"
                    f"{reason_line}\n\n"
                    f"Workflow reset to estimation. Review and post a new estimation to continue.",
                )
            except Exception:
                pass
        else:
            try:
                await _jira_comment(
                    jira,
                    run.jira_issue_key,
                    f"[Delivery Manager] Delivery restarted from estimation\n\n"
                    f"{message}\n\n"
                    f"Review and post a new estimation to continue.",
                )
            except Exception:
                pass

        reset_run_to_estimation(run, summary=ctx.get("summary", run.summary), notice=message)
        fresh_ctx = dict(run.context_data or {})
        if new_status:
            fresh_ctx["status_name"] = new_status
        run.context_data = fresh_ctx
        run.error_message = None

        completed = (
            f"Declined {', '.join(declined)} — delivery restarted from estimation"
            if declined
            else (
                f"Pull request(s) already closed — delivery restarted from estimation"
                if already_closed
                else f"Delivery restarted from estimation — {message}"
            )
        )
        await _log_step(db, run, step_name, "completed", completed)
        await db.commit()
        await db.refresh(run)
        return run

    except PipelineError as exc:
        run.status = "awaiting_approval"
        run.error_message = str(exc)
        await _log_step(db, run, step_name, "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise
    except Exception as exc:
        run.status = "awaiting_approval"
        run.error_message = str(exc)
        await _log_step(db, run, step_name, "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise PipelineError(str(exc)) from exc


async def sync_pr_review_state(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    """Sync PR review: refresh changed files from Bitbucket; reset if PRs were closed externally."""
    if run.error_message and "Failed to decline" in run.error_message:
        run.error_message = None
        await db.commit()
        await db.refresh(run)

    if run.status != "awaiting_approval" or get_workflow_phase(run) != "pr_review":
        if (
            run.status == "active"
            and get_workflow_phase(run) in ("estimation", "ready_for_implementation")
            and run.error_message
        ):
            run.error_message = None
            await db.commit()
            await db.refresh(run)
        return run

    ctx = dict(run.context_data or {})
    mapping = await _resolve_run_mapping(db, run, ctx)
    if not mapping or not settings.bitbucket_configured:
        return run

    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
    stale_reason = await _check_pr_review_stale(run, ctx, mapping, bitbucket)
    if not stale_reason:
        return await _sync_pr_changed_files(db, run, ctx, mapping, bitbucket)

    return await reset_after_pr_closed(
        db,
        run,
        session,
        f"{stale_reason}.",
        attempt_decline=False,
        step_name="sync_pr_review",
    )


async def decline_prs_and_restart(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    reason: str = "",
) -> DeliveryRun:
    if run.status not in ("awaiting_approval", "failed"):
        raise PipelineError("Pull requests can only be reset during PR review")
    if get_workflow_phase(run) != "pr_review":
        raise PipelineError("Pull requests can only be reset during PR review")

    ctx = dict(run.context_data or {})
    if ctx.get("beta_merged") or ctx.get("master_merged"):
        raise PipelineError("Cannot restart after a pull request has been merged")

    run.error_message = None
    await db.commit()

    decline_message = reason.strip() or "Restarting development on the same branch"
    return await reset_after_pr_closed(
        db,
        run,
        session,
        decline_message,
        attempt_decline=True,
        step_name="decline_pr",
    )


async def get_run_file_diff(
    db: AsyncSession,
    run: DeliveryRun,
    file_path: str,
) -> dict:
    ctx = dict(run.context_data or {})
    mapping_data = ctx.get("mapping")
    if not mapping_data:
        result = await db.execute(
            select(ProjectRepoMapping).where(ProjectRepoMapping.jira_project_key == run.project_key)
        )
        mapping = result.scalar_one_or_none()
        if not mapping:
            raise PipelineError(
                f"No Bitbucket mapping for project {run.project_key}. Add one in Admin → Mappings."
            )
        mapping_data = {
            "workspace": mapping.bitbucket_workspace,
            "repo_slug": mapping.bitbucket_repo_slug,
            "master_branch": mapping.master_branch,
        }

    branch_name = run.branch_name or ctx.get("branch_name")
    if not branch_name:
        raise PipelineError("No feature branch for this run")

    normalized_path = file_path.strip().lstrip("/")
    if not normalized_path:
        raise PipelineError("File path is required")

    action = "modify"
    for item in ctx.get("changed_files") or []:
        if isinstance(item, dict) and item.get("path") == normalized_path:
            action = item.get("action", "modify")
            break

    if action in ("create", "added"):
        action = "add"

    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
    workspace = mapping_data["workspace"]
    repo_slug = mapping_data["repo_slug"]
    base_ref = mapping_data["master_branch"]

    old_content: str | None = None
    new_content: str | None = None
    if action != "add":
        old_content = await bitbucket.get_file(workspace, repo_slug, normalized_path, ref=base_ref)
    if action != "delete":
        new_content = await bitbucket.get_file(workspace, repo_slug, normalized_path, ref=branch_name)

    if not new_content and action in ("add", "modify"):
        for item in (ctx.get("code_result") or {}).get("files") or []:
            if isinstance(item, dict) and item.get("path") == normalized_path and item.get("content"):
                new_content = item["content"]
                if action == "modify" and item.get("action") in ("create", "add", "added"):
                    action = "add"
                break

    old_text = old_content or ""
    new_text = new_content or ""
    if action == "add" and new_text:
        unified_diff = "".join(f"+{line}\n" for line in new_text.splitlines())
    else:
        unified_diff = "".join(
            difflib.unified_diff(
                old_text.splitlines(keepends=True),
                new_text.splitlines(keepends=True),
                fromfile=f"{base_ref}/{normalized_path}",
                tofile=f"{branch_name}/{normalized_path}",
            )
        )

    return {
        "path": normalized_path,
        "action": action,
        "base_ref": base_ref,
        "head_ref": branch_name,
        "old_content": old_content,
        "new_content": new_content,
        "unified_diff": unified_diff,
    }


async def _step_resolve_mapping(db, run, jira, ctx) -> tuple[str, dict]:
    result = await db.execute(
        select(ProjectRepoMapping).where(ProjectRepoMapping.jira_project_key == run.project_key)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise PipelineError(
            f"No Bitbucket mapping for project {run.project_key}. Add one in Admin → Mappings."
        )
    mapping_data = {
        "workspace": mapping.bitbucket_workspace,
        "repo_slug": mapping.bitbucket_repo_slug,
        "master_branch": mapping.master_branch,
        "beta_branch": mapping.beta_branch,
        "beta_website_url": mapping.beta_website_url,
        "master_website_url": mapping.master_website_url,
    }
    return (
        f"Repo: {mapping.bitbucket_workspace}/{mapping.bitbucket_repo_slug} "
        f"(master: {mapping.master_branch}, beta: {mapping.beta_branch})",
        {"mapping": mapping_data},
    )


async def _step_create_branch(db, run, jira, ctx) -> tuple[str, dict]:
    if not settings.bitbucket_configured:
        raise PipelineError("Bitbucket credentials are not configured")
    mapping = ctx.get("mapping")
    if not mapping:
        raise PipelineError("Run resolve mapping step first")

    branch_name = run.branch_name or ctx.get("branch_name")
    if not branch_name:
        branch_name = f"feature/{run.jira_issue_key.lower()}-{slugify(ctx.get('summary', run.summary))}"

    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
    if await bitbucket.branch_exists(
        mapping["workspace"],
        mapping["repo_slug"],
        branch_name,
    ):
        run.branch_name = branch_name
        await db.commit()
        return (
            f"Reusing existing branch `{branch_name}`",
            {"branch_name": branch_name},
        )

    try:
        await bitbucket.create_branch(
            mapping["workspace"],
            mapping["repo_slug"],
            branch_name,
            mapping["master_branch"],
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 409:
            run.branch_name = branch_name
            await db.commit()
            return (
                f"Reusing existing branch `{branch_name}`",
                {"branch_name": branch_name},
            )
        if exc.response.status_code == 404:
            raise PipelineError(
                f"Branch `{mapping['master_branch']}` not found in "
                f"{mapping['workspace']}/{mapping['repo_slug']}. "
                "Update the master branch in Admin → Mappings."
            ) from exc
        raise PipelineError(f"Bitbucket branch creation failed: {exc}") from exc
    except Exception as exc:
        raise PipelineError(f"Bitbucket branch creation failed: {exc}") from exc
    run.branch_name = branch_name
    await db.commit()
    return (
        f"Created branch `{branch_name}` from `{mapping['master_branch']}`",
        {"branch_name": branch_name},
    )


async def _step_cursor_development(db, run, jira, ctx) -> tuple[str, dict]:
    mapping = ctx.get("mapping")
    branch_name = run.branch_name or ctx.get("branch_name")
    if not mapping or not branch_name:
        raise PipelineError("Run create branch step first")

    if settings.cursor_configured:
        repo_url = BitbucketClient.repo_html_url(mapping["workspace"], mapping["repo_slug"])
        try:
            result = run_implementation_agent(
                issue_key=run.jira_issue_key,
                summary=ctx.get("summary", run.summary),
                description=ctx.get("description", ""),
                branch_name=branch_name,
                master_branch=mapping["master_branch"],
                repo_url=repo_url,
                repo_context=ctx.get("repo_context", ""),
            )
            notes = result.get("implementation_notes", "")
            return (
                f"Cursor SDK completed development on `{branch_name}`\n\n{notes[:500]}",
                {"development_result": result, "code_result": {"implementation_notes": notes, "files": []}},
            )
        except CursorDevelopmentError as exc:
            if not settings.openai_configured:
                raise PipelineError(str(exc)) from exc

    return (
        "Cursor SDK not configured — using OpenAI for code generation",
        {"development_result": {"source": "openai_fallback"}},
    )


async def _step_repo_context(db, run, jira, ctx) -> tuple[str, dict]:
    if not settings.bitbucket_configured:
        raise PipelineError("Bitbucket credentials are not configured")
    mapping = ctx.get("mapping")
    if not mapping:
        raise PipelineError("Run resolve mapping step first")

    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
    context_parts: list[str] = []
    loaded: list[str] = []
    for path in ["README.md", "readme.md", "package.json", "pyproject.toml", "composer.json"]:
        content = await bitbucket.get_file(
            mapping["workspace"], mapping["repo_slug"], path, mapping["master_branch"]
        )
        if content:
            context_parts.append(f"--- {path} ---\n{content[:3000]}")
            loaded.append(path)

    repo_context = "\n\n".join(context_parts) or "(no repo files found)"
    return (
        f"Loaded {len(loaded)} file(s): {', '.join(loaded) or 'none'}",
        {"repo_context": repo_context, "loaded_files": loaded},
    )


async def _step_generate_code(db, run, jira, ctx) -> tuple[str, dict]:
    if not settings.openai_configured:
        raise PipelineError("OPENAI_API_KEY is not configured")
    openai = OpenAIClient()
    code_result = await openai.generate_code_changes(
        run.jira_issue_key,
        ctx.get("summary", run.summary),
        ctx.get("description", ""),
        ctx.get("repo_context", ""),
    )
    files = code_result.get("files", [])
    if not files:
        raise PipelineError("OpenAI did not generate any file changes")
    notes = code_result.get("implementation_notes", "")
    paths = [f["path"] for f in files if f.get("path")]
    return (
        f"Generated {len(files)} file(s): {', '.join(paths)}\n\n{notes}",
        {"code_result": code_result},
    )


async def _step_commit_changes(db, run, jira, ctx) -> tuple[str, dict]:
    if not settings.bitbucket_configured:
        raise PipelineError("Bitbucket credentials are not configured")
    mapping = ctx.get("mapping")
    code_result = ctx.get("code_result")
    if not mapping or not code_result:
        raise PipelineError("Run generate code step first")

    files = code_result.get("files", [])
    file_map = {f["path"]: f["content"] for f in files if f.get("path") and f.get("content")}
    if not file_map:
        raise PipelineError("No files to commit")

    branch_name = run.branch_name or ctx.get("branch_name")
    if not branch_name:
        raise PipelineError("Run create branch step first")

    notes = code_result.get("implementation_notes", "")
    commit_message = f"{run.jira_issue_key}: {run.summary}\n\n{notes}\n\nDelivery Manager"

    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
    parent_commit = await bitbucket.get_branch_commit(
        mapping["workspace"],
        mapping["repo_slug"],
        branch_name,
    )
    await bitbucket.commit_files(
        mapping["workspace"],
        mapping["repo_slug"],
        branch_name,
        commit_message,
        file_map,
        parent_commit=parent_commit,
    )
    await db.commit()
    return (
        f"Committed {len(file_map)} file(s) to branch `{branch_name}`",
        {"branch_name": branch_name},
    )


def _pr_description(run: DeliveryRun, ctx: dict) -> str:
    notes = (ctx.get("code_result") or {}).get("implementation_notes", "")
    return (
        f"## {run.jira_issue_key}: {run.summary}\n\n"
        f"**Estimation:** {run.estimation_hours or 'n/a'}h\n\n"
        f"{notes}\n\n"
        f"---\n*Delivery Manager*"
    )


async def _step_create_pr_beta(db, run, jira, ctx) -> tuple[str, dict]:
    if not settings.bitbucket_configured:
        raise PipelineError("Bitbucket credentials are not configured")
    mapping = ctx.get("mapping")
    branch_name = run.branch_name or ctx.get("branch_name")
    if not mapping or not branch_name:
        raise PipelineError("Run commit changes step first")

    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
    pr = await bitbucket.create_pull_request(
        mapping["workspace"],
        mapping["repo_slug"],
        f"{run.jira_issue_key}: {run.summary} (Beta)",
        branch_name,
        mapping["beta_branch"],
        _pr_description(run, ctx),
    )
    beta_pr_id = pr.get("id")
    beta_pr_url = BitbucketClient.pr_html_url(pr)
    run.pr_id = beta_pr_id
    run.pr_url = beta_pr_url
    await db.commit()

    return (
        f"Beta pull request created: {beta_pr_url or 'success'}\n"
        f"{branch_name} → {mapping['beta_branch']}",
        {"beta_pr_url": beta_pr_url, "beta_pr_id": beta_pr_id, "pr_url": beta_pr_url, "pr_id": beta_pr_id},
    )


async def _step_create_pr_master(db, run, jira, ctx) -> tuple[str, dict]:
    if not settings.bitbucket_configured:
        raise PipelineError("Bitbucket credentials are not configured")
    mapping = ctx.get("mapping")
    branch_name = run.branch_name or ctx.get("branch_name")
    if not mapping or not branch_name:
        raise PipelineError("Run commit changes step first")

    bitbucket = BitbucketClient(settings.bitbucket_username, settings.bitbucket_app_password)
    pr = await bitbucket.create_pull_request(
        mapping["workspace"],
        mapping["repo_slug"],
        f"{run.jira_issue_key}: {run.summary} (Master)",
        branch_name,
        mapping["master_branch"],
        _pr_description(run, ctx),
    )
    master_pr_id = pr.get("id")
    master_pr_url = BitbucketClient.pr_html_url(pr)
    await db.commit()
    return (
        f"Master pull request created: {master_pr_url or 'success'}\n"
        f"{branch_name} → {mapping['master_branch']}",
        {"master_pr_url": master_pr_url, "master_pr_id": master_pr_id},
    )


async def _step_verify_website(db, run, jira, ctx, environment: str) -> tuple[str, dict]:
    mapping = ctx.get("mapping")
    if not mapping:
        raise PipelineError("Run resolve mapping step first")

    website_url = (
        mapping["beta_website_url"] if environment == "Beta" else mapping["master_website_url"]
    ).strip()
    if not website_url:
        return (f"No {environment} website URL configured; skipped verification", {})

    if not settings.openai_configured:
        raise PipelineError("OPENAI_API_KEY is required for website verification")

    openai = OpenAIClient()
    result = await verify_website(
        issue_key=run.jira_issue_key,
        summary=ctx.get("summary", run.summary),
        environment=environment,
        website_url=website_url,
        openai_client=openai,
    )
    analysis = result["analysis"]
    filename = f"{environment.lower()}-{run.jira_issue_key.lower()}.png"
    await jira.add_attachment(run.jira_issue_key, filename, result["screenshot_png"])

    findings = analysis.get("findings") or []
    findings_text = "\n".join(f"- {item}" for item in findings) or "- No specific findings"
    comment = (
        f"[Delivery Manager] {environment} website verification\n\n"
        f"URL: {website_url}\n"
        f"Result: {'Passed' if analysis.get('passed') else 'Needs review'}\n\n"
        f"{analysis.get('summary', '')}\n\n"
        f"Findings:\n{findings_text}"
    )
    if analysis.get("recommendations"):
        comment += f"\n\nRecommendations:\n{analysis['recommendations']}"
    comment += f"\n\nScreenshot attached: {filename}"
    await _jira_comment(jira, run.jira_issue_key, comment)

    verification_record = {
        "environment": environment,
        "url": website_url,
        "passed": bool(analysis.get("passed")),
        "summary": analysis.get("summary", ""),
        "findings": findings,
        "screenshot_filename": filename,
    }
    verifications = list(ctx.get("verifications") or [])
    verifications.append(verification_record)
    return (
        f"{environment} verification {'passed' if verification_record['passed'] else 'flagged'}: {website_url}",
        {"verifications": verifications, f"{environment.lower()}_verification": verification_record},
    )


async def _step_create_pr(db, run, jira, ctx) -> tuple[str, dict]:
    """Legacy single-PR helper kept for compatibility."""
    return await _step_create_pr_beta(db, run, jira, ctx)


# Legacy compatibility for old step endpoint
PIPELINE_STEPS = IMPLEMENTATION_STEPS


def get_next_step(run: DeliveryRun) -> str | None:
    return None
