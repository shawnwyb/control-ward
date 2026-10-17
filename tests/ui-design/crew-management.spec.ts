import { test, expect, type Page } from "@playwright/test";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test
async function signIn(page: Page, email: string, query = "") {
  await page.goto(`/${query}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
}

test("supervisor adds and removes crew in the Crew section", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
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
  const ack = page.getByRole("button", { name: "Acknowledge" }).first();
  await ack.click();
  await expect(page.getByText("Acknowledged").first()).toBeVisible();
});
