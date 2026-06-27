"""Helpers for local project directory workflows during implementation."""

from __future__ import annotations

from pathlib import Path


def build_local_git_commands(
    project_dir: str,
    branch_name: str,
    *,
    master_branch: str = "master",
    issue_key: str = "",
) -> list[str]:
    """Shell commands to check out the feature branch in a local repo clone."""
    project_dir = project_dir.strip()
    branch_name = branch_name.strip()
    if not project_dir or not branch_name:
        return []

    commit_hint = f'{issue_key}: ' if issue_key else ""
    return [
        f"cd {project_dir}",
        "git fetch origin",
        f"git checkout {branch_name} 2>/dev/null || git checkout -b {branch_name} origin/{branch_name}",
        f"git pull origin {branch_name}",
        "# Edit files in your IDE, then commit and push:",
        "git add -A",
        f'git commit -m "{commit_hint}your message"',
        f"git push origin {branch_name}",
    ]


def write_code_files_to_local(project_dir: str, files: list[dict]) -> int:
    """Write generated or revised file contents into the configured local project directory."""
    root = Path(project_dir.strip())
    if not root.is_dir():
        return 0

    written = 0
    for item in files:
        if not isinstance(item, dict):
            continue
        rel_path = str(item.get("path") or "").strip()
        if not rel_path or ".." in Path(rel_path).parts:
            continue

        target = root / rel_path
        action = str(item.get("action") or "modify").lower()
        if action == "delete":
            if target.is_file():
                target.unlink()
                written += 1
            continue

        content = item.get("content")
        if content is None:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(content), encoding="utf-8")
        written += 1
    return written
