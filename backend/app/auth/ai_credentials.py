import httpx
from openai import AsyncOpenAI

from app.auth.crypto import decrypt_token, encrypt_token
from app.clients.openai_client import OpenAIClient

DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_CURSOR_MODEL = "composer-2.5"

OPENAI_FALLBACK_MODELS = [
    {"id": "gpt-4o-mini", "label": "gpt-4o-mini"},
    {"id": "gpt-4o", "label": "gpt-4o"},
    {"id": "gpt-4-turbo", "label": "gpt-4-turbo"},
    {"id": "gpt-4.1", "label": "gpt-4.1"},
    {"id": "gpt-4.1-mini", "label": "gpt-4.1-mini"},
    {"id": "o1", "label": "o1"},
    {"id": "o1-mini", "label": "o1-mini"},
    {"id": "o3-mini", "label": "o3-mini"},
]

CURSOR_FALLBACK_MODELS = [
    {"id": "composer-2.5", "label": "Composer 2.5"},
    {"id": "composer-2.5-fast", "label": "Composer 2.5 Fast"},
    {"id": "gpt-5.3-codex", "label": "GPT-5.3 Codex"},
]

CURSOR_MODELS_URL = "https://api.cursor.com/v1/models"


def openai_configured(session: dict) -> bool:
    return bool(session.get("openai_api_key_encrypted"))


def cursor_configured(session: dict) -> bool:
    return bool(session.get("cursor_api_key_encrypted"))


def openai_model(session: dict) -> str:
    return session.get("openai_model") or DEFAULT_OPENAI_MODEL


def cursor_model(session: dict) -> str:
    return session.get("cursor_model") or DEFAULT_CURSOR_MODEL


def openai_api_key(session: dict) -> str:
    return decrypt_token(session["openai_api_key_encrypted"])


def cursor_api_key(session: dict) -> str:
    return decrypt_token(session["cursor_api_key_encrypted"])


def openai_client_from_session(session: dict) -> OpenAIClient:
    return OpenAIClient(api_key=openai_api_key(session), model=openai_model(session))


async def verify_openai_credentials(api_key: str, model: str) -> dict:
    api_key = api_key.strip()
    model = (model or DEFAULT_OPENAI_MODEL).strip() or DEFAULT_OPENAI_MODEL
    if not api_key:
        raise ValueError("OpenAI API key is required")

    client = AsyncOpenAI(api_key=api_key)
    await client.models.list()

    return {
        "openai_api_key_encrypted": encrypt_token(api_key),
        "openai_model": model,
    }


def save_cursor_credentials(api_key: str, model: str) -> dict:
    api_key = api_key.strip()
    model = (model or DEFAULT_CURSOR_MODEL).strip() or DEFAULT_CURSOR_MODEL
    if not api_key:
        raise ValueError("Cursor API key is required")

    return {
        "cursor_api_key_encrypted": encrypt_token(api_key),
        "cursor_model": model,
    }


def _is_openai_chat_model(model_id: str) -> bool:
    excluded_prefixes = (
        "text-embedding",
        "tts-",
        "whisper",
        "dall-e",
        "davinci",
        "babbage",
        "curie",
        "ada",
        "omni-moderation",
        "ft:",
    )
    excluded_suffixes = ("-transcribe", "-realtime", "-audio", "-search")
    if any(model_id.startswith(prefix) for prefix in excluded_prefixes):
        return False
    if any(model_id.endswith(suffix) for suffix in excluded_suffixes):
        return False
    allowed_prefixes = ("gpt-", "o1", "o3", "o4", "chatgpt")
    return any(model_id.startswith(prefix) for prefix in allowed_prefixes)


def _dedupe_model_options(models: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for model in models:
        model_id = model["id"]
        if model_id in seen:
            continue
        seen.add(model_id)
        unique.append(model)
    return unique


async def list_openai_models(
    session: dict,
    api_key_override: str | None = None,
) -> tuple[list[dict[str, str]], str]:
    api_key = (api_key_override or "").strip()
    if not api_key and openai_configured(session):
        api_key = openai_api_key(session)
    if api_key:
        try:
            client = AsyncOpenAI(api_key=api_key)
            response = await client.models.list()
            models = [
                {"id": model.id, "label": model.id}
                for model in response.data
                if _is_openai_chat_model(model.id)
            ]
            if models:
                return sorted(models, key=lambda item: item["id"]), "api"
        except Exception:
            pass
    return OPENAI_FALLBACK_MODELS, "fallback"


async def list_cursor_models(api_key: str | None) -> tuple[list[dict[str, str]], str]:
    if api_key:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    CURSOR_MODELS_URL,
                    auth=(api_key, ""),
                    timeout=30.0,
                )
                response.raise_for_status()
                items = response.json().get("items", [])
                models = [
                    {
                        "id": item["id"],
                        "label": item.get("displayName") or item["id"],
                    }
                    for item in items
                    if item.get("id")
                ]
                models = _dedupe_model_options(models)
                if models:
                    return models, "api"
        except Exception:
            pass
    return CURSOR_FALLBACK_MODELS, "fallback"
