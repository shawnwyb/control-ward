import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const config = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }),
);
if (new URL(config.API_URL).hostname !== "127.0.0.1")
  throw new Error("Local tests only");
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const db = new pg.Pool({ connectionString: config.DB_URL });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0V8AAAAASUVORK5CYII=",
  "base64",
);
let email: string;
let userId: string;
let siteId: string;

test.beforeAll(async () => {
  email = `browser-${crypto.randomUUID()}@test.planit.local`;
  const result = await admin.auth.admin.createUser({
    email,
    password: "BrowserTest123!",
    email_confirm: true,
  });
  if (result.error) throw result.error;
  userId = result.data.user.id;
  siteId = crypto.randomUUID();
  await db.query(
    "insert into public.sites(id,name,latitude,longitude) values($1,$2,29.652,-82.325)",
    [siteId, "Browser test plant"],
  );
  await db.query(
    "insert into public.site_memberships(site_id,user_id) values($1,$2)",
    [siteId, userId],
  );
});
test.afterAll(async () => {
  const { rows: photos } = await db.query(
    "select object_path from public.hazard_photos where site_id=$1",
    [siteId],
  );
  if (photos.length)
    await admin.storage
      .from("hazard-photos")
      .remove(photos.map((p) => p.object_path));
  await db.query("delete from private.hazard_requests where user_id=$1", [
    userId,
  ]);
  await db.query("delete from public.hazard_photos where site_id=$1", [siteId]);
  for (const table of [
    "hazard_checkin_tasks",
    "hazard_events",
    "hazard_observations",
  ]) {
    await db.query(
      `delete from public.${table} where report_id in(select id from public.hazard_reports where site_id=$1)`,
      [siteId],
    );
  }
  await db.query("delete from public.hazard_reports where site_id=$1", [
    siteId,
  ]);
  await db.query("delete from public.site_memberships where site_id=$1", [
    siteId,
  ]);
  await db.query("delete from public.sites where id=$1", [siteId]);
  await admin.auth.admin.deleteUser(userId);
  await db.end();
});

test("crew submits a private photo, merges, confirms, resolves and views history", async ({
  page,
}) => {
  const errors: string[] = [];
  const outsideRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname))
      outsideRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("BrowserTest123!");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(page.getByText("No active hazards reported")).toBeVisible();
  await expect(page.locator("#connection")).toContainText("Live updates", {
    timeout: 15000,
  });
  await page.getByRole("radio", { name: /Wildlife/ }).check();
  await page.getByRole("radio", { name: /3 High/ }).check();
  await page.locator("#pin-map").click({ position: { x: 200, y: 140 } });
  await page
    .locator("#photo")
    .setInputFiles({ name: "hazard.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Submit hazard report" }).click();
  await expect(page.getByRole("status")).toContainText("Hazard reported");
  const card = page.locator(".report-card").first();
  await expect(card.getByRole("heading", { name: "Wildlife" })).toBeVisible();
  await expect(card).toContainText("1 confirmation");
  await page.getByRole("button", { name: "Submit hazard report" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Merged with a nearby hazard",
  );
  await expect(card).toContainText("2 confirmations");
  await card.getByRole("button", { name: "Still there" }).click();
  await expect(card).toContainText("3 confirmations");
  await card.getByRole("button", { name: "History & photos" }).click();
  const image = card.getByRole("img", { name: "Crew hazard photo" });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 1);
  await card.getByRole("button", { name: "Gone", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Marked resolved");
  await expect(page.getByText("No active hazards reported")).toBeVisible();
  await page.getByLabel("Show resolved").check();
  await expect(page.locator(".report-card")).toContainText("Resolved");
  await page
    .locator(".report-card")
    .getByRole("button", { name: "History & photos" })
    .click();
  await expect(page.locator(".history-content")).toContainText("resolved");
  expect(errors).toEqual([]);
  expect(outsideRequests).toEqual([]);
});

test("mobile layout supports keyboard pins, validation, retry and accessible controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("BrowserTest123!");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#latitude")).toHaveValue("29.652000");
  await page.locator("#pin-map").focus();
  await page.keyboard.press("ArrowUp");
  expect(Number(await page.locator("#latitude").inputValue())).toBeGreaterThan(
    29.652,
  );
  await page.locator("#photo").setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5242881),
  });
  await page.getByRole("button", { name: "Submit hazard report" }).click();
  await expect(page.getByRole("status")).toContainText("smaller than 5 MB");
  await page.locator("#photo").setInputFiles([]);
  let firstRequestId: string | undefined;
  let failOnce = true;
  await page.route("**/rest/v1/rpc/submit_hazard_report", async (route) => {
    if (failOnce) {
      failOnce = false;
      firstRequestId = route.request().postDataJSON().p_request_id;
      // Simulate a lost response AFTER the database committed, then retry safely.
      await route.fetch();
      await route.abort("failed");
    } else {
      expect(route.request().postDataJSON().p_request_id).toBe(firstRequestId);
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Submit hazard report" }).click();
  await expect(page.getByRole("status")).toContainText("you can retry");
  await page.getByRole("button", { name: "Submit hazard report" }).click();
  await expect(page.getByRole("status")).toContainText("Hazard reported");
  await expect(page.locator(".report-card")).toContainText("1 confirmation");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/crew-mobile.png",
    fullPage: true,
  });
});

test("unassigned user sees no site workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("outsider@planit.local");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(
    page.getByRole("heading", { name: "No sites assigned" }),
  ).toBeVisible();
  await expect(page.locator("#site-workspace")).toBeHidden();
});

test("seeded crew workspace renders on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(page.locator(".report-card").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/crew-desktop.png",
    fullPage: true,
  });
});
