import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class UserCredentials(Base):
    __tablename__ = "user_credentials"
    __table_args__ = (
        UniqueConstraint("atlassian_account_id", "site_host", name="uq_user_credentials_account_site"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    atlassian_account_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    site_host: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    site_url: Mapped[str] = mapped_column(String(512), nullable=False)
    site_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    atlassian_email: Mapped[str] = mapped_column(String(256), nullable=False)
    api_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    user_display_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    user_email: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    user_avatar_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    jira_cloud_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    bitbucket_username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    bitbucket_app_password_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    bitbucket_display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    bitbucket_git_username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    bitbucket_git_password_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    openai_api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    openai_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cursor_api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    cursor_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class ProjectRepoMapping(Base):
    __tablename__ = "project_repo_mappings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    jira_project_key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    bitbucket_workspace: Mapped[str] = mapped_column(String(128), nullable=False)
    bitbucket_repo_slug: Mapped[str] = mapped_column(String(128), nullable=False)
    master_branch: Mapped[str] = mapped_column(String(128), nullable=False, default="master")
    beta_branch: Mapped[str] = mapped_column(String(128), nullable=False, default="beta")
    beta_website_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    master_website_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    rules: Mapped[str] = mapped_column(Text, nullable=False, default="")
    skills: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ssh_host: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    ssh_port: Mapped[int] = mapped_column(nullable=False, default=22)
    ssh_username: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    ssh_password_encrypted: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ssh_private_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ssh_auth_type: Mapped[str] = mapped_column(String(16), nullable=False, default="password")
    ssh_use_sudo: Mapped[bool] = mapped_column(nullable=False, default=False)
    project_root_directory: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    local_project_directory: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    beta_post_pr_merge_command: Mapped[str] = mapped_column(Text, nullable=False, default="")
    master_post_pr_merge_command: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    jira_impact_analysis_field: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    jira_unit_testing_field: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    jira_admin_database_field: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    jira_fields_cache: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    jira_fields_cached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class DeliveryRun(Base):
    __tablename__ = "delivery_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    jira_issue_key: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    jira_issue_id: Mapped[str] = mapped_column(String(32), nullable=False)
    project_key: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    summary: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    current_step: Mapped[str | None] = mapped_column(String(64), nullable=True)
    steps_log: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    context_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    estimation_hours: Mapped[float | None] = mapped_column(nullable=True)
    estimation_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    branch_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    pr_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    pr_id: Mapped[int | None] = mapped_column(nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
