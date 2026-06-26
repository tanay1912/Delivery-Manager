from fastapi import HTTPException, Request


async def get_valid_session(request: Request) -> dict:
    from app.api.auth import get_session_from_request
    from app.auth.jira_credentials import ensure_jira_api_mode
    from app.auth.session import update_session
    from app.auth.user_credentials_store import save_user_credentials

    session = await get_session_from_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not session.get("api_token_encrypted"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    if "jira_cloud_id" not in session:
        session = await ensure_jira_api_mode(session)
        session_id = session.get("_session_id")
        if session_id:
            await update_session(session_id, session)
            await save_user_credentials(session)

    return session


async def require_auth(request: Request) -> dict:
    return await get_valid_session(request)
