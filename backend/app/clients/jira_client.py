import httpx


class JiraClient:
    def __init__(self, site_url: str, email: str, api_token: str, cloud_id: str | None = None):
        self.site_url = site_url.rstrip("/")
        self.email = email
        self.api_token = api_token
        self.cloud_id = cloud_id
        if cloud_id:
            self.base_url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3"
        else:
            self.base_url = f"{self.site_url}/rest/api/3"

    def _auth(self) -> tuple[str, str]:
        return (self.email, self.api_token)

    def _headers(self) -> dict:
        return {"Accept": "application/json"}

    async def get_myself(self) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/myself",
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def get_server_info(self) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/serverInfo",
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def get_projects(
        self,
        start_at: int = 0,
        max_results: int = 50,
        query: str | None = None,
    ) -> dict:
        params: dict = {"startAt": start_at, "maxResults": max_results}
        if query:
            params["query"] = query

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/project/search",
                params=params,
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def search_issues(
        self,
        jql: str,
        max_results: int = 50,
        next_page_token: str | None = None,
    ) -> dict:
        fields = ["summary", "status", "priority", "assignee", "updated", "project"]
        body: dict = {
            "jql": jql,
            "maxResults": max_results,
            "fields": fields,
        }
        if next_page_token:
            body["nextPageToken"] = next_page_token

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/search/jql",
                json=body,
                auth=self._auth(),
                headers={**self._headers(), "Content-Type": "application/json"},
            )
            response.raise_for_status()
            return response.json()

    async def get_issue(self, issue_key: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/issue/{issue_key}",
                params={"fields": "summary,description,status,project,assignee,timetracking,customfield_10016"},
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def get_issue_comments(self, issue_key: str) -> list[dict]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/issue/{issue_key}/comment",
                params={"orderBy": "created", "maxResults": 100},
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json().get("comments", [])

    async def get_transitions(self, issue_key: str) -> list[dict]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/issue/{issue_key}/transitions",
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json().get("transitions", [])

    async def transition_issue(self, issue_key: str, transition_id: str) -> None:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/issue/{issue_key}/transitions",
                json={"transition": {"id": transition_id}},
                auth=self._auth(),
                headers={**self._headers(), "Content-Type": "application/json"},
            )
            response.raise_for_status()

    async def update_issue(self, issue_key: str, fields: dict) -> None:
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{self.base_url}/issue/{issue_key}",
                json={"fields": fields},
                auth=self._auth(),
                headers={**self._headers(), "Content-Type": "application/json"},
            )
            response.raise_for_status()

    async def add_comment(self, issue_key: str, body: str) -> None:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/issue/{issue_key}/comment",
                json={"body": self._adf_paragraph(body)},
                auth=self._auth(),
                headers={**self._headers(), "Content-Type": "application/json"},
            )
            response.raise_for_status()

    async def add_attachment(self, issue_key: str, filename: str, content: bytes, mime_type: str = "image/png") -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/issue/{issue_key}/attachments",
                files={"file": (filename, content, mime_type)},
                auth=self._auth(),
                headers={"X-Atlassian-Token": "no-check"},
                timeout=60.0,
            )
            response.raise_for_status()
            return response.json()[0] if response.content else {}

    @staticmethod
    def _adf_paragraph(text: str) -> dict:
        return JiraClient._adf_from_text(text)

    @staticmethod
    def _adf_from_text(text: str) -> dict:
        paragraphs = []
        for block in text.split("\n\n"):
            block = block.strip()
            if not block:
                continue
            lines = block.split("\n")
            content: list[dict] = []
            for i, line in enumerate(lines):
                if line:
                    content.append({"type": "text", "text": line})
                if i < len(lines) - 1:
                    content.append({"type": "hardBreak"})
            paragraphs.append(
                {
                    "type": "paragraph",
                    "content": content or [{"type": "text", "text": ""}],
                }
            )
        if not paragraphs:
            paragraphs = [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
        return {"type": "doc", "version": 1, "content": paragraphs}

    async def get_fields(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/field",
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def resolve_field_id(self, field_name: str, configured_id: str | None = None) -> str:
        if configured_id and configured_id.strip():
            field_id = configured_id.strip()
            return field_id if field_id.startswith("customfield_") else f"customfield_{field_id}"

        target = field_name.lower().strip()
        for field in await self.get_fields():
            if field.get("name", "").lower().strip() == target:
                return field["id"]
        raise ValueError(f"Jira field not found: {field_name}")

    async def set_paragraph_field(self, issue_key: str, field_id: str, text: str) -> None:
        try:
            await self.update_issue(issue_key, {field_id: self._adf_from_text(text)})
        except Exception:
            await self.update_issue(issue_key, {field_id: text})

    @staticmethod
    def extract_description(issue: dict) -> str:
        description = (issue.get("fields") or {}).get("description")
        if description is None:
            return ""
        if isinstance(description, str):
            return description
        return JiraClient._adf_to_text(description)

    @staticmethod
    def normalize_comments(raw_comments: list[dict]) -> list[dict]:
        normalized: list[dict] = []
        for comment in raw_comments:
            body = comment.get("body")
            if body is None:
                text = ""
            elif isinstance(body, str):
                text = body
            else:
                text = JiraClient._adf_to_text(body)
            text = text.strip()
            if not text:
                continue
            author = (comment.get("author") or {}).get("displayName", "Unknown")
            normalized.append(
                {
                    "author": author,
                    "created": comment.get("created", ""),
                    "body": text,
                }
            )
        return normalized

    @staticmethod
    def format_comments_for_ai(comments: list[dict], *, exclude_delivery_manager: bool = True) -> str:
        lines: list[str] = []
        for comment in comments:
            body = str(comment.get("body") or "").strip()
            if not body:
                continue
            if exclude_delivery_manager and body.startswith("[Delivery Manager]"):
                continue
            author = str(comment.get("author") or "Unknown").strip()
            created = str(comment.get("created") or "").strip()
            header = f"{author}"
            if created:
                header = f"{author} ({created})"
            lines.append(f"{header}:\n{body}")
        return "\n\n".join(lines)

    @staticmethod
    def build_ticket_context(description: str, comments: list[dict]) -> str:
        parts: list[str] = []
        if description.strip():
            parts.append(description.strip())
        comments_text = JiraClient.format_comments_for_ai(comments)
        if comments_text:
            parts.append(f"--- Jira comments ---\n{comments_text}")
        return "\n\n".join(parts) if parts else "(no description or comments)"

    @staticmethod
    def _adf_to_text(node: dict) -> str:
        if not isinstance(node, dict):
            return ""
        node_type = node.get("type")

        if node_type == "text":
            text = node.get("text", "")
            for mark in node.get("marks") or []:
                if mark.get("type") == "link":
                    href = str((mark.get("attrs") or {}).get("href") or "").strip()
                    if href:
                        if not text or text == href:
                            return href
                        return f"[{text}]({href})"
            return text

        if node_type == "inlineCard":
            return str((node.get("attrs") or {}).get("url") or "").strip()

        if node_type == "hardBreak":
            return "\n"

        if node_type == "mention":
            return str((node.get("attrs") or {}).get("text") or "@mention").strip()

        parts: list[str] = []
        for child in node.get("content") or []:
            parts.append(JiraClient._adf_to_text(child))
        text = "".join(parts)

        if node_type in {"paragraph", "heading", "listItem", "blockquote", "tableCell", "tableHeader"}:
            text += "\n"
        elif node_type == "rule":
            text += "\n---\n"

        return text

    @staticmethod
    def find_transition(
        transitions: list[dict],
        *keywords: str,
        exclude_keywords: tuple[str, ...] | None = None,
        exact_names: tuple[str, ...] | None = None,
    ) -> dict | None:
        for exact in exact_names or ():
            target = exact.lower().strip()
            for transition in transitions:
                if transition.get("name", "").lower().strip() == target:
                    return transition

        lowered = [k.lower() for k in keywords]
        exclude = [k.lower() for k in (exclude_keywords or ())]

        def excluded(name: str) -> bool:
            name_l = name.lower().strip()
            return any(ex in name_l for ex in exclude)

        def keyword_matches(keyword: str, name: str) -> bool:
            name_l = name.lower().strip()
            tokens = name_l.replace("-", " ").split()
            return keyword in tokens or name_l == keyword

        def all_match(name: str) -> bool:
            if excluded(name):
                return False
            return all(keyword_matches(kw, name) for kw in lowered)

        def any_match(name: str) -> bool:
            if excluded(name):
                return False
            return any(keyword_matches(kw, name) for kw in lowered)

        for transition in transitions:
            name = transition.get("name", "")
            if all_match(name):
                return transition
        for transition in transitions:
            name = transition.get("name", "")
            if any_match(name):
                return transition
        return None

    async def count_issues(self, jql: str) -> int:
        # approximate-count does not accept ORDER BY
        count_jql = jql.split(" ORDER BY ")[0].strip()
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/search/approximate-count",
                json={"jql": count_jql},
                auth=self._auth(),
                headers={**self._headers(), "Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
            return int(data.get("count", 0))

    @staticmethod
    def build_jql(
        project_key: str | None = None,
        assigned_to_me: bool = True,
        status_category: str | None = None,
        *,
        order_by_updated: bool = True,
    ) -> str:
        clauses: list[str] = []
        if assigned_to_me:
            clauses.append("assignee = currentUser()")
        if project_key:
            clauses.append(f'project = "{project_key}"')
        if status_category:
            clauses.append(f'statusCategory = "{status_category}"')
        if not clauses:
            clauses.append("updated >= -365d")
        jql = " AND ".join(clauses)
        if order_by_updated:
            jql += " ORDER BY updated DESC"
        return jql
