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
                """
                UPDATE project_repo_mappings
                SET master_branch = COALESCE(NULLIF(master_branch, ''), 'master'),
                    beta_branch = COALESCE(NULLIF(beta_branch, ''), 'beta'),
                    beta_website_url = COALESCE(beta_website_url, ''),
                    master_website_url = COALESCE(master_website_url, '')
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


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session
