import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
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
