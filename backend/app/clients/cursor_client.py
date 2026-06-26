from __future__ import annotations


class CursorDevelopmentError(Exception):
    pass


def _project_agent_context(*, rules: str = "", skills: str = "") -> str:
    """Mandatory Cursor SDK instructions from Admin → Mappings."""
    if not rules.strip() and not skills.strip():
        return ""
    sections = [
        "=== MANDATORY: Project rules and skills ===",
        "You MUST follow these conventions for every file you create or modify.",
        "Do NOT generate a greenfield app or a different technology stack.",
        "Match the existing repository structure and the rules/skills below.",
    ]
    if rules.strip():
        sections.append(f"\nProject rules:\n{rules.strip()}")
    if skills.strip():
        sections.append(f"\nProject skills:\n{skills.strip()}")
    return "\n".join(sections) + "\n\n"


def _cloud_agent_options(*, repo_url: str, branch_name: str) -> object:
    from cursor_sdk import CloudAgentOptions, CloudRepository

    return CloudAgentOptions(
        repos=[CloudRepository(url=repo_url, starting_ref=branch_name)],
        work_on_current_branch=True,
        auto_create_pr=False,
        skip_reviewer_request=True,
    )


def _repo_stack_context(*, repo_stack_summary: str = "") -> str:
    summary = repo_stack_summary.strip()
    if not summary:
        return ""
    return f"Repository technology (from config files):\n{summary}\n\n"


def _cursor_repo_instructions(*, branch_name: str, master_branch: str) -> str:
    return (
        f"Before implementing, explore the repository on branch `{branch_name}` "
        f"(from `{master_branch}`) to confirm module layout, naming conventions, "
        f"and patterns already used in this codebase. "
        f"Match the detected technology stack and existing file structure.\n\n"
    )


def run_implementation_agent(
    *,
    issue_key: str,
    summary: str,
    description: str,
    branch_name: str,
    master_branch: str,
    repo_url: str,
    api_key: str,
    model: str,
    rules: str = "",
    skills: str = "",
    repo_stack_summary: str = "",
) -> dict:
    """Run a Cursor cloud agent to implement changes on the feature branch."""
    if not api_key:
        raise CursorDevelopmentError("Cursor API key is not configured")

    try:
        from cursor_sdk import Agent, AgentOptions
    except ImportError as exc:
        raise CursorDevelopmentError("cursor-sdk is not installed") from exc

    project_context = _project_agent_context(rules=rules, skills=skills)
    repo_context = _repo_stack_context(repo_stack_summary=repo_stack_summary)
    explore = _cursor_repo_instructions(branch_name=branch_name, master_branch=master_branch)
    prompt = (
        f"{project_context}"
        f"{repo_context}"
        f"{explore}"
        f"Implement Jira ticket {issue_key}: {summary}\n\n"
        f"Ticket definition (description and Jira comments):\n{description or '(no description)'}\n\n"
        f"Create and work on branch `{branch_name}` from `{master_branch}`. "
        f"Implement only what the ticket requires — keep changes minimal. "
        f"All code MUST comply with the project rules and skills above. "
        f"Commit all required changes to `{branch_name}`. "
        f"Do not open pull requests — only implement and commit on the feature branch."
    )

    try:
        result = Agent.prompt(
            prompt,
            AgentOptions(
                api_key=api_key,
                model=model,
                cloud=_cloud_agent_options(repo_url=repo_url, branch_name=branch_name),
            ),
        )
    except Exception as exc:
        raise CursorDevelopmentError(f"Cursor agent failed to start: {exc}") from exc

    if result.status == "error":
        raise CursorDevelopmentError(
            f"Cursor agent run failed (run_id={getattr(result, 'id', 'unknown')})"
        )

    notes = ""
    if hasattr(result, "result") and result.result:
        notes = str(result.result).strip()

    return {
        "implementation_notes": notes or f"Cursor agent completed for {issue_key}",
        "cursor_run_id": getattr(result, "id", None),
        "cursor_agent_id": getattr(result, "agent_id", None),
        "source": "cursor_sdk",
    }


def run_revision_agent(
    *,
    issue_key: str,
    summary: str,
    description: str,
    branch_name: str,
    master_branch: str,
    repo_url: str,
    revision_prompt: str,
    api_key: str,
    model: str,
    rules: str = "",
    skills: str = "",
    repo_stack_summary: str = "",
) -> dict:
    """Apply follow-up changes on an existing feature branch via Cursor cloud agent."""
    if not api_key:
        raise CursorDevelopmentError("Cursor API key is not configured")

    try:
        from cursor_sdk import Agent, AgentOptions
    except ImportError as exc:
        raise CursorDevelopmentError("cursor-sdk is not installed") from exc

    project_context = _project_agent_context(rules=rules, skills=skills)
    repo_context = _repo_stack_context(repo_stack_summary=repo_stack_summary)
    explore = _cursor_repo_instructions(branch_name=branch_name, master_branch=master_branch)
    prompt = (
        f"{project_context}"
        f"{repo_context}"
        f"{explore}"
        f"Jira ticket {issue_key}: {summary}\n\n"
        f"Ticket definition (description and Jira comments):\n{description or '(no description)'}\n\n"
        f"Additional changes requested:\n{revision_prompt}\n\n"
        f"The implementation already exists on branch `{branch_name}` (created from `{master_branch}`). "
        f"Apply only the requested changes on `{branch_name}`. "
        f"All code MUST comply with the project rules and skills above. "
        f"Commit all changes to `{branch_name}`. Do not open pull requests.\n\n"
        f"If the request asks to remove, delete, or exclude files or an entire module, "
        f"you MUST delete those files from git on `{branch_name}` using git rm or equivalent. "
        f"Do not only edit references in layout or config files — removed files must disappear "
        f"from the branch so they are no longer in the pull request diff."
    )

    try:
        result = Agent.prompt(
            prompt,
            AgentOptions(
                api_key=api_key,
                model=model,
                cloud=_cloud_agent_options(repo_url=repo_url, branch_name=branch_name),
            ),
        )
    except Exception as exc:
        raise CursorDevelopmentError(f"Cursor revision agent failed: {exc}") from exc

    if result.status == "error":
        raise CursorDevelopmentError(
            f"Cursor revision agent failed (run_id={getattr(result, 'id', 'unknown')})"
        )

    notes = ""
    if hasattr(result, "result") and result.result:
        notes = str(result.result).strip()

    return {
        "implementation_notes": notes or f"Revision applied for {issue_key}",
        "cursor_run_id": getattr(result, "id", None),
        "source": "cursor_sdk",
    }
