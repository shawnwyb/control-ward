import { test, expect, type Page } from "@playwright/test";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test
async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
}

test("theme: Notion surfaces and fonts", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  await expect(page.locator("#risk-now")).toBeVisible();
  const { bg, font, emoji } = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return {
      bg: body.backgroundColor,
      font: body.fontFamily,
      // (c), (R) and TM (e.g. the map attribution) are pictographic but not emoji.
      emoji:
        document.body.innerText.match(
          /(?![\u00a9\u00ae\u2122])\p{Extended_Pictographic}/gu,
        ) ?? [],
    };
  });
  expect(bg).toBe("rgb(255, 255, 255)");
  expect(font).not.toContain("IBM Plex");
  expect(emoji).toEqual([]);
});
