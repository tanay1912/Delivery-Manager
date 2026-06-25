from __future__ import annotations

from app.config import settings


class CursorDevelopmentError(Exception):
    pass


def run_implementation_agent(
    *,
    issue_key: str,
    summary: str,
    description: str,
    branch_name: str,
    master_branch: str,
    repo_url: str,
    repo_context: str,
) -> dict:
    """Run a Cursor cloud agent to implement changes on the feature branch."""
    if not settings.cursor_configured:
        raise CursorDevelopmentError("CURSOR_API_KEY is not configured")

    try:
        from cursor_sdk import Agent, AgentOptions, CloudAgentOptions
    except ImportError as exc:
        raise CursorDevelopmentError("cursor-sdk is not installed") from exc

    prompt = (
        f"Implement Jira ticket {issue_key}: {summary}\n\n"
        f"Description:\n{description or '(no description)'}\n\n"
        f"Repository context:\n{repo_context[:8000]}\n\n"
        f"Create and work on branch `{branch_name}` from `{master_branch}`. "
        f"Commit all required changes to `{branch_name}`. "
        f"Do not open pull requests — only implement and commit on the feature branch."
    )

    try:
        result = Agent.prompt(
            prompt,
            AgentOptions(
                api_key=settings.cursor_api_key,
                model=settings.cursor_model,
                cloud=CloudAgentOptions(
                    repos=[repo_url],
                    auto_create_pr=False,
                    skip_reviewer_request=True,
                ),
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
    branch_name: str,
    master_branch: str,
    repo_url: str,
    revision_prompt: str,
) -> dict:
    """Apply follow-up changes on an existing feature branch via Cursor cloud agent."""
    if not settings.cursor_configured:
        raise CursorDevelopmentError("CURSOR_API_KEY is not configured")

    try:
        from cursor_sdk import Agent, AgentOptions, CloudAgentOptions
    except ImportError as exc:
        raise CursorDevelopmentError("cursor-sdk is not installed") from exc

    prompt = (
        f"Jira ticket {issue_key}: {summary}\n\n"
        f"Additional changes requested:\n{revision_prompt}\n\n"
        f"The implementation already exists on branch `{branch_name}` (created from `{master_branch}`). "
        f"Apply only the requested changes on `{branch_name}`. "
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
                api_key=settings.cursor_api_key,
                model=settings.cursor_model,
                cloud=CloudAgentOptions(
                    repos=[repo_url],
                    auto_create_pr=False,
                    skip_reviewer_request=True,
                ),
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
