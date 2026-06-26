import re

import httpx

from app.auth.crypto import decrypt_token, encrypt_token
from app.clients.jira_client import JiraClient

_SITE_HOST_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9-]*\.atlassian\.net$")


def normalize_site_url(raw: str) -> str:
    value = raw.strip().rstrip("/")
    if value.startswith("http://"):
        value = "https://" + value[len("http://") :]
    elif not value.startswith("https://"):
        value = f"https://{value}"

    host = value.split("://", 1)[1].split("/")[0].lower()
    if not _SITE_HOST_RE.match(host):
        raise ValueError("Use your Atlassian Cloud site (e.g. yoursite.atlassian.net)")
    return f"https://{host}"


async def fetch_jira_cloud_id(site_url: str) -> str | None:
    """Resolve the Atlassian cloud ID for a Jira site (needed for scoped API tokens)."""
    url = f"{site_url.rstrip('/')}/_edge/tenant_info"
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=15.0)
        if response.status_code != 200:
            return None
        data = response.json()
        cloud_id = data.get("cloudId")
        return str(cloud_id) if cloud_id else None


async def resolve_jira_client(
    site_url: str, email: str, api_token: str
) -> tuple[JiraClient, str | None, dict, dict]:
    """Pick the Jira API base URL that works for this token.

    Scoped API tokens must use https://api.atlassian.com/ex/jira/{cloudId}/...
    Classic (unscoped) tokens use https://{site}.atlassian.net/rest/api/3/...
    """
    email = email.strip()
    api_token = api_token.strip()
    cloud_id = await fetch_jira_cloud_id(site_url)

    candidates: list[JiraClient] = []
    if cloud_id:
        candidates.append(JiraClient(site_url, email, api_token, cloud_id=cloud_id))
    candidates.append(JiraClient(site_url, email, api_token))

    last_exc: Exception | None = None
    for client in candidates:
        try:
            user = await client.get_myself()
            server = await client.get_server_info()
            return client, client.cloud_id, user, server
        except Exception as exc:
            last_exc = exc
    if last_exc is None:
        raise ValueError("Could not connect to Jira")
    raise last_exc


async def ensure_jira_api_mode(session: dict) -> dict:
    """Re-detect API URL mode for sessions saved before gateway support."""
    if "jira_cloud_id" in session:
        return session
    try:
        _, cloud_id, _, _ = await resolve_jira_client(
            session["site_url"],
            session["atlassian_email"],
            decrypt_token(session["api_token_encrypted"]),
        )
        session["jira_cloud_id"] = cloud_id
    except Exception:
        session.setdefault("jira_cloud_id", None)
    return session


async def verify_jira_credentials(site_url: str, email: str, api_token: str) -> dict:
    _, cloud_id, user, server = await resolve_jira_client(site_url, email, api_token)
    return {
        "site_url": site_url,
        "site_host": site_url.replace("https://", ""),
        "site_name": server.get("serverTitle") or site_url.replace("https://", "").replace(".atlassian.net", ""),
        "atlassian_email": email.strip(),
        "api_token_encrypted": encrypt_token(api_token.strip()),
        "jira_cloud_id": cloud_id,
        "user": {
            "account_id": user.get("accountId"),
            "display_name": user.get("displayName"),
            "email": user.get("emailAddress"),
            "avatar_url": (user.get("avatarUrls") or {}).get("48x48"),
        },
    }


def jira_client_from_session(session: dict) -> JiraClient:
    cloud_id = session.get("jira_cloud_id")
    return JiraClient(
        site_url=session["site_url"],
        email=session["atlassian_email"],
        api_token=decrypt_token(session["api_token_encrypted"]),
        cloud_id=cloud_id,
    )
