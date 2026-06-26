from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from sqlalchemy import text

from app.config import settings
from app.db.models import Base

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text(
                "ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS context_data JSONB NOT NULL DEFAULT '{}'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS steps_log JSONB NOT NULL DEFAULT '[]'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS master_branch VARCHAR(128)"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS beta_branch VARCHAR(128)"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS beta_website_url VARCHAR(512)"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS master_website_url VARCHAR(512)"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS rules TEXT NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS skills TEXT NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS ssh_host VARCHAR(256) NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS ssh_port INTEGER NOT NULL DEFAULT 22"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS ssh_username VARCHAR(128) NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS ssh_password_encrypted TEXT NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS ssh_private_key_encrypted TEXT NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS ssh_auth_type VARCHAR(16) NOT NULL DEFAULT 'password'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS ssh_use_sudo BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS project_root_directory VARCHAR(512) NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS local_project_directory VARCHAR(512) NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS post_pr_merge_command TEXT NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS beta_post_pr_merge_command TEXT NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE project_repo_mappings ADD COLUMN IF NOT EXISTS master_post_pr_merge_command TEXT NOT NULL DEFAULT ''"
            )
        )
        await conn.execute(
            text(
                """
                UPDATE project_repo_mappings
                SET master_branch = COALESCE(NULLIF(master_branch, ''), 'master'),
                    beta_branch = COALESCE(NULLIF(beta_branch, ''), 'beta'),
                    beta_website_url = COALESCE(beta_website_url, ''),
                    master_website_url = COALESCE(master_website_url, ''),
                    rules = COALESCE(rules, ''),
                    skills = COALESCE(skills, ''),
                    ssh_host = COALESCE(ssh_host, ''),
                    ssh_port = COALESCE(ssh_port, 22),
                    ssh_username = COALESCE(ssh_username, ''),
                    ssh_password_encrypted = COALESCE(ssh_password_encrypted, ''),
                    ssh_private_key_encrypted = COALESCE(ssh_private_key_encrypted, ''),
                    ssh_auth_type = COALESCE(NULLIF(ssh_auth_type, ''), 'password'),
                    project_root_directory = COALESCE(project_root_directory, ''),
                    local_project_directory = COALESCE(local_project_directory, ''),
                    post_pr_merge_command = COALESCE(post_pr_merge_command, ''),
                    beta_post_pr_merge_command = COALESCE(
                        NULLIF(beta_post_pr_merge_command, ''),
                        post_pr_merge_command,
                        ''
                    ),
                    master_post_pr_merge_command = COALESCE(
                        NULLIF(master_post_pr_merge_command, ''),
                        post_pr_merge_command,
                        ''
                    )
                """
            )
        )
        await conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_name = 'project_repo_mappings'
                          AND column_name = 'default_branch'
                    ) THEN
                        UPDATE project_repo_mappings
                        SET master_branch = COALESCE(NULLIF(master_branch, ''), default_branch, 'master')
                        WHERE master_branch IS NULL OR master_branch = '';
                    END IF;
                END $$;
                """
            )
        )
        await conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credentials_account_site
                ON user_credentials (atlassian_account_id, site_host)
                """
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS jira_cloud_id VARCHAR(128)"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS bitbucket_git_username VARCHAR(128)"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS bitbucket_git_password_encrypted TEXT"
            )
        )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session
