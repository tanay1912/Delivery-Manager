import json
import uuid
from typing import Any

import redis.asyncio as redis
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import settings

SESSION_COOKIE = "session_id"
REMEMBER_COOKIE = "remember_user"
SESSION_PREFIX = "session:"
SESSION_TTL = 60 * 60 * 24 * 365  # 1 year
REMEMBER_TTL = 60 * 60 * 24 * 365 * 10  # 10 years

_serializer = URLSafeTimedSerializer(settings.session_secret)
_redis: redis.Redis | None = None


async def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def sign_remember_user(account_id: str, site_host: str) -> str:
    return _serializer.dumps(f"{account_id}:{site_host}")


def unsign_remember_user(signed: str, max_age: int = REMEMBER_TTL) -> tuple[str, str] | None:
    try:
        value = _serializer.loads(signed, max_age=max_age)
    except (BadSignature, SignatureExpired):
        return None
    if ":" not in value:
        return None
    account_id, site_host = value.split(":", 1)
    if not account_id or not site_host:
        return None
    return account_id, site_host


async def touch_session(session_id: str) -> None:
    r = await get_redis()
    key = f"{SESSION_PREFIX}{session_id}"
    await r.expire(key, SESSION_TTL)


def sign_session_id(session_id: str) -> str:
    return _serializer.dumps(session_id)


def unsign_session_id(signed: str, max_age: int = SESSION_TTL) -> str | None:
    try:
        return _serializer.loads(signed, max_age=max_age)
    except (BadSignature, SignatureExpired):
        return None


async def create_session(data: dict[str, Any]) -> str:
    session_id = str(uuid.uuid4())
    r = await get_redis()
    await r.setex(f"{SESSION_PREFIX}{session_id}", SESSION_TTL, json.dumps(data))
    return session_id


async def get_session(session_id: str) -> dict[str, Any] | None:
    r = await get_redis()
    raw = await r.get(f"{SESSION_PREFIX}{session_id}")
    if not raw:
        return None
    return json.loads(raw)


def session_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Strip runtime-only keys before persisting session data."""
    return {key: value for key, value in data.items() if key != "_session_id"}


async def update_session(session_id: str, data: dict[str, Any]) -> None:
    r = await get_redis()
    await r.setex(
        f"{SESSION_PREFIX}{session_id}",
        SESSION_TTL,
        json.dumps(session_payload(data)),
    )


async def delete_session(session_id: str) -> None:
    r = await get_redis()
    await r.delete(f"{SESSION_PREFIX}{session_id}")
