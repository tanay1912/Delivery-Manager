import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jira_credentials import jira_client_from_session
from app.db.session import get_db
from app.middleware.auth_guard import require_auth
from app.schemas.jira_fields import (
    JiraFieldItem,
    JiraFieldsResponse,
    JiraIssueEditFieldsResponse,
    JiraIssueFieldMeta,
    JiraIssueTransitionsResponse,
    JiraTransitionFieldMeta,
    JiraTransitionItem,
)
from app.services.app_settings import get_or_create_app_settings, sync_jira_fields_cache
from app.services.jira_fields import JiraFieldCatalog, get_field_catalog, search_field_items

router = APIRouter(prefix="/api/jira", tags=["jira"])


@router.get("/fields", response_model=JiraFieldsResponse)
async def list_jira_fields(
    q: str = Query("", description="Search by field name or id"),
    custom_only: bool = Query(False, description="Only custom fields"),
    refresh: bool = Query(False, description="Reload from Jira and update the database cache"),
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await get_or_create_app_settings(db)
    jira = jira_client_from_session(session)

    try:
        if refresh or not row.jira_fields_cache:
            items = await sync_jira_fields_cache(db, jira)
            row = await get_or_create_app_settings(db)
            source = "jira"
        else:
            items = list(row.jira_fields_cache or [])
            source = "database"

        matches = search_field_items(items, q, custom_only=custom_only, limit=500)
        cached_at = row.jira_fields_cached_at

        catalog = get_field_catalog(jira)
        if items:
            catalog.load_from_items(items)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Jira") from exc

    field_items = [JiraFieldItem(**item) for item in matches]
    return JiraFieldsResponse(
        fields=field_items,
        total=len(field_items),
        cached_at=cached_at,
        source=source,
    )


@router.get("/issues/{issue_key}/edit-fields", response_model=JiraIssueEditFieldsResponse)
async def list_issue_edit_fields(
    issue_key: str,
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Fields Jira allows updating on this issue (edit screen metadata)."""
    jira = jira_client_from_session(session)
    row = await get_or_create_app_settings(db)
    catalog = get_field_catalog(jira)
    cache = list(row.jira_fields_cache or [])
    if cache:
        catalog.load_from_items(cache)
    try:
        editmeta = await jira.get_issue_editmeta(issue_key)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Jira") from exc

    fields: list[JiraIssueFieldMeta] = []
    for field_id, meta in editmeta.items():
        if not isinstance(meta, dict):
            continue
        schema = meta.get("schema") or {}
        catalog_field = await catalog.get_field(field_id)
        name = str(meta.get("name") or (catalog_field or {}).get("name") or field_id)
        fields.append(
            JiraIssueFieldMeta(
                id=field_id,
                name=name,
                required=bool(meta.get("required")),
                schema_type=schema.get("type"),
                allowed_values=list(meta.get("allowedValues") or []),
            )
        )

    fields.sort(key=lambda item: item.name.lower())
    return JiraIssueEditFieldsResponse(issue_key=issue_key, fields=fields)


@router.get("/issues/{issue_key}/transitions", response_model=JiraIssueTransitionsResponse)
async def list_issue_transitions(
    issue_key: str,
    expand_fields: bool = Query(True, description="Include fields available on each transition screen"),
    session: dict = Depends(require_auth),
):
    jira = jira_client_from_session(session)
    try:
        raw_transitions = await jira.get_transitions(issue_key, expand_fields=expand_fields)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Jira") from exc

    transitions: list[JiraTransitionItem] = []
    for transition in raw_transitions:
        field_items: list[JiraTransitionFieldMeta] = []
        for field_id, meta in (transition.get("fields") or {}).items():
            if not isinstance(meta, dict):
                continue
            schema = meta.get("schema") or {}
            field_items.append(
                JiraTransitionFieldMeta(
                    id=field_id,
                    name=str(meta.get("name") or field_id),
                    required=bool(meta.get("required")),
                    schema_type=schema.get("type"),
                )
            )
        field_items.sort(key=lambda item: item.name.lower())
        to_status = ((transition.get("to") or {}).get("name")) or None
        transitions.append(
            JiraTransitionItem(
                id=str(transition.get("id") or ""),
                name=str(transition.get("name") or ""),
                to_status=to_status,
                fields=field_items,
            )
        )

    transitions.sort(key=lambda item: item.name.lower())
    return JiraIssueTransitionsResponse(issue_key=issue_key, transitions=transitions)
