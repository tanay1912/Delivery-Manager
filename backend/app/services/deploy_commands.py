import re
import shlex
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProjectRepoMapping

_GIT_AUTH_COMMAND = re.compile(
    r"^git\s+(pull|fetch|clone|push|submodule\s+update)\b",
    re.IGNORECASE,
)


def parse_post_pr_merge_commands(raw: str) -> list[str]:
    return [line.strip() for line in raw.splitlines() if line.strip()]


def build_post_merge_shell_script(
    project_root: str,
    commands_raw: str,
    *,
    use_sudo: bool = False,
) -> str:
    """Build a shell script that cds to project root, then runs each command in order."""
    commands = parse_post_pr_merge_commands(commands_raw)
    root = project_root.strip()
    if not root:
        script = " && ".join(commands) if commands else ""
    else:
        parts = [f"cd {shlex.quote(root)}", *commands]
        script = " && ".join(parts)
    if use_sudo and script:
        return f"sudo su - root -c {shlex.quote(script)}"
    return script


def command_needs_bitbucket_auth(command: str) -> bool:
    return bool(_GIT_AUTH_COMMAND.match(command.strip()))


def commands_need_bitbucket_auth(commands: list[str]) -> bool:
    return any(command_needs_bitbucket_auth(command) for command in commands)


def apply_bitbucket_auth_to_command(command: str, username: str, password: str) -> str:
    stripped = command.strip()
    if not command_needs_bitbucket_auth(stripped):
        return command

    helper = (
        f"!f() {{ echo username={shlex.quote(username)}; "
        f"echo password={shlex.quote(password)}; }}; f"
    )
    git_args = stripped[4:].lstrip()
    return (
        f"GIT_TERMINAL_PROMPT=0 git -c credential.helper={shlex.quote(helper)} {git_args}"
    )


def deploy_commands_for_environment(
    mapping: ProjectRepoMapping,
    environment: Literal["beta", "master"],
) -> str:
    if environment == "beta":
        return mapping.beta_post_pr_merge_command
    return mapping.master_post_pr_merge_command


async def fetch_deploy_commands_from_db(
    db: AsyncSession,
    project_key: str,
    environment: Literal["beta", "master"],
) -> list[str]:
    """Read deployment commands directly from the database, bypassing ORM session cache."""
    column = (
        ProjectRepoMapping.beta_post_pr_merge_command
        if environment == "beta"
        else ProjectRepoMapping.master_post_pr_merge_command
    )
    result = await db.execute(
        select(column).where(ProjectRepoMapping.jira_project_key == project_key)
    )
    raw = result.scalar_one_or_none()
    if raw is None:
        return []
    return parse_post_pr_merge_commands(raw)


async def fetch_all_deploy_commands_from_db(
    db: AsyncSession,
    project_key: str,
) -> dict[str, list[str]]:
    """Return the latest Staging and Live deployment command lists for a project."""
    result = await db.execute(
        select(
            ProjectRepoMapping.beta_post_pr_merge_command,
            ProjectRepoMapping.master_post_pr_merge_command,
        ).where(ProjectRepoMapping.jira_project_key == project_key)
    )
    row = result.one_or_none()
    if not row:
        return {"beta": [], "master": []}
    return {
        "beta": parse_post_pr_merge_commands(row[0] or ""),
        "master": parse_post_pr_merge_commands(row[1] or ""),
    }
