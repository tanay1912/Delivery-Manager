import httpx

from fastapi import APIRouter, HTTPException, Request, Response

from app.auth.ai_credentials import (
    cursor_api_key,
    cursor_configured,
    cursor_model,
    list_cursor_models,
    list_openai_models,
    openai_configured,
    openai_model,
    save_cursor_credentials,
    verify_openai_credentials,
)
from app.auth.bitbucket_credentials import (
    bitbucket_configured,
    verify_bitbucket_credentials,
)
from app.auth.jira_credentials import normalize_site_url, ensure_jira_api_mode, verify_jira_credentials
from app.auth.session import (
    REMEMBER_COOKIE,
    REMEMBER_TTL,
    SESSION_COOKIE,
    SESSION_TTL,
    create_session,
    delete_session,
    get_session,
    sign_remember_user,
    sign_session_id,
    touch_session,
    unsign_remember_user,
    unsign_session_id,
    update_session,
)
from app.auth.user_credentials_store import (
    load_user_credentials,
    merge_integrations,
    save_user_credentials,
    stored_to_session,
)
from app.schemas.auth import (
    BitbucketConnectRequest,
    ConnectRequest,
    CursorConnectRequest,
    OpenAIConnectRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


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


def _set_remember_cookie(response: Response, account_id: str, site_host: str) -> None:
    signed = sign_remember_user(account_id, site_host)
    response.set_cookie(
        key=REMEMBER_COOKIE,
        value=signed,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=REMEMBER_TTL,
    )


def _me_payload(session: dict) -> dict:
    return {
        "user": session.get("user"),
        "site_name": session.get("site_name"),
        "site_url": session.get("site_url"),
        "bitbucket_configured": bitbucket_configured(session),
        "bitbucket_username": session.get("bitbucket_username"),
        "openai_configured": openai_configured(session),
        "openai_model": openai_model(session) if openai_configured(session) else None,
        "cursor_configured": cursor_configured(session),
        "cursor_model": cursor_model(session) if cursor_configured(session) else None,
    }


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
        await touch_session(session_id)
    return session


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

    account_id = session_data["user"]["account_id"]
    site_host = session_data["site_host"]
    stored = await load_user_credentials(account_id, site_host)
    if stored:
        merge_integrations(session_data, stored)

    await save_user_credentials(session_data)

    session_id = await create_session(session_data)
    _set_session_cookie(response, session_id)
    _set_remember_cookie(response, account_id, site_host)

    return {
        "ok": True,
        **_me_payload(session_data),
    }


@router.post("/resume")
async def resume(request: Request, response: Response):
    signed = request.cookies.get(REMEMBER_COOKIE)
    if not signed:
        raise HTTPException(status_code=401, detail="Not authenticated")

    remembered = unsign_remember_user(signed)
    if not remembered:
        raise HTTPException(status_code=401, detail="Not authenticated")

    account_id, site_host = remembered
    stored = await load_user_credentials(account_id, site_host)
    if not stored:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session_data = stored_to_session(stored)
    session_data = await ensure_jira_api_mode(session_data)
    await save_user_credentials(session_data)
    session_id = await create_session(session_data)
    _set_session_cookie(response, session_id)
    _set_remember_cookie(response, account_id, site_host)

    return {
        "ok": True,
        **_me_payload(session_data),
    }


@router.post("/logout")
async def logout(request: Request, response: Response):
    session = await get_session_from_request(request)
    if session and session.get("_session_id"):
        await delete_session(session["_session_id"])
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(REMEMBER_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    session = await get_session_from_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return _me_payload(session)


@router.get("/bitbucket")
async def get_bitbucket_credentials(request: Request):
    session = await get_session_from_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "configured": bitbucket_configured(session),
        "username": session.get("bitbucket_username"),
        "display_name": session.get("bitbucket_display_name"),
    }


@router.post("/bitbucket")
async def connect_bitbucket(body: BitbucketConnectRequest, request: Request):
    session = await get_session_from_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session_id = session.get("_session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    email = body.username.strip()
    api_token = body.app_password.strip()

    if not api_token and bitbucket_configured(session):
        if "@" not in email:
            raise HTTPException(
                status_code=400,
                detail="Use your Atlassian account email (not your Bitbucket username).",
            )
        session["bitbucket_username"] = email
        await update_session(session_id, session)
        await save_user_credentials(session)
        return {
            "ok": True,
            "configured": True,
            "username": session["bitbucket_username"],
            "display_name": session.get("bitbucket_display_name"),
        }

    if not api_token:
        raise HTTPException(status_code=400, detail="Bitbucket API token is required")

    try:
        bitbucket_data = await verify_bitbucket_credentials(email, api_token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid Bitbucket credentials. Use your Atlassian account email and a "
                    "Bitbucket API token (not your Jira login token)."
                ),
            )
        raise HTTPException(status_code=502, detail="Could not reach Bitbucket.")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not reach Bitbucket.")

    session.update(bitbucket_data)
    await update_session(session_id, session)
    await save_user_credentials(session)

    return {
        "ok": True,
        "configured": True,
        "username": bitbucket_data["bitbucket_username"],
        "display_name": bitbucket_data.get("bitbucket_display_name"),
    }


@router.delete("/bitbucket")
async def disconnect_bitbucket(request: Request):
    session = await get_session_from_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session_id = session.get("_session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session.pop("bitbucket_username", None)
    session.pop("bitbucket_app_password_encrypted", None)
    session.pop("bitbucket_display_name", None)
    await update_session(session_id, session)
    await save_user_credentials(session)

    return {"ok": True, "configured": False}


async def _require_session(request: Request) -> tuple[dict, str]:
    session = await get_session_from_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    session_id = session.get("_session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return session, session_id


@router.get("/openai")
async def get_openai_credentials(request: Request):
    session, _ = await _require_session(request)
    return {
        "configured": openai_configured(session),
        "model": openai_model(session),
    }


@router.post("/openai")
async def connect_openai(body: OpenAIConnectRequest, request: Request):
    session, session_id = await _require_session(request)

    api_key = body.api_key.strip()
    if not api_key and openai_configured(session):
        api_key = None
    elif not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key is required")

    try:
        if api_key:
            openai_data = await verify_openai_credentials(api_key, body.model)
        else:
            openai_data = {"openai_model": body.model.strip() or openai_model(session)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid OpenAI API key.")

    session.update(openai_data)
    await update_session(session_id, session)
    await save_user_credentials(session)

    return {
        "ok": True,
        "configured": openai_configured(session),
        "model": openai_model(session),
    }


@router.delete("/openai")
async def disconnect_openai(request: Request):
    session, session_id = await _require_session(request)
    session.pop("openai_api_key_encrypted", None)
    session.pop("openai_model", None)
    await update_session(session_id, session)
    await save_user_credentials(session)
    return {"ok": True, "configured": False}


@router.get("/openai/models")
async def get_openai_models(request: Request, api_key: str | None = None):
    session, _ = await _require_session(request)
    models, source = await list_openai_models(session, api_key_override=api_key)
    return {"models": models, "source": source}


@router.get("/cursor")
async def get_cursor_credentials(request: Request):
    session, _ = await _require_session(request)
    return {
        "configured": cursor_configured(session),
        "model": cursor_model(session),
    }


@router.post("/cursor")
async def connect_cursor(body: CursorConnectRequest, request: Request):
    session, session_id = await _require_session(request)

    api_key = body.api_key.strip()
    if not api_key and cursor_configured(session):
        cursor_data = {"cursor_model": body.model.strip() or cursor_model(session)}
    elif not api_key:
        raise HTTPException(status_code=400, detail="Cursor API key is required")
    else:
        try:
            cursor_data = save_cursor_credentials(api_key, body.model)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    session.update(cursor_data)
    await update_session(session_id, session)
    await save_user_credentials(session)

    return {
        "ok": True,
        "configured": cursor_configured(session),
        "model": cursor_model(session),
    }


@router.delete("/cursor")
async def disconnect_cursor(request: Request):
    session, session_id = await _require_session(request)
    session.pop("cursor_api_key_encrypted", None)
    session.pop("cursor_model", None)
    await update_session(session_id, session)
    await save_user_credentials(session)
    return {"ok": True, "configured": False}


@router.get("/cursor/models")
async def get_cursor_models(request: Request, api_key: str | None = None):
    session, _ = await _require_session(request)
    key = (api_key or "").strip()
    if not key and cursor_configured(session):
        key = cursor_api_key(session)
    models, source = await list_cursor_models(key or None)
    return {"models": models, "source": source}
