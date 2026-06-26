from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import AppSettings
from app.services.jira_fields import JiraFieldCatalog, field_name_from_items


async def get_or_create_app_settings(db: AsyncSession) -> AppSettings:
    row = await db.scalar(select(AppSettings).where(AppSettings.id == 1))
    if row is not None:
        return row

    row = AppSettings(id=1)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _resolved_field(env_value: str, db_value: str) -> str | None:
    configured = (env_value or db_value or "").strip()
    return configured or None


def resolved_field_name(row: AppSettings, env_value: str, db_value: str) -> str:
    field_id = _resolved_field(env_value, db_value)
    if not field_id:
        return ""
    cache = list(row.jira_fields_cache or [])
    return field_name_from_items(cache, field_id)


async def jira_impact_analysis_field_id(db: AsyncSession) -> str | None:
    row = await get_or_create_app_settings(db)
    return _resolved_field(settings.jira_impact_analysis_field, row.jira_impact_analysis_field)


async def jira_unit_testing_field_id(db: AsyncSession) -> str | None:
    row = await get_or_create_app_settings(db)
    return _resolved_field(settings.jira_unit_testing_field, row.jira_unit_testing_field)


async def jira_admin_database_field_id(db: AsyncSession) -> str | None:
    row = await get_or_create_app_settings(db)
    return _resolved_field(settings.jira_admin_database_field, row.jira_admin_database_field)


async def sync_jira_fields_cache(db: AsyncSession, jira) -> list[dict]:
    """Fetch all fields from Jira and persist id/name mapping in app_settings."""
    catalog = JiraFieldCatalog(jira)
    raw_fields = await catalog.refresh()
    items = [JiraFieldCatalog.to_item(field) for field in raw_fields if field.get("id")]
    items.sort(key=lambda item: str(item.get("name") or "").lower())

    row = await get_or_create_app_settings(db)
    row.jira_fields_cache = items
    row.jira_fields_cached_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    return items
