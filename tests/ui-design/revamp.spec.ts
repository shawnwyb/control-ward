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

test("reports: Mine narrows the list to the signed-in user's reports", async ({
  page,
}) => {
  await signIn(page, "crew@planit.local");
  await go(page, "Reports");
  const cards = page.locator(".report-card");
  await expect(cards.first()).toBeVisible();
  const before = await cards.count();
  expect(before).toBeGreaterThan(1);
  await go(page, "My site");
  await page.getByRole("radio", { name: /Wildlife/ }).check();
  await page.getByRole("button", { name: "Submit hazard report" }).click();
  await expect(page.getByRole("status")).toContainText("Hazard reported");
  await go(page, "Reports");
  await expect(cards).toHaveCount(before + 1);
  await page.getByLabel("Mine").check();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Wildlife");
  await page.getByLabel("Mine").uncheck();
  await expect(cards).toHaveCount(before + 1);
});

test("sidebar: Alerts badge counts the selected site's active alerts", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  const link = page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: /^Alerts/ });
  await page.locator("#site").selectOption("site-north");
  await expect(link).toHaveAccessibleName("Alerts 2 active");
  await page.locator("#site").selectOption("site-south");
  await expect(link).toHaveAccessibleName("Alerts 1 active");
});

test("site switcher: the choice survives a reload, and storage failures are harmless", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-south");
  await page.reload();
  await expect(page.locator("#site")).toHaveValue("site-south");

  // Blocked storage for our key must not stop the app loading or switching sites.
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) {
      if (key === "planit.site") throw new Error("blocked");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "planit.site") throw new Error("blocked");
      return set.call(this, key, value);
    };
  });
  await page.reload();
  await expect(page.locator("#site")).toBeVisible();
  await page.locator("#site").selectOption("site-north");
  await expect(page.locator("#site")).toHaveValue("site-north");
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
});

test("crew page: ticked workers stay ticked after visiting another page", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption({ label: "North Plant · Demo" });
  await go(page, "Crew");
  // The site switch finishes asynchronously; wait for it before ticking.
  await expect(
    page.locator("main").getByText("North Plant · Demo").first(),
  ).toBeVisible();
  await page.getByLabel("Select Jordan Lee").check();
  await go(page, "Reports");
  await go(page, "Crew");
  await expect(page.getByLabel("Select Jordan Lee")).toBeChecked();
  // A different site starts clean.
  await page.locator("#site").selectOption({ label: "South Plant · Demo" });
  await expect(
    page.locator("main").getByText("South Plant · Demo").first(),
  ).toBeVisible();
  await page.locator("#site").selectOption({ label: "North Plant · Demo" });
  await expect(
    page.locator("main").getByText("North Plant · Demo").first(),
  ).toBeVisible();
  await expect(page.getByLabel("Select Jordan Lee")).not.toBeChecked();
});
