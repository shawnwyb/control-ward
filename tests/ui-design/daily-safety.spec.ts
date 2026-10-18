import { test, expect } from "@playwright/test";
import { go, signIn } from "./helpers";

const cta = "View Next-day report";

test("daily safety links out to its own next-day report page and loads the forecast only on demand", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page
    .locator("#site")
    .selectOption({ label: "Turkey Point · Report demo" });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/reports/621/")) requests.push(request.url());
  });
  await go(page, "Daily safety");
  const nav = page.getByRole("navigation", { name: "Pages" });
  await expect(
    nav.getByRole("link", { name: "Daily safety", exact: true }),
  ).toHaveCount(1);
  await expect(
    nav.getByRole("link", { name: "Next-day report", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Daily safety", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#safety-checklist")).toBeVisible();
  await expect(page.locator("#plan")).toBeVisible();
  await expect(page.locator("#next-day-report")).toHaveCount(0);
  expect(requests).toHaveLength(0);
  const order = await page
    .locator("#safety-checklist")
    .evaluate((el) =>
      Boolean(
        el.compareDocumentPosition(document.getElementById("plan")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    );
  expect(order).toBe(true);
  await page.getByRole("button", { name: cta, exact: true }).click();
  await expect(page).toHaveURL(/#\/next-day-report$/);
  await expect(page.locator("#next-day-report")).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  await go(page, "Daily safety");
  await expect(page.locator("#next-day-report")).toHaveCount(0);
  await expect(page.locator("#safety-checklist")).toBeVisible();
  await page.getByRole("button", { name: cta, exact: true }).click();
  await expect(page.locator("#next-day-report")).toBeVisible();
});

test("worker keeps the checklist and follows the button to the report page", async ({
  page,
}) => {
  await signIn(page, "crew@planit.local");
  await go(page, "Daily safety");
  await expect(page.locator("#safety-checklist")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve and send to crew" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: cta, exact: true }).click();
  await expect(page).toHaveURL(/#\/next-day-report$/);
  await expect(
    page.getByText("A detailed forecast is not available for this site.", {
      exact: false,
    }),
  ).toBeVisible();
  await go(page, "Daily safety");
  await expect(page.locator("#safety-checklist")).toBeVisible();
});

test("old briefing bookmarks still reach daily safety and report bookmarks open the report page", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.evaluate(() => {
    location.hash = "#/briefing";
  });
  await expect(
    page.getByRole("heading", { name: "Daily safety", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#safety-checklist")).toBeVisible();
  await go(page, "Sites");
  await page
    .locator("#site")
    .selectOption({ label: "Turkey Point · Report demo" });
  await page.evaluate(() => {
    location.hash = "#/next-day-report";
  });
  await expect(
    page.getByRole("heading", { name: "Next-day report", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#next-day-report")).toBeVisible();
  await page.evaluate(() => {
    location.hash = "#/daily-safety";
  });
  await expect(page.locator("#next-day-report")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Daily safety", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    location.hash = "#/next-day-report";
  });
  await expect(page.locator("#next-day-report")).toBeVisible();
});
