import re

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


async def verify_jira_credentials(site_url: str, email: str, api_token: str) -> dict:
    client = JiraClient(site_url=site_url, email=email.strip(), api_token=api_token.strip())
    user = await client.get_myself()
    server = await client.get_server_info()
    return {
        "site_url": site_url,
        "site_host": site_url.replace("https://", ""),
        "site_name": server.get("serverTitle") or site_url.replace("https://", "").replace(".atlassian.net", ""),
        "atlassian_email": email.strip(),
        "api_token_encrypted": encrypt_token(api_token.strip()),
        "user": {
            "account_id": user.get("accountId"),
            "display_name": user.get("displayName"),
            "email": user.get("emailAddress"),
            "avatar_url": (user.get("avatarUrls") or {}).get("48x48"),
        },
    }


def jira_client_from_session(session: dict) -> JiraClient:
    return JiraClient(
        site_url=session["site_url"],
        email=session["atlassian_email"],
        api_token=decrypt_token(session["api_token_encrypted"]),
    )
