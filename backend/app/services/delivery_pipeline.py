import asyncio
import difflib
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.auth.ai_credentials import (
    cursor_api_key,
    cursor_configured,
    cursor_model,
    openai_client_from_session,
    openai_configured,
)
from app.auth.bitbucket_credentials import (
    bitbucket_client_from_session,
    bitbucket_configured,
    bitbucket_git_credentials,
)
from app.auth.jira_credentials import jira_client_from_session
from app.clients.bitbucket_client import BitbucketClient
from app.clients.cursor_client import CursorDevelopmentError, run_implementation_agent, run_revision_agent
from app.clients.jira_client import JiraClient
from app.clients.openai_client import OpenAIClient, slugify
from app.config import settings
from app.db.models import DeliveryRun, ProjectRepoMapping
from app.services.app_settings import (
    jira_admin_database_field_id,
    jira_impact_analysis_field_id,
    jira_unit_testing_field_id,
)
from app.services.deploy_commands import (
    commands_need_bitbucket_auth,
    deploy_commands_for_environment,
    fetch_deploy_commands_from_db,
)
from app.services.jira_fields import build_select_field_payload, filter_settable_transition_fields
from app.services.repo_stack import probe_repository_stack
from app.services.ssh_deploy import (
    DeployError,
    deploy_configured,
    run_environment_deploy,
)
from app.services.website_verifier import verify_website

_RUN_DATA_ROOT = Path(__file__).resolve().parents[2] / "data" / "runs"

MergeTarget = Literal["beta", "master"]

WORKFLOW_PHASES: list[tuple[str, str]] = [
    ("estimation", "Estimation"),
    ("waiting_for_info", "Waiting for info"),
    ("ready_for_implementation", "Ready for implementation"),
    ("implementation", "Implementation"),
    ("local_development", "Local development"),
    ("pr_review", "Pull request review"),
    ("completed", "Completed"),
]

PHASE_LABELS = dict(WORKFLOW_PHASES)

IMPLEMENTATION_STEPS: list[tuple[str, str]] = [
    ("impact_analysis", "Write Impact Analysis"),
    ("transition_in_progress", "Move to In Progress"),
    ("resolve_mapping", "Resolve Bitbucket repo"),
    ("create_branch", "Create branch from Master"),
    ("repo_stack", "Detect repository stack"),
    ("cursor_development", "Develop with Cursor SDK"),
    ("commit_changes", "Commit changes to branch"),
    ("confirm_local_changes", "Create pull requests"),
    ("create_pr_beta", "Create pull request to Staging"),
    ("create_pr_master", "Create pull request to Master"),
    ("verify_beta", "Verify Staging website"),
    ("verify_master", "Verify Master website"),
]

STEP_LABELS = dict(IMPLEMENTATION_STEPS)


class PipelineError(Exception):
    pass


def _bitbucket_client(session: dict) -> BitbucketClient:
    if not bitbucket_configured(session):
        raise PipelineError(
            "Bitbucket credentials are not configured. Add them in Settings."
        )
    return bitbucket_client_from_session(session)


def _openai_client(session: dict) -> OpenAIClient:
    if not openai_configured(session):
        raise PipelineError("OpenAI API key is not configured. Add it in Settings.")
    return openai_client_from_session(session)


def get_workflow_phase(run: DeliveryRun) -> str:
    ctx = run.context_data or {}
    return ctx.get("workflow_phase", "estimation")


PIPELINE_STEP_UI_STEP: dict[str, int] = {
    "estimate": 1,
    "post_estimation": 2,
    "impact_analysis": 2,
    "transition_in_progress": 2,
    "resolve_mapping": 2,
    "create_branch": 2,
    "repo_stack": 2,
    "cursor_development": 2,
    "commit_changes": 2,
    "confirm_local_changes": 2,
    "create_pr_beta": 3,
    "create_pr_master": 3,
    "merge_beta_pr": 4,
    "deploy_beta": 4,
    "verify_beta": 4,
    "merge_master_pr": 4,
    "deploy_master": 4,
    "verify_master": 4,
    "transition_in_testing": 4,
}


def _derive_ui_active_step(run: DeliveryRun, phase: str, ctx: dict) -> int:
    if phase == "completed" and run.status == "completed":
        return 4

    has_open_prs = bool(
        run.pr_id
        or ctx.get("beta_pr_id")
        or ctx.get("master_pr_id")
        or run.pr_url
        or ctx.get("beta_pr_url")
        or ctx.get("master_pr_url")
    )
    has_post_merge = bool(
        ctx.get("pending_deploy_retry") or ctx.get("beta_merged") or ctx.get("master_merged")
    )
    verifications = ctx.get("verifications") or []
    verification_done = phase == "completed" and run.status == "completed"
    show_merge_progress = _has_merge_progress(run, ctx)
    verification_in_progress = (
        has_post_merge
        or (len(verifications) > 0 and not verification_done)
        or (run.status == "running" and phase == "pr_review" and show_merge_progress)
    )
    if verification_done or verification_in_progress:
        return 4

    pr_review_ready = (
        phase == "pr_review"
        or (run.status == "awaiting_approval" and phase != "local_development")
        or has_open_prs
        or has_post_merge
    )
    if pr_review_ready:
        return 3

    if phase in {
        "ready_for_implementation",
        "implementation",
        "local_development",
        "pr_review",
        "completed",
    } or _step_completed(run, "post_estimation"):
        return 2

    return 1


def resolve_ui_active_step(
    run: DeliveryRun,
    phase: str | None = None,
    ctx: dict | None = None,
) -> int:
    ctx = dict(ctx or run.context_data or {})
    _hydrate_merge_flags_from_steps(run, ctx)
    phase = phase or get_workflow_phase(run)
    if ctx.get("beta_merged") or ctx.get("master_merged") or ctx.get("pending_deploy_retry"):
        phase = "pr_review"

    derived = _derive_ui_active_step(run, phase, ctx)
    stored = ctx.get("ui_active_step")
    if isinstance(stored, int) and 1 <= stored <= 4:
        if derived < stored and phase in {
            "estimation",
            "waiting_for_info",
            "ready_for_implementation",
            "implementation",
            "local_development",
        }:
            return derived
        return max(stored, derived)
    return derived


def _touch_ui_active_step(run: DeliveryRun, step: str, status: str) -> None:
    if status not in ("completed", "running"):
        return
    step_ui = PIPELINE_STEP_UI_STEP.get(step)
    if not step_ui:
        return
    ctx = dict(run.context_data or {})
    current = ctx.get("ui_active_step", 1)
    if not isinstance(current, int):
        current = 1
    ctx["ui_active_step"] = max(current, step_ui)
    run.context_data = ctx
    flag_modified(run, "context_data")


def _is_todo_status(status_name: str) -> bool:
    lowered = status_name.lower().strip()
    return lowered in ("to do", "todo", "open", "backlog", "new")


def _is_in_estimation_status(status_name: str) -> bool:
    lowered = status_name.lower().strip()
    return "estimation" in lowered and "complete" not in lowered and "completed" not in lowered


def _is_waiting_for_info_status(status_name: str) -> bool:
    lowered = status_name.lower().strip().replace("-", " ")
    return "waiting" in lowered and "info" in lowered


def _is_jira_ready_for_estimation(status_name: str) -> bool:
    return not _is_waiting_for_info_status(status_name)


def _resume_estimation_phase_if_ready(ctx: dict, snapshot: dict) -> bool:
    """Move workflow back to estimation when Jira is no longer waiting for info."""
    if ctx.get("workflow_phase") != "waiting_for_info":
        return False
    if ctx.get("estimation_prepared"):
        return False
    if not _is_jira_ready_for_estimation(snapshot.get("status_name", "")):
        return False
    ctx["workflow_phase"] = "estimation"
    return True


def _should_auto_prepare_in_waiting_for_info(ctx: dict) -> bool:
    """After a workflow restart, still generate a draft estimation from Jira content."""
    return bool(str(ctx.get("workflow_notice") or "").strip())


async def _auto_prepare_estimation_if_needed(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    snapshot: dict,
) -> DeliveryRun:
    ctx = run.context_data or {}
    phase = get_workflow_phase(run)
    if has_pending_post_merge_work(run):
        return run
    if phase not in ("estimation", "", "waiting_for_info"):
        return run
    if ctx.get("estimation_prepared"):
        return run
    if run.status == "running":
        return run
    if phase == "waiting_for_info":
        if not _should_auto_prepare_in_waiting_for_info(ctx):
            return run
    elif not _is_jira_ready_for_estimation(snapshot.get("status_name", "")):
        return run
    if not openai_configured(session):
        return run
    try:
        return await prepare_estimation(db, run, session)
    except Exception:
        await db.refresh(run)
        return run


def _jira_has_original_estimate(snapshot: dict) -> bool:
    timetracking = snapshot.get("timetracking") or {}
    original_estimate = str(timetracking.get("originalEstimate") or "").strip()
    original_seconds = timetracking.get("originalEstimateSeconds")
    if original_estimate:
        return True
    try:
        return bool(original_seconds and int(original_seconds) > 0)
    except (TypeError, ValueError):
        return False


def _estimation_was_posted(run: DeliveryRun) -> bool:
    phase = get_workflow_phase(run)
    if phase in ("ready_for_implementation", "implementation", "local_development", "pr_review", "completed"):
        return True
    return _step_completed(run, "post_estimation")


def _should_restart_for_waiting_for_info(run: DeliveryRun, snapshot: dict) -> bool:
    """Restart when Jira moved back to waiting-for-info after estimation was posted."""
    if run.status == "running":
        return False
    if not _is_waiting_for_info_status(snapshot.get("status_name", "")):
        return False
    if not _estimation_was_posted(run):
        return False
    if get_workflow_phase(run) == "waiting_for_info":
        return False
    return True


_IN_ESTIMATION_EXACT_NAMES: tuple[str, ...] = ("In Estimation",)
_IN_ESTIMATION_KEYWORD_SETS: tuple[tuple[str, ...], ...] = (
    ("in", "estimation"),
    ("start", "estimation"),
    ("begin", "estimation"),
)
_IN_ESTIMATION_EXCLUDE: tuple[str, ...] = ("complete", "completed", "done")

_IN_PROGRESS_EXACT_NAMES: tuple[str, ...] = (
    "In Progress",
    "Start Progress",
    "Begin Progress",
)
_IN_PROGRESS_KEYWORD_SETS: tuple[tuple[str, ...], ...] = (
    ("in", "progress"),
    ("start", "progress"),
    ("start", "work"),
    ("begin", "work"),
)
_IN_PROGRESS_EXCLUDE: tuple[str, ...] = (
    "review",
    "complete",
    "completed",
    "done",
    "testing",
    "estimation",
)

_ESTIMATION_COMPLETE_EXACT_NAMES: tuple[str, ...] = (
    "Estimation Complete",
    "Estimation Completed",
)
_ESTIMATION_COMPLETE_KEYWORD_SETS: tuple[tuple[str, ...], ...] = (
    ("estimation", "complete"),
    ("estimation", "completed"),
    ("complete", "estimation"),
)

_IN_TESTING_EXACT_NAMES: tuple[str, ...] = (
    "In Testing",
    "Unit Testing",
    "Under Testing",
    "Under testing",
)
_IN_TESTING_KEYWORD_SETS: tuple[tuple[str, ...], ...] = (
    ("under", "testing"),
    ("in", "testing"),
)
_IN_TESTING_EXCLUDE: tuple[str, ...] = ("complete", "completed")

_JIRA_DEPARTMENT_FIELD_NAME = "Department"
_JIRA_DEPARTMENT_DEFAULT_VALUE = "Development"
_WRITEBACK_FIELD_NAMES: tuple[str, ...] = (
    "unit testing",
    "unit testing field",
    "impact analysis",
    "admin/ database",
    "admin/database",
    "admin database",
)


def is_unified_deploy_target(mapping: dict | ProjectRepoMapping) -> bool:
    """True when staging and live share the same target branch (single PR merge flow)."""
    if isinstance(mapping, ProjectRepoMapping):
        beta = mapping.beta_branch.strip().lower()
        master = mapping.master_branch.strip().lower()
    else:
        beta = str(mapping.get("beta_branch", "")).strip().lower()
        master = str(mapping.get("master_branch", "")).strip().lower()
    return bool(beta) and beta == master


async def _load_fresh_mapping(db: AsyncSession, project_key: str) -> ProjectRepoMapping:
    """Load mapping from the database, bypassing any stale session cache."""
    result = await db.execute(
        select(ProjectRepoMapping)
        .where(ProjectRepoMapping.jira_project_key == project_key)
        .execution_options(populate_existing=True)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise PipelineError(
            f"No Bitbucket mapping for project {project_key}. Add one in Admin → Mappings."
        )
    await db.refresh(
        mapping,
        attribute_names=[
            "beta_post_pr_merge_command",
            "master_post_pr_merge_command",
            "project_root_directory",
            "ssh_use_sudo",
            "ssh_host",
            "ssh_port",
            "ssh_username",
            "ssh_auth_type",
            "ssh_password_encrypted",
            "ssh_private_key_encrypted",
            "bitbucket_workspace",
            "bitbucket_repo_slug",
        ],
    )
    return mapping


def _prune_deploy_step_logs(run: DeliveryRun, deploy_step: str) -> None:
    """Remove prior deploy step log entries so retries reflect the latest command list."""
    cmd_prefix = f"{deploy_step}_cmd_"
    run.steps_log = [
        entry
        for entry in (run.steps_log or [])
        if isinstance(entry, dict)
        and entry.get("step") != deploy_step
        and not str(entry.get("step", "")).startswith(cmd_prefix)
    ]
    flag_modified(run, "steps_log")


def _is_in_testing_status(status_name: str) -> bool:
    lowered = status_name.lower().strip().replace("-", " ")
    return "testing" in lowered and "complete" not in lowered and "completed" not in lowered


async def ensure_in_testing_status(
    jira: JiraClient,
    issue_key: str,
    current_status: str | None = None,
    *,
    db: AsyncSession | None = None,
) -> str:
    """Move issue to In Testing / Unit Testing after deployment completes successfully."""
    if current_status and _is_in_testing_status(current_status):
        return current_status

    return await _transition_issue(
        jira,
        issue_key,
        keyword_sets=_IN_TESTING_KEYWORD_SETS,
        exact_names=_IN_TESTING_EXACT_NAMES,
        exclude_keywords=_IN_TESTING_EXCLUDE,
        label="In Testing",
        db=db,
    )


async def _department_transition_payload(jira: JiraClient, issue_key: str) -> dict | None:
    try:
        field_id = await jira.resolve_field_id(_JIRA_DEPARTMENT_FIELD_NAME)
    except ValueError:
        return None

    payload = await build_select_field_payload(
        jira,
        issue_key,
        field_id,
        _JIRA_DEPARTMENT_DEFAULT_VALUE,
    )
    return {field_id: payload}


def _transition_field_value_usable(value, meta: dict) -> bool:
    if value is None:
        return False
    schema_type = str((meta.get("schema") or {}).get("type") or "").lower()
    if schema_type in ("option", "priority", "resolution"):
        return not JiraClient.is_select_field_empty(value)
    if schema_type == "user":
        return bool((value or {}).get("accountId"))
    if schema_type == "array":
        return bool(value)
    if schema_type in ("string", "number"):
        return bool(str(value).strip())
    if isinstance(value, dict):
        if value.get("type") == "doc":
            return bool(value.get("content"))
        return bool(value.get("value") or value.get("id") or value.get("name"))
    return bool(value)


def _is_department_transition_field(
    field_id: str,
    meta: dict,
    dept_field_id: str | None,
) -> bool:
    name = str(meta.get("name") or "").lower().strip()
    return field_id == dept_field_id or name == _JIRA_DEPARTMENT_FIELD_NAME.lower()


def _is_writeback_transition_field(
    field_id: str,
    meta: dict,
    *,
    dept_field_id: str | None = None,
    skip_field_ids: set[str] | None = None,
) -> bool:
    """Fields Delivery Manager updates separately — never send on status transitions."""
    if _is_department_transition_field(field_id, meta, dept_field_id):
        return True
    if skip_field_ids and field_id in skip_field_ids:
        return True
    name = str(meta.get("name") or "").lower().strip()
    return any(
        name == pattern or pattern in name
        for pattern in _WRITEBACK_FIELD_NAMES
    )


async def _transition_skip_field_ids(
    jira: JiraClient,
    db: AsyncSession | None = None,
) -> set[str]:
    skip: set[str] = set()
    try:
        skip.add(await jira.resolve_field_id(_JIRA_DEPARTMENT_FIELD_NAME))
    except ValueError:
        pass

    if db is not None:
        for resolver in (
            jira_impact_analysis_field_id,
            jira_unit_testing_field_id,
            jira_admin_database_field_id,
        ):
            field_id = await resolver(db)
            if field_id:
                skip.add(field_id)
        return skip

    for names in (
        "Impact Analysis",
        ("Unit Testing Field", "Unit Testing"),
        ("Admin/ Database", "Admin/Database", "Admin Database"),
    ):
        try:
            skip.add(await jira.resolve_field_id(names))
        except ValueError:
            pass
    return skip


def _parse_jira_unsettable_fields(exc: Exception) -> set[str]:
    """Field ids Jira rejected because they are not on the transition screen."""
    text = str(exc)
    fields = set(re.findall(r"(customfield_\d+):", text))
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            for key, msg in (response.json().get("errors") or {}).items():
                if key.startswith("customfield_") and "cannot be set" in str(msg).lower():
                    fields.add(key)
        except Exception:
            pass
    return fields


def _strip_skip_fields_from_transition_payload(
    transition: dict,
    payload: dict | None,
    *,
    dept_field_id: str | None = None,
    skip_field_ids: set[str] | None = None,
) -> dict | None:
    if not payload:
        return None
    field_meta = transition.get("fields") or {}
    filtered = {
        field_id: value
        for field_id, value in payload.items()
        if not _is_writeback_transition_field(
            field_id,
            field_meta.get(field_id) or {},
            dept_field_id=dept_field_id,
            skip_field_ids=skip_field_ids,
        )
    }
    return filtered or None


def _strip_unsettable_transition_fields(fields: dict | None, unsettable: set[str]) -> dict | None:
    if not fields or not unsettable:
        return fields
    filtered = {field_id: value for field_id, value in fields.items() if field_id not in unsettable}
    return filtered or None


def _strip_custom_transition_fields(transition: dict, fields: dict | None) -> dict | None:
    """Drop custom fields from a transition payload — last resort before a bare transition."""
    if not fields:
        return None
    field_meta = transition.get("fields") or {}
    filtered: dict = {}
    for field_id, value in fields.items():
        meta = field_meta.get(field_id) or {}
        schema = meta.get("schema") or {}
        if schema.get("custom") or str(field_id).startswith("customfield_"):
            continue
        filtered[field_id] = value
    return filtered or None


def _default_transition_field_value(meta: dict) -> dict | str | None:
    schema = meta.get("schema") or {}
    schema_type = str(schema.get("type") or "").lower()
    if schema_type in ("resolution", "option", "priority") or schema.get("custom"):
        allowed = meta.get("allowedValues") or []
        if not allowed:
            return None
        opt = allowed[0]
        if opt.get("id") is not None:
            return {"id": str(opt["id"])}
        if opt.get("value"):
            return {"value": str(opt["value"])}
    return None


async def _resolve_transition_required_fields(
    jira: JiraClient,
    issue_key: str,
    transition: dict,
    *,
    skip_field_ids: set[str] | None = None,
) -> dict:
    """Build payload for required fields declared on a Jira transition screen."""
    field_meta = transition.get("fields") or {}
    if not field_meta:
        return {}

    dept_field_id: str | None = None
    try:
        dept_field_id = await jira.resolve_field_id(_JIRA_DEPARTMENT_FIELD_NAME)
    except ValueError:
        pass

    payload: dict = {}
    for field_id, meta in field_meta.items():
        if not meta.get("required"):
            continue

        if _is_writeback_transition_field(
            field_id,
            meta,
            dept_field_id=dept_field_id,
            skip_field_ids=skip_field_ids,
        ):
            continue

        schema = meta.get("schema") or {}
        schema_type = str(schema.get("type") or "").lower()

        if schema_type == "resolution":
            allowed = meta.get("allowedValues") or []
            preferred = ("done", "fixed", "complete", "completed")
            chosen = None
            for target in preferred:
                for option in allowed:
                    option_name = str(option.get("name") or "").lower().strip()
                    if option_name == target:
                        chosen = option
                        break
                if chosen:
                    break
            if not chosen and allowed:
                chosen = allowed[0]
            if chosen and chosen.get("id") is not None:
                payload[field_id] = {"id": str(chosen["id"])}
            continue

        if schema_type == "user" and field_id == "assignee":
            try:
                myself = await jira.get_myself()
                account_id = str(myself.get("accountId") or "").strip()
                if account_id:
                    payload[field_id] = {"accountId": account_id}
            except Exception:
                pass
            continue

        default_value = _default_transition_field_value(meta)
        if default_value is not None:
            payload[field_id] = default_value

    return payload


async def _fill_transition_fields_from_issue(
    jira: JiraClient,
    issue_key: str,
    transition: dict,
    payload: dict,
    *,
    skip_field_ids: set[str] | None = None,
) -> dict:
    """Copy existing issue values for required transition fields not yet in the payload."""
    field_meta = transition.get("fields") or {}
    missing = [
        field_id
        for field_id, meta in field_meta.items()
        if meta.get("required") and field_id not in payload
    ]
    if not missing:
        return payload

    issue = await jira.get_issue(issue_key, extra_fields=missing)
    issue_fields = issue.get("fields") or {}

    dept_field_id: str | None = None
    try:
        dept_field_id = await jira.resolve_field_id(_JIRA_DEPARTMENT_FIELD_NAME)
    except ValueError:
        pass

    result = dict(payload)
    for field_id in missing:
        meta = field_meta[field_id]
        if _is_writeback_transition_field(
            field_id,
            meta,
            dept_field_id=dept_field_id,
            skip_field_ids=skip_field_ids,
        ):
            continue

        value = issue_fields.get(field_id)
        if _transition_field_value_usable(value, meta):
            result[field_id] = value
            continue

        default_value = _default_transition_field_value(meta)
        if default_value is not None:
            result[field_id] = default_value

    return result


def _unfilled_required_transition_fields(transition: dict, payload: dict | None) -> list[str]:
    field_meta = transition.get("fields") or {}
    filled = payload or {}
    missing: list[str] = []
    for field_id, meta in field_meta.items():
        if meta.get("required") and field_id not in filled:
            missing.append(str(meta.get("name") or field_id))
    return missing


def _filter_fields_to_transition_screen(transition: dict, fields: dict | None) -> dict | None:
    """Drop fields that are not on this transition's screen — Jira rejects them with 400."""
    if not fields:
        return None
    allowed = set((transition.get("fields") or {}).keys())
    if not allowed:
        return None
    filtered = {field_id: value for field_id, value in fields.items() if field_id in allowed}
    return filtered or None


async def _merge_transition_fields(
    jira: JiraClient,
    issue_key: str,
    transition: dict,
    explicit_fields: dict | None,
    *,
    skip_field_ids: set[str] | None = None,
) -> dict | None:
    skip_ids = skip_field_ids if skip_field_ids is not None else await _transition_skip_field_ids(jira)
    resolved = await _resolve_transition_required_fields(
        jira,
        issue_key,
        transition,
        skip_field_ids=skip_ids,
    )
    resolved = await _fill_transition_fields_from_issue(
        jira,
        issue_key,
        transition,
        resolved,
        skip_field_ids=skip_ids,
    )
    if explicit_fields:
        field_meta = transition.get("fields") or {}
        dept_field_id: str | None = None
        try:
            dept_field_id = await jira.resolve_field_id(_JIRA_DEPARTMENT_FIELD_NAME)
        except ValueError:
            pass
        for field_id, value in explicit_fields.items():
            meta = field_meta.get(field_id) or {}
            if meta.get("required") and not _is_writeback_transition_field(
                field_id,
                meta,
                dept_field_id=dept_field_id,
                skip_field_ids=skip_ids,
            ):
                resolved[field_id] = value
    screened = _filter_fields_to_transition_screen(transition, resolved)
    screened = _strip_skip_fields_from_transition_payload(
        transition,
        screened,
        skip_field_ids=skip_ids,
    )
    return await filter_settable_transition_fields(jira, issue_key, transition, screened)


def _is_in_progress_status(status_name: str) -> bool:
    lowered = status_name.lower().strip().replace("-", " ")
    return "in progress" in lowered or lowered == "progress"


async def ensure_in_progress_status(
    jira: JiraClient,
    issue_key: str,
    current_status: str | None = None,
) -> str:
    """Move issue to In Progress when implementation begins."""
    if current_status and _is_in_progress_status(current_status):
        return current_status

    transition_fields = await _ensure_department_for_estimation(jira, issue_key)
    try:
        return await _transition_issue(
            jira,
            issue_key,
            keyword_sets=_IN_PROGRESS_KEYWORD_SETS,
            exact_names=_IN_PROGRESS_EXACT_NAMES,
            exclude_keywords=_IN_PROGRESS_EXCLUDE,
            label="In Progress",
            transition_fields=transition_fields,
        )
    except PipelineError:
        if transition_fields:
            raise
        fallback_fields = await _department_transition_payload(jira, issue_key)
        if not fallback_fields:
            raise
        return await _transition_issue(
            jira,
            issue_key,
            keyword_sets=_IN_PROGRESS_KEYWORD_SETS,
            exact_names=_IN_PROGRESS_EXACT_NAMES,
            exclude_keywords=_IN_PROGRESS_EXCLUDE,
            label="In Progress",
            transition_fields=fallback_fields,
        )


async def _ensure_department_for_estimation(jira: JiraClient, issue_key: str) -> dict | None:
    """Set Department to Development when missing — required by some Jira workflows."""
    try:
        field_id = await jira.resolve_field_id(_JIRA_DEPARTMENT_FIELD_NAME)
    except ValueError:
        return None

    try:
        issue = await jira.get_issue(issue_key, extra_fields=[field_id])
        current = (issue.get("fields") or {}).get(field_id)
        if not JiraClient.is_select_field_empty(current):
            return None

        try:
            await jira.set_select_field_value(issue_key, field_id, _JIRA_DEPARTMENT_DEFAULT_VALUE)
            return None
        except Exception:
            option_id = await jira._resolve_select_option_id(
                issue_key,
                field_id,
                _JIRA_DEPARTMENT_DEFAULT_VALUE,
            )
            if option_id:
                payload = JiraClient.select_field_payload(
                    _JIRA_DEPARTMENT_DEFAULT_VALUE,
                    option_id=option_id,
                )
                return {field_id: payload}
            return await _department_transition_payload(jira, issue_key)
    except Exception:
        return await _department_transition_payload(jira, issue_key)


async def ensure_in_estimation_status(
    jira: JiraClient,
    issue_key: str,
    current_status: str,
) -> str:
    """Move issue to In Estimation unless it is already in an estimation status."""
    if _is_in_estimation_status(current_status):
        return current_status

    transition_fields = await _ensure_department_for_estimation(jira, issue_key)
    try:
        return await _transition_issue(
            jira,
            issue_key,
            keyword_sets=_IN_ESTIMATION_KEYWORD_SETS,
            exact_names=_IN_ESTIMATION_EXACT_NAMES,
            exclude_keywords=_IN_ESTIMATION_EXCLUDE,
            label="In Estimation",
            transition_fields=transition_fields,
        )
    except PipelineError:
        if transition_fields:
            raise
        fallback_fields = await _department_transition_payload(jira, issue_key)
        if not fallback_fields:
            raise
        return await _transition_issue(
            jira,
            issue_key,
            keyword_sets=_IN_ESTIMATION_KEYWORD_SETS,
            exact_names=_IN_ESTIMATION_EXACT_NAMES,
            exclude_keywords=_IN_ESTIMATION_EXCLUDE,
            label="In Estimation",
            transition_fields=fallback_fields,
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
    development_plan = str(estimate.get("development_plan") or "").strip()
    test_cases = str(estimate.get("test_cases") or "").strip()
    reasoning = str(estimate.get("reasoning") or "").strip()
    hours = estimate.get("hours", "n/a")
    story_points = estimate.get("story_points", "n/a")

    if development_plan or test_cases:
        parts = [
            f"Estimation for {issue_key}: {summary}",
            "",
            f"Story points: {story_points}",
            f"Original estimate: {hours} hours",
        ]
        if reasoning:
            parts.extend(["", "Reasoning:", reasoning])
        if development_plan:
            parts.extend(["", "Development Plan:", development_plan])
        if test_cases:
            parts.extend(["", "Test Cases:", test_cases])
        return "\n".join(parts).strip()

    if jira_comment:
        return jira_comment

    return (
        f"Estimation for {issue_key}: {summary}\n\n"
        f"Story points: {story_points}\n"
        f"Original estimate: {hours} hours\n\n"
        f"Reasoning:\n{reasoning}"
    )


def _ticket_context_for_ai(ctx: dict) -> str:
    return JiraClient.build_ticket_context(
        ctx.get("description", ""),
        ctx.get("jira_comments") or [],
    )


async def _fetch_issue_snapshot(jira: JiraClient, issue_key: str) -> dict:
    issue = await jira.get_issue(issue_key)
    raw_comments = await jira.get_issue_comments(issue_key)
    fields = issue.get("fields", {})
    project = fields.get("project") or {}
    timetracking = fields.get("timetracking") or {}
    attachments = JiraClient.issue_attachments(issue)
    issue_type = fields.get("issuetype") or {}
    snapshot = {
        "issue_id": str(issue.get("id", "")),
        "project_key": project.get("key", issue_key.split("-")[0]),
        "summary": fields.get("summary") or issue_key,
        "description": JiraClient.extract_description(issue),
        "status_name": (fields.get("status") or {}).get("name", ""),
        "issue_type": issue_type.get("name", ""),
        "issue_type_icon": issue_type.get("iconUrl", ""),
        "jira_comments": JiraClient.normalize_comments(raw_comments, attachments),
        "timetracking": timetracking,
    }
    snapshot["has_original_estimate"] = _jira_has_original_estimate(snapshot)
    return snapshot


def _apply_issue_snapshot_to_run(run: DeliveryRun, snapshot: dict) -> dict:
    ctx = dict(run.context_data or {})
    run.summary = snapshot["summary"]
    ctx["summary"] = snapshot["summary"]
    ctx["description"] = snapshot["description"]
    ctx["status_name"] = snapshot["status_name"]
    ctx["issue_type"] = snapshot.get("issue_type") or ""
    ctx["issue_type_icon"] = snapshot.get("issue_type_icon") or ""
    ctx["jira_comments"] = snapshot["jira_comments"]
    ctx["jira_synced_at"] = datetime.now(timezone.utc).isoformat()
    run.context_data = ctx
    return ctx


async def reload_jira_issue(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    return await sync_jira_workflow_state(db, run, session, raise_on_fetch_error=True)


async def sync_jira_workflow_state(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    *,
    raise_on_fetch_error: bool = False,
) -> DeliveryRun:
    run = await _pause_for_deploy_retry_if_needed(db, run)
    if run.status == "running":
        return run

    jira = jira_client_from_session(session)
    try:
        snapshot = await _fetch_issue_snapshot(jira, run.jira_issue_key)
    except Exception as exc:
        if raise_on_fetch_error:
            raise PipelineError(f"Could not reload Jira ticket: {exc}") from exc
        return run

    if _should_restart_for_waiting_for_info(run, snapshot):
        return await restart_after_waiting_for_info_in_jira(db, run, session, snapshot)

    ctx = _apply_issue_snapshot_to_run(run, snapshot)
    _resume_estimation_phase_if_ready(ctx, snapshot)
    run.context_data = ctx

    await db.commit()
    await db.refresh(run)
    run = await resume_post_merge_workflow_if_needed(db, run, session)
    run = await resume_open_pr_review_if_needed(db, run, session)
    return await _auto_prepare_estimation_if_needed(db, run, session, snapshot)


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
            "development_plan": estimate.get("development_plan", ""),
            "test_cases": estimate.get("test_cases", ""),
        },
        run.jira_issue_key,
        data.get("summary") or run.summary,
    )


def _step_completed(run: DeliveryRun, step: str) -> bool:
    for entry in run.steps_log or []:
        if isinstance(entry, dict) and entry.get("step") == step and entry.get("status") == "completed":
            return True
    return False


def _step_resolved(run: DeliveryRun, step: str) -> bool:
    """True when a step finished successfully or was intentionally skipped."""
    status = _latest_step_status(run, step)
    if status == "failed" and step in ("transition_in_testing", "transition_in_progress"):
        return True
    return status in ("completed", "skipped")


def _verification_screenshot_path(run_id: uuid.UUID, environment: str) -> Path:
    env_slug = "beta" if environment.lower() in ("beta", "staging") else "master"
    return _RUN_DATA_ROOT / str(run_id) / f"verification-{env_slug}.png"


def verification_screenshot_file(run_id: uuid.UUID, environment: str) -> Path | None:
    """Return the on-disk verification screenshot when it exists."""
    for candidate in (
        _verification_screenshot_path(run_id, environment),
        _verification_screenshot_path(run_id, "Staging" if environment.lower() in ("beta", "staging") else "Live"),
    ):
        if candidate.is_file():
            return candidate
    return None


def _build_verification_draft_comment(
    environment: str,
    website_url: str,
    analysis: dict,
    filename: str,
) -> str:
    findings = analysis.get("findings") or []
    findings_text = "\n".join(f"- {item}" for item in findings) or "- No specific findings"
    comment = (
        f"[Delivery Manager] {environment} website testing — Unit Testing\n\n"
        f"URL: {website_url}\n"
        f"Result: {'Passed' if analysis.get('passed') else 'Needs review'}\n\n"
        f"{analysis.get('summary', '')}\n\n"
        f"Findings:\n{findings_text}"
    )
    if analysis.get("recommendations"):
        comment += f"\n\nRecommendations:\n{analysis['recommendations']}"
    return comment


def _environment_label_for_target(target: MergeTarget) -> str:
    return "Staging" if target == "beta" else "Live"


def _reset_environment_verification(run: DeliveryRun, ctx: dict, target: MergeTarget) -> None:
    verify_step = "verify_beta" if target == "beta" else "verify_master"
    env_label = _environment_label_for_target(target)
    run.steps_log = [
        entry
        for entry in (run.steps_log or [])
        if not (isinstance(entry, dict) and entry.get("step") == verify_step)
    ]
    ctx["verifications"] = [
        item
        for item in (ctx.get("verifications") or [])
        if not (isinstance(item, dict) and item.get("environment") == env_label)
    ]
    ctx.pop("pending_verification", None)
    ctx.pop(f"{env_label.lower()}_verification", None)


def _latest_step_status(run: DeliveryRun, step: str) -> str | None:
    for entry in reversed(run.steps_log or []):
        if isinstance(entry, dict) and entry.get("step") == step:
            return entry.get("status")
    return None


def _hydrate_merge_flags_from_steps(run: DeliveryRun, ctx: dict) -> None:
    if _step_completed(run, "merge_beta_pr"):
        ctx["beta_merged"] = True
    if _step_completed(run, "merge_master_pr"):
        ctx["master_merged"] = True


def _has_merge_progress(run: DeliveryRun, ctx: dict | None = None) -> bool:
    data = ctx if ctx is not None else (run.context_data or {})
    return bool(
        data.get("beta_merged")
        or data.get("master_merged")
        or _step_completed(run, "merge_beta_pr")
        or _step_completed(run, "merge_master_pr")
    )


def _deploy_required_for_target(
    mapping: ProjectRepoMapping | dict,
    target: Literal["beta", "master"],
    ctx: dict,
) -> bool:
    if target == "beta":
        if not ctx.get("beta_merged"):
            return False
    elif not ctx.get("master_merged") and not (
        is_unified_deploy_target(mapping) and ctx.get("beta_merged")
    ):
        return False
    if deploy_configured(mapping, target):
        return True
    return bool(deploy_commands_for_environment(mapping, target).strip())


def _deploy_step_succeeded(run: DeliveryRun, deploy_step: str) -> bool:
    return _latest_step_status(run, deploy_step) == "completed"


def _all_required_deployments_succeeded(
    run: DeliveryRun,
    ctx: dict,
    mapping: ProjectRepoMapping | dict,
) -> bool:
    for target, deploy_step in (("beta", "deploy_beta"), ("master", "deploy_master")):
        if not _deploy_required_for_target(mapping, target, ctx):
            continue
        if not _deploy_step_succeeded(run, deploy_step):
            return False
    return True


def _infer_pending_deploy_target(
    run: DeliveryRun,
    ctx: dict,
    mapping: ProjectRepoMapping | dict,
) -> str | None:
    pending = ctx.get("pending_deploy_retry")
    if pending in ("beta", "master"):
        return pending
    for deploy_step, target in (("deploy_beta", "beta"), ("deploy_master", "master")):
        if _latest_step_status(run, deploy_step) == "failed":
            return target
    for target, deploy_step in (("beta", "deploy_beta"), ("master", "deploy_master")):
        if not _deploy_required_for_target(mapping, target, ctx):
            continue
        if not _deploy_step_succeeded(run, deploy_step):
            return target
    return None


_INTERRUPTED_DEPLOY_MESSAGE = (
    "Deployment did not finish. Click Retry deployment to run deployment commands again."
)


def _mark_deploy_step_failed(run: DeliveryRun, deploy_step: str, message: str) -> bool:
    steps = list(run.steps_log or [])
    changed = False
    for index in range(len(steps) - 1, -1, -1):
        entry = steps[index]
        if (
            isinstance(entry, dict)
            and entry.get("step") == deploy_step
            and entry.get("status") == "running"
        ):
            steps[index] = {
                **entry,
                "status": "failed",
                "message": message,
                "at": datetime.now(timezone.utc).isoformat(),
            }
            changed = True
            break
    if changed:
        run.steps_log = steps
        flag_modified(run, "steps_log")
    return changed


def _reconcile_interrupted_deployment_state(run: DeliveryRun, ctx: dict) -> bool:
    """Mark interrupted deployments as failed; never auto-runs deploy commands."""
    _hydrate_merge_flags_from_steps(run, ctx)
    if not _has_merge_progress(run, ctx):
        return False

    pending = ctx.get("pending_deploy_retry")
    if pending not in ("beta", "master"):
        for deploy_step, target in (("deploy_beta", "beta"), ("deploy_master", "master")):
            if _latest_step_status(run, deploy_step) == "failed":
                pending = target
                break
    if pending not in ("beta", "master"):
        return False

    deploy_step = "deploy_beta" if pending == "beta" else "deploy_master"
    deploy_status = _latest_step_status(run, deploy_step)
    if deploy_status not in ("running", "failed"):
        ctx["pending_deploy_retry"] = pending
        ctx["workflow_phase"] = "pr_review"
        return run.status == "running"

    changed = False
    if deploy_status == "running":
        changed = _mark_deploy_step_failed(run, deploy_step, _INTERRUPTED_DEPLOY_MESSAGE)

    history = list(ctx.get("deployment_history") or [])
    for index in range(len(history) - 1, -1, -1):
        entry = history[index]
        if entry.get("environment") == pending and entry.get("status") == "running":
            history[index] = {
                **entry,
                "status": "failed",
                "error": entry.get("error") or _INTERRUPTED_DEPLOY_MESSAGE,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            changed = True
            break
    if changed:
        ctx["deployment_history"] = history

    ctx["pending_deploy_retry"] = pending
    ctx["workflow_phase"] = "pr_review"
    return changed or run.status == "running"


async def _pause_for_deploy_retry_if_needed(
    db: AsyncSession,
    run: DeliveryRun,
) -> DeliveryRun:
    """Ensure failed/interrupted deployments wait for an explicit user retry."""
    ctx = dict(run.context_data or {})
    if not _reconcile_interrupted_deployment_state(run, ctx):
        return run

    run.context_data = ctx
    run.status = "awaiting_approval"
    if not run.error_message:
        deploy_step = "deploy_beta" if ctx.get("pending_deploy_retry") == "beta" else "deploy_master"
        for entry in reversed(run.steps_log or []):
            if isinstance(entry, dict) and entry.get("step") == deploy_step and entry.get("status") == "failed":
                run.error_message = str(entry.get("message") or _INTERRUPTED_DEPLOY_MESSAGE)
                break
        else:
            run.error_message = _INTERRUPTED_DEPLOY_MESSAGE
    await db.commit()
    await db.refresh(run)
    return run


def has_pending_post_merge_work(run: DeliveryRun) -> bool:
    """True when PR merge started but delivery (deploy/verify/finish) is not complete."""
    ctx = dict(run.context_data or {})
    _hydrate_merge_flags_from_steps(run, ctx)
    if not _has_merge_progress(run, ctx):
        return False
    return not (run.status == "completed" and get_workflow_phase(run) == "completed")


def _hydrate_ctx_from_steps(run: DeliveryRun, ctx: dict) -> None:
    """Restore step outputs from steps_log when resuming a failed run."""
    for entry in run.steps_log or []:
        if not isinstance(entry, dict) or entry.get("status") != "completed":
            continue
        data = entry.get("data")
        if isinstance(data, dict):
            ctx.update(data)


async def _persist_context(db: AsyncSession, run: DeliveryRun, ctx: dict) -> None:
    run.context_data = ctx
    await db.commit()


async def _complete_step(
    db: AsyncSession,
    run: DeliveryRun,
    ctx: dict,
    step: str,
    message: str,
    data: dict | None = None,
) -> None:
    if data:
        ctx.update(data)
    run.context_data = ctx
    await _log_step(db, run, step, "completed", message, data=data or None)


REVISION_STEPS: list[tuple[str, str]] = [
    ("revision_prepare", "Prepare revision context"),
    ("revision_generate", "Generate code changes"),
    ("revision_commit", "Commit changes to branch"),
    ("revision_delete", "Remove requested files"),
    ("revision_refresh", "Refresh changed files"),
]

REDEVELOPMENT_RESET_STEPS = frozenset({
    "repo_stack",
    "cursor_development",
    "generate_code",
    "commit_changes",
    "confirm_local_changes",
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


def _invalidate_generated_code_steps(run: DeliveryRun) -> None:
    _invalidate_steps(
        run,
        frozenset({"commit_changes", "confirm_local_changes", "create_pr_beta", "create_pr_master"}),
    )


def reset_for_redevelopment(run: DeliveryRun, ctx: dict, *, notice: str = "") -> None:
    """Reset implementation/PR steps but keep estimation and the feature branch."""
    branch_name = run.branch_name or ctx.get("branch_name")
    preserved: dict = {
        "workflow_phase": "ready_for_implementation",
        "summary": ctx.get("summary") or run.summary,
        "description": ctx.get("description", ""),
        "jira_comments": ctx.get("jira_comments", []),
        "status_name": ctx.get("status_name"),
        "mapping": ctx.get("mapping"),
        "estimation_prepared": ctx.get("estimation_prepared", True),
        "estimate": ctx.get("estimate"),
        "draft_comment": ctx.get("draft_comment"),
        "impact_analysis": ctx.get("impact_analysis"),
        "impact_analysis_field": ctx.get("impact_analysis_field"),
        "branch_name": branch_name,
        "ui_active_step": 2,
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

    if attempt_decline and bitbucket_configured(session) and mapping:
        bitbucket = _bitbucket_client(session)
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
    _touch_ui_active_step(run, step, status)
    run.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(run)


async def _jira_comment(jira: JiraClient, issue_key: str, body: str) -> None:
    try:
        await jira.add_comment(issue_key, body)
    except Exception as exc:
        raise PipelineError(f"Jira comment failed: {exc}") from exc


def _is_admin_related_path(path: str) -> bool:
    normalized = path.strip().lstrip("/").lower()
    if not normalized:
        return False
    segments = normalized.split("/")
    if "admin" in segments:
        return True
    return segments[-1] == "system.xml"


def _admin_related_changed_paths(changed_files: list) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for item in changed_files:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip().lstrip("/")
        if not path or path in seen or not _is_admin_related_path(path):
            continue
        seen.add(path)
        paths.append(path)
    return paths


def _build_admin_database_field_content(paths: list[str]) -> str:
    return "\n".join(path for path in paths if path.strip())


async def _update_admin_database_field(
    jira: JiraClient,
    issue_key: str,
    paths: list[str],
    *,
    configured_field_id: str | None = None,
) -> str:
    text = _build_admin_database_field_content(paths)
    if not text:
        return ""

    try:
        field_id = await jira.resolve_field_id(
            ("Admin/ Database", "Admin/Database", "Admin Database"),
            configured_field_id,
        )
    except ValueError as exc:
        raise PipelineError(str(exc)) from exc

    try:
        await jira.set_paragraph_field(issue_key, field_id, text)
    except Exception as exc:
        raise PipelineError(f"Failed to update Admin/ Database field: {exc}") from exc

    return field_id


def _build_unit_testing_field_content(verifications: list[dict]) -> str:
    sections: list[str] = []
    for item in verifications:
        if not isinstance(item, dict):
            continue
        comment = str(item.get("comment") or "").strip()
        if not comment:
            continue
        environment = str(item.get("environment") or "Site").strip()
        sections.append(f"{environment}\n\n{comment}")
    return "\n\n---\n\n".join(sections)


async def _update_unit_testing_field(
    jira: JiraClient,
    issue_key: str,
    verifications: list[dict],
    *,
    configured_field_id: str | None = None,
) -> str:
    text = _build_unit_testing_field_content(verifications)
    if not text:
        return ""

    try:
        field_id = await jira.resolve_field_id(
            ("Unit Testing Field", "Unit Testing"),
            configured_field_id,
        )
    except ValueError as exc:
        raise PipelineError(str(exc)) from exc

    try:
        await jira.set_paragraph_field(issue_key, field_id, text)
    except Exception as exc:
        raise PipelineError(f"Failed to update Unit Testing Field: {exc}") from exc

    return field_id


async def _post_jira_transition(
    jira: JiraClient,
    issue_key: str,
    transition_id: str,
    fields: dict | None,
) -> None:
    fields_attempt = fields
    for _ in range(5):
        try:
            await jira.transition_issue(issue_key, transition_id, fields=fields_attempt)
            return
        except Exception as exc:
            unsettable = _parse_jira_unsettable_fields(exc)
            if not unsettable or not fields_attempt:
                raise
            stripped = _strip_unsettable_transition_fields(fields_attempt, unsettable)
            if stripped == fields_attempt:
                raise
            fields_attempt = stripped


async def _transition_issue(
    jira: JiraClient,
    issue_key: str,
    *keywords: str,
    fallback_keywords: tuple[str, ...] | None = None,
    keyword_sets: tuple[tuple[str, ...], ...] | None = None,
    exact_names: tuple[str, ...] | None = None,
    exclude_keywords: tuple[str, ...] | None = None,
    label: str | None = None,
    transition_fields: dict | None = None,
    db: AsyncSession | None = None,
) -> str:
    try:
        transitions = await jira.get_transitions(issue_key, expand_fields=True)
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

    skip_field_ids = await _transition_skip_field_ids(jira, db)
    merged_fields = await _merge_transition_fields(
        jira,
        issue_key,
        transition,
        transition_fields,
        skip_field_ids=skip_field_ids,
    )

    transition_name = transition.get("name", label or "target status")
    try:
        await _post_jira_transition(jira, issue_key, transition["id"], merged_fields)
    except Exception as exc:
        unsettable = _parse_jira_unsettable_fields(exc)
        expanded_skip = set(skip_field_ids or set()) | unsettable

        retry_fields = await filter_settable_transition_fields(
            jira,
            issue_key,
            transition,
            _strip_skip_fields_from_transition_payload(
                transition,
                _filter_fields_to_transition_screen(
                    transition,
                    await _fill_transition_fields_from_issue(
                        jira,
                        issue_key,
                        transition,
                        merged_fields or {},
                        skip_field_ids=expanded_skip,
                    ),
                ),
                skip_field_ids=expanded_skip,
            ),
        )

        for fields_attempt in (
            retry_fields,
            _strip_custom_transition_fields(transition, retry_fields or merged_fields),
            None,
        ):
            if fields_attempt == (merged_fields or {}):
                continue
            try:
                await _post_jira_transition(jira, issue_key, transition["id"], fields_attempt)
                return transition["name"]
            except Exception as retry_exc:
                exc = retry_exc
                expanded_skip |= _parse_jira_unsettable_fields(retry_exc)

        missing = _unfilled_required_transition_fields(
            transition,
            retry_fields if retry_fields != (merged_fields or {}) else merged_fields,
        )
        detail = f" Missing required fields: {', '.join(missing)}." if missing else ""
        raise PipelineError(
            f"Jira transition to {transition_name} failed: {exc}.{detail}"
        ) from exc
    return transition["name"]


async def prepare_estimation(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    if get_workflow_phase(run) not in ("estimation", "", "waiting_for_info"):
        return run

    ctx = dict(run.context_data or {})
    if ctx.get("estimation_prepared"):
        if not str(ctx.get("draft_comment") or "").strip():
            ctx["draft_comment"] = resolve_draft_comment(run, ctx)
            run.context_data = ctx
            await db.commit()
            await db.refresh(run)
        return run

    if not openai_configured(session):
        raise PipelineError("OpenAI API key is not configured. Add it in Settings.")

    jira = jira_client_from_session(session)
    run.status = "running"
    run.error_message = None
    await db.commit()

    try:
        await _log_step(db, run, "fetch_issue", "running", "Loading ticket details...")
        snapshot = await _fetch_issue_snapshot(jira, run.jira_issue_key)
        summary = snapshot["summary"]
        description = snapshot["description"]
        status_name = snapshot["status_name"]
        run.summary = summary
        ctx["summary"] = summary
        ctx["description"] = description
        ctx["status_name"] = status_name
        ctx["jira_comments"] = snapshot["jira_comments"]
        ctx["jira_synced_at"] = datetime.now(timezone.utc).isoformat()
        await db.commit()

        waiting_in_jira = _is_waiting_for_info_status(status_name)

        if not waiting_in_jira and not _is_in_estimation_status(status_name):
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
        openai = _openai_client(session)
        estimate = await openai.estimate_issue(
            run.jira_issue_key,
            summary,
            description,
            jira_comments=JiraClient.format_comments_for_ai(snapshot["jira_comments"]),
        )
        run.estimation_hours = estimate["hours"]
        run.estimation_summary = estimate["reasoning"]
        ctx["estimate"] = estimate
        ctx["draft_comment"] = _build_draft_comment(estimate, run.jira_issue_key, summary)
        ctx["draft_question"] = estimate.get("clarification_question", "")
        ctx["needs_clarification"] = estimate.get("needs_clarification", False)
        ctx["workflow_phase"] = "waiting_for_info" if waiting_in_jira else "estimation"
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


async def _step_write_impact_analysis(db, run, jira, ctx, session) -> tuple[str, dict]:
    if not openai_configured(session):
        raise PipelineError("OpenAI API key is not configured. Add it in Settings.")

    estimate = ctx.get("estimate") or {}
    openai = _openai_client(session)
    analysis = await openai.generate_impact_analysis(
        run.jira_issue_key,
        ctx.get("summary", run.summary),
        _ticket_context_for_ai(ctx),
        run.estimation_hours,
        run.estimation_summary or estimate.get("reasoning", ""),
    )
    text = analysis.get("impact_analysis", "").strip()
    if not text:
        raise PipelineError("Impact analysis could not be generated")

    try:
        field_id = await jira.resolve_field_id(
            "Impact Analysis",
            await jira_impact_analysis_field_id(db),
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
    run = await resume_open_pr_review_if_needed(db, run, session)
    if get_workflow_phase(run) == "pr_review":
        return run

    phase = get_workflow_phase(run)
    resuming = phase in ("implementation", "local_development") and run.status == "failed"
    if phase not in ("ready_for_implementation", "waiting_for_info") and not resuming:
        raise PipelineError("Complete estimation before starting implementation")

    jira = jira_client_from_session(session)
    ctx = dict(run.context_data or {})
    if resuming:
        _hydrate_ctx_from_steps(run, ctx)

    if _step_completed(run, "confirm_local_changes") and get_workflow_phase(run) == "local_development":
        run.status = "running"
        run.error_message = None
        ctx["workflow_phase"] = "local_development"
        run.context_data = ctx
        await db.commit()
        return await _complete_pr_creation(db, run, jira, ctx, session)

    run.status = "running"
    run.error_message = None
    ctx["workflow_phase"] = "implementation"
    run.context_data = ctx
    await db.commit()

    mapping = await _resolve_run_mapping(db, run, ctx)
    if mapping and not ctx.get("mapping"):
        ctx["mapping"] = mapping
        run.context_data = ctx
        await db.commit()
    if mapping and bitbucket_configured(session):
        bitbucket = _bitbucket_client(session)
        if await _forget_inactive_tracked_prs(bitbucket, mapping, run, ctx):
            run.context_data = ctx
            await db.commit()

    try:
        snapshot = await _fetch_issue_snapshot(jira, run.jira_issue_key)
        ctx["summary"] = snapshot["summary"]
        ctx["description"] = snapshot["description"]
        ctx["status_name"] = snapshot["status_name"]
        ctx["jira_comments"] = snapshot["jira_comments"]
        ctx["jira_synced_at"] = datetime.now(timezone.utc).isoformat()
        run.summary = snapshot["summary"]
        run.context_data = ctx
        await db.commit()

        if not _step_completed(run, "impact_analysis"):
            result = await _step_write_impact_analysis(db, run, jira, ctx, session)
            await _complete_step(db, run, ctx, "impact_analysis", result[0], result[1] or None)

        if not _step_resolved(run, "transition_in_progress"):
            try:
                new_status = await ensure_in_progress_status(
                    jira,
                    run.jira_issue_key,
                    ctx.get("status_name"),
                )
                ctx["status_name"] = new_status
                await _persist_context(db, run, ctx)
                await _log_step(db, run, "transition_in_progress", "completed", f"Status: {new_status}")
            except Exception:
                try:
                    snapshot = await _fetch_issue_snapshot(jira, run.jira_issue_key)
                    ctx["status_name"] = snapshot["status_name"]
                    ctx["jira_synced_at"] = datetime.now(timezone.utc).isoformat()
                except Exception:
                    pass
                if _is_in_progress_status(str(ctx.get("status_name") or "")):
                    await _persist_context(db, run, ctx)
                    await _log_step(
                        db,
                        run,
                        "transition_in_progress",
                        "completed",
                        f"Status: {ctx['status_name']}",
                    )
                else:
                    await _persist_context(db, run, ctx)
                    await _log_step(
                        db,
                        run,
                        "transition_in_progress",
                        "skipped",
                        "Jira status transition skipped; continuing implementation",
                    )

        if not _step_completed(run, "resolve_mapping"):
            result = await _step_resolve_mapping(db, run, jira, ctx)
            await _complete_step(db, run, ctx, "resolve_mapping", result[0], result[1] or None)

        if not _step_completed(run, "create_branch"):
            result = await _step_create_branch(db, run, jira, ctx, session)
            await _complete_step(db, run, ctx, "create_branch", result[0], result[1] or None)

        if bitbucket_configured(session) and not _step_completed(run, "repo_stack"):
            result = await _step_repo_stack(db, run, jira, ctx, session)
            await _complete_step(db, run, ctx, "repo_stack", result[0], result[1] or None)

        dev_automated = cursor_configured(session) or openai_configured(session)
        if dev_automated:
            if not _step_completed(run, "cursor_development"):
                result = await _step_cursor_development(db, run, jira, ctx, session)
                await _complete_step(db, run, ctx, "cursor_development", result[0], result[1] or None)

            if (ctx.get("development_result") or {}).get("source") != "cursor_sdk":
                if not _step_completed(run, "generate_code"):
                    result = await _step_generate_code(db, run, jira, ctx, session)
                    await _complete_step(db, run, ctx, "generate_code", result[0], result[1] or None)
        elif not _step_completed(run, "cursor_development"):
            await _log_step(
                db,
                run,
                "cursor_development",
                "skipped",
                "Develop changes in your local project, then create pull requests when ready",
            )

        await _prepare_local_development(db, run, ctx, session)

        if not _step_completed(run, "confirm_local_changes"):
            return await _pause_for_local_confirmation(db, run, ctx)

        return await _complete_pr_creation(db, run, jira, ctx, session)

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


async def _refresh_run_changed_files(
    run: DeliveryRun,
    ctx: dict,
    session: dict,
) -> None:
    mapping = ctx.get("mapping") or {}
    branch_name = run.branch_name or ctx.get("branch_name")
    if not branch_name or not mapping or not bitbucket_configured(session):
        return

    bitbucket = _bitbucket_client(session)
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


def _populate_changed_files_from_code_result(ctx: dict) -> None:
    files = (ctx.get("code_result") or {}).get("files") or []
    if not files or ctx.get("changed_files"):
        return
    ctx["changed_files"] = [
        {"path": f["path"], "action": f.get("action", "modify")}
        for f in files
        if isinstance(f, dict) and f.get("path")
    ]
    if ctx["changed_files"]:
        ctx["changed_files_refreshed_at"] = datetime.now(timezone.utc).isoformat()


async def _prepare_local_development(
    db: AsyncSession,
    run: DeliveryRun,
    ctx: dict,
    session: dict,
) -> None:
    """After code generation: surface changed files for review before opening pull requests."""
    _populate_changed_files_from_code_result(ctx)
    if _step_completed(run, "commit_changes"):
        await _refresh_run_changed_files(run, ctx, session)
    elif not ctx.get("changed_files"):
        await _refresh_run_changed_files(run, ctx, session)
        _populate_changed_files_from_code_result(ctx)

    run.context_data = ctx
    await db.commit()


async def _commit_pending_changes(
    db: AsyncSession,
    run: DeliveryRun,
    jira: JiraClient,
    ctx: dict,
    session: dict,
) -> None:
    """Commit generated changes to the feature branch via Bitbucket API."""
    if _step_completed(run, "commit_changes"):
        return

    code_result = ctx.get("code_result") or {}
    files = code_result.get("files") or []
    if not files and _step_completed(run, "cursor_development") and not _step_completed(run, "generate_code"):
        await _complete_step(
            db,
            run,
            ctx,
            "commit_changes",
            "Changes committed on the feature branch by Cursor SDK",
        )
        return

    result = await _step_commit_changes(db, run, jira, ctx, session)
    await _complete_step(db, run, ctx, "commit_changes", result[0], result[1] or None)


async def _pause_for_local_confirmation(
    db: AsyncSession,
    run: DeliveryRun,
    ctx: dict,
) -> DeliveryRun:
    branch_name = run.branch_name or ctx.get("branch_name") or "feature branch"
    ctx["workflow_phase"] = "local_development"
    run.context_data = ctx
    run.status = "awaiting_approval"
    run.error_message = None
    await _log_step(
        db,
        run,
        "confirm_local_changes",
        "running",
        f"Branch `{branch_name}` is ready — review the generated changes, then create pull requests",
    )
    await db.commit()
    await db.refresh(run)
    return run


async def _complete_pr_creation(
    db: AsyncSession,
    run: DeliveryRun,
    jira: JiraClient,
    ctx: dict,
    session: dict,
) -> DeliveryRun:
    if not _step_completed(run, "create_pr_beta"):
        result = await _step_create_pr_beta(db, run, jira, ctx, session)
        await _complete_step(db, run, ctx, "create_pr_beta", result[0], result[1] or None)

    if not _step_completed(run, "create_pr_master"):
        result = await _step_create_pr_master(db, run, jira, ctx, session)
        await _complete_step(db, run, ctx, "create_pr_master", result[0], result[1] or None)

    await _refresh_run_changed_files(run, ctx, session)

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


async def create_prs_from_local(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    if get_workflow_phase(run) != "local_development":
        raise PipelineError("Run is not in local development")
    if run.status == "running":
        raise PipelineError("A step is already running")

    jira = jira_client_from_session(session)
    ctx = dict(run.context_data or {})
    if _step_completed(run, "confirm_local_changes"):
        run.status = "running"
        run.error_message = None
        await db.commit()
        return await _complete_pr_creation(db, run, jira, ctx, session)

    run.status = "running"
    run.error_message = None
    await db.commit()

    try:
        await _commit_pending_changes(db, run, jira, ctx, session)
        await _refresh_run_changed_files(run, ctx, session)
        branch_name = run.branch_name or ctx.get("branch_name")
        file_count = len(ctx.get("changed_files") or [])
        message = (
            f"Ready to open pull requests for `{branch_name or 'feature branch'}`"
            if file_count == 0
            else f"Opening pull requests — {file_count} file(s) on `{branch_name}`"
        )
        await _complete_step(db, run, ctx, "confirm_local_changes", message)
        return await _complete_pr_creation(db, run, jira, ctx, session)
    except PipelineError as exc:
        run.status = "awaiting_approval"
        run.error_message = str(exc)
        await _log_step(db, run, "confirm_local_changes", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise
    except Exception as exc:
        run.status = "awaiting_approval"
        run.error_message = str(exc)
        await _log_step(db, run, "confirm_local_changes", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise PipelineError(str(exc)) from exc


async def confirm_local_and_create_prs(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    """Backward-compatible alias for create_prs_from_local."""
    return await create_prs_from_local(db, run, session)


def _pr_ids_for_run(run: DeliveryRun, ctx: dict) -> tuple[int | None, int | None]:
    beta_pr_id = ctx.get("beta_pr_id") or run.pr_id
    master_pr_id = ctx.get("master_pr_id")
    return (
        int(beta_pr_id) if beta_pr_id else None,
        int(master_pr_id) if master_pr_id else None,
    )


def _clear_beta_pr_refs(ctx: dict, run: DeliveryRun) -> None:
    for key in ("beta_pr_id", "beta_pr_url", "pr_id", "pr_url"):
        ctx.pop(key, None)
    run.pr_id = None
    run.pr_url = None


def _clear_master_pr_refs(ctx: dict) -> None:
    ctx.pop("master_pr_id", None)
    ctx.pop("master_pr_url", None)


async def _load_open_pr(
    bitbucket: BitbucketClient,
    mapping: dict,
    pr_id: int | None,
) -> dict | None:
    if not pr_id:
        return None
    pr = await bitbucket.get_pull_request_safe(
        mapping["workspace"],
        mapping["repo_slug"],
        int(pr_id),
    )
    if pr and BitbucketClient.is_pull_request_open(pr):
        return pr
    return None


async def _discover_open_prs_for_branch(
    bitbucket: BitbucketClient,
    mapping: dict,
    branch_name: str,
    *,
    beta_pr: dict | None = None,
    master_pr: dict | None = None,
    beta_merged: bool = False,
    master_merged: bool = False,
) -> tuple[dict | None, dict | None]:
    """Find open staging/live PRs for a feature branch."""
    found_beta = beta_pr
    found_master = master_pr
    try:
        open_prs = await bitbucket.list_open_pull_requests_for_branch(
            mapping["workspace"],
            mapping["repo_slug"],
            branch_name,
        )
    except Exception:
        return found_beta, found_master

    for pr in open_prs:
        dest = ((pr.get("destination") or {}).get("branch") or {}).get("name", "")
        if not found_beta and not beta_merged and dest == mapping["beta_branch"]:
            found_beta = pr
        elif (
            not found_master
            and not master_merged
            and not is_unified_deploy_target(mapping)
            and dest == mapping["master_branch"]
        ):
            found_master = pr
    return found_beta, found_master


def _apply_open_pr_refs(
    run: DeliveryRun,
    ctx: dict,
    *,
    beta_pr: dict | None,
    master_pr: dict | None,
) -> None:
    if beta_pr:
        beta_pr_id = beta_pr.get("id")
        beta_pr_url = BitbucketClient.pr_html_url(beta_pr)
        if beta_pr_id:
            ctx["beta_pr_id"] = int(beta_pr_id)
            ctx["beta_pr_url"] = beta_pr_url
            ctx["pr_id"] = int(beta_pr_id)
            ctx["pr_url"] = beta_pr_url
            run.pr_id = int(beta_pr_id)
            run.pr_url = beta_pr_url
    if master_pr:
        master_pr_id = master_pr.get("id")
        master_pr_url = BitbucketClient.pr_html_url(master_pr)
        if master_pr_id:
            ctx["master_pr_id"] = int(master_pr_id)
            ctx["master_pr_url"] = master_pr_url


async def resume_post_merge_workflow_if_needed(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    """Restore PR-review UI after merge when delivery is unfinished; deploy only on explicit retry."""
    run = await _pause_for_deploy_retry_if_needed(db, run)
    if run.status == "running":
        return run
    if run.status == "completed" and get_workflow_phase(run) == "completed":
        return run

    ctx = dict(run.context_data or {})
    _hydrate_merge_flags_from_steps(run, ctx)
    if not _has_merge_progress(run, ctx):
        return run

    mapping = await _resolve_run_mapping(db, run, ctx)
    ctx["workflow_phase"] = "pr_review"
    ctx["estimation_prepared"] = True
    try:
        mapping_row = await _load_fresh_mapping(db, run.project_key)
    except PipelineError:
        mapping_row = None
    if mapping_row:
        pending = _infer_pending_deploy_target(run, ctx, mapping_row)
        if pending:
            ctx["pending_deploy_retry"] = pending

    run.context_data = ctx
    if run.status in ("failed", "active"):
        run.status = "awaiting_approval"
    run.error_message = None
    await db.commit()
    await db.refresh(run)

    if mapping and bitbucket_configured(session):
        try:
            bitbucket = _bitbucket_client(session)
            run = await _sync_pr_changed_files(db, run, dict(run.context_data or {}), mapping, bitbucket)
            await db.refresh(run)
        except Exception:
            pass
    return run


async def resume_open_pr_review_if_needed(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
) -> DeliveryRun:
    """When open PRs already exist, skip earlier workflow phases and show PR review."""
    phase = get_workflow_phase(run)
    if phase in ("pr_review", "completed"):
        return run
    if run.status == "running":
        return run

    ctx = dict(run.context_data or {})
    mapping = await _resolve_run_mapping(db, run, ctx)
    if not mapping or not bitbucket_configured(session):
        return run

    bitbucket = _bitbucket_client(session)
    branch_name = run.branch_name or ctx.get("branch_name")

    beta_pr = await _load_open_pr(
        bitbucket,
        mapping,
        ctx.get("beta_pr_id") or run.pr_id,
    ) if not ctx.get("beta_merged") else None
    master_pr = await _load_open_pr(
        bitbucket,
        mapping,
        ctx.get("master_pr_id"),
    ) if not ctx.get("master_merged") else None

    if not branch_name:
        for pr in (beta_pr, master_pr):
            if pr:
                branch_name = ((pr.get("source") or {}).get("branch") or {}).get("name")
                if branch_name:
                    break

    if branch_name and (not beta_pr or (not master_pr and not is_unified_deploy_target(mapping))):
        beta_pr, master_pr = await _discover_open_prs_for_branch(
            bitbucket,
            mapping,
            branch_name,
            beta_pr=beta_pr,
            master_pr=master_pr,
            beta_merged=bool(ctx.get("beta_merged")),
            master_merged=bool(ctx.get("master_merged")),
        )

    if not beta_pr and not master_pr:
        return run

    if branch_name:
        run.branch_name = branch_name
        ctx["branch_name"] = branch_name

    _apply_open_pr_refs(run, ctx, beta_pr=beta_pr, master_pr=master_pr)
    ctx["workflow_phase"] = "pr_review"
    ctx["estimation_prepared"] = True
    run.status = "awaiting_approval"
    run.error_message = None
    run.context_data = ctx
    await db.commit()
    await db.refresh(run)

    return await _sync_pr_changed_files(db, run, dict(run.context_data or {}), mapping, bitbucket)


async def _forget_inactive_tracked_prs(
    bitbucket: BitbucketClient,
    mapping: dict,
    run: DeliveryRun,
    ctx: dict,
) -> bool:
    """Drop stored PR ids that are no longer open so the same branch can get fresh PRs."""
    workspace = mapping["workspace"]
    repo_slug = mapping["repo_slug"]
    changed = False
    beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)

    if beta_pr_id and not ctx.get("beta_merged"):
        pr = await bitbucket.get_pull_request_safe(workspace, repo_slug, int(beta_pr_id))
        if BitbucketClient.is_pull_request_inactive(pr):
            _clear_beta_pr_refs(ctx, run)
            _invalidate_steps(run, frozenset({"create_pr_beta"}))
            changed = True

    if master_pr_id and not ctx.get("master_merged"):
        pr = await bitbucket.get_pull_request_safe(workspace, repo_slug, int(master_pr_id))
        if BitbucketClient.is_pull_request_inactive(pr):
            _clear_master_pr_refs(ctx)
            _invalidate_steps(run, frozenset({"create_pr_master"}))
            changed = True

    return changed


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
        pr = await bitbucket.get_pull_request_safe(workspace, repo_slug, int(beta_pr_id))
        if BitbucketClient.is_pull_request_inactive(pr):
            already_closed.append(f"Beta PR #{beta_pr_id}")
        else:
            outcome = await bitbucket.decline_pull_request_if_open(
                workspace, repo_slug, int(beta_pr_id), message
            )
            if outcome == "declined":
                declined.append(f"Beta PR #{beta_pr_id}")
            else:
                already_closed.append(f"Beta PR #{beta_pr_id}")

    if master_pr_id and not ctx.get("master_merged"):
        pr = await bitbucket.get_pull_request_safe(workspace, repo_slug, int(master_pr_id))
        if BitbucketClient.is_pull_request_inactive(pr):
            already_closed.append(f"Live PR #{master_pr_id}")
        else:
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


def _bitbucket_deploy_credentials(session: dict) -> tuple[str, str] | None:
    return bitbucket_git_credentials(session)


async def _run_environment_deploy_step(
    db: AsyncSession,
    run: DeliveryRun,
    mapping: ProjectRepoMapping,
    target: Literal["beta", "master"],
    env_label: str,
    deploy_step: str,
    session: dict,
    *,
    trigger: str = "merge",
) -> None:
    mapping = await _load_fresh_mapping(db, run.project_key)
    commands = await fetch_deploy_commands_from_db(db, run.project_key, target)
    _prune_deploy_step_logs(run, deploy_step)

    bitbucket_credentials = _bitbucket_deploy_credentials(session)
    if commands_need_bitbucket_auth(commands) and not bitbucket_credentials:
        raise PipelineError(
            "Deployment includes git commands that require Bitbucket authentication. "
            "Add your Atlassian account email and Bitbucket API token in Settings."
        )

    ctx = dict(run.context_data or {})
    started_at = datetime.now(timezone.utc).isoformat()
    history_entry: dict = {
        "id": started_at,
        "environment": target,
        "environment_label": env_label,
        "trigger": trigger,
        "status": "running",
        "started_at": started_at,
        "planned_commands": commands,
        "commands": [],
    }
    history = list(ctx.get("deployment_history") or [])
    history.append(history_entry)
    ctx["deployment_history"] = history
    run.context_data = ctx
    await db.commit()
    await db.refresh(run)

    if deploy_configured(mapping, target):
        await _log_step(db, run, deploy_step, "running", f"Running {env_label} deployment commands…")

        async def on_command_progress(
            status: str,
            index: int,
            total: int,
            command: str,
            output: str,
        ) -> None:
            step_id = f"{deploy_step}_cmd_{index}"
            if status == "running":
                message = f"({index + 1}/{total}) {command}"
            elif status == "failed":
                message = output or f"Failed: {command}"
            else:
                message = output or f"Completed: {command}"
            await _log_step(db, run, step_id, status, message)

            cmd_ctx = dict(run.context_data or {})
            cmd_history = list(cmd_ctx.get("deployment_history") or [])
            if cmd_history:
                commands = list(cmd_history[-1].get("commands") or [])
                cmd_record = {
                    "index": index,
                    "command": command,
                    "status": status,
                    "output": output,
                    "at": datetime.now(timezone.utc).isoformat(),
                }
                existing = next((item for item in commands if item.get("index") == index), None)
                if existing:
                    existing.update(cmd_record)
                else:
                    commands.append(cmd_record)
                cmd_history[-1]["commands"] = commands
                cmd_ctx["deployment_history"] = cmd_history
                run.context_data = cmd_ctx
                await db.commit()
                await db.refresh(run)

        try:
            deploy_kwargs: dict = {
                "commands": commands,
                "on_command_progress": on_command_progress,
            }
            if bitbucket_credentials:
                deploy_kwargs["bitbucket_username"] = bitbucket_credentials[0]
                deploy_kwargs["bitbucket_app_password"] = bitbucket_credentials[1]
            deploy_output = await run_environment_deploy(mapping, target, **deploy_kwargs)
        except DeployError as exc:
            fail_ctx = dict(run.context_data or {})
            fail_history = list(fail_ctx.get("deployment_history") or [])
            if fail_history:
                fail_history[-1]["status"] = "failed"
                fail_history[-1]["error"] = str(exc)
                fail_history[-1]["completed_at"] = datetime.now(timezone.utc).isoformat()
            fail_ctx["deployment_history"] = fail_history
            fail_ctx["pending_deploy_retry"] = target
            run.context_data = fail_ctx
            await _log_step(db, run, deploy_step, "failed", str(exc))
            await db.commit()
            await db.refresh(run)
            raise PipelineError(str(exc)) from exc

        success_ctx = dict(run.context_data or {})
        success_history = list(success_ctx.get("deployment_history") or [])
        if success_history:
            success_history[-1]["status"] = "completed"
            success_history[-1]["output"] = deploy_output
            success_history[-1]["completed_at"] = datetime.now(timezone.utc).isoformat()
        success_ctx["deployment_history"] = success_history
        success_ctx.pop("pending_deploy_retry", None)
        run.context_data = success_ctx
        await _log_step(db, run, deploy_step, "completed", deploy_output)
    elif deploy_commands_for_environment(mapping, target).strip():
        await _log_step(
            db,
            run,
            deploy_step,
            "skipped",
            f"{env_label} deployment commands are configured but SSH credentials are incomplete",
        )


async def _transition_to_in_testing_after_merge(
    db: AsyncSession,
    run: DeliveryRun,
    jira: JiraClient,
    ctx: dict,
) -> dict:
    if _step_resolved(run, "transition_in_testing"):
        return ctx

    try:
        snapshot = await _fetch_issue_snapshot(jira, run.jira_issue_key)
        ctx["status_name"] = snapshot["status_name"]
    except Exception:
        pass

    if _is_in_testing_status(str(ctx.get("status_name") or "")):
        await _log_step(
            db,
            run,
            "transition_in_testing",
            "completed",
            f"Status: {ctx['status_name']}",
        )
        return ctx

    try:
        new_status = await ensure_in_testing_status(
            jira,
            run.jira_issue_key,
            ctx.get("status_name"),
            db=db,
        )
        ctx["status_name"] = new_status
        await _log_step(
            db,
            run,
            "transition_in_testing",
            "completed",
            f"Status: {new_status}",
        )
    except Exception:
        try:
            snapshot = await _fetch_issue_snapshot(jira, run.jira_issue_key)
            ctx["status_name"] = snapshot["status_name"]
            if _is_in_testing_status(snapshot["status_name"]):
                await _log_step(
                    db,
                    run,
                    "transition_in_testing",
                    "completed",
                    f"Status: {snapshot['status_name']}",
                )
                return ctx
        except Exception:
            pass
        await _log_step(
            db,
            run,
            "transition_in_testing",
            "skipped",
            "Jira status transition skipped; continuing with verification",
        )
    return ctx


async def _finalize_completed_run(
    db: AsyncSession,
    run: DeliveryRun,
    jira: JiraClient,
    ctx: dict,
    merged_summary: list[str],
) -> DeliveryRun:
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
            f"[Delivery Manager] Merged — In Testing\n\n"
            f"Merged: {', '.join(merged_summary)}\n"
            f"Beta PR: {beta_url or 'n/a'}\n"
            f"Master PR: {master_url or 'n/a'}\n\n"
            f"Website verification (screenshots attached above):\n{verification_block}",
        )
    except Exception:
        pass

    ctx["workflow_phase"] = "completed"
    run.context_data = ctx
    run.status = "completed"
    await db.commit()
    await db.refresh(run)
    return run


async def _continue_merge_flow_after_deploy(
    db: AsyncSession,
    run: DeliveryRun,
    jira: JiraClient,
    ctx: dict,
    mapping: ProjectRepoMapping,
    session: dict,
    target: MergeTarget,
    beta_pr_id: int | None,
    master_pr_id: int | None,
    *,
    deploy_trigger: str = "merge",
) -> DeliveryRun:
    mapping = await _load_fresh_mapping(db, run.project_key)
    ctx = dict(run.context_data or {})
    env_label = "Staging" if target == "beta" else "Live"
    verify_step = "verify_beta" if target == "beta" else "verify_master"

    if target == "beta" and _step_completed(run, "deploy_beta") and not _step_resolved(run, "transition_in_testing"):
        ctx = await _transition_to_in_testing_after_merge(db, run, jira, ctx)
        run.context_data = ctx
        await db.commit()
        await db.refresh(run)

    if not _step_completed(run, verify_step):
        latest_verify = _latest_step_status(run, verify_step)
        pending = ctx.get("pending_verification")
        if latest_verify == "running" and isinstance(pending, dict) and pending.get("environment"):
            ctx["workflow_phase"] = "pr_review"
            run.context_data = ctx
            run.status = "awaiting_approval"
            run.error_message = None
            await db.commit()
            await db.refresh(run)
            return run
        if latest_verify != "running":
            await _log_step(db, run, verify_step, "running", f"Testing {env_label} website…")
        result = await _step_verify_website(db, run, jira, ctx, env_label, session)
        ctx.update(result[1] or {})
        if ctx.get("pending_verification"):
            run.context_data = ctx
            ctx["workflow_phase"] = "pr_review"
            run.status = "awaiting_approval"
            run.error_message = None
            await db.commit()
            await db.refresh(run)
            return run
        await _log_step(db, run, verify_step, "completed", result[0], data=result[1] or None)

    if target == "beta" and is_unified_deploy_target(mapping):
        if not _step_completed(run, "deploy_master"):
            await _run_environment_deploy_step(
                db,
                run,
                mapping,
                "master",
                "Live",
                "deploy_master",
                session,
                trigger=deploy_trigger,
            )
        if not _step_completed(run, "verify_master"):
            await _log_step(db, run, "verify_master", "running", "Testing Live website…")
            master_result = await _step_verify_website(db, run, jira, ctx, "Live", session)
            ctx.update(master_result[1] or {})
            if ctx.get("pending_verification"):
                run.context_data = ctx
                ctx["workflow_phase"] = "pr_review"
                run.status = "awaiting_approval"
                run.error_message = None
                await db.commit()
                await db.refresh(run)
                return run
            await _log_step(
                db,
                run,
                "verify_master",
                "completed",
                master_result[0],
                data=master_result[1] or None,
            )
            ctx.update(master_result[1] or {})

    merged_summary: list[str] = []
    if ctx.get("beta_merged"):
        merged_summary.append(f"Staging PR #{beta_pr_id}" if beta_pr_id else "Staging")
    if ctx.get("master_merged"):
        merged_summary.append(f"Live PR #{master_pr_id}" if master_pr_id else "Live")

    if _all_prs_merged(run, ctx) and _all_required_deployments_succeeded(run, ctx, mapping):
        return await _finalize_completed_run(db, run, jira, ctx, merged_summary)

    ctx["workflow_phase"] = "pr_review"
    pending = _infer_pending_deploy_target(run, ctx, mapping)
    if pending:
        ctx["pending_deploy_retry"] = pending
    else:
        ctx.pop("pending_deploy_retry", None)
    run.context_data = ctx
    run.status = "awaiting_approval"
    run.error_message = None
    await db.commit()
    await db.refresh(run)
    return run


async def _handle_post_merge_failure(
    db: AsyncSession,
    run: DeliveryRun,
    ctx: dict,
    target: MergeTarget,
    exc: Exception,
) -> DeliveryRun:
    ctx = dict(ctx)
    ctx["workflow_phase"] = "pr_review"
    if not ctx.get("pending_deploy_retry"):
        ctx["pending_deploy_retry"] = target
    deploy_step = "deploy_beta" if target == "beta" else "deploy_master"
    if _latest_step_status(run, deploy_step) == "running":
        _mark_deploy_step_failed(run, deploy_step, str(exc))
    history = list(ctx.get("deployment_history") or [])
    for index in range(len(history) - 1, -1, -1):
        entry = history[index]
        if entry.get("environment") == target and entry.get("status") == "running":
            history[index] = {
                **entry,
                "status": "failed",
                "error": str(exc),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            ctx["deployment_history"] = history
            break
    run.context_data = ctx
    run.status = "awaiting_approval"
    run.error_message = str(exc)
    await db.commit()
    await db.refresh(run)
    return run


async def _attempt_merge_pull_request(
    bitbucket: BitbucketClient,
    workspace: str,
    repo_slug: str,
    pr_id: int,
    merged_label: str,
) -> str:
    """Merge a PR or confirm it was already merged. Raises PipelineError on failure."""
    try:
        await bitbucket.merge_pull_request(workspace, repo_slug, pr_id)
        return f"Merged {merged_label}"
    except Exception as exc:
        pr = await bitbucket.get_pull_request_safe(workspace, repo_slug, pr_id)
        if BitbucketClient.is_pull_request_merged(pr):
            return f"{merged_label} (already merged)"
        if pr and BitbucketClient.is_pull_request_open(pr):
            if await bitbucket.pull_request_has_merge_conflicts(workspace, repo_slug, pr_id):
                raise PipelineError(
                    f"Cannot merge {merged_label}: the pull request has merge conflicts. "
                    "Resolve conflicts in Bitbucket, then try merging again."
                ) from exc
        detail = BitbucketClient.http_error_detail(exc)
        raise PipelineError(f"Failed to merge {merged_label}: {detail}") from exc


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
            raise PipelineError("No Staging pull request to merge")
        if ctx.get("beta_merged"):
            raise PipelineError("Staging pull request is already merged")
        pr_id = beta_pr_id
        env_label = "Staging"
        merged_key = "beta_merged"
        step_name = "merge_beta_pr"
        deploy_step = "deploy_beta"
    else:
        if not master_pr_id:
            raise PipelineError("No Live (Master) pull request to merge")
        if ctx.get("master_merged"):
            raise PipelineError("Live pull request is already merged")
        pr_id = master_pr_id
        env_label = "Live"
        merged_key = "master_merged"
        step_name = "merge_master_pr"
        deploy_step = "deploy_master"

    jira = jira_client_from_session(session)
    bitbucket = _bitbucket_client(session)
    run.status = "running"
    run.error_message = None
    await db.commit()

    merged_label = f"{env_label} PR #{pr_id}"
    try:
        await _log_step(db, run, step_name, "running", f"Merging {merged_label}…")
        merge_message = await _attempt_merge_pull_request(
            bitbucket,
            mapping.bitbucket_workspace,
            mapping.bitbucket_repo_slug,
            pr_id,
            merged_label,
        )
        ctx[merged_key] = True
        await _log_step(db, run, step_name, "completed", merge_message)

        await _run_environment_deploy_step(
            db, run, mapping, target, env_label, deploy_step, session, trigger="merge"
        )

        return await _continue_merge_flow_after_deploy(
            db,
            run,
            jira,
            ctx,
            mapping,
            session,
            target,
            beta_pr_id,
            master_pr_id,
            deploy_trigger="merge",
        )

    except PipelineError as exc:
        ctx = dict(run.context_data or {})
        if ctx.get(merged_key):
            return await _handle_post_merge_failure(db, run, ctx, target, exc)
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, step_name, "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise
    except Exception as exc:
        ctx = dict(run.context_data or {})
        if ctx.get(merged_key):
            return await _handle_post_merge_failure(db, run, ctx, target, exc)
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, step_name, "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise


async def retry_deployment(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    mapping: ProjectRepoMapping,
    target: MergeTarget | None = None,
) -> DeliveryRun:
    mapping = await _load_fresh_mapping(db, run.project_key)
    ctx = dict(run.context_data or {})
    retry_target = target or ctx.get("pending_deploy_retry")
    if retry_target not in ("beta", "master"):
        raise PipelineError("Deployment target (beta or master) is required")

    manual_redeploy = target is not None and not ctx.get("pending_deploy_retry")

    if retry_target == "beta":
        if not ctx.get("beta_merged"):
            raise PipelineError("Staging pull request is not merged yet")
        env_label = "Staging"
        deploy_step = "deploy_beta"
    else:
        if not ctx.get("master_merged"):
            raise PipelineError("Live pull request is not merged yet")
        env_label = "Live"
        deploy_step = "deploy_master"

    if run.status not in ("awaiting_approval", "running", "failed"):
        raise PipelineError("Run is not ready for deployment")

    if manual_redeploy or target is not None:
        _reset_environment_verification(run, ctx, retry_target)

    beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)
    jira = jira_client_from_session(session)
    ctx.pop("pending_deploy_retry", None)
    run.context_data = ctx
    run.status = "running"
    run.error_message = None
    await db.commit()

    deploy_trigger = "manual" if manual_redeploy else "retry"

    try:
        await _run_environment_deploy_step(
            db,
            run,
            mapping,
            retry_target,
            env_label,
            deploy_step,
            session,
            trigger=deploy_trigger,
        )
        return await _continue_merge_flow_after_deploy(
            db,
            run,
            jira,
            ctx,
            mapping,
            session,
            retry_target,
            beta_pr_id,
            master_pr_id,
            deploy_trigger=deploy_trigger,
        )
    except PipelineError as exc:
        return await _handle_post_merge_failure(db, run, dict(run.context_data or {}), retry_target, exc)
    except Exception as exc:
        return await _handle_post_merge_failure(db, run, dict(run.context_data or {}), retry_target, exc)


async def post_website_verification(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    comment: str,
) -> DeliveryRun:
    if run.status == "running":
        raise PipelineError("A step is already running")

    ctx = dict(run.context_data or {})
    pending = ctx.get("pending_verification")
    if not isinstance(pending, dict) or not pending.get("environment"):
        raise PipelineError("No website verification awaiting review")

    environment = str(pending.get("environment", ""))
    verify_step = "verify_beta" if environment.lower() in ("beta", "staging") else "verify_master"

    jira = jira_client_from_session(session)
    filename = str(pending.get("screenshot_filename") or "verification.png")
    screenshot_path = Path(str(pending.get("screenshot_path") or ""))
    if not screenshot_path.is_file():
        resolved = verification_screenshot_file(run.id, environment)
        if resolved is None:
            raise PipelineError("Verification screenshot not found; redeploy to capture again")
        screenshot_path = resolved

    screenshot_bytes = screenshot_path.read_bytes()
    await jira.add_attachment(run.jira_issue_key, filename, screenshot_bytes)

    full_comment = (comment or pending.get("draft_comment") or "").strip()
    if not full_comment:
        raise PipelineError("Verification comment cannot be empty")
    await _jira_comment(jira, run.jira_issue_key, full_comment)

    verification_record = {
        "environment": environment,
        "url": str(pending.get("url") or ""),
        "passed": bool(pending.get("passed")),
        "summary": str(pending.get("summary") or ""),
        "findings": [str(item) for item in (pending.get("findings") or []) if str(item).strip()],
        "screenshot_filename": filename,
        "comment": full_comment,
    }
    verifications = [
        item
        for item in (ctx.get("verifications") or [])
        if not (isinstance(item, dict) and item.get("environment") == environment)
    ]
    verifications.append(verification_record)

    unit_testing_field = await _update_unit_testing_field(
        jira,
        run.jira_issue_key,
        verifications,
        configured_field_id=await jira_unit_testing_field_id(db),
    )

    admin_paths = _admin_related_changed_paths(ctx.get("changed_files") or [])
    admin_database_field = ""
    if admin_paths:
        admin_database_field = await _update_admin_database_field(
            jira,
            run.jira_issue_key,
            admin_paths,
            configured_field_id=await jira_admin_database_field_id(db),
        )

    ctx.pop("pending_verification", None)
    ctx["verifications"] = verifications
    ctx[f"{environment.lower()}_verification"] = verification_record

    run.status = "running"
    run.error_message = None
    run.context_data = ctx
    await db.commit()

    await _log_step(
        db,
        run,
        verify_step,
        "completed",
        f"{environment} verification posted to Jira",
        data={
            "verifications": verifications,
            f"{environment.lower()}_verification": verification_record,
            "unit_testing_field": unit_testing_field or None,
            "admin_database_field": admin_database_field or None,
            "admin_paths": admin_paths or None,
        },
    )

    mapping = await _load_fresh_mapping(db, run.project_key)
    merge_target: MergeTarget = "beta" if environment.lower() in ("beta", "staging") else "master"
    beta_pr_id, master_pr_id = _pr_ids_for_run(run, dict(run.context_data or {}))
    return await _continue_merge_flow_after_deploy(
        db,
        run,
        jira,
        dict(run.context_data or {}),
        mapping,
        session,
        merge_target,
        beta_pr_id,
        master_pr_id,
        deploy_trigger="verification_posted",
    )


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
    mapping = dict(ctx.get("mapping") or {})
    result = await db.execute(
        select(ProjectRepoMapping).where(ProjectRepoMapping.jira_project_key == run.project_key)
    )
    mapping_row = result.scalar_one_or_none()
    if not mapping_row:
        return mapping or None
    db_mapping = {
        "workspace": mapping_row.bitbucket_workspace,
        "repo_slug": mapping_row.bitbucket_repo_slug,
        "master_branch": mapping_row.master_branch,
        "beta_branch": mapping_row.beta_branch,
        "beta_website_url": mapping_row.beta_website_url,
        "master_website_url": mapping_row.master_website_url,
        "rules": mapping_row.rules or "",
        "skills": mapping_row.skills or "",
    }
    if mapping:
        return {**mapping, **db_mapping}
    return db_mapping


async def _check_pr_review_stale(
    run: DeliveryRun,
    ctx: dict,
    mapping: dict,
    bitbucket: BitbucketClient,
) -> str | None:
    """Only treat a missing feature branch as stale; declined/closed PRs are ignored."""
    branch_name = run.branch_name or ctx.get("branch_name")
    if branch_name:
        if not await bitbucket.branch_exists(
            mapping["workspace"], mapping["repo_slug"], branch_name
        ):
            return "Feature branch was removed (pull request likely declined)"

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
    session: dict,
) -> tuple[list[str], str]:
    if not _revision_prompt_requests_deletion(revision_prompt):
        return [], ""
    if not openai_configured(session):
        return [], ""

    branch_paths = _branch_paths_from_changed_files(changed_files)
    if not branch_paths:
        return [], ""

    openai = _openai_client(session)
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

    await db.refresh(run)
    return run


async def apply_local_code_revision(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    prompt: str,
) -> DeliveryRun:
    if get_workflow_phase(run) != "local_development":
        raise PipelineError("Run is not in local development")
    if run.status != "awaiting_approval":
        raise PipelineError("Run is not awaiting approval")

    revision_prompt = prompt.strip()
    if not revision_prompt:
        raise PipelineError("Revision prompt is required")
    if not openai_configured(session):
        raise PipelineError("OpenAI API key is required for code revisions. Add it in Settings.")

    ctx = dict(run.context_data or {})
    mapping = await _resolve_run_mapping(db, run, ctx)
    if mapping:
        ctx["mapping"] = mapping
    branch_name = run.branch_name or ctx.get("branch_name")
    code_result = ctx.get("code_result") or {}
    files = code_result.get("files") or []
    changed_files = ctx.get("changed_files") or []

    if not files and not changed_files:
        raise PipelineError("No generated code to revise yet. Start implementation first.")

    revision_count = int(ctx.get("local_revision_count", 0)) + 1
    run.status = "running"
    run.error_message = None
    await _log_step(
        db,
        run,
        "code_revision",
        "running",
        f"Local revision #{revision_count}: updating generated code…",
    )
    await _log_step(db, run, "revision_prepare", "running", "Loading current file contents…")
    await db.commit()

    try:
        current_files = [
            {
                "path": f["path"],
                "content": f["content"],
                "action": f.get("action", "modify"),
            }
            for f in files
            if isinstance(f, dict) and f.get("path") and f.get("content") is not None
        ]
        if not current_files and changed_files and mapping and branch_name and bitbucket_configured(session):
            bitbucket = _bitbucket_client(session)
            current_files = await _load_branch_file_contents(
                bitbucket, mapping, branch_name, changed_files, ctx
            )

        if not current_files:
            raise PipelineError("No file contents available to revise")

        await _log_step(
            db,
            run,
            "revision_prepare",
            "completed",
            f"Ready to revise {len(current_files)} file(s)",
        )

        if not ctx.get("repo_stack_summary") and mapping and bitbucket_configured(session):
            bitbucket = _bitbucket_client(session)
            summary, _loaded = await probe_repository_stack(
                bitbucket,
                mapping["workspace"],
                mapping["repo_slug"],
                branch_name or mapping["master_branch"],
            )
            ctx["repo_stack_summary"] = summary

        await _log_step(db, run, "revision_generate", "running", "Generating changes with AI…")
        await db.commit()

        rules = (mapping.get("rules") or "").strip() if mapping else ""
        skills = (mapping.get("skills") or "").strip() if mapping else ""
        openai = _openai_client(session)
        revised = await openai.apply_code_revision(
            run.jira_issue_key,
            ctx.get("summary", run.summary),
            revision_prompt,
            current_files,
            branch_paths=[f["path"] for f in current_files],
            rules=rules,
            skills=skills,
            repo_stack_summary=ctx.get("repo_stack_summary", ""),
        )
        revised_files = revised.get("files", [])
        file_map, deleted_paths = _partition_revision_files(revised_files)
        if not file_map and not deleted_paths:
            raise PipelineError("No file changes were generated for this revision")

        notes = revised.get("implementation_notes", "")
        _update_code_result_files(ctx, file_map, deleted_paths, notes)

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

        project_dir = (mapping.get("local_project_directory") or "").strip() if mapping else ""
        await _log_step(
            db,
            run,
            "revision_commit",
            "completed",
            "Updated generated code — create pull requests when ready",
        )

        _invalidate_generated_code_steps(run)
        ctx["changed_files"] = [
            {"path": f["path"], "action": f.get("action", "modify")}
            for f in (ctx.get("code_result") or {}).get("files", [])
            if isinstance(f, dict) and f.get("path")
        ]
        ctx["changed_files_refreshed_at"] = datetime.now(timezone.utc).isoformat()
        ctx["local_revision_count"] = revision_count
        ctx["last_revision_prompt"] = revision_prompt
        ctx["workflow_phase"] = "local_development"

        await _log_step(
            db,
            run,
            "revision_refresh",
            "completed",
            f"Updated file list ({len(ctx['changed_files'])} changed file(s))",
        )
        await _log_step(
            db,
            run,
            "code_revision",
            "completed",
            f"Local revision #{revision_count} generated\n\n{notes[:400]}",
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
    if mapping:
        ctx["mapping"] = mapping
    branch_name = run.branch_name or ctx.get("branch_name")
    if not mapping or not branch_name:
        raise PipelineError("Missing branch or repo mapping")
    if ctx.get("beta_merged") and ctx.get("master_merged"):
        raise PipelineError("All pull requests are already merged")

    if not bitbucket_configured(session):
        raise PipelineError("Bitbucket credentials are not configured. Add them in Settings.")

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

    bitbucket = _bitbucket_client(session)

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
            "Running Cursor agent…" if cursor_configured(session) else "Generating changes with AI…",
        )
        await db.commit()

        if cursor_configured(session):
            repo_url = BitbucketClient.repo_html_url(mapping["workspace"], mapping["repo_slug"])
            rules = (mapping.get("rules") or "").strip()
            skills = (mapping.get("skills") or "").strip()
            try:
                result = run_revision_agent(
                    issue_key=run.jira_issue_key,
                    summary=ctx.get("summary", run.summary),
                    description=_ticket_context_for_ai(ctx),
                    branch_name=branch_name,
                    master_branch=mapping["master_branch"],
                    repo_url=repo_url,
                    revision_prompt=revision_prompt,
                    api_key=cursor_api_key(session),
                    model=cursor_model(session),
                    rules=rules,
                    skills=skills,
                    repo_stack_summary=ctx.get("repo_stack_summary", ""),
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
                if not openai_configured(session):
                    raise

        if not used_cursor:
            if not openai_configured(session):
                raise PipelineError(
                    "Cursor API key or OpenAI API key is required for code revisions. Add them in Settings."
                )

            if not ctx.get("repo_stack_summary") and mapping:
                summary, _loaded = await probe_repository_stack(
                    bitbucket,
                    mapping["workspace"],
                    mapping["repo_slug"],
                    branch_name,
                )
                ctx["repo_stack_summary"] = summary

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

            rules = (mapping.get("rules") or "").strip()
            skills = (mapping.get("skills") or "").strip()
            openai = _openai_client(session)
            code_result = await openai.apply_code_revision(
                run.jira_issue_key,
                ctx.get("summary", run.summary),
                revision_prompt,
                current_files,
                branch_paths=branch_paths,
                rules=rules,
                skills=skills,
                repo_stack_summary=ctx.get("repo_stack_summary", ""),
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
            if openai_configured(session):
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
                    session,
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
                    "File removal was requested; add an OpenAI API key in Settings to auto-delete files after Cursor revisions",
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


def reset_run_to_estimation(
    run: DeliveryRun,
    *,
    summary: str | None = None,
    notice: str = "",
    workflow_phase: str = "estimation",
) -> None:
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
        "workflow_phase": workflow_phase,
        "summary": summary or ctx.get("summary") or run.summary,
    }
    if notice.strip():
        fresh_ctx["workflow_notice"] = notice.strip()
    run.context_data = fresh_ctx


async def restart_after_waiting_for_info_in_jira(
    db: AsyncSession,
    run: DeliveryRun,
    session: dict,
    snapshot: dict,
) -> DeliveryRun:
    """Full workflow reset when Jira ticket returns to waiting-for-information."""
    ctx = dict(run.context_data or {})
    mapping = await _resolve_run_mapping(db, run, ctx)
    message = (
        "The Jira ticket is waiting for information. "
        "Delivery workflow restarted from estimation."
    )

    run.status = "running"
    run.error_message = None
    await _log_step(
        db,
        run,
        "restart_waiting_for_info",
        "running",
        "Restarting after Jira moved to waiting for information…",
    )
    await db.commit()

    try:
        if bitbucket_configured(session) and mapping:
            bitbucket = _bitbucket_client(session)
            beta_pr_id, master_pr_id = _pr_ids_for_run(run, ctx)
            if beta_pr_id or master_pr_id or run.pr_id:
                await _decline_tracked_prs(bitbucket, mapping, run, ctx, message)

            branch_name = run.branch_name or ctx.get("branch_name")
            if branch_name:
                try:
                    await bitbucket.delete_branch(
                        mapping["workspace"],
                        mapping["repo_slug"],
                        branch_name,
                    )
                except Exception:
                    pass

        reset_run_to_estimation(
            run,
            summary=snapshot.get("summary") or run.summary,
            notice=message,
            workflow_phase="waiting_for_info",
        )
        fresh_ctx = dict(run.context_data or {})
        fresh_ctx["description"] = snapshot.get("description", "")
        fresh_ctx["status_name"] = snapshot.get("status_name", "")
        fresh_ctx["jira_comments"] = snapshot.get("jira_comments", [])
        fresh_ctx["jira_synced_at"] = datetime.now(timezone.utc).isoformat()
        run.context_data = fresh_ctx
        run.summary = snapshot.get("summary") or run.summary

        await _log_step(db, run, "restart_waiting_for_info", "completed", message)
        run.status = "active"
        await db.commit()
        await db.refresh(run)
        return await _auto_prepare_estimation_if_needed(db, run, session, snapshot)
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        await _log_step(db, run, "restart_waiting_for_info", "failed", str(exc))
        await db.commit()
        await db.refresh(run)
        raise


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
        if bitbucket_configured(session) and mapping:
            bitbucket = _bitbucket_client(session)
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
    if not mapping or not bitbucket_configured(session):
        return run

    bitbucket = _bitbucket_client(session)
    if await _forget_inactive_tracked_prs(bitbucket, mapping, run, ctx):
        run.context_data = ctx
        await db.commit()
        await db.refresh(run)

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
    session: dict,
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

    bitbucket = _bitbucket_client(session)
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
        "rules": mapping.rules,
        "skills": mapping.skills,
        "local_project_directory": mapping.local_project_directory,
    }
    return (
        f"Repo: {mapping.bitbucket_workspace}/{mapping.bitbucket_repo_slug} "
        f"(master: {mapping.master_branch}, beta: {mapping.beta_branch})",
        {"mapping": mapping_data},
    )


async def _step_create_branch(db, run, jira, ctx, session) -> tuple[str, dict]:
    if not bitbucket_configured(session):
        raise PipelineError("Bitbucket credentials are not configured. Add them in Settings.")
    mapping = ctx.get("mapping")
    if not mapping:
        raise PipelineError("Run resolve mapping step first")

    branch_name = run.branch_name or ctx.get("branch_name")
    if not branch_name:
        branch_name = f"feature/{run.jira_issue_key}-{slugify(ctx.get('summary', run.summary))}"

    bitbucket = _bitbucket_client(session)
    try:
        branch_exists = await bitbucket.branch_exists(
            mapping["workspace"],
            mapping["repo_slug"],
            branch_name,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise PipelineError(BitbucketClient.http_error_detail(exc)) from exc
        raise PipelineError(f"Bitbucket branch lookup failed: {exc}") from exc

    if branch_exists:
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
                "Update the production branch in Admin → Mappings."
            ) from exc
        if exc.response.status_code in (401, 403):
            raise PipelineError(BitbucketClient.http_error_detail(exc)) from exc
        raise PipelineError(f"Bitbucket branch creation failed: {exc}") from exc
    except Exception as exc:
        raise PipelineError(f"Bitbucket branch creation failed: {exc}") from exc
    run.branch_name = branch_name
    await db.commit()
    return (
        f"Created branch `{branch_name}` from `{mapping['master_branch']}`",
        {"branch_name": branch_name},
    )


async def _step_cursor_development(db, run, jira, ctx, session) -> tuple[str, dict]:
    mapping = await _resolve_run_mapping(db, run, ctx)
    if mapping:
        ctx["mapping"] = mapping
    branch_name = run.branch_name or ctx.get("branch_name")
    if not mapping or not branch_name:
        raise PipelineError("Run create branch step first")

    rules = (mapping.get("rules") or "").strip()
    skills = (mapping.get("skills") or "").strip()

    if cursor_configured(session):
        repo_url = BitbucketClient.repo_html_url(mapping["workspace"], mapping["repo_slug"])
        try:
            result = run_implementation_agent(
                issue_key=run.jira_issue_key,
                summary=ctx.get("summary", run.summary),
                description=_ticket_context_for_ai(ctx),
                branch_name=branch_name,
                master_branch=mapping["master_branch"],
                repo_url=repo_url,
                api_key=cursor_api_key(session),
                model=cursor_model(session),
                rules=rules,
                skills=skills,
                repo_stack_summary=ctx.get("repo_stack_summary", ""),
            )
            notes = result.get("implementation_notes", "")
            rules_note = ""
            if rules or skills:
                rules_note = " (with project rules/skills)"
            return (
                f"Cursor SDK completed development on `{branch_name}`{rules_note}\n\n{notes[:500]}",
                {"development_result": result, "code_result": {"implementation_notes": notes, "files": []}},
            )
        except CursorDevelopmentError as exc:
            if not openai_configured(session):
                raise PipelineError(str(exc)) from exc

    return (
        "Cursor SDK not configured — using OpenAI for code generation (with project rules/skills and repo stack)",
        {"development_result": {"source": "openai_fallback"}},
    )


async def _step_repo_stack(db, run, jira, ctx, session) -> tuple[str, dict]:
    if not bitbucket_configured(session):
        raise PipelineError("Bitbucket credentials are not configured. Add them in Settings.")
    mapping = ctx.get("mapping")
    if not mapping:
        raise PipelineError("Run resolve mapping step first")

    branch_name = run.branch_name or ctx.get("branch_name")
    ref = branch_name or mapping["master_branch"]
    bitbucket = _bitbucket_client(session)
    summary, loaded = await probe_repository_stack(
        bitbucket,
        mapping["workspace"],
        mapping["repo_slug"],
        ref,
    )
    return (
        f"Detected stack from {len(loaded)} file(s): {', '.join(loaded) or 'none'}",
        {"repo_stack_summary": summary, "repo_stack_files": loaded},
    )


async def _step_generate_code(db, run, jira, ctx, session) -> tuple[str, dict]:
    if not openai_configured(session):
        raise PipelineError("OpenAI API key is not configured. Add it in Settings.")
    mapping = ctx.get("mapping") or await _resolve_run_mapping(db, run, ctx)
    rules = (mapping.get("rules") or "").strip() if mapping else ""
    skills = (mapping.get("skills") or "").strip() if mapping else ""
    openai = _openai_client(session)
    code_result = await openai.generate_code_changes(
        run.jira_issue_key,
        ctx.get("summary", run.summary),
        _ticket_context_for_ai(ctx),
        rules=rules,
        skills=skills,
        repo_stack_summary=ctx.get("repo_stack_summary", ""),
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


async def _step_commit_changes(db, run, jira, ctx, session) -> tuple[str, dict]:
    if not bitbucket_configured(session):
        raise PipelineError("Bitbucket credentials are not configured. Add them in Settings.")
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

    bitbucket = _bitbucket_client(session)
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


async def _step_create_pr_beta(db, run, jira, ctx, session) -> tuple[str, dict]:
    if not bitbucket_configured(session):
        raise PipelineError("Bitbucket credentials are not configured. Add them in Settings.")
    mapping = ctx.get("mapping")
    branch_name = run.branch_name or ctx.get("branch_name")
    if not mapping or not branch_name:
        raise PipelineError("Run commit changes step first")

    bitbucket = _bitbucket_client(session)
    existing_id = ctx.get("beta_pr_id") or run.pr_id
    if existing_id and not ctx.get("beta_merged"):
        existing = await bitbucket.get_pull_request_safe(
            mapping["workspace"], mapping["repo_slug"], int(existing_id)
        )
        if existing and BitbucketClient.is_pull_request_open(existing):
            beta_pr_url = BitbucketClient.pr_html_url(existing)
            run.pr_id = int(existing_id)
            run.pr_url = beta_pr_url
            await db.commit()
            return (
                f"Reusing open Beta pull request: {beta_pr_url or f'#{existing_id}'}\n"
                f"{branch_name} → {mapping['beta_branch']}",
                {
                    "beta_pr_url": beta_pr_url,
                    "beta_pr_id": int(existing_id),
                    "pr_url": beta_pr_url,
                    "pr_id": int(existing_id),
                },
            )

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


async def _step_create_pr_master(db, run, jira, ctx, session) -> tuple[str, dict]:
    if not bitbucket_configured(session):
        raise PipelineError("Bitbucket credentials are not configured. Add them in Settings.")
    mapping = ctx.get("mapping")
    if mapping and is_unified_deploy_target(mapping):
        return (
            f"Skipped Live PR — staging and live share target branch `{mapping['beta_branch']}`",
            {"master_pr_skipped": True},
        )
    branch_name = run.branch_name or ctx.get("branch_name")
    if not mapping or not branch_name:
        raise PipelineError("Run commit changes step first")

    bitbucket = _bitbucket_client(session)
    existing_id = ctx.get("master_pr_id")
    if existing_id and not ctx.get("master_merged"):
        existing = await bitbucket.get_pull_request_safe(
            mapping["workspace"], mapping["repo_slug"], int(existing_id)
        )
        if existing and BitbucketClient.is_pull_request_open(existing):
            master_pr_url = BitbucketClient.pr_html_url(existing)
            await db.commit()
            return (
                f"Reusing open Live pull request: {master_pr_url or f'#{existing_id}'}\n"
                f"{branch_name} → {mapping['master_branch']}",
                {"master_pr_url": master_pr_url, "master_pr_id": int(existing_id)},
            )

    pr = await bitbucket.create_pull_request(
        mapping["workspace"],
        mapping["repo_slug"],
        f"{run.jira_issue_key}: {run.summary} (Live)",
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


async def _step_verify_website(db, run, jira, ctx, environment: str, session) -> tuple[str, dict]:
    mapping = ctx.get("mapping")
    if not mapping:
        raise PipelineError("Run resolve mapping step first")

    website_url = (
        mapping["beta_website_url"]
        if environment.lower() in ("beta", "staging")
        else mapping["master_website_url"]
    ).strip()
    if not website_url:
        return (f"No {environment} website URL configured; skipped verification", {})

    if not openai_configured(session):
        raise PipelineError("OpenAI API key is required for website verification. Add it in Settings.")

    openai = _openai_client(session)
    result = await verify_website(
        issue_key=run.jira_issue_key,
        summary=ctx.get("summary", run.summary),
        environment=environment,
        website_url=website_url,
        openai_client=openai,
    )
    analysis = result["analysis"]
    filename = f"{environment.lower()}-{run.jira_issue_key.lower()}.png"
    screenshot_path = _verification_screenshot_path(run.id, environment)
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    screenshot_path.write_bytes(result["screenshot_png"])

    draft_comment = _build_verification_draft_comment(environment, website_url, analysis, filename)
    findings = analysis.get("findings") or []
    admin_paths = _admin_related_changed_paths(ctx.get("changed_files") or [])
    pending_verification = {
        "environment": environment,
        "url": website_url,
        "passed": bool(analysis.get("passed")),
        "summary": analysis.get("summary", ""),
        "findings": findings,
        "draft_comment": draft_comment,
        "screenshot_filename": filename,
        "screenshot_path": str(screenshot_path),
        "admin_paths": admin_paths,
    }
    return (
        f"{environment} website captured — review draft comment before posting to Jira",
        {"pending_verification": pending_verification},
    )


async def _step_create_pr(db, run, jira, ctx) -> tuple[str, dict]:
    """Legacy single-PR helper kept for compatibility."""
    return await _step_create_pr_beta(db, run, jira, ctx)


# Legacy compatibility for old step endpoint
PIPELINE_STEPS = IMPLEMENTATION_STEPS


def get_next_step(run: DeliveryRun) -> str | None:
    return None
