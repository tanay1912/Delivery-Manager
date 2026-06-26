from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.jira_fields import JiraFieldItem


class AdminDatabaseSettingsResponse(BaseModel):
    jira_impact_analysis_field: str = ""
    jira_unit_testing_field: str = ""
    jira_admin_database_field: str = ""
    jira_impact_analysis_field_name: str = ""
    jira_unit_testing_field_name: str = ""
    jira_admin_database_field_name: str = ""
    env_jira_impact_analysis_field: str = ""
    env_jira_unit_testing_field: str = ""
    env_jira_admin_database_field: str = ""
    jira_fields_cache_total: int = 0
    jira_fields_cached_at: datetime | None = None
    updated_at: datetime | None = None


class AdminDatabaseSettingsUpdate(BaseModel):
    jira_impact_analysis_field: str = Field(default="", max_length=64)
    jira_unit_testing_field: str = Field(default="", max_length=64)
    jira_admin_database_field: str = Field(default="", max_length=64)


class SyncJiraFieldsResponse(BaseModel):
    fields: list[JiraFieldItem]
    total: int
    cached_at: datetime | None
