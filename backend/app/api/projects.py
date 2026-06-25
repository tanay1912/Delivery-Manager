from fastapi import APIRouter, Depends, Query

from app.auth.jira_credentials import jira_client_from_session
from app.clients.jira_client import JiraClient
from app.middleware.auth_guard import require_auth

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects(
    start_at: int = Query(0, ge=0),
    max_results: int = Query(50, ge=1, le=100),
    query: str | None = Query(None, min_length=1, max_length=100),
    session: dict = Depends(require_auth),
):
    client = jira_client_from_session(session)
    data = await client.get_projects(
        start_at=start_at,
        max_results=max_results,
        query=query.strip() if query else None,
    )
    projects = [
        {
            "id": p.get("id"),
            "key": p.get("key"),
            "name": p.get("name"),
            "avatar_url": p.get("avatarUrls", {}).get("48x48"),
            "project_type": p.get("projectTypeKey"),
        }
        for p in data.get("values", [])
    ]
    return {
        "projects": projects,
        "total": data.get("total", len(projects)),
        "start_at": data.get("startAt", start_at),
        "max_results": data.get("maxResults", max_results),
    }
