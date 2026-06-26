from datetime import datetime

from pydantic import BaseModel, Field


class JiraFieldItem(BaseModel):
    id: str
    name: str
    custom: bool
    schema_type: str | None = None
    clause_names: list[str] = []


class JiraFieldsResponse(BaseModel):
    fields: list[JiraFieldItem]
    total: int
    cached_at: datetime | None = None
    source: str = "database"


class JiraIssueFieldMeta(BaseModel):
    id: str
    name: str
    required: bool = False
    schema_type: str | None = None
    allowed_values: list[dict] = []


class JiraIssueEditFieldsResponse(BaseModel):
    issue_key: str
    fields: list[JiraIssueFieldMeta]


class JiraTransitionFieldMeta(BaseModel):
    id: str
    name: str
    required: bool = False
    schema_type: str | None = None


class JiraTransitionItem(BaseModel):
    id: str
    name: str
    to_status: str | None = None
    fields: list[JiraTransitionFieldMeta] = []


class JiraIssueTransitionsResponse(BaseModel):
    issue_key: str
    transitions: list[JiraTransitionItem]
