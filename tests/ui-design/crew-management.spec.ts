import { test, expect } from "@playwright/test";
import { go, signIn } from "./helpers";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test

test("supervisor adds and removes crew in the Crew section", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await go(page, "Crew");
  const roster = page.locator("#crew-roster");
  await expect(roster).toContainText("Jordan Lee");

  await page.getByLabel("Add crew by email").fill("taylor.kim@example.com");
  await page.getByRole("button", { name: "Add to site" }).click();
  await expect(roster).toContainText("taylor.kim");

  await page.getByLabel("Add crew by email").fill("nobody@example.com");
  await page.getByRole("button", { name: "Add to site" }).click();
  await expect(
    page.getByText("No account uses that email address."),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Remove taylor.kim from/ }).click();
  await page.getByRole("button", { name: "Remove from site" }).click();
  await expect(roster).not.toContainText("taylor.kim");
});

test("crew has no stats bar but keeps the connection indicator", async ({
  page,
}) => {
  await signIn(page, "crew@planit.local");
  await expect(page.locator("#connection")).toBeVisible();
  await expect(page.getByText("Site risk")).toHaveCount(0);
  await expect(page.locator("#crew-roster")).toHaveCount(0);
});

test("crew can acknowledge a stop-work alert", async ({ page }) => {
  await signIn(page, "crew@planit.local");
  await go(page, "Alerts");
  const ack = page
    .getByRole("button", { name: "Acknowledge", exact: true })
    .first();
  await ack.click();
  await expect(page.getByText("Acknowledged").first()).toBeVisible();
});

test("a supervisor alert shows on the crew's screen like a safety alert", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption({ label: "North Plant · Demo" });
  await go(page, "Crew");
  await page.locator("#push-title-input").fill("Wrap up early");
  await page
    .locator("#push-body")
    .fill("Storm cell moving in. Be off the roof by 1 PM.");
  await page.getByRole("button", { name: "Send alert" }).click();
  await expect(page.getByText("Alert sent")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill("crew@planit.local");
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await go(page, "Alerts");
  await expect(page.getByText("Wrap up early")).toBeVisible();
  await expect(page.getByText("Be off the roof by 1 PM.")).toBeVisible();
  const message = page
    .getByText("Wrap up early", { exact: true })
    .locator("../..");
  await message
    .getByRole("button", { name: "Acknowledge", exact: true })
    .click();
  await expect(
    message.getByText("Acknowledged", { exact: true }),
  ).toBeVisible();
});

test("only the chosen crew see a targeted supervisor alert", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption({ label: "North Plant · Demo" });
  await go(page, "Crew");
  await page.getByLabel("Selected (0)").check();
  await page.getByLabel("Select Jordan Lee").check();
  await page.locator("#push-title-input").fill("Jordan only");
  await page.locator("#push-body").fill("Meet at gate 2.");
  await page.getByRole("button", { name: "Send alert" }).click();
  await expect(page.getByText("Alert sent")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill("crew@planit.local");
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await go(page, "Alerts");
  await expect(
    page.getByRole("button", { name: "Acknowledge", exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Jordan only")).toHaveCount(0);
});
