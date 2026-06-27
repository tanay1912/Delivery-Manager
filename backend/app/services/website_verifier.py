import logging
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)


def normalize_verification_url(base_website_url: str, candidate_url: str) -> str:
    """Resolve candidate to an absolute URL on the same host as the base website."""
    base = base_website_url.strip()
    if not base:
        return candidate_url.strip()

    if "://" not in base:
        base = f"https://{base.lstrip('/')}"

    parsed_base = urlparse(base)
    origin = f"{parsed_base.scheme}://{parsed_base.netloc}"
    base_path = base if base.endswith("/") else f"{base}/"

    candidate = (candidate_url or "").strip()
    if not candidate:
        return base

    if "://" not in candidate:
        candidate = urljoin(base_path, candidate.lstrip("/"))

    parsed_candidate = urlparse(candidate)
    if parsed_candidate.netloc.lower() != parsed_base.netloc.lower():
        logger.warning(
            "Verification URL %s is off-domain for base %s; using base URL",
            candidate,
            base,
        )
        return base

    return candidate


async def capture_website_screenshot(url: str) -> bytes:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwright is required for website verification. Install with: pip install playwright && playwright install chromium"
        ) from exc

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            page = await browser.new_page(viewport={"width": 1440, "height": 900})
            await page.goto(url, wait_until="networkidle", timeout=90_000)
            return await page.screenshot(full_page=True, type="png")
        finally:
            await browser.close()


async def resolve_verification_target(
    *,
    issue_key: str,
    summary: str,
    description: str,
    changed_files: list,
    base_website_url: str,
    openai_client,
) -> dict:
    """Pick the page URL to screenshot for Unit Testing based on the ticket and code changes."""
    base = base_website_url.strip()
    fallback = {
        "url": base,
        "page_type": "homepage",
        "reason": "Default homepage verification",
    }
    if not base:
        return fallback

    try:
        resolved = await openai_client.resolve_verification_url(
            issue_key=issue_key,
            summary=summary,
            description=description,
            changed_files=changed_files,
            base_website_url=base,
        )
    except Exception as exc:
        logger.warning("Failed to resolve verification URL for %s: %s", issue_key, exc)
        return fallback

    url = normalize_verification_url(base, resolved.get("url", ""))
    page_type = str(resolved.get("page_type", "other")).strip().lower() or "other"
    reason = str(resolved.get("reason", "")).strip() or fallback["reason"]
    if url == base and page_type not in ("homepage", "other"):
        page_type = "homepage"
    return {"url": url, "page_type": page_type, "reason": reason}


async def verify_website(
    *,
    issue_key: str,
    summary: str,
    description: str,
    changed_files: list,
    environment: str,
    website_url: str,
    openai_client,
) -> dict:
    target = await resolve_verification_target(
        issue_key=issue_key,
        summary=summary,
        description=description,
        changed_files=changed_files,
        base_website_url=website_url,
        openai_client=openai_client,
    )
    screenshot_url = target["url"]
    screenshot = await capture_website_screenshot(screenshot_url)
    analysis = await openai_client.verify_website_screenshot(
        issue_key,
        summary,
        environment,
        screenshot_url,
        screenshot,
        page_type=target["page_type"],
        page_reason=target["reason"],
    )
    return {
        "environment": environment,
        "url": screenshot_url,
        "page_type": target["page_type"],
        "page_reason": target["reason"],
        "screenshot_png": screenshot,
        "analysis": analysis,
    }
