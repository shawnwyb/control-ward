import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, email: string, navigate = true) {
  if (navigate) await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
}
test("a checklist appears automatically for supervisor and worker, with no planning or publication steps", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-north");
  const panel = page.locator("#safety-checklist");
  await expect(
    panel.getByRole("region", { name: "Automatic worker checklist" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    panel.getByText("Heat index (F): 92", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(/Gainesville city, Alachua County, Florida/),
  ).toBeVisible();
  await expect(panel.getByLabel("Planned task description")).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: /Generate|Publish|Save work|reviewed revision/,
    }),
  ).toHaveCount(0);
  await panel
    .getByText("FICTIONAL DEMO safety guidance", { exact: true })
    .first()
    .click();
  await expect(panel.getByRole("blockquote")).toContainText("FICTIONAL DEMO");
  await panel.screenshot({
    path: "test-results/safety-automatic-supervisor.png",
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page, "crew@planit.local", false);
  await expect(
    panel.getByRole("button", { name: "Acknowledge this checklist" }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "Acknowledge this checklist" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Receipt recorded", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: "test-results/safety-automatic-worker-mobile.png",
  });
  expect(errors).toEqual([]);
});
test("stale guidance cannot be acknowledged while urgent crew alerts remain visible", async ({
  page,
}) => {
  await page.goto("/?safety=stale");
  await login(page, "crew@planit.local", false);
  const panel = page.locator("#safety-checklist");
  await expect(
    panel.getByText("Updating / out of date", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Acknowledge this checklist" }),
  ).toBeDisabled();
  await expect(panel.getByText(/STALE/)).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Stop work" }),
  ).toBeVisible();
});
test("automatic retry preserves the previous checklist without requiring an admin action", async ({
  page,
}) => {
  await page.goto("/?safety=retry");
  await login(page, "supervisor@planit.local", false);
  const panel = page.locator("#safety-checklist");
  await expect(
    panel.getByText(/Updating automatically: queued.*Attempt 2/),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Automatic worker checklist" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Generate|Publish/ }),
  ).toHaveCount(0);
});
test("an automatically replaced checklist requires a fresh receipt", async ({
  page,
}) => {
  await page.goto("/?safety=revised");
  await login(page, "crew@planit.local", false);
  const panel = page.locator("#safety-checklist");
  await panel
    .getByRole("button", { name: "Acknowledge this checklist" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Receipt recorded", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "Acknowledge this checklist" }),
  ).toBeEnabled({ timeout: 12000 });
  await panel
    .getByRole("button", { name: "Acknowledge this checklist" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Receipt recorded", exact: true }),
  ).toBeDisabled();
});
test("missing jurisdiction and condition data produce explicit gaps instead of fabricated instructions", async ({
  page,
}) => {
  await page.goto("/?safety=missing");
  await login(page, "crew@planit.local", false);
  const panel = page.locator("#safety-checklist");
  await expect(
    panel.getByRole("region", { name: "Automatic worker checklist" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    panel.getByText("Jurisdiction: Lookup unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(/Jurisdiction lookup and official sources unavailable/),
  ).toBeVisible();
  await expect(
    panel.getByText(/No verified instruction could be extracted/),
  ).toBeVisible();
});
