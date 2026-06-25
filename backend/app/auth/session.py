import json
import uuid
from typing import Any

import redis.asyncio as redis
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import settings

SESSION_COOKIE = "session_id"
SESSION_PREFIX = "session:"
SESSION_TTL = 60 * 60 * 24 * 7  # 7 days

_serializer = URLSafeTimedSerializer(settings.session_secret)
_redis: redis.Redis | None = None


async def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


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


async def update_session(session_id: str, data: dict[str, Any]) -> None:
    r = await get_redis()
    await r.setex(f"{SESSION_PREFIX}{session_id}", SESSION_TTL, json.dumps(data))


async def delete_session(session_id: str) -> None:
    r = await get_redis()
    await r.delete(f"{SESSION_PREFIX}{session_id}")
