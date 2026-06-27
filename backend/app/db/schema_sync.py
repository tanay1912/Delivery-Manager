"""Keep the Postgres schema aligned with SQLAlchemy models on every startup."""

from __future__ import annotations

from sqlalchemy import Boolean, Integer, Text, inspect, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection
from sqlalchemy.schema import Column, UniqueConstraint

from app.db.models import Base

_DIALECT = postgresql.dialect()


def _default_sql(column: Column) -> str | None:
    if column.server_default is not None:
        compiled = column.server_default.compile(dialect=_DIALECT)
        return f"DEFAULT {compiled}"

    if column.default is None:
        return None

    if column.default.is_scalar:
        value = column.default.arg
        if isinstance(value, str):
            return f"DEFAULT '{value}'"
        if isinstance(value, bool):
            return f"DEFAULT {'TRUE' if value else 'FALSE'}"
        if isinstance(value, int):
            return f"DEFAULT {value}"
        return None

    if column.default.is_callable:
        factory = column.default.arg
        if factory is list:
            return "DEFAULT '[]'::jsonb"
        if factory is dict:
            return "DEFAULT '{}'::jsonb"

    return None


def _column_definition_sql(column: Column) -> str:
    type_sql = column.type.compile(dialect=_DIALECT)
    parts = [type_sql]

    default_sql = _default_sql(column)
    if default_sql:
        parts.append(default_sql)
    elif not column.nullable:
        # Existing rows need a value when adding NOT NULL columns.
        if isinstance(column.type, postgresql.JSONB):
            parts.append("DEFAULT '{}'::jsonb" if column.name.endswith("_data") else "DEFAULT '[]'::jsonb")
        elif isinstance(column.type, Text):
            parts.append("DEFAULT ''")
        elif isinstance(column.type, (Integer,)):
            parts.append("DEFAULT 0")
        elif isinstance(column.type, Boolean):
            parts.append("DEFAULT FALSE")
        else:
            parts.append("DEFAULT ''")

    if not column.nullable:
        parts.append("NOT NULL")

    return " ".join(parts)


def _sync_columns(connection: Connection) -> None:
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue

        existing_columns = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing_columns:
                continue
            definition = _column_definition_sql(column)
            connection.execute(
                text(
                    f"ALTER TABLE {table.name} "
                    f"ADD COLUMN IF NOT EXISTS {column.name} {definition}"
                )
            )


def _sync_unique_constraints(connection: Connection) -> None:
    for table in Base.metadata.sorted_tables:
        for constraint in table.constraints:
            if not isinstance(constraint, UniqueConstraint) or not constraint.name:
                continue
            columns = ", ".join(column.name for column in constraint.columns)
            connection.execute(
                text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS {constraint.name} "
                    f"ON {table.name} ({columns})"
                )
            )


def _run_data_migrations(connection: Connection) -> None:
    connection.execute(
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
                beta_post_pr_merge_command = COALESCE(NULLIF(beta_post_pr_merge_command, ''), ''),
                master_post_pr_merge_command = COALESCE(NULLIF(master_post_pr_merge_command, ''), '')
            """
        )
    )

    connection.execute(
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'project_repo_mappings'
                      AND column_name = 'post_pr_merge_command'
                ) THEN
                    UPDATE project_repo_mappings
                    SET beta_post_pr_merge_command = COALESCE(
                            NULLIF(beta_post_pr_merge_command, ''),
                            post_pr_merge_command,
                            ''
                        ),
                        master_post_pr_merge_command = COALESCE(
                            NULLIF(master_post_pr_merge_command, ''),
                            post_pr_merge_command,
                            ''
                        );
                END IF;
            END $$;
            """
        )
    )

    connection.execute(
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


def _seed_app_settings(connection: Connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO app_settings (
                id,
                jira_impact_analysis_field,
                jira_unit_testing_field,
                jira_admin_database_field,
                jira_fields_cache
            )
            VALUES (1, '', '', '', '[]'::jsonb)
            ON CONFLICT (id) DO NOTHING
            """
        )
    )


def sync_schema(connection: Connection) -> None:
    """Create missing tables/columns and apply lightweight data backfills."""
    Base.metadata.create_all(bind=connection)
    _sync_columns(connection)
    _sync_unique_constraints(connection)
    _run_data_migrations(connection)
    _seed_app_settings(connection)
