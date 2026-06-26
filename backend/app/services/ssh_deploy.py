import shlex
from collections.abc import Awaitable, Callable
from typing import Literal

from app.auth.crypto import decrypt_token
from app.db.models import ProjectRepoMapping
from app.services.deploy_commands import (
    apply_bitbucket_auth_to_command,
    build_post_merge_shell_script,
    commands_need_bitbucket_auth,
    deploy_commands_for_environment,
    parse_post_pr_merge_commands,
)

DeployCommandProgressCallback = Callable[[str, int, int, str, str], Awaitable[None]]


class DeployError(Exception):
    pass


def _load_asyncssh():
    try:
        import asyncssh
    except ImportError as exc:
        raise DeployError(
            "SSH deployment requires asyncssh. Rebuild the backend image: "
            "docker compose -f docker-compose.dev.yml up --build backend"
        ) from exc
    return asyncssh


def _deploy_script(mapping: ProjectRepoMapping, environment: Literal["beta", "master"]) -> str:
    commands_raw = deploy_commands_for_environment(mapping, environment)
    return build_post_merge_shell_script(mapping.project_root_directory, commands_raw)


def list_deploy_commands(mapping: ProjectRepoMapping, environment: Literal["beta", "master"]) -> list[str]:
    commands_raw = deploy_commands_for_environment(mapping, environment)
    return parse_post_pr_merge_commands(commands_raw)


def _command_with_root(project_root: str, command: str, *, use_sudo: bool = False) -> str:
    root = project_root.strip()
    if not root:
        full_command = command
    else:
        full_command = f"cd {shlex.quote(root)} && {command}"
    if use_sudo:
        return f"sudo su - root -c {shlex.quote(full_command)}"
    return full_command


def deploy_configured(mapping: ProjectRepoMapping, environment: Literal["beta", "master"]) -> bool:
    if not mapping.ssh_host.strip() or not mapping.ssh_username.strip():
        return False
    if not _deploy_script(mapping, environment).strip():
        return False
    if mapping.ssh_auth_type == "pem":
        return bool(mapping.ssh_private_key_encrypted)
    return bool(mapping.ssh_password_encrypted)


async def run_environment_deploy(
    mapping: ProjectRepoMapping,
    environment: Literal["beta", "master"],
    *,
    commands: list[str] | None = None,
    bitbucket_username: str | None = None,
    bitbucket_app_password: str | None = None,
    on_command_progress: DeployCommandProgressCallback | None = None,
    timeout_seconds: int = 600,
) -> str:
    if commands is None:
        commands = list_deploy_commands(mapping, environment)
    if not commands:
        raise DeployError(f"No {environment} deployment commands configured")

    display_commands = list(commands)
    execution_commands = list(commands)
    if commands_need_bitbucket_auth(commands):
        if not bitbucket_username or not bitbucket_app_password:
            raise DeployError(
                "Deployment includes git commands that require Bitbucket authentication. "
                "Add your Atlassian account email and Bitbucket API token in Settings."
            )
        execution_commands = [
            apply_bitbucket_auth_to_command(command, bitbucket_username, bitbucket_app_password)
            for command in commands
        ]

    host = mapping.ssh_host.strip()
    username = mapping.ssh_username.strip()
    if not host or not username:
        raise DeployError("SSH host and username are required for deployment")

    connect_kwargs: dict = {
        "host": host,
        "port": mapping.ssh_port or 22,
        "username": username,
        "known_hosts": None,
    }

    asyncssh = _load_asyncssh()

    if mapping.ssh_auth_type == "pem":
        if not mapping.ssh_private_key_encrypted:
            raise DeployError("SSH private key is not configured")
        key_data = decrypt_token(mapping.ssh_private_key_encrypted)
        connect_kwargs["client_keys"] = [asyncssh.import_private_key(key_data)]
    else:
        if not mapping.ssh_password_encrypted:
            raise DeployError("SSH password is not configured")
        connect_kwargs["password"] = decrypt_token(mapping.ssh_password_encrypted)

    outputs: list[str] = []
    total = len(execution_commands)
    try:
        async with asyncssh.connect(**connect_kwargs) as conn:
            for index, command in enumerate(execution_commands):
                display_command = display_commands[index]
                full_command = _command_with_root(
                    mapping.project_root_directory,
                    command,
                    use_sudo=bool(mapping.ssh_use_sudo),
                )
                if on_command_progress:
                    await on_command_progress("running", index, total, display_command, "")
                try:
                    result = await conn.run(full_command, check=False, timeout=timeout_seconds)
                except TimeoutError as exc:
                    raise DeployError(f"Deployment timed out after {timeout_seconds}s") from exc

                stdout = (result.stdout or "").strip()
                stderr = (result.stderr or "").strip()
                if result.exit_status != 0:
                    detail = stderr or stdout or f"exit code {result.exit_status}"
                    if on_command_progress:
                        await on_command_progress("failed", index, total, display_command, detail)
                    raise DeployError(f"Deployment command failed ({display_command}): {detail}")

                if on_command_progress:
                    await on_command_progress("completed", index, total, display_command, stdout)
                if stdout:
                    outputs.append(stdout)
    except asyncssh.Error as exc:
        raise DeployError(f"SSH connection failed: {exc}") from exc

    return "\n".join(outputs) or "Deployment completed successfully"
