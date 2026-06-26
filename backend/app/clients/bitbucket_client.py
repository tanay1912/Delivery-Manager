import httpx
from urllib.parse import quote


class BitbucketClient:
    BASE_URL = "https://api.bitbucket.org/2.0"

    def __init__(self, email: str, api_token: str):
        self.auth = (email, api_token)

    @staticmethod
    def _looks_like_commit(ref: str) -> bool:
        return len(ref) == 40 and all(c in "0123456789abcdef" for c in ref.lower())

    @staticmethod
    def _encode_branch(branch: str) -> str:
        return quote(branch, safe="")

    async def resolve_ref(self, workspace: str, repo_slug: str, ref: str) -> str | None:
        """Resolve a branch name to a commit hash. Pass through commit hashes unchanged."""
        if self._looks_like_commit(ref):
            return ref
        encoded = self._encode_branch(ref)
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/refs/branches/{encoded}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, auth=self.auth, timeout=30.0)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            commit_hash = (response.json().get("target") or {}).get("hash")
            return commit_hash or None

    async def branch_exists(self, workspace: str, repo_slug: str, branch: str) -> bool:
        return await self.resolve_ref(workspace, repo_slug, branch) is not None

    async def create_branch(
        self, workspace: str, repo_slug: str, branch_name: str, from_branch: str
    ) -> str:
        parent_hash = await self.get_branch_commit(workspace, repo_slug, from_branch)
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/refs/branches"
        body = {"name": branch_name, "target": {"hash": parent_hash}}
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                auth=self.auth,
                json=body,
                headers={"Content-Type": "application/json"},
                timeout=30.0,
            )
            response.raise_for_status()
        return parent_hash

    async def get_branch_commit(self, workspace: str, repo_slug: str, branch: str) -> str:
        commit_hash = await self.resolve_ref(workspace, repo_slug, branch)
        if not commit_hash:
            raise ValueError(f"Could not resolve commit for branch {branch}")
        return commit_hash

    async def get_file(self, workspace: str, repo_slug: str, path: str, ref: str = "main") -> str | None:
        node = await self.resolve_ref(workspace, repo_slug, ref) or ref
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/src/{node}/{path}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, auth=self.auth, timeout=30.0)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.text

    async def list_directory(
        self, workspace: str, repo_slug: str, path: str = "", ref: str = "main"
    ) -> list[dict]:
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/src/{ref}/{path}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, auth=self.auth, timeout=30.0)
            if response.status_code == 404:
                return []
            response.raise_for_status()
            data = response.json()
            return data.get("values", [])

    async def commit_files(
        self,
        workspace: str,
        repo_slug: str,
        branch: str,
        message: str,
        files: dict[str, str] | None = None,
        deleted_paths: list[str] | None = None,
        parent_commit: str | None = None,
    ) -> dict:
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/src"
        # Use files= (not data=) so httpx builds multipart correctly on AsyncClient.
        multipart: list[tuple[str, tuple[str | None, str]]] = [
            ("message", (None, message)),
            ("branch", (None, branch)),
        ]
        if parent_commit:
            multipart.append(("parents", (None, parent_commit)))
        for path in deleted_paths or []:
            normalized = path if path.startswith("/") else f"/{path.lstrip('/')}"
            multipart.append(("files", (None, normalized)))
        for file_path, content in (files or {}).items():
            multipart.append((file_path, (None, content)))

        async with httpx.AsyncClient() as client:
            response = await client.post(url, auth=self.auth, files=multipart, timeout=60.0)
            response.raise_for_status()
            return response.json() if response.content else {}

    async def create_pull_request(
        self,
        workspace: str,
        repo_slug: str,
        title: str,
        source_branch: str,
        destination_branch: str,
        description: str = "",
    ) -> dict:
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/pullrequests"
        body = {
            "title": title,
            "description": description,
            "source": {"branch": {"name": source_branch}},
            "destination": {"branch": {"name": destination_branch}},
            "close_source_branch": False,
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                auth=self.auth,
                json=body,
                headers={"Content-Type": "application/json"},
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    _CONFLICT_DIFFSTAT_STATUSES = frozenset(
        {
            "merge conflict",
            "rename conflict",
            "rename/delete conflict",
            "subrepo conflict",
            "local deleted",
            "remote deleted",
        }
    )

    @staticmethod
    def is_pull_request_merged(pr: dict | None) -> bool:
        if not pr:
            return False
        return BitbucketClient.pull_request_state(pr) == "MERGED"

    @staticmethod
    def http_error_detail(exc: Exception) -> str:
        if isinstance(exc, httpx.HTTPStatusError):
            from app.auth.bitbucket_credentials import parse_bitbucket_auth_error

            deprecated = parse_bitbucket_auth_error(exc.response)
            if deprecated:
                return deprecated
            try:
                body = exc.response.json()
                if isinstance(body, dict):
                    error = body.get("error") or {}
                    if isinstance(error, dict):
                        message = error.get("message") or error.get("detail")
                        if message:
                            return str(message)
            except Exception:
                pass
            text = exc.response.text.strip()
            if text:
                return text[:500]
            return f"HTTP {exc.response.status_code}"
        return str(exc) or "Unknown error"

    async def pull_request_has_merge_conflicts(
        self, workspace: str, repo_slug: str, pr_id: int
    ) -> bool:
        url = (
            f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}"
            f"/pullrequests/{pr_id}/diffstat"
        )
        async with httpx.AsyncClient(follow_redirects=True) as client:
            while url:
                response = await client.get(url, auth=self.auth, timeout=60.0)
                if response.status_code == 404:
                    return False
                response.raise_for_status()
                data = response.json()
                for item in data.get("values", []):
                    status = str(item.get("status", "")).lower().strip()
                    if status in self._CONFLICT_DIFFSTAT_STATUSES or "conflict" in status:
                        return True
                url = data.get("next") or ""
        return False

    async def merge_pull_request(self, workspace: str, repo_slug: str, pr_id: int) -> dict:
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/merge"
        async with httpx.AsyncClient() as client:
            response = await client.post(url, auth=self.auth, timeout=30.0)
            response.raise_for_status()
            return response.json()

    async def get_pull_request(
        self, workspace: str, repo_slug: str, pr_id: int
    ) -> dict | None:
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, auth=self.auth, timeout=30.0)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()

    async def get_pull_request_safe(
        self, workspace: str, repo_slug: str, pr_id: int
    ) -> dict | None:
        """Load a PR without raising on HTTP errors."""
        try:
            return await self.get_pull_request(workspace, repo_slug, pr_id)
        except Exception:
            return None

    async def list_open_pull_requests_for_branch(
        self, workspace: str, repo_slug: str, branch_name: str
    ) -> list[dict]:
        """Return open pull requests whose source branch matches branch_name."""
        q = f'source.branch.name="{branch_name}" AND state="OPEN"'
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/pullrequests"
        params: dict[str, str | int] = {"q": q, "pagelen": 50}
        results: list[dict] = []
        async with httpx.AsyncClient() as client:
            while url:
                response = await client.get(url, auth=self.auth, params=params, timeout=30.0)
                if response.status_code == 404:
                    return results
                response.raise_for_status()
                data = response.json()
                results.extend(data.get("values", []))
                url = data.get("next") or ""
                params = {}
        return results

    @staticmethod
    def pull_request_state(pr: dict) -> str:
        return str(pr.get("state", "")).upper().strip()

    @staticmethod
    def is_pull_request_open(pr: dict) -> bool:
        return BitbucketClient.pull_request_state(pr) == "OPEN"

    @staticmethod
    def is_pull_request_inactive(pr: dict | None) -> bool:
        """True when the PR is missing or no longer open (declined, merged, superseded, etc.)."""
        if not pr:
            return True
        return not BitbucketClient.is_pull_request_open(pr)

    async def decline_pull_request(
        self,
        workspace: str,
        repo_slug: str,
        pr_id: int,
        message: str = "",
    ) -> dict:
        """Decline a pull request. No-op if the PR is already closed or missing."""
        await self.decline_pull_request_if_open(workspace, repo_slug, pr_id, message)
        return {}

    async def decline_pull_request_if_open(
        self,
        workspace: str,
        repo_slug: str,
        pr_id: int,
        message: str = "",
    ) -> str:
        """Decline an open PR. Returns 'declined', 'already_closed', or 'missing'. Never raises."""
        pr = await self.get_pull_request_safe(workspace, repo_slug, pr_id)
        if not pr:
            return "missing"

        if not self.is_pull_request_open(pr):
            return "already_closed"

        url = (
            f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}"
            f"/pullrequests/{pr_id}/decline"
        )
        body = {"message": message} if message.strip() else None
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    auth=self.auth,
                    json=body,
                    headers={"Content-Type": "application/json"} if body else None,
                    timeout=30.0,
                )
                if response.status_code in (200, 201, 204):
                    return "declined"
                if response.status_code in (400, 404, 409):
                    return "already_closed"
                if response.is_success:
                    return "declined"
                return "already_closed"
        except Exception:
            return "already_closed"

    async def delete_branch(self, workspace: str, repo_slug: str, branch_name: str) -> None:
        encoded = self._encode_branch(branch_name)
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/refs/branches/{encoded}"
        async with httpx.AsyncClient() as client:
            response = await client.delete(url, auth=self.auth, timeout=30.0)
            if response.status_code in (404, 409):
                return
            response.raise_for_status()

    @staticmethod
    def pr_html_url(pr: dict) -> str | None:
        links = pr.get("links", {}).get("html", {})
        return links.get("href") if isinstance(links, dict) else None

    @staticmethod
    def repo_html_url(workspace: str, repo_slug: str) -> str:
        return f"https://bitbucket.org/{workspace}/{repo_slug}"

    @staticmethod
    def _parse_diffstat_values(values: list) -> list[dict[str, str]]:
        changed: list[dict[str, str]] = []
        for item in values:
            old_path = (item.get("old") or {}).get("path")
            new_path = (item.get("new") or {}).get("path")
            path = new_path or old_path
            if not path:
                continue
            if old_path and new_path:
                action = "modify"
            elif new_path:
                action = "add"
            else:
                action = "delete"
            changed.append({"path": path, "action": action})
        return changed

    async def _fetch_diffstat_url(self, url: str) -> list[dict[str, str]]:
        changed: list[dict[str, str]] = []
        async with httpx.AsyncClient(follow_redirects=True) as client:
            while url:
                response = await client.get(url, auth=self.auth, timeout=60.0)
                if response.status_code == 404:
                    return changed
                response.raise_for_status()
                data = response.json()
                changed.extend(self._parse_diffstat_values(data.get("values", [])))
                url = (data.get("next") or "") if data.get("next") else ""
        return changed

    async def list_changed_files(
        self, workspace: str, repo_slug: str, from_ref: str, to_ref: str
    ) -> list[dict[str, str]]:
        from_hash = await self.resolve_ref(workspace, repo_slug, from_ref)
        to_hash = await self.resolve_ref(workspace, repo_slug, to_ref)
        if not from_hash or not to_hash:
            return []
        spec = f"{from_hash}..{to_hash}"
        url = f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}/diffstat/{spec}"
        return await self._fetch_diffstat_url(url)

    async def list_pull_request_changed_files(
        self, workspace: str, repo_slug: str, pr_id: int
    ) -> list[dict[str, str]]:
        url = (
            f"{self.BASE_URL}/repositories/{workspace}/{repo_slug}"
            f"/pullrequests/{pr_id}/diffstat"
        )
        return await self._fetch_diffstat_url(url)
