import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, email: string, navigate = true) {
  if (navigate) await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
}
async function saveWork(page: Page) {
  const panel = page.locator("#safety-checklist");
  await panel
    .getByLabel("Planned task description")
    .fill("Inspect generator before maintenance");
  await panel.getByRole("button", { name: "Save work context" }).click();
  await expect(
    panel.getByText("Work context saved.", { exact: false }),
  ).toBeVisible();
  return panel;
}
test("supervisor drafts, edits, publishes; crew sees only publication and exact receipt", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-north");
  const panel = await saveWork(page);
  await panel
    .getByRole("button", { name: "Generate safety draft", exact: true })
    .click();
  await expect(
    panel.getByRole("region", { name: "Supervisor draft review" }),
  ).toBeVisible({ timeout: 12000 });
  await panel
    .getByLabel("Private review notes")
    .fill("Private note: follow up with safety officer");
  await expect(
    panel.getByRole("button", { name: "Publish safety checklist" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Save reviewed revision" }).click();
  await expect(
    panel.getByText("Supervisor draft review · Revision 2"),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Publish safety checklist" }).click();
  await expect(
    panel.getByText("Safety checklist published to site members."),
  ).toBeVisible();
  await panel
    .getByRole("region", { name: "Published worker checklist" })
    .getByText("FICTIONAL DEMO company pre-job procedure")
    .click();
  await panel.screenshot({ path: "test-results/safety-supervisor.png" });
  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page, "crew@planit.local", false);
  await expect(
    panel.getByRole("button", { name: "Acknowledge this revision" }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("region", { name: "Supervisor draft review" }),
  ).toHaveCount(0);
  await expect(
    panel.getByText("Private note: follow up with safety officer"),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Acknowledge this revision" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Receipt recorded", exact: true }),
  ).toBeDisabled();
  await panel.screenshot({ path: "test-results/safety-crew.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: "test-results/safety-crew-mobile.png" });
  expect(errors).toEqual([]);
});
test("stale guidance is visible and cannot be acknowledged; crew alerts remain", async ({
  page,
}) => {
  await page.goto("/?safety=stale");
  await login(page, "crew@planit.local", false);
  const panel = page.locator("#safety-checklist");
  await expect(
    panel.getByText("Needs supervisor review", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Acknowledge this revision" }),
  ).toBeDisabled();
  await expect(
    panel.getByText(/Hazard feed is missing or stale/),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Stop work" }),
  ).toBeVisible();
});
test("pending/retry states preserve published checklist and display attempt status", async ({
  page,
}) => {
  await page.goto("/?safety=retry");
  await login(page, "supervisor@planit.local", false);
  const panel = await saveWork(page);
  await panel
    .getByRole("button", { name: "Generate safety draft", exact: true })
    .click();
  await expect(panel.getByText(/Generation: queued · Attempt 2/)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Generate new safety draft" }),
  ).toBeDisabled();
});
test("site change clears private draft; date changes clear prior checklist", async ({
  page,
}) => {
  await login(page, "supervisor@planit.local");
  const panel = await saveWork(page);
  await panel
    .getByRole("button", { name: "Generate safety draft", exact: true })
    .click();
  await expect(
    panel.getByRole("region", { name: "Supervisor draft review" }),
  ).toBeVisible({ timeout: 12000 });
  const siteSelect = page
    .locator("select")
    .filter({ has: page.locator('option[value="site-south"]') });
  const selected = await siteSelect.inputValue();
  await siteSelect.selectOption(
    selected === "site-south" ? "site-north" : "site-south",
  );
  await expect(
    panel.getByRole("region", { name: "Supervisor draft review" }),
  ).toHaveCount(0);
  await expect(panel.getByLabel("Planned task description")).toHaveValue("");
  await panel.getByLabel("Checklist work date").fill("2026-11-10");
  await expect(panel.getByLabel("Planned task description")).toHaveValue("");
});
