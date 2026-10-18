import { test, expect } from "@playwright/test";
import { go, signIn } from "./helpers";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test

test("supervisor sees risk, one alerts section and a role-aware heading", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  // Signs in on Jacksonville; the detail agrees with its row in the sites table.
  await expect(page.locator("#risk-now")).toContainText("4.1");
  await go(page, "Alerts");
  // Alerts appear once for supervisors, not again in the crew tools.
  await expect(page.getByText("Warning · raised")).toHaveCount(1);
  // The metrics strip is reduced to the connection line.
  await expect(page.locator("#metric-count")).toHaveCount(0);
});

test("send explains why it is disabled, then enables", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  await go(page, "Crew");
  const send = page.getByRole("button", { name: "Send alert" });
  await expect(send).toBeDisabled();
  await expect(page.locator("#push-blocker")).toHaveText("Add a title.");
  await page.locator("#push-title-input").fill("Heads up");
  await expect(page.locator("#push-blocker")).toHaveText("Add a message.");
  await page.locator("#push-body").fill("Wrap up by 1 PM.");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(
    page.getByText("Alert sent. It now shows on the crew’s screens."),
  ).toBeVisible({
    timeout: 10000,
  });
  await page.getByLabel("Selected (0)").check();
  await expect(page.locator("#push-blocker")).toContainText(
    "Tick at least one worker",
  );
});

test("crew does not get the dashboard or section nav", async ({ page }) => {
  await signIn(page, "crew@planit.local");
  await expect(
    page.getByRole("heading", { name: "North Plant · Demo" }),
  ).toBeVisible();
  await expect(page.locator("#supervisor-dashboard")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send alert" })).toHaveCount(0);
});

test("plan draft generates, shows blocked hours and can be approved", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await go(page, "Daily safety");
  await page.getByRole("button", { name: "Draft now" }).click();
  await expect(page.locator("#briefing-plan")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Blocked hours: 13:00 to 16:00/)).toBeVisible();
  await page.getByRole("button", { name: "Approve and send to crew" }).click();
  await expect(page.getByText(/Sent to crew/)).toBeVisible();
});
