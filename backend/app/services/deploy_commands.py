import re
import shlex
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProjectRepoMapping

_GIT_AUTH_SUBCOMMAND = re.compile(
    r"\bgit(?:\s+-[^\s=]+(?:=[^\s]+)?)*\s+(?:pull|fetch|clone|push|submodule\s+update)\b",
    re.IGNORECASE,
)

_GIT_AUTH_FAILURE_PATTERNS = (
    re.compile(r"could not read (?:Username|Password)", re.IGNORECASE),
    re.compile(r"terminal prompts disabled", re.IGNORECASE),
    re.compile(r"Authentication failed", re.IGNORECASE),
    re.compile(r"Invalid username or password", re.IGNORECASE),
    re.compile(r"Username for ['\"]", re.IGNORECASE),
    re.compile(r"HTTP Basic: Access denied", re.IGNORECASE),
    re.compile(r"Permission denied \(publickey\)", re.IGNORECASE),
    re.compile(r"change-3222", re.IGNORECASE),
    re.compile(r"app passwords are deprecated", re.IGNORECASE),
    re.compile(r"returned error: 410", re.IGNORECASE),
)


_DOCKER_EXEC = re.compile(r"\bdocker(?:\s+compose)?\s+exec\b", re.IGNORECASE)
_DOCKER_TTY_FLAG = re.compile(r"^\s+(?:-[it]+\b|--(?:tty|interactive)\b)", re.IGNORECASE)
_TTY_FAILURE_PATTERNS = (
    re.compile(r"not a tty", re.IGNORECASE),
    re.compile(r"the input device is not a tty", re.IGNORECASE),
)


def parse_post_pr_merge_commands(raw: str) -> list[str]:
    return [line.strip() for line in raw.splitlines() if line.strip()]


def strip_docker_tty_flags(command: str) -> str:
    """Remove -i/-t from docker exec; SSH deploy runs without a TTY."""
    match = _DOCKER_EXEC.search(command)
    if not match:
        return command
    before = command[: match.end()]
    after = command[match.end() :]
    while True:
        stripped = _DOCKER_TTY_FLAG.sub("", after, count=1)
        if stripped == after:
            break
        after = stripped
    return before + after


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
    return bool(_GIT_AUTH_SUBCOMMAND.search(command.strip()))


def is_git_auth_failure(detail: str) -> bool:
    return any(pattern.search(detail) for pattern in _GIT_AUTH_FAILURE_PATTERNS)


def is_tty_failure(detail: str) -> bool:
    return any(pattern.search(detail) for pattern in _TTY_FAILURE_PATTERNS)


def format_deploy_command_failure(command: str, detail: str) -> str:
    display_command = command.strip()
    if is_git_auth_failure(detail):
        if re.search(r"change-3222|app passwords are deprecated|error: 410", detail, re.IGNORECASE):
            return (
                f"Git authentication failed while running `{display_command}`. "
                "Bitbucket app passwords no longer work for git pull. "
                "In Settings → Bitbucket, connect with your Atlassian account email and a "
                "Bitbucket API token (create one at id.atlassian.com, select Bitbucket, "
                "enable repository read/write scopes). Clear any separate Git credentials "
                "that still use an app password, then retry deployment."
            )
        return (
            f"Git authentication failed while running `{display_command}`. "
            "Add your Atlassian account email and Bitbucket API token in Settings, "
            "then retry deployment."
        )
    if is_tty_failure(detail):
        return (
            f"Deployment command failed ({display_command}): {detail}. "
            "Remove -it or -t from docker exec commands — deployment runs non-interactively over SSH."
        )
    return f"Deployment command failed ({display_command}): {detail}"


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
    git_prefix = f"GIT_TERMINAL_PROMPT=0 git -c credential.helper={shlex.quote(helper)}"
    match = re.search(r"\bgit\b", stripped, re.IGNORECASE)
    if not match:
        return command
    before = stripped[: match.start()]
    after = stripped[match.end() :].lstrip()
    return f"{before}{git_prefix} {after}".strip()


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
