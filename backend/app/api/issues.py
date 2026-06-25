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
    }


@router.get("/summary")
async def issue_summary(
    project: str | None = Query(None, description="Filter by project key"),
    assigned_to_me: bool = Query(True, description="Only issues assigned to the connected user"),
    session: dict = Depends(require_auth),
):
    client = jira_client_from_session(session)

    async def count_for_category(status_category: str | None) -> int:
        jql = JiraClient.build_jql(project, assigned_to_me=assigned_to_me, status_category=status_category)
        return await client.count_issues(jql)

    try:
        total, todo, in_progress, done = await asyncio.gather(
            count_for_category(None),
            count_for_category("To Do"),
            count_for_category("In Progress"),
            count_for_category("Done"),
        )
    except httpx.HTTPStatusError as exc:
        detail = "Could not fetch issue summary from Jira"
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
        raise HTTPException(status_code=502, detail=detail) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Jira") from exc

    return {
        "total": total,
        "todo": todo,
        "in_progress": in_progress,
        "done": done,
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
