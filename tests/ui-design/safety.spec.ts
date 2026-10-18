import { test, expect, type Page } from "@playwright/test";
import { go, signIn } from "./helpers";
async function login(page: Page, email: string, navigate = true, query = "") {
  if (navigate) await signIn(page, email, query);
  else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("CrewDemo123!");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.locator("#sidebar")).toBeAttached();
  }
  await go(
    page,
    email.startsWith("supervisor")
      ? "Next-day briefing"
      : "Tomorrow's briefing",
  );
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
  await expect(panel.getByRole("blockquote")).not.toBeVisible();
  await panel.getByText(/Research details ·/).click();
  await expect(
    panel.getByText(/Gainesville city, Alachua County, Florida/),
  ).toBeVisible();
  await panel.getByText(/Research details ·/).click();
  await expect(panel.getByLabel("Planned task description")).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: /Generate|Publish|Save work|reviewed revision/,
    }),
  ).toHaveCount(0);
  await panel
    .getByText(/Scope & sources/)
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
  await login(page, "crew@planit.local", true, "?safety=stale");
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
  await login(page, "supervisor@planit.local", true, "?safety=retry");
  const panel = page.locator("#safety-checklist");
  await panel.getByText(/Research details ·/).click();
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
  await login(page, "crew@planit.local", true, "?safety=revised");
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
  await login(page, "crew@planit.local", true, "?safety=missing");
  const panel = page.locator("#safety-checklist");
  await expect(
    panel.getByRole("region", { name: "Automatic worker checklist" }),
  ).toBeVisible({ timeout: 12000 });
  await panel.getByText(/Sources and conditions ·/).click();
  await panel.getByText(/Coverage is limited/).click();
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

test("a long legacy checklist stays compact on mobile and preserves every instruction and quote", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "crew@planit.local", true, "?safety=long");
  const panel = page.locator("#safety-checklist");
  const actions = panel.getByRole("list", { name: "Priority worker actions" });
  await expect(actions.locator(":scope > li")).toHaveCount(5);
  for (const quote of await panel.getByRole("blockquote").all())
    await expect(quote).not.toBeVisible();
  expect((await panel.boundingBox())!.height).toBeLessThan(1200);
  await panel.screenshot({
    path: "test-results/safety-compact-worker-mobile.png",
  });
  await panel.getByText("7 additional instructions from this version").click();
  await expect(
    panel.getByText("FICTIONAL DEMO action 12", { exact: true }),
  ).toBeVisible();
  await panel
    .getByText(/Scope & sources/)
    .last()
    .click();
  await expect(panel.getByRole("blockquote").last()).toContainText(
    "FICTIONAL DEMO",
  );
});
