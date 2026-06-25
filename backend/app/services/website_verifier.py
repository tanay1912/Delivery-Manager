import logging

logger = logging.getLogger(__name__)


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


async def verify_website(
    *,
    issue_key: str,
    summary: str,
    environment: str,
    website_url: str,
    openai_client,
) -> dict:
    screenshot = await capture_website_screenshot(website_url)
    analysis = await openai_client.verify_website_screenshot(
        issue_key,
        summary,
        environment,
        website_url,
        screenshot,
    )
    return {
        "environment": environment,
        "url": website_url,
        "screenshot_png": screenshot,
        "analysis": analysis,
    }
