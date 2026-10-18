import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test
test("mud routes show on the site map for a site with a mud layer", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page
    .locator("#site")
    .selectOption({ label: "Turkey Point · Report demo" });
  const mud = page.getByRole("button", { name: "Mud" });
  await expect(mud).toBeVisible({ timeout: 10000 });
  await expect(mud).toHaveAttribute("aria-pressed", "false");
  await mud.click();
  await expect(mud).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/\d+ to hold, \d+ to inspect/)).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByText(/does not certify a crossing is safe/),
  ).toBeVisible();
  await page.getByRole("button", { name: /excavator/i }).click();
  await expect(
    page.getByText(/\d+ to hold, \d+ to inspect|No unpaved routes/),
  ).toBeVisible();
  await mud.click();
  await expect(page.getByText(/\d+ to hold, \d+ to inspect/)).toHaveCount(0);
});

test("a site with no plant id has no mud chip", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption({ label: "North Plant · Demo" });
  await expect(page.getByRole("button", { name: "Rain" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mud" })).toHaveCount(0);
});

test("satellite imagery can be turned on and off, with mud on top", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page
    .locator("#site")
    .selectOption({ label: "Turkey Point · Report demo" });
  const map = page.locator("[data-satellite]");
  await expect(map).toHaveAttribute("data-satellite", "off");
  const chip = page.getByRole("button", { name: "Satellite" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(map).toHaveAttribute("data-satellite", "on");
  await page.getByRole("button", { name: "Mud" }).click();
  await expect(page.getByText(/\d+ to hold, \d+ to inspect/)).toBeVisible();
  await chip.click();
  await expect(map).toHaveAttribute("data-satellite", "off");
});
