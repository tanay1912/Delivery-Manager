import json
import re

from openai import AsyncOpenAI

from app.clients.cursor_client import _project_agent_context, _repo_stack_context
from app.clients.jira_client import JiraClient


def _code_generation_preamble(
    *,
    rules: str = "",
    skills: str = "",
    repo_stack_summary: str = "",
) -> str:
    """Shared mandatory context for OpenAI code generation (mirrors Cursor SDK prompts)."""
    parts: list[str] = []
    project = _project_agent_context(rules=rules, skills=skills)
    if project:
        parts.append(project)
    repo = _repo_stack_context(repo_stack_summary=repo_stack_summary)
    if repo:
        parts.append(repo)
    if parts:
        parts.append(
            "CRITICAL: Implement only within the detected repository technology stack. "
            "Do NOT generate a greenfield app, SPA, or code for a different framework "
            "(e.g. do not use React, Vue, Next.js, or standalone Node apps when Magento 2 is detected). "
            "Match existing module layout, naming, and file paths in the repository.\n\n"
        )
    return "".join(parts)


class OpenAIClient:
    def __init__(self, api_key: str, model: str):
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model

    async def estimate_issue(
        self,
        issue_key: str,
        summary: str,
        description: str,
        *,
        jira_comments: str = "",
    ) -> dict:
        comments_block = ""
        if jira_comments.strip():
            comments_block = f"\n\nJira comments and discussion:\n{jira_comments.strip()}"
        else:
            comments_block = "\n\nJira comments and discussion:\n(none)"

        prompt = f"""You are a senior software engineer estimating Jira work.

Read ALL of the following before estimating — task heading, description, and every Jira comment:
Issue: {issue_key}
Task heading (summary): {summary}
Description:
{description or "(no description)"}{comments_block}

Assess whether the ticket has enough detail to estimate and implement confidently.
Use the task heading, description, and full comment thread together — comments may add scope or answer earlier questions.
If requirements are vague, acceptance criteria are missing, or scope is unclear, set needs_clarification to true.

Formatting rules (use literal newlines in JSON string values):
- Put each numbered item on its own line: "1. First item\\n2. Second item\\n3. Third item"
- Do not run multiple numbered points together on one line.

Respond with JSON only:
{{
  "story_points": <number 1-13>,
  "hours": <number>,
  "reasoning": "<brief explanation of the estimate>",
  "needs_clarification": <boolean>,
  "clarification_question": "<numbered clarification questions for Jira when information is missing or ambiguous — one question per line (1. ...\\n2. ...); empty string only if the ticket is fully clear>",
  "development_plan": "<concrete implementation plan as numbered steps — one step per line (1. ...\\n2. ...): approach, components/files to change, ordered steps, and dependencies>",
  "test_cases": "<numbered manual test cases — one per line (1. ...\\n2. ...): happy path, edge cases, and regression checks>"
}}"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        needs_clarification = bool(data.get("needs_clarification", False))
        clarification = JiraClient.format_text_for_jira(str(data.get("clarification_question", "")))
        if needs_clarification and not clarification.strip():
            clarification = JiraClient.format_text_for_jira(
                "1. Could you clarify the acceptance criteria and expected behaviour for this ticket?"
            )
        return {
            "story_points": float(data.get("story_points", 3)),
            "hours": float(data.get("hours", 4)),
            "reasoning": JiraClient.format_text_for_jira(str(data.get("reasoning", ""))),
            "needs_clarification": needs_clarification,
            "clarification_question": clarification.strip(),
            "development_plan": JiraClient.format_text_for_jira(str(data.get("development_plan", ""))),
            "test_cases": JiraClient.format_text_for_jira(str(data.get("test_cases", ""))),
        }

    async def generate_clarification_questions(
        self,
        issue_key: str,
        summary: str,
        description: str,
        *,
        jira_comments: str = "",
    ) -> str:
        comments_block = ""
        if jira_comments.strip():
            comments_block = f"\n\nJira comments and discussion:\n{jira_comments.strip()}"
        else:
            comments_block = "\n\nJira comments and discussion:\n(none)"

        prompt = f"""You are a senior software engineer reviewing a Jira ticket before estimation.

Read ALL of the following — task heading, description, and every Jira comment:
Issue: {issue_key}
Task heading (summary): {summary}
Description:
{description or "(no description)"}{comments_block}

Draft numbered clarification questions to post in Jira before estimating this work.
Focus on missing acceptance criteria, ambiguous scope, technical unknowns, dependencies, and edge cases.
Ask specific, actionable questions — not generic placeholders.
Include at least one question even if the ticket looks mostly clear (confirm assumptions or edge cases).

Formatting rules (use literal newlines in JSON string values):
- Put each numbered item on its own line: "1. First question\\n2. Second question\\n3. Third question"
- Do not run multiple numbered points together on one line.

Respond with JSON only:
{{
  "clarification_question": "<numbered clarification questions — one per line (1. ...\\n2. ...); at least one question>"
}}"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        clarification = JiraClient.format_text_for_jira(str(data.get("clarification_question", "")))
        if not clarification.strip():
            clarification = JiraClient.format_text_for_jira(
                "1. Could you clarify the acceptance criteria and expected behaviour for this ticket?"
            )
        return clarification.strip()

    async def generate_code_changes(
        self,
        issue_key: str,
        summary: str,
        description: str,
        *,
        rules: str = "",
        skills: str = "",
        repo_stack_summary: str = "",
    ) -> dict:
        preamble = _code_generation_preamble(
            rules=rules,
            skills=skills,
            repo_stack_summary=repo_stack_summary,
        )
        prompt = f"""{preamble}You are a senior software engineer implementing a Jira ticket in an EXISTING repository.

Issue: {issue_key}
Summary: {summary}
Ticket definition (description and Jira comments):
{description or "(no description)"}

Generate minimal, focused code changes to implement only what the ticket describes.
Use file paths and patterns that match the repository technology stack above.
Respond with JSON only:
{{
  "files": [
    {{"path": "relative/path/to/file.ext", "content": "full file content", "action": "create|modify"}}
  ],
  "implementation_notes": "brief summary of what was done"
}}

Rules:
- Only include files that need changes (max 5 files)
- Provide complete file contents, not diffs
- Keep changes minimal and production-ready
- File paths must be valid for the detected stack (e.g. Magento 2 modules under app/code/Vendor/Module)"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        return {
            "files": data.get("files", []),
            "implementation_notes": str(data.get("implementation_notes", "")),
        }

    async def apply_code_revision(
        self,
        issue_key: str,
        summary: str,
        revision_prompt: str,
        current_files: list[dict],
        branch_paths: list[str] | None = None,
        *,
        rules: str = "",
        skills: str = "",
        repo_stack_summary: str = "",
    ) -> dict:
        files_block = "\n\n".join(
            f"--- {item['path']} ---\n{item['content']}"
            for item in current_files
            if item.get("path") and item.get("content") is not None
        )
        all_paths = branch_paths or [item["path"] for item in current_files if item.get("path")]
        paths_block = "\n".join(f"- {path}" for path in all_paths) or "(none)"
        preamble = _code_generation_preamble(
            rules=rules,
            skills=skills,
            repo_stack_summary=repo_stack_summary,
        )
        prompt = f"""{preamble}You are a senior software engineer applying follow-up changes to an existing implementation.

Issue: {issue_key}
Summary: {summary}

All files currently changed on the feature branch:
{paths_block}

File contents on the branch:
{files_block or "(no file contents provided)"}

Additional changes requested by the reviewer:
{revision_prompt}

Respond with JSON only:
{{
  "files": [
    {{"path": "relative/path/to/file.ext", "content": "full updated file content", "action": "modify"}},
    {{"path": "relative/path/to/remove.ext", "action": "delete"}}
  ],
  "implementation_notes": "brief summary of what was changed"
}}

Rules:
- Use action "modify" (with full content) or "delete" (no content field)
- When asked to remove a module, package, or set of files, include EVERY matching path from the branch file list with action "delete"
- Deleting files from the branch is required — do not only edit references in other files
- Only include paths that exist in the branch file list above
- Provide complete file contents for modifications, not diffs
- Keep changes minimal and focused on the requested revision"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        return {
            "files": data.get("files", []),
            "implementation_notes": str(data.get("implementation_notes", "")),
        }

    async def identify_files_to_delete(
        self,
        issue_key: str,
        summary: str,
        revision_prompt: str,
        branch_paths: list[str],
    ) -> list[str]:
        if not branch_paths:
            return []

        paths_json = json.dumps(branch_paths, indent=2)
        prompt = f"""You are a senior software engineer reviewing a pull request revision request.

Issue: {issue_key}
Summary: {summary}

Files currently in the pull request diff:
{paths_json}

Reviewer request:
{revision_prompt}

Identify which paths from the list above must be DELETED from the feature branch to fully satisfy the request.
If the request asks to remove a module or package, include every file path that belongs to it.

Respond with JSON only:
{{"delete_paths": ["relative/path/to/file.ext"]}}

Rules:
- Only include paths from the provided list
- Return an empty array if no deletions are needed
- Prefer deleting all files that are part of the module or feature being removed"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        allowed = set(branch_paths)
        return [
            path
            for path in (data.get("delete_paths") or [])
            if isinstance(path, str) and path in allowed
        ]

    async def generate_impact_analysis(
        self,
        issue_key: str,
        summary: str,
        description: str,
        estimation_hours: float | None,
        estimation_reasoning: str,
    ) -> dict:
        prompt = f"""You are a senior software engineer writing an Impact Analysis for a Jira ticket before implementation begins.

Issue: {issue_key}
Summary: {summary}
Ticket details (description and Jira comments):
{description or "(no description)"}

Estimation: {estimation_hours if estimation_hours is not None else "n/a"} hours
Estimation notes: {estimation_reasoning or "(none)"}

Write a concise Impact Analysis covering:
- Affected areas, systems, or components
- Technical risks and dependencies
- Testing considerations
- Rollback or mitigation notes if relevant

Respond with JSON only:
{{"impact_analysis": "<multi-paragraph text suitable for a Jira Impact Analysis field>"}}"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        return {
            "impact_analysis": str(data.get("impact_analysis", "")).strip(),
        }

    async def resolve_verification_url(
        self,
        *,
        issue_key: str,
        summary: str,
        description: str,
        changed_files: list,
        base_website_url: str,
    ) -> dict:
        changed_paths = [
            str(item["path"])
            for item in changed_files
            if isinstance(item, dict) and item.get("path")
        ]
        files_block = "\n".join(f"- {path}" for path in changed_paths) or "(none)"
        prompt = f"""You are a QA engineer deciding which website page to screenshot for Unit Testing verification.

Issue: {issue_key}
Summary: {summary}
Ticket details:
{description or "(no description)"}

Changed files in this delivery:
{files_block}

Base website URL: {base_website_url}

Choose the single most relevant page to screenshot based on the functionality that was developed.
Examples: homepage, category page, product page, CMS page, checkout, cart, search results, account page, etc.
Prefer a specific URL or path mentioned in the ticket when present.
If the change is global (theme, header, footer, CSS) or the target page is unclear, use the homepage.

Respond with JSON only:
{{
  "url": "<full absolute URL to screenshot, must stay on the same site as the base URL>",
  "page_type": "<homepage|category|product|cms|checkout|cart|search|account|other>",
  "reason": "<one sentence explaining why this page was chosen>"
}}"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        return {
            "url": str(data.get("url", "")).strip(),
            "page_type": str(data.get("page_type", "other")).strip().lower() or "other",
            "reason": str(data.get("reason", "")).strip(),
        }

    async def verify_website_screenshot(
        self,
        issue_key: str,
        summary: str,
        environment: str,
        website_url: str,
        screenshot_png: bytes,
        *,
        page_type: str = "",
        page_reason: str = "",
    ) -> dict:
        import base64

        image_b64 = base64.b64encode(screenshot_png).decode("ascii")
        page_context = ""
        if page_type or page_reason:
            page_context = (
                f"\nPage type: {page_type or 'unknown'}"
                f"\nWhy this page: {page_reason or '(not specified)'}\n"
            )
        prompt = f"""You are a QA engineer verifying a website change for a Jira ticket.

Issue: {issue_key}
Summary: {summary}
Environment: {environment}
URL: {website_url}
{page_context}
Review the screenshot and assess whether the site appears healthy and whether the described change
is likely visible or complete on this page. Note layout issues, errors, blank pages, or obvious regressions.

Respond with JSON only:
{{
  "passed": <boolean>,
  "summary": "<short verification summary for Jira>",
  "findings": ["<bullet finding>", "..."],
  "recommendations": "<optional follow-up for the team>"
}}"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                        },
                    ],
                }
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        return {
            "passed": bool(data.get("passed", False)),
            "summary": str(data.get("summary", "")).strip(),
            "findings": [str(f) for f in (data.get("findings") or []) if str(f).strip()],
            "recommendations": str(data.get("recommendations", "")).strip(),
        }


def slugify(text: str, max_len: int = 40) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    return value[:max_len] or "change"
