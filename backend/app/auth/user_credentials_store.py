from sqlalchemy import select

from app.db.models import UserCredentials
from app.db.session import async_session

INTEGRATION_FIELDS = (
    "bitbucket_username",
    "bitbucket_app_password_encrypted",
    "bitbucket_display_name",
    "bitbucket_git_username",
    "bitbucket_git_password_encrypted",
    "openai_api_key_encrypted",
    "openai_model",
    "cursor_api_key_encrypted",
    "cursor_model",
)


def _user_from_session(session: dict) -> dict:
    user = session.get("user") or {}
    return {
        "account_id": user.get("account_id"),
        "display_name": user.get("display_name") or "",
        "email": user.get("email") or "",
        "avatar_url": user.get("avatar_url") or "",
    }


def session_to_stored(session: dict) -> dict:
    user = _user_from_session(session)
    return {
        "atlassian_account_id": user["account_id"],
        "site_host": session["site_host"],
        "site_url": session["site_url"],
        "site_name": session.get("site_name") or "",
        "atlassian_email": session["atlassian_email"],
        "api_token_encrypted": session["api_token_encrypted"],
        "jira_cloud_id": session.get("jira_cloud_id"),
        "user_display_name": user["display_name"],
        "user_email": user["email"],
        "user_avatar_url": user["avatar_url"],
        "bitbucket_username": session.get("bitbucket_username"),
        "bitbucket_app_password_encrypted": session.get("bitbucket_app_password_encrypted"),
        "bitbucket_display_name": session.get("bitbucket_display_name"),
        "bitbucket_git_username": session.get("bitbucket_git_username"),
        "bitbucket_git_password_encrypted": session.get("bitbucket_git_password_encrypted"),
        "openai_api_key_encrypted": session.get("openai_api_key_encrypted"),
        "openai_model": session.get("openai_model"),
        "cursor_api_key_encrypted": session.get("cursor_api_key_encrypted"),
        "cursor_model": session.get("cursor_model"),
    }


def stored_to_session(record: UserCredentials) -> dict:
    return {
        "site_url": record.site_url,
        "site_host": record.site_host,
        "site_name": record.site_name,
        "atlassian_email": record.atlassian_email,
        "api_token_encrypted": record.api_token_encrypted,
        "jira_cloud_id": record.jira_cloud_id,
        "user": {
            "account_id": record.atlassian_account_id,
            "display_name": record.user_display_name,
            "email": record.user_email or None,
            "avatar_url": record.user_avatar_url or None,
        },
        "bitbucket_username": record.bitbucket_username,
        "bitbucket_app_password_encrypted": record.bitbucket_app_password_encrypted,
        "bitbucket_display_name": record.bitbucket_display_name,
        "bitbucket_git_username": record.bitbucket_git_username,
        "bitbucket_git_password_encrypted": record.bitbucket_git_password_encrypted,
        "openai_api_key_encrypted": record.openai_api_key_encrypted,
        "openai_model": record.openai_model,
        "cursor_api_key_encrypted": record.cursor_api_key_encrypted,
        "cursor_model": record.cursor_model,
    }


def merge_integrations(session: dict, stored: UserCredentials) -> None:
    for field in INTEGRATION_FIELDS:
        value = getattr(stored, field, None)
        if value:
            session[field] = value


async def save_user_credentials(session: dict) -> None:
    user = _user_from_session(session)
    account_id = user.get("account_id")
    site_host = session.get("site_host")
    if not account_id or not site_host:
        return

    values = session_to_stored(session)
    async with async_session() as db:
        result = await db.execute(
            select(UserCredentials).where(
                UserCredentials.atlassian_account_id == account_id,
                UserCredentials.site_host == site_host,
            )
        )
        record = result.scalar_one_or_none()
        if record:
            for key, value in values.items():
                if key not in ("atlassian_account_id", "site_host"):
                    setattr(record, key, value)
        else:
            db.add(UserCredentials(**values))
        await db.commit()


async def load_user_credentials(account_id: str, site_host: str) -> UserCredentials | None:
    async with async_session() as db:
        result = await db.execute(
            select(UserCredentials).where(
                UserCredentials.atlassian_account_id == account_id,
                UserCredentials.site_host == site_host,
            )
        )
        return result.scalar_one_or_none()
