"""Jira field catalog — fetch once, resolve names/ids, build update payloads."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.clients.jira_client import JiraClient

_SYSTEM_TRANSITION_FIELDS = frozenset(
    {
        "assignee",
        "resolution",
        "priority",
        "labels",
        "comment",
        "fixVersions",
        "components",
        "versions",
        "duedate",
        "description",
        "summary",
        "timetracking",
    }
)


def normalize_field_id(field_id: str) -> str:
    value = field_id.strip()
    if value.isdigit():
        return f"customfield_{value}"
    return value


class JiraFieldCatalog:
    """Cached index of all fields from GET /rest/api/3/field."""

    def __init__(self, jira: JiraClient):
        self._jira = jira
        self._loaded = False
        self._fields: list[dict] = []
        self._by_id: dict[str, dict] = {}
        self._by_name: dict[str, str] = {}

    async def refresh(self) -> list[dict]:
        raw = await self._jira.get_fields()
        self._fields = list(raw)
        self._by_id = {}
        self._by_name = {}
        for field in self._fields:
            field_id = str(field.get("id") or "").strip()
            if not field_id:
                continue
            self._by_id[field_id] = field
            name = str(field.get("name") or "").lower().strip()
            if name and name not in self._by_name:
                self._by_name[name] = field_id
        self._loaded = True
        return self._fields

    async def all_fields(self) -> list[dict]:
        if not self._loaded:
            await self.refresh()
        return self._fields

    async def get_field(self, field_id: str) -> dict | None:
        await self.all_fields()
        return self._by_id.get(normalize_field_id(field_id))

    async def resolve_id(
        self,
        field_name: str | tuple[str, ...],
        configured_id: str | None = None,
    ) -> str:
        if configured_id and configured_id.strip():
            return normalize_field_id(configured_id)

        await self.all_fields()
        names = (field_name,) if isinstance(field_name, str) else field_name
        for name in names:
            field_id = self._by_name.get(name.lower().strip())
            if field_id:
                return field_id

        display = names[0] if len(names) == 1 else f"one of: {', '.join(names)}"
        raise ValueError(f"Jira field not found: {display}")

    async def search(
        self,
        query: str = "",
        *,
        custom_only: bool = False,
        limit: int = 200,
    ) -> list[dict]:
        await self.all_fields()
        needle = query.lower().strip()
        results: list[dict] = []
        for field in self._fields:
            if custom_only and not field.get("custom"):
                continue
            field_id = str(field.get("id") or "")
            name = str(field.get("name") or "")
            if needle:
                haystack = f"{field_id} {name}".lower()
                if needle not in haystack:
                    continue
            results.append(field)
            if len(results) >= limit:
                break
        return results

    @staticmethod
    def to_item(field: dict) -> dict:
        schema = field.get("schema") or {}
        return {
            "id": str(field.get("id") or ""),
            "name": str(field.get("name") or ""),
            "custom": bool(field.get("custom")),
            "schema_type": schema.get("type"),
            "clause_names": list(field.get("clauseNames") or []),
        }

    def load_from_items(self, items: list[dict]) -> None:
        """Hydrate the in-memory catalog from persisted field items."""
        self._fields = []
        self._by_id = {}
        self._by_name = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            field_id = str(item.get("id") or "").strip()
            if not field_id:
                continue
            field = {
                "id": field_id,
                "name": str(item.get("name") or ""),
                "custom": bool(item.get("custom")),
                "schema": {"type": item.get("schema_type")},
                "clauseNames": list(item.get("clause_names") or []),
            }
            self._fields.append(field)
            self._by_id[field_id] = field
            name = str(item.get("name") or "").lower().strip()
            if name and name not in self._by_name:
                self._by_name[name] = field_id
        self._loaded = bool(self._fields)


def search_field_items(
    items: list[dict],
    query: str = "",
    *,
    custom_only: bool = False,
    limit: int = 500,
) -> list[dict]:
    """Search persisted Jira field items (id + name + custom flags)."""
    needle = query.lower().strip()
    results: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if custom_only and not item.get("custom"):
            continue
        field_id = str(item.get("id") or "")
        name = str(item.get("name") or "")
        if needle:
            haystack = f"{field_id} {name}".lower()
            if needle not in haystack:
                continue
        results.append(item)
        if len(results) >= limit:
            break
    return results


def field_name_from_items(items: list[dict], field_id: str) -> str:
    if not field_id.strip():
        return ""
    normalized = normalize_field_id(field_id)
    for item in items:
        if not isinstance(item, dict):
            continue
        if str(item.get("id") or "") == normalized:
            return str(item.get("name") or "")
    return ""


def get_field_catalog(jira: JiraClient) -> JiraFieldCatalog:
    catalog = getattr(jira, "_field_catalog", None)
    if catalog is None:
        catalog = JiraFieldCatalog(jira)
        jira._field_catalog = catalog
    return catalog


async def resolve_jira_field_id(
    jira: JiraClient,
    field_name: str | tuple[str, ...],
    configured_id: str | None = None,
) -> str:
    return await get_field_catalog(jira).resolve_id(field_name, configured_id)


async def build_select_field_payload(
    jira: JiraClient,
    issue_key: str,
    field_id: str,
    value: str,
) -> dict:
    """Build a select/option payload using editmeta allowed values when available."""
    target = value.lower().strip()
    editmeta = await jira.get_issue_editmeta(issue_key)
    field_meta = editmeta.get(field_id) or {}
    for option in field_meta.get("allowedValues") or []:
        option_value = str(option.get("value") or option.get("name") or "").strip()
        if option_value.lower() == target:
            option_id = option.get("id")
            if option_id is not None:
                return jira.select_field_payload(value, option_id=str(option_id))
            return jira.select_field_payload(value)

    option_id = await jira._resolve_select_option_id(issue_key, field_id, value)
    if option_id:
        return jira.select_field_payload(value, option_id=option_id)
    return jira.select_field_payload(value)


def is_system_transition_field(field_id: str) -> bool:
    return field_id in _SYSTEM_TRANSITION_FIELDS


async def filter_settable_transition_fields(
    jira: JiraClient,
    issue_key: str,
    transition: dict,
    fields: dict | None,
) -> dict | None:
    """Keep only fields that appear on the transition screen and can be posted."""
    if not fields:
        return None

    screen_meta = transition.get("fields") or {}
    allowed_screen = set(screen_meta.keys())
    if not allowed_screen:
        return None

    editmeta = await jira.get_issue_editmeta(issue_key)
    editable = set(editmeta.keys())

    filtered: dict = {}
    for field_id, value in fields.items():
        if field_id not in allowed_screen:
            continue
        meta = screen_meta.get(field_id) or {}
        schema = meta.get("schema") or {}
        is_custom = bool(schema.get("custom")) or str(field_id).startswith("customfield_")
        if is_custom and field_id not in editable:
            continue
        if not is_custom and not is_system_transition_field(field_id):
            continue
        filtered[field_id] = value

    return filtered or None
