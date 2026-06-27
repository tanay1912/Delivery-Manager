import httpx

from app.auth.crypto import decrypt_token, encrypt_token
from app.clients.bitbucket_client import BitbucketClient

BITBUCKET_GIT_USERNAME = "x-bitbucket-api-token-auth"

_API_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens"

_API_TOKEN_REQUIRED_MESSAGE = (
    "Bitbucket app passwords no longer work for repository APIs. "
    f"Create a Bitbucket API token at {_API_TOKEN_URL} "
    "(select Bitbucket, with repository read and write scopes) and connect using your "
    "Atlassian account email and the API token."
)

_APP_PASSWORD_WITH_EMAIL_MESSAGE = (
    "That looks like a Bitbucket app password (ATBB…). App passwords only work with your "
    "Bitbucket username, not your email, and are being retired. "
    f"Create a scoped Bitbucket API token at {_API_TOKEN_URL} instead — select Bitbucket, "
    "add repository read/write scopes, then connect with your Atlassian account email "
    "and the new token."
)

_INVALID_CREDENTIALS_MESSAGE = (
    "Invalid Bitbucket credentials. Use your Atlassian account email and a Bitbucket API token "
    f"(not your Jira login token). Create one at {_API_TOKEN_URL}, select Bitbucket, and "
    "enable repository read and write scopes."
)


_MISSING_REPO_SCOPE_MESSAGE = (
    "This Bitbucket API token is missing repository scopes. "
    f"Create a new token at {_API_TOKEN_URL}, select Bitbucket, and enable "
    "repository read and write scopes (read:repository and write:repository)."
)

_REQUIRED_REPO_SCOPE = "write:repository:bitbucket"


def _looks_like_app_password(api_token: str) -> bool:
    return api_token.startswith("ATBB")


def _scope_grant_from_response(response: httpx.Response) -> list[str] | None:
    """If a 403 response is an authenticated 'missing scope' error, return granted scopes.

    A genuine bad-credentials failure returns 401 (or a 403 without scope detail). When the
    token authenticated successfully but simply lacks a scope, Bitbucket returns 403 with a
    body listing the granted scopes — which means the credentials themselves are valid.
    """
    try:
        body = response.json()
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    error = body.get("error") or {}
    if not isinstance(error, dict):
        return None
    message = str(error.get("message") or "").lower()
    detail = error.get("detail")
    granted: list[str] = []
    if isinstance(detail, dict):
        raw = detail.get("granted")
        if isinstance(raw, list):
            granted = [str(scope) for scope in raw]
    if "privilege scope" in message or "scope" in message or granted:
        return granted
    return None


def parse_bitbucket_auth_error(response: httpx.Response) -> str | None:
    try:
        body = response.json()
        if not isinstance(body, dict):
            return None
        error = body.get("error") or {}
        if not isinstance(error, dict):
            return None
        message = str(error.get("message") or "")
        detail = str(error.get("detail") or "")
        combined = f"{message} {detail}".lower()
        if "change-3222" in message.lower() or "app password" in combined:
            return _API_TOKEN_REQUIRED_MESSAGE
    except Exception:
        return None
    return None


async def verify_bitbucket_credentials(email: str, api_token: str) -> dict:
    email = email.strip()
    api_token = api_token.strip()
    if not email or not api_token:
        raise ValueError("Bitbucket account email and API token are required")
    if "@" not in email:
        raise ValueError(
            "Use your Atlassian account email (not your Bitbucket username) with a Bitbucket API token."
        )

    if _looks_like_app_password(api_token):
        raise ValueError(_APP_PASSWORD_WITH_EMAIL_MESSAGE)

    auth = (email, api_token)
    user_url = f"{BitbucketClient.BASE_URL}/user"
    display_name = email

    async with httpx.AsyncClient() as client:
        user_response = await client.get(user_url, auth=auth, timeout=30.0)

        if user_response.status_code == 401:
            # Bare 401 means the email/token pair did not authenticate at all.
            raise ValueError(_INVALID_CREDENTIALS_MESSAGE)

        if user_response.status_code == 403:
            # Scoped API tokens commonly omit read:user. A 403 that lists granted scopes
            # means the credentials authenticated fine — the token just can't read /user.
            granted = _scope_grant_from_response(user_response)
            if granted is None:
                raise ValueError(_INVALID_CREDENTIALS_MESSAGE)
            if granted and _REQUIRED_REPO_SCOPE not in granted:
                raise ValueError(_MISSING_REPO_SCOPE_MESSAGE)
        else:
            user_response.raise_for_status()
            try:
                display_name = user_response.json().get("display_name") or email
            except Exception:
                display_name = email

    return {
        "bitbucket_username": email,
        "bitbucket_app_password_encrypted": encrypt_token(api_token),
        "bitbucket_display_name": display_name,
    }


def bitbucket_configured(session: dict) -> bool:
    return bool(session.get("bitbucket_username") and session.get("bitbucket_app_password_encrypted"))


def bitbucket_client_from_session(session: dict) -> BitbucketClient:
    return BitbucketClient(
        session["bitbucket_username"],
        decrypt_token(session["bitbucket_app_password_encrypted"]),
    )


def bitbucket_git_credentials(session: dict) -> tuple[str, str] | None:
    if not bitbucket_configured(session):
        return None
    return (
        BITBUCKET_GIT_USERNAME,
        decrypt_token(session["bitbucket_app_password_encrypted"]),
    )


def bitbucket_app_password(session: dict) -> str:
    return decrypt_token(session["bitbucket_app_password_encrypted"])
