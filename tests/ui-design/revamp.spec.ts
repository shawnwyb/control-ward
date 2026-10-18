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
      emoji: /\p{Extended_Pictographic}/u.test(document.body.innerText),
    };
  });
  expect(bg).toBe("rgb(255, 255, 255)");
  expect(font).not.toContain("IBM Plex");
  expect(emoji).toBe(false);
});
