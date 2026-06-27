import re

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
        fields = ["summary", "status", "priority", "assignee", "updated", "project", "issuetype"]
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

    async def get_issue(self, issue_key: str, extra_fields: list[str] | None = None) -> dict:
        fields = [
            "summary",
            "description",
            "status",
            "project",
            "assignee",
            "issuetype",
            "timetracking",
            "customfield_10016",
            "attachment",
        ]
        if extra_fields:
            for field_id in extra_fields:
                if field_id and field_id not in fields:
                    fields.append(field_id)

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/issue/{issue_key}",
                params={"fields": ",".join(fields)},
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    def issue_attachments(issue: dict) -> list[dict]:
        return list((issue.get("fields") or {}).get("attachment") or [])

    @staticmethod
    def resolve_media_attachment_id(media_id: str, alt: str, attachments: list[dict]) -> str:
        for attachment in attachments:
            if str(attachment.get("id") or "") == media_id:
                return str(attachment["id"])
        alt_name = alt.strip().lower()
        if alt_name:
            for attachment in attachments:
                filename = str(attachment.get("filename") or "").strip().lower()
                if filename and filename == alt_name:
                    return str(attachment["id"])
        return media_id

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

    async def get_transitions(
        self,
        issue_key: str,
        *,
        expand_fields: bool = False,
    ) -> list[dict]:
        params: dict[str, str] = {}
        if expand_fields:
            params["expand"] = "transitions.fields"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/issue/{issue_key}/transitions",
                params=params or None,
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json().get("transitions", [])

    @staticmethod
    def format_http_error(exc: httpx.HTTPStatusError) -> str:
        try:
            body = exc.response.json()
            parts = [str(msg) for msg in (body.get("errorMessages") or []) if str(msg).strip()]
            for key, msg in (body.get("errors") or {}).items():
                parts.append(f"{key}: {msg}")
            if parts:
                return f"{exc}. Jira: {'; '.join(parts)}"
        except Exception:
            pass
        return str(exc)

    async def transition_issue(
        self,
        issue_key: str,
        transition_id: str,
        fields: dict | None = None,
    ) -> None:
        body: dict = {"transition": {"id": transition_id}}
        if fields:
            body["fields"] = fields

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/issue/{issue_key}/transitions",
                json=body,
                auth=self._auth(),
                headers={**self._headers(), "Content-Type": "application/json"},
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise httpx.HTTPStatusError(
                    JiraClient.format_http_error(exc),
                    request=exc.request,
                    response=exc.response,
                ) from exc

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

    async def fetch_attachment_content(self, attachment_id: str) -> tuple[bytes, str]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/attachment/content/{attachment_id}",
                auth=self._auth(),
                headers={"Accept": "*/*"},
                follow_redirects=True,
                timeout=60.0,
            )
            response.raise_for_status()
            content_type = response.headers.get("content-type", "application/octet-stream")
            return response.content, content_type

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
    def format_text_for_jira(text: str) -> str:
        """Normalize plain text so numbered and bulleted lists render on separate lines."""
        if not text or not text.strip():
            return text
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        normalized = re.sub(r"(?<=\S)\s+(\d+)\.\s", r"\n\1. ", normalized)
        normalized = re.sub(r"(?<=\S)\s+([-*])\s", r"\n\1 ", normalized)
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        return normalized.strip()

    @staticmethod
    def _adf_list_item(text: str) -> dict:
        return {
            "type": "listItem",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": text}],
                }
            ],
        }

    @staticmethod
    def _adf_paragraph_block(lines: list[str]) -> dict:
        content: list[dict] = []
        for i, line in enumerate(lines):
            if line:
                content.append({"type": "text", "text": line})
            if i < len(lines) - 1:
                content.append({"type": "hardBreak"})
        return {
            "type": "paragraph",
            "content": content or [{"type": "text", "text": ""}],
        }

    @staticmethod
    def _adf_from_text(text: str) -> dict:
        text = JiraClient.format_text_for_jira(text)
        if not text:
            return {
                "type": "doc",
                "version": 1,
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}],
            }

        content: list[dict] = []
        lines = text.split("\n")
        index = 0
        numbered_pattern = re.compile(r"^\d+\.\s*(.*)$")
        bullet_pattern = re.compile(r"^[-*]\s+(.*)$")

        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped:
                index += 1
                continue

            numbered_match = numbered_pattern.match(stripped)
            if numbered_match:
                items: list[dict] = []
                while index < len(lines):
                    current = lines[index].strip()
                    if not current:
                        index += 1
                        break
                    item_match = numbered_pattern.match(current)
                    if not item_match:
                        break
                    items.append(JiraClient._adf_list_item(item_match.group(1).strip()))
                    index += 1
                if items:
                    content.append({"type": "orderedList", "content": items})
                continue

            bullet_match = bullet_pattern.match(stripped)
            if bullet_match:
                items = []
                while index < len(lines):
                    current = lines[index].strip()
                    if not current:
                        index += 1
                        break
                    item_match = bullet_pattern.match(current)
                    if not item_match:
                        break
                    items.append(JiraClient._adf_list_item(item_match.group(1).strip()))
                    index += 1
                if items:
                    content.append({"type": "bulletList", "content": items})
                continue

            paragraph_lines = [lines[index]]
            index += 1
            while index < len(lines):
                current = lines[index].strip()
                if not current:
                    index += 1
                    break
                if numbered_pattern.match(current) or bullet_pattern.match(current):
                    break
                paragraph_lines.append(lines[index])
                index += 1
            content.append(JiraClient._adf_paragraph_block(paragraph_lines))

        if not content:
            content = [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
        return {"type": "doc", "version": 1, "content": content}

    async def get_fields(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/field",
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def resolve_field_id(
        self,
        field_name: str | tuple[str, ...],
        configured_id: str | None = None,
    ) -> str:
        from app.services.jira_fields import resolve_jira_field_id

        return await resolve_jira_field_id(self, field_name, configured_id)

    async def get_issue_editmeta(self, issue_key: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/issue/{issue_key}/editmeta",
                auth=self._auth(),
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json().get("fields") or {}

    @staticmethod
    def is_select_field_empty(value) -> bool:
        if value is None:
            return True
        if isinstance(value, str):
            return not value.strip()
        if isinstance(value, dict):
            return not any(value.get(key) for key in ("value", "name", "id"))
        if isinstance(value, list):
            return len(value) == 0
        return False

    @staticmethod
    def select_field_payload(value: str, *, option_id: str | None = None) -> dict:
        if option_id:
            return {"id": option_id}
        return {"value": value}

    async def _resolve_select_option_id(
        self,
        issue_key: str,
        field_id: str,
        value: str,
    ) -> str | None:
        target = value.lower().strip()
        editmeta = await self.get_issue_editmeta(issue_key)
        field_meta = editmeta.get(field_id) or {}
        for option in field_meta.get("allowedValues") or []:
            option_value = str(option.get("value") or option.get("name") or "").strip()
            if option_value.lower() == target:
                option_id = option.get("id")
                return str(option_id) if option_id is not None else None
        return None

    async def set_select_field_value(self, issue_key: str, field_id: str, value: str) -> None:
        try:
            await self.update_issue(
                issue_key,
                {field_id: self.select_field_payload(value)},
            )
            return
        except httpx.HTTPStatusError:
            option_id = await self._resolve_select_option_id(issue_key, field_id, value)
            if not option_id:
                raise
            await self.update_issue(
                issue_key,
                {field_id: self.select_field_payload(value, option_id=option_id)},
            )

    async def set_paragraph_field(self, issue_key: str, field_id: str, text: str) -> None:
        try:
            await self.update_issue(issue_key, {field_id: self._adf_from_text(text)})
        except Exception:
            await self.update_issue(issue_key, {field_id: text})

    @staticmethod
    def extract_description(issue: dict) -> str:
        description = (issue.get("fields") or {}).get("description")
        attachments = JiraClient.issue_attachments(issue)
        if description is None:
            return ""
        if isinstance(description, str):
            return description
        return JiraClient._adf_to_text(description, attachments=attachments)

    @staticmethod
    def normalize_comments(raw_comments: list[dict], attachments: list[dict] | None = None) -> list[dict]:
        attachment_list = attachments or []
        normalized: list[dict] = []
        for comment in raw_comments:
            body = comment.get("body")
            if body is None:
                text = ""
            elif isinstance(body, str):
                text = body
            else:
                text = JiraClient._adf_to_text(body, attachments=attachment_list)
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
    def _adf_to_text(node: dict, attachments: list[dict] | None = None) -> str:
        if not isinstance(node, dict):
            return ""
        node_type = node.get("type")
        attachment_list = attachments or []

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

        if node_type == "media":
            attrs = node.get("attrs") or {}
            media_id = str(attrs.get("id") or "").strip()
            alt = str(attrs.get("alt") or attrs.get("filename") or "Image").strip()
            if media_id:
                attachment_id = JiraClient.resolve_media_attachment_id(media_id, alt, attachment_list)
                return f"\n{{{{jira-media:{attachment_id}|{alt}}}}}\n"
            return f"\n[Image: {alt}]\n"

        if node_type == "hardBreak":
            return "\n"

        if node_type == "mention":
            return str((node.get("attrs") or {}).get("text") or "@mention").strip()

        parts: list[str] = []
        for child in node.get("content") or []:
            parts.append(JiraClient._adf_to_text(child, attachments=attachment_list))
        text = "".join(parts)

        if node_type in {"paragraph", "heading", "listItem", "blockquote", "tableCell", "tableHeader"}:
            text += "\n"
        elif node_type == "rule":
            text += "\n---\n"

        return text

    @staticmethod
    def transition_destination_name(transition: dict) -> str:
        return str((transition.get("to") or {}).get("name") or "").strip()

    @staticmethod
    def transition_result_name(transition: dict) -> str:
        dest = JiraClient.transition_destination_name(transition)
        if dest:
            return dest
        return str(transition.get("name") or "").strip()

    @staticmethod
    def find_transition(
        transitions: list[dict],
        *keywords: str,
        exclude_keywords: tuple[str, ...] | None = None,
        exact_names: tuple[str, ...] | None = None,
    ) -> dict | None:
        lowered = [k.lower() for k in keywords]
        exclude = [k.lower() for k in (exclude_keywords or ())]

        def labels(transition: dict) -> tuple[str, ...]:
            dest = JiraClient.transition_destination_name(transition)
            action = str(transition.get("name") or "").strip()
            if dest:
                return (dest, action)
            return (action,) if action else ()

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

        for exact in exact_names or ():
            target = exact.lower().strip()
            for transition in transitions:
                for name in labels(transition):
                    if name.lower().strip() == target:
                        return transition

        for transition in transitions:
            dest = JiraClient.transition_destination_name(transition)
            if dest and excluded(dest):
                continue
            for name in labels(transition):
                if all_match(name):
                    return transition

        for transition in transitions:
            dest = JiraClient.transition_destination_name(transition)
            if dest:
                if excluded(dest):
                    continue
                if any_match(dest):
                    return transition
            else:
                action = str(transition.get("name") or "").strip()
                if action and any_match(action):
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

    async def summarize_by_status(self, jql: str) -> dict[str, dict[str, int]]:
        """Count issues grouped by workflow status and issue type."""
        search_jql = jql.split(" ORDER BY ")[0].strip()
        counts: dict[str, dict[str, int]] = {}
        next_token: str | None = None

        while True:
            body: dict = {
                "jql": search_jql,
                "maxResults": 100,
                "fields": ["status", "issuetype"],
            }
            if next_token:
                body["nextPageToken"] = next_token

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/search/jql",
                    json=body,
                    auth=self._auth(),
                    headers={**self._headers(), "Content-Type": "application/json"},
                )
                response.raise_for_status()
                data = response.json()

            for issue in data.get("issues", []):
                fields = issue.get("fields") or {}
                status = (fields.get("status") or {}).get("name") or "Unknown"
                issue_type = (fields.get("issuetype") or {}).get("name") or ""
                type_key = self._classify_issue_type(issue_type)

                bucket = counts.setdefault(
                    status,
                    {"total": 0, "qis": 0, "bug": 0, "task": 0},
                )
                bucket["total"] += 1
                bucket[type_key] += 1

            if data.get("isLast", True):
                break
            next_token = data.get("nextPageToken")
            if not next_token:
                break

        return counts

    @staticmethod
    def _classify_issue_type(name: str) -> str:
        if name == "QIS":
            return "qis"
        if name == "Bug":
            return "bug"
        return "task"

    @staticmethod
    def build_jql(
        project_key: str | None = None,
        assigned_to_me: bool = True,
        status_category: str | None = None,
        issue_type: str | None = None,
        issue_types: list[str] | None = None,
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
        types = issue_types or ([issue_type] if issue_type else None)
        if types:
            if len(types) == 1:
                clauses.append(f'issuetype = "{types[0]}"')
            else:
                quoted = ", ".join(f'"{item}"' for item in types)
                clauses.append(f"issuetype in ({quoted})")
        if not clauses:
            clauses.append("updated >= -365d")
        jql = " AND ".join(clauses)
        if order_by_updated:
            jql += " ORDER BY updated DESC"
        return jql
