import { test, expect, type Page } from "@playwright/test";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test
async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
}

test("supervisor sees risk, one alerts section and a role-aware heading", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await expect(
    page.getByRole("heading", { name: "Site control" }),
  ).toBeVisible();
  await expect(page.locator("#risk-now")).toContainText("5.2");
  // Alerts appear once for supervisors, not again in the crew tools.
  await expect(page.getByText("Warning · raised")).toHaveCount(1);
  // The metrics strip is reduced to the connection line.
  await expect(page.locator("#metric-count")).toHaveCount(0);
});

test("send explains why it is disabled, then enables", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  const send = page.getByRole("button", { name: "Send alert" });
  await expect(send).toBeDisabled();
  await expect(page.locator("#push-blocker")).toHaveText("Add a title.");
  await page.locator("#push-title-input").fill("Heads up");
  await expect(page.locator("#push-blocker")).toHaveText("Add a message.");
  await page.locator("#push-body").fill("Wrap up by 1 PM.");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText("Delivered to 2 of 2 devices")).toBeVisible({
    timeout: 10000,
  });
  await page.getByLabel("Selected (0)").check();
  await expect(page.locator("#push-blocker")).toContainText(
    "Tick at least one worker",
  );
});

test("phone: section nav and Show on map bring the map into view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "supervisor@planit.local");
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Crew" }).click();
  await expect(page.locator("#crew")).toBeInViewport();
  await page.getByRole("button", { name: "Show on map" }).first().click();
  await expect(page.locator("#site-map")).toBeInViewport();
});

test("crew does not get the dashboard or section nav", async ({ page }) => {
  await signIn(page, "crew@planit.local");
  await expect(
    page.getByRole("heading", { name: "Crew reporting" }),
  ).toBeVisible();
  await expect(page.locator("#supervisor-dashboard")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send alert" })).toHaveCount(0);
});

test("plan draft generates, shows blocked hours and can be approved", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.getByRole("button", { name: "Draft now" }).click();
  await expect(page.locator("#briefing-plan")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Blocked hours: 13:00 to 16:00/)).toBeVisible();
  await page.getByRole("button", { name: "Approve and send to crew" }).click();
  await expect(page.getByText(/Sent to crew/)).toBeVisible();
});
