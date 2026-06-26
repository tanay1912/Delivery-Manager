import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jira_credentials import jira_client_from_session
from app.config import settings
from app.db.session import get_db
from app.middleware.auth_guard import require_auth
from app.schemas.admin_database import (
    AdminDatabaseSettingsResponse,
    AdminDatabaseSettingsUpdate,
    SyncJiraFieldsResponse,
)
from app.schemas.jira_fields import JiraFieldItem
from app.services.app_settings import get_or_create_app_settings, resolved_field_name, sync_jira_fields_cache

router = APIRouter(prefix="/api/admin/database", tags=["admin"])


def _settings_response(row) -> AdminDatabaseSettingsResponse:
    cache = list(row.jira_fields_cache or [])
    return AdminDatabaseSettingsResponse(
        jira_impact_analysis_field=row.jira_impact_analysis_field or "",
        jira_unit_testing_field=row.jira_unit_testing_field or "",
        jira_admin_database_field=row.jira_admin_database_field or "",
        jira_impact_analysis_field_name=resolved_field_name(
            row, settings.jira_impact_analysis_field, row.jira_impact_analysis_field
        ),
        jira_unit_testing_field_name=resolved_field_name(
            row, settings.jira_unit_testing_field, row.jira_unit_testing_field
        ),
        jira_admin_database_field_name=resolved_field_name(
            row, settings.jira_admin_database_field, row.jira_admin_database_field
        ),
        env_jira_impact_analysis_field=settings.jira_impact_analysis_field or "",
        env_jira_unit_testing_field=settings.jira_unit_testing_field or "",
        env_jira_admin_database_field=settings.jira_admin_database_field or "",
        jira_fields_cache_total=len(cache),
        jira_fields_cached_at=row.jira_fields_cached_at,
        updated_at=row.updated_at,
    )


@router.get("", response_model=AdminDatabaseSettingsResponse)
async def get_admin_database_settings(
    _session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await get_or_create_app_settings(db)
    return _settings_response(row)


@router.put("", response_model=AdminDatabaseSettingsResponse)
async def update_admin_database_settings(
    body: AdminDatabaseSettingsUpdate,
    _session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await get_or_create_app_settings(db)
    row.jira_impact_analysis_field = body.jira_impact_analysis_field.strip()
    row.jira_unit_testing_field = body.jira_unit_testing_field.strip()
    row.jira_admin_database_field = body.jira_admin_database_field.strip()
    await db.commit()
    await db.refresh(row)
    return _settings_response(row)


@router.post("/sync-jira-fields", response_model=SyncJiraFieldsResponse)
async def sync_admin_jira_fields(
    session: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Fetch the full Jira field list and store id/name mapping in the database."""
    jira = jira_client_from_session(session)
    try:
        items = await sync_jira_fields_cache(db, jira)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Jira") from exc

    row = await get_or_create_app_settings(db)
    return SyncJiraFieldsResponse(
        fields=[JiraFieldItem(**item) for item in items],
        total=len(items),
        cached_at=row.jira_fields_cached_at,
    )
