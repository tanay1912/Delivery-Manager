"""Detect repository technology from key config files in the target repository."""

from __future__ import annotations

import json
import re

from app.clients.bitbucket_client import BitbucketClient

PROBE_FILES = (
    "composer.json",
    "composer.lock",
    "package.json",
    "pyproject.toml",
    "app/etc/config.php",
    "README.md",
    "readme.md",
)

MAGENTO_PACKAGES = (
    "magento/product-community-edition",
    "magento/product-enterprise-edition",
    "magento/magento2-base",
    "magento/framework",
    "magento/module-",
)

HYVA_PACKAGES = (
    "hyva-themes/",
    "hyva/magento",
)


def _parse_composer_require(content: str) -> dict[str, str]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return {}
    requires: dict[str, str] = {}
    for section in ("require", "require-dev"):
        for name, version in (data.get(section) or {}).items():
            if isinstance(name, str) and isinstance(version, str):
                requires[name] = version
    return requires


def _detect_stack_from_composer(requires: dict[str, str]) -> list[str]:
    hints: list[str] = []
    names = " ".join(requires.keys()).lower()

    if any(pkg in names for pkg in MAGENTO_PACKAGES) or "magento/" in names:
        hints.append("Magento 2")

    hyva = [pkg for pkg in requires if any(h in pkg.lower() for h in HYVA_PACKAGES)]
    if hyva:
        hints.append("Hyvä theme stack")

    if any("magewire" in pkg.lower() for pkg in requires):
        hints.append("Magewire")

    if "magento/product-community-edition" in requires:
        hints.append("Magento Open Source")
    if "magento/product-enterprise-edition" in requires:
        hints.append("Magento Commerce / Adobe Commerce")

    tailwind = [pkg for pkg in requires if "tailwind" in pkg.lower()]
    if tailwind:
        hints.append("Tailwind CSS (PHP/frontend tooling)")

    return hints


def _detect_stack_from_package_json(content: str) -> list[str]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []
    deps = {**(data.get("dependencies") or {}), **(data.get("devDependencies") or {})}
    hints: list[str] = []
    if "react" in deps:
        hints.append("React")
    if "vue" in deps:
        hints.append("Vue")
    if "next" in deps:
        hints.append("Next.js")
    if "vite" in deps:
        hints.append("Vite")
    if "tailwindcss" in deps:
        hints.append("Tailwind CSS")
    if "typescript" in deps:
        hints.append("TypeScript")
    return hints


def _detect_stack_from_pyproject(content: str) -> list[str]:
    hints: list[str] = []
    lowered = content.lower()
    if "fastapi" in lowered:
        hints.append("FastAPI")
    if "django" in lowered:
        hints.append("Django")
    if "flask" in lowered:
        hints.append("Flask")
    return hints


def _magento_module_paths(requires: dict[str, str]) -> list[str]:
    """Vendor modules declared in composer — hints at custom vs vendor layout."""
    custom = [
        name
        for name in requires
        if "/" in name and not name.startswith(("magento/", "hyva-themes/", "php/", "symfony/"))
    ]
    return custom[:8]


def build_repo_stack_summary(file_contents: dict[str, str]) -> str:
    """Build a concise technology summary from probed repository files."""
    stack: list[str] = []
    composer_requires: dict[str, str] = {}

    if composer := file_contents.get("composer.json"):
        composer_requires = _parse_composer_require(composer)
        stack.extend(_detect_stack_from_composer(composer_requires))

    if package_json := file_contents.get("package.json"):
        stack.extend(_detect_stack_from_package_json(package_json))

    if pyproject := file_contents.get("pyproject.toml"):
        stack.extend(_detect_stack_from_pyproject(pyproject))

    if file_contents.get("app/etc/config.php") and "Magento 2" not in stack:
        stack.append("Magento 2")

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_stack: list[str] = []
    for item in stack:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            unique_stack.append(item)

    lines: list[str] = []
    if unique_stack:
        lines.append(f"Detected stack: {', '.join(unique_stack)}")
    else:
        lines.append("Detected stack: (unknown — explore the repository before implementing)")

    if composer_requires:
        magento_modules = _magento_module_paths(composer_requires)
        if magento_modules:
            lines.append(f"Notable composer packages: {', '.join(magento_modules)}")

    readme = file_contents.get("README.md") or file_contents.get("readme.md") or ""
    if readme.strip():
        snippet = re.sub(r"\s+", " ", readme.strip())[:400]
        lines.append(f"README excerpt: {snippet}")

    if "Magento 2" in unique_stack or "Hyvä theme stack" in unique_stack:
        lines.append(
            "Magento notes: use module-based layout (app/code/Vendor/Module), "
            "Hyvä/Tailwind templates where present, and match existing module naming in the repo."
        )

    return "\n".join(lines)


async def probe_repository_stack(
    bitbucket: BitbucketClient,
    workspace: str,
    repo_slug: str,
    ref: str,
) -> tuple[str, list[str]]:
    """Load key config files and return (stack summary, loaded file paths)."""
    file_contents: dict[str, str] = {}
    loaded: list[str] = []

    for path in PROBE_FILES:
        if path in file_contents:
            continue
        content = await bitbucket.get_file(workspace, repo_slug, path, ref)
        if content:
            file_contents[path] = content[:8000]
            loaded.append(path)

    summary = build_repo_stack_summary(file_contents)
    return summary, loaded
