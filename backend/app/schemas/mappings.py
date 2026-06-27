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
    rules: str = Field(default="", max_length=50000)
    skills: str = Field(default="", max_length=50000)
    ssh_host: str = Field(default="", max_length=256)
    ssh_port: int = Field(default=22, ge=1, le=65535)
    ssh_username: str = Field(default="", max_length=128)
    ssh_password: str = Field(default="", max_length=4096)
    ssh_private_key: str = Field(default="", max_length=50000)
    ssh_auth_type: str = Field(default="password", pattern="^(password|pem)$")
    ssh_use_sudo: bool = False
    project_root_directory: str = Field(default="", max_length=512)
    local_project_directory: str = Field(default="", max_length=512)
    beta_post_pr_merge_commands: str = Field(default="", max_length=50000)
    master_post_pr_merge_commands: str = Field(default="", max_length=50000)

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
    rules: str | None = Field(default=None, max_length=50000)
    skills: str | None = Field(default=None, max_length=50000)
    ssh_host: str | None = Field(default=None, max_length=256)
    ssh_port: int | None = Field(default=None, ge=1, le=65535)
    ssh_username: str | None = Field(default=None, max_length=128)
    ssh_password: str | None = Field(default=None, max_length=4096)
    ssh_private_key: str | None = Field(default=None, max_length=50000)
    ssh_auth_type: str | None = Field(default=None, pattern="^(password|pem)$")
    ssh_use_sudo: bool | None = None
    project_root_directory: str | None = Field(default=None, max_length=512)
    local_project_directory: str | None = Field(default=None, max_length=512)
    beta_post_pr_merge_commands: str | None = Field(default=None, max_length=50000)
    master_post_pr_merge_commands: str | None = Field(default=None, max_length=50000)

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
    rules: str
    skills: str
    ssh_host: str
    ssh_port: int
    ssh_username: str
    ssh_password_configured: bool
    ssh_private_key_configured: bool
    ssh_auth_type: str
    ssh_use_sudo: bool
    project_root_directory: str
    local_project_directory: str
    beta_post_pr_merge_commands: str
    master_post_pr_merge_commands: str
    beta_post_merge_shell_preview: str
    master_post_merge_shell_preview: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MappingListResponse(BaseModel):
    mappings: list[MappingResponse]


class MappingSshPrivateKeyResponse(BaseModel):
    ssh_private_key: str
