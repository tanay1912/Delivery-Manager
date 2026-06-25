import httpx

from fastapi import APIRouter, HTTPException, Request, Response

from app.auth.jira_credentials import normalize_site_url, verify_jira_credentials
from app.auth.session import (
    SESSION_COOKIE,
    SESSION_TTL,
    create_session,
    delete_session,
    get_session,
    sign_session_id,
    unsign_session_id,
)
from app.schemas.auth import ConnectRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def get_session_from_request(request: Request) -> dict | None:
    signed = request.cookies.get(SESSION_COOKIE)
    if not signed:
        return None
    session_id = unsign_session_id(signed)
    if not session_id:
        return None
    session = await get_session(session_id)
    if session:
        session["_session_id"] = session_id
    return session


def _set_session_cookie(response: Response, session_id: str) -> None:
    signed = sign_session_id(session_id)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=signed,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=SESSION_TTL,
    )


@router.post("/connect")
async def connect(body: ConnectRequest, response: Response):
    try:
        site_url = normalize_site_url(body.site_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        session_data = await verify_jira_credentials(site_url, body.email, body.api_token)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(
                status_code=401,
                detail="Invalid Jira credentials. Check site URL, email, and API token.",
            )
        raise HTTPException(status_code=502, detail="Could not reach Jira. Check the site URL.")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not reach Jira. Check the site URL.")

    session_id = await create_session(session_data)
    _set_session_cookie(response, session_id)

    return {
        "ok": True,
        "user": session_data["user"],
        "site_name": session_data["site_name"],
        "site_url": session_data["site_url"],
    }


@router.post("/logout")
async def logout(request: Request, response: Response):
    session = await get_session_from_request(request)
    if session and session.get("_session_id"):
        await delete_session(session["_session_id"])
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    session = await get_session_from_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "user": session.get("user"),
        "site_name": session.get("site_name"),
        "site_url": session.get("site_url"),
    }
