import asyncio

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.jira_credentials import jira_client_from_session
from app.clients.jira_client import JiraClient
from app.middleware.auth_guard import require_auth

router = APIRouter(prefix="/api/issues", tags=["issues"])


def _format_issue(issue: dict) -> dict:
    fields = issue.get("fields", {})
    status = fields.get("status") or {}
    priority = fields.get("priority") or {}
    assignee = fields.get("assignee") or {}
    project = fields.get("project") or {}
    issue_type = fields.get("issuetype") or {}
    return {
        "id": issue.get("id"),
        "key": issue.get("key"),
        "summary": fields.get("summary"),
        "status": status.get("name"),
        "status_category": (status.get("statusCategory") or {}).get("name"),
        "priority": priority.get("name"),
        "assignee": assignee.get("displayName"),
        "assignee_avatar": (assignee.get("avatarUrls") or {}).get("24x24"),
        "updated": fields.get("updated"),
        "project_key": project.get("key"),
        "project_name": project.get("name"),
        "issue_type": issue_type.get("name"),
        "issue_type_icon": issue_type.get("iconUrl"),
    }


def _jira_error_detail(exc: httpx.HTTPStatusError, fallback: str) -> str:
    detail = fallback
    try:
        body = exc.response.json()
        if isinstance(body, dict):
            messages = body.get("errorMessages") or []
            errors = body.get("errors") or {}
            if messages:
                detail = "; ".join(messages)
            elif errors:
                detail = "; ".join(f"{k}: {v}" for k, v in errors.items())
    except Exception:
        pass
    return detail


async def _fetch_issue_summary(
    client: JiraClient,
    project: str | None = None,
    *,
    assigned_to_me: bool = True,
) -> dict:
    base_jql = JiraClient.build_jql(
        project,
        assigned_to_me=assigned_to_me,
        order_by_updated=False,
    )

    by_status = await client.summarize_by_status(base_jql)

    total = sum(bucket["total"] for bucket in by_status.values())
    summary = {
        "total": total,
        "by_status": by_status,
        "qis": sum(bucket["qis"] for bucket in by_status.values()),
        "bug": sum(bucket["bug"] for bucket in by_status.values()),
        "task": sum(bucket["task"] for bucket in by_status.values()),
    }
    return summary


@router.get("/summary")
async def issue_summary(
    project: str | None = Query(None, description="Filter by project key"),
    assigned_to_me: bool = Query(True, description="Only issues assigned to the connected user"),
    session: dict = Depends(require_auth),
):
    client = jira_client_from_session(session)

    try:
        return await _fetch_issue_summary(client, project, assigned_to_me=assigned_to_me)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=_jira_error_detail(exc, "Could not fetch issue summary from Jira"),
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Jira") from exc


@router.get("/project-summaries")
async def project_summaries(
    projects: str = Query(..., description="Comma-separated Jira project keys"),
    assigned_to_me: bool = Query(True, description="Only issues assigned to the connected user"),
    session: dict = Depends(require_auth),
):
    project_keys = [key.strip() for key in projects.split(",") if key.strip()]
    if not project_keys:
        return {"summaries": {}}

    client = jira_client_from_session(session)

    try:
        results = await asyncio.gather(
            *[
                _fetch_issue_summary(client, project_key, assigned_to_me=assigned_to_me)
                for project_key in project_keys
            ]
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=_jira_error_detail(exc, "Could not fetch project summaries from Jira"),
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Jira") from exc

    return {
        "summaries": {
            project_key: summary
            for project_key, summary in zip(project_keys, results, strict=True)
        }
    }


@router.get("")
async def list_issues(
    project: str | None = Query(None, description="Filter by project key"),
    assigned_to_me: bool = Query(True, description="Only issues assigned to the connected user"),
    page_token: str | None = Query(None, description="Pagination token from a previous response"),
    max_results: int = Query(50, ge=1, le=100),
    session: dict = Depends(require_auth),
):
    client = jira_client_from_session(session)
    jql = JiraClient.build_jql(project, assigned_to_me=assigned_to_me)
    data = await client.search_issues(
        jql=jql,
        max_results=max_results,
        next_page_token=page_token,
    )
    issues = [_format_issue(i) for i in data.get("issues", [])]
    return {
        "issues": issues,
        "total": data.get("totalIssueCount", len(issues)),
        "next_page_token": data.get("nextPageToken"),
        "is_last": data.get("isLast", True),
        "max_results": max_results,
    }
