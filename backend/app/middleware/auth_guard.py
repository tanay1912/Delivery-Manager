from fastapi import HTTPException, Request


async def get_valid_session(request: Request) -> dict:
    from app.api.auth import get_session_from_request

    session = await get_session_from_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not session.get("api_token_encrypted"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return session


async def require_auth(request: Request) -> dict:
    return await get_valid_session(request)
