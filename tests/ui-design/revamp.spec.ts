import { test, expect } from "@playwright/test";

import { go, signIn } from "./helpers";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test
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

test("shell: sidebar pages and role guard", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  const nav = page.getByRole("navigation", { name: "Pages" });
  for (const name of [
    "Sites",
    "Alerts",
    "Next-day briefing",
    "Crew",
    "Reports",
  ])
    await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await go(page, "Crew");
  await expect(page.locator("#crew-roster")).toBeVisible();
  await expect(page).toHaveURL(/#\/crew$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.locator("#risk-now")).toBeVisible();

  // The query string survives page changes (the mock reads flags from it).
  await page.goto("/?safety=stale#/sign-in");
  await expect(page).toHaveURL(/\?safety=stale#\//);
});

test("shell: crew cannot open supervisor pages", async ({ page }) => {
  await signIn(page, "crew@planit.local");
  const nav = page.getByRole("navigation", { name: "Pages" });
  for (const name of ["My site", "Alerts", "Tomorrow's briefing", "Reports"])
    await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Crew" })).toHaveCount(0);
  await page.evaluate(() => (location.hash = "#/crew"));
  await expect(page.getByRole("heading", { name: "My site" })).toBeVisible();
  await expect(page).toHaveURL(/#\/site$/);
  await expect(page.locator("#crew-roster")).toHaveCount(0);
});

test("shell: signed-out visitors cannot open app pages", async ({ page }) => {
  await page.goto("/#/alerts");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page).toHaveURL(/#\/sign-in$/);
});

test("phone: sidebar collapses to a menu button and opens pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "supervisor@planit.local");
  const nav = page.getByRole("navigation", { name: "Pages" });
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Crew" }).click();
  await expect(page.locator("#crew-roster")).toBeVisible();
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Show on map" }).first().click();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.locator("#site-map")).toBeVisible();
});
