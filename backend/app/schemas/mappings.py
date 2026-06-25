import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class MappingCreate(BaseModel):
    jira_project_key: str = Field(..., min_length=1, max_length=32)
    bitbucket_workspace: str = Field(..., min_length=1, max_length=128)
    bitbucket_repo_slug: str = Field(..., min_length=1, max_length=128)
    master_branch: str = Field(default="master", min_length=1, max_length=128)
    beta_branch: str = Field(default="beta", min_length=1, max_length=128)
    beta_website_url: str = Field(..., min_length=1, max_length=512)
    master_website_url: str = Field(..., min_length=1, max_length=512)

    @field_validator("jira_project_key")
    @classmethod
    def uppercase_project_key(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("beta_website_url", "master_website_url")
    @classmethod
    def strip_url(cls, value: str) -> str:
        return value.strip()


class MappingUpdate(BaseModel):
    jira_project_key: str | None = Field(default=None, min_length=1, max_length=32)
    bitbucket_workspace: str | None = Field(default=None, min_length=1, max_length=128)
    bitbucket_repo_slug: str | None = Field(default=None, min_length=1, max_length=128)
    master_branch: str | None = Field(default=None, min_length=1, max_length=128)
    beta_branch: str | None = Field(default=None, min_length=1, max_length=128)
    beta_website_url: str | None = Field(default=None, min_length=1, max_length=512)
    master_website_url: str | None = Field(default=None, min_length=1, max_length=512)

    @field_validator("jira_project_key")
    @classmethod
    def uppercase_project_key(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return value.strip().upper()

    @field_validator("beta_website_url", "master_website_url")
    @classmethod
    def strip_url(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return value.strip()


class MappingResponse(BaseModel):
    id: uuid.UUID
    jira_project_key: str
    bitbucket_workspace: str
    bitbucket_repo_slug: str
    master_branch: str
    beta_branch: str
    beta_website_url: str
    master_website_url: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MappingListResponse(BaseModel):
    mappings: list[MappingResponse]
