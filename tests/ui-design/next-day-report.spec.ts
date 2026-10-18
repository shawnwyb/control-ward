import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test tests/ui-design/next-day-report.spec.ts
// The mock has a demo site mapped to Turkey Point (EIA 621). Its report is public/reports/621/latest.json,
// written by reports/next-day/run.sh build. Other states are made by answering that request with other files.

const sample = (eia: string) =>
  JSON.parse(readFileSync(`public/reports/${eia}/latest.json`, "utf8"));

async function openReport(page: Page, siteName = "Turkey Point · Report demo") {
  await page.goto("/");
  await page.getByLabel("Email").fill("supervisor@planit.local");
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForSelector("#workspace select");
  await page.selectOption("#site", { label: siteName });
  await page.locator("label", { hasText: "Next-day report" }).click();
}

test("shows the verdict, heat timeline, map, flood and gaps for a site with a report", async ({
  page,
}) => {
  await openReport(page);
  const report = page.locator("#next-day-report");
  await expect(report).toBeVisible();
  await expect(report.getByRole("heading", { level: 2 }).first()).toContainText(
    /Go|Reschedule/,
  );
  await expect(
    page.getByText("decision support", { exact: false }).first(),
  ).toBeVisible();

  const heat = page.locator("#heat");
  await expect(heat).toContainText("Peak heat index");
  await expect(
    heat.getByRole("list", { name: "Water and rest timeline" }),
  ).toBeVisible();
  await expect(heat).toContainText("Chart read by hand");

  await expect(
    page.getByRole("img", { name: /Map of flagged routes/ }),
  ).toBeVisible();
  await expect(page.locator("#routes")).toContainText(
    "does not certify a crossing is safe",
  );
  await expect(page.locator("#flood")).toContainText("Highest tide");
  await expect(page.locator("#flood")).toContainText(
    "Levees (National Levee Database)",
  );
  await expect(page.locator("#hazard-index")).toContainText("of 10");
  await expect(page.locator("#gaps")).toContainText("Limits that always apply");
});

test("the equipment switch changes the rated result and the layers can be turned off", async ({
  page,
}) => {
  await openReport(page);
  const routes = page.locator("#routes");
  await expect(routes).toContainText("Road trucks");
  await routes.locator("label", { hasText: "Excavator" }).click();
  await expect(routes).toContainText("Tracked excavator");
  const tide = routes.getByRole("checkbox", { name: "Tide shading" });
  await expect(tide).toBeChecked();
  await tide.uncheck();
  await expect(tide).not.toBeChecked();
});

test("an inland site shows tide as not applicable and an empty river forecast in words", async ({
  page,
}) => {
  const inland = sample("6113");
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: inland }),
  );
  await openReport(page);
  await expect(page.locator("#flood")).toContainText("Not a tidal site");
  await expect(page.locator("#gaps")).toContainText("Not applicable");
});

test("a report older than 24 hours says so", async ({ page }) => {
  const old = sample("621");
  old.meta.generated_at = "2026-01-01T00:00:00Z";
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: old }),
  );
  await openReport(page);
  await expect(
    page.getByRole("status").filter({ hasText: "more than 24 hours old" }),
  ).toBeVisible();
});

test("a site with no report file says how to build one", async ({ page }) => {
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ status: 404, body: "not found" }),
  );
  await openReport(page);
  await expect(page.getByText("No report yet")).toBeVisible();
  await expect(page.getByText("run.sh build --site 621")).toBeVisible();
});

test("a report in a newer format is refused with a clear message", async ({
  page,
}) => {
  const future = sample("621");
  future.schema_version = 99;
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: future }),
  );
  await openReport(page);
  await expect(page.getByRole("alert")).toContainText("format 99");
});

test("a site without an EIA plant id explains why there is no report", async ({
  page,
}) => {
  await openReport(page, "North Plant · Demo");
  await expect(page.getByText("no EIA plant id")).toBeVisible();
});

test("a missing forecast leaves the rest of the report readable", async ({
  page,
}) => {
  const broken = sample("621");
  broken.heat = {
    status: "missing",
    reason: "The forecast has no temperature and humidity for this day.",
  };
  broken.weather = {
    status: "missing",
    reason: "The forecast has no temperature and humidity for this day.",
    alerts: [],
  };
  broken.hourly = [];
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: broken }),
  );
  await openReport(page);
  await expect(page.locator("#heat")).toContainText(
    "The forecast has no temperature",
  );
  await expect(page.locator("#flood")).toContainText("Highest tide");
});

test("the task planner blocks hours per task, shows why and lets a manager change a limit", async ({
  page,
}) => {
  const rep = sample("621");
  // make 1 PM windy so one task is blocked there
  rep.hourly = rep.hourly.map((h: { hour: number; gust: number | null }) =>
    h.hour === 13 ? { ...h, gust: 55 } : { ...h, gust: 10 },
  );
  rep.tasks.site_flags.mud = null;
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: rep }),
  );
  await openReport(page);
  const planner = page.locator("#tasks");
  await expect(planner).toContainText("Heavy equipment moves");
  await planner.getByLabel("Aerial or line work").check();
  await expect(
    planner.getByRole("region", { name: "Aerial or line work" }),
  ).toContainText("Wind gusts 55 mph (limit 40)");
  await expect(planner.getByText("All selected tasks together")).toBeVisible();
  // raise the aerial-work wind limit above the gust: the block goes away for that task
  await planner
    .getByRole("region", { name: "Aerial or line work" })
    .getByText("Limits for this task")
    .click();
  await planner
    .getByLabel("Aerial or line work: limit for Wind gusts")
    .fill("60");
  await expect(
    planner.getByRole("region", { name: "Aerial or line work" }),
  ).not.toContainText("Wind gusts 55 mph");
  await expect(
    planner
      .getByRole("region", { name: "Aerial or line work" })
      .getByText("Confirm")
      .first(),
  ).toBeVisible();
});

test("the acclimatization switch shows the NIOSH schedule", async ({
  page,
}) => {
  await openReport(page);
  const heat = page.locator("#heat");
  await expect(heat.getByText("Most time in the heat")).toHaveCount(0);
  await heat
    .getByLabel("Some workers are new to the job or back after a break")
    .check();
  await expect(heat.getByText("Most time in the heat")).toBeVisible();
  await expect(heat).toContainText("20%");
  await expect(heat).toContainText("Supervise new workers closely");
});

test("changes since the earlier report are listed, or reported as none", async ({
  page,
}) => {
  const rep = sample("621");
  rep.changes = {
    status: "ok",
    since: "2026-10-18T22:00:00Z",
    since_kind: "evening",
    items: [
      {
        section: "verdict",
        text: "The verdict got worse: from Go to Go with limits.",
      },
    ],
  };
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: rep }),
  );
  await openReport(page);
  await expect(
    page.getByRole("region", { name: /Go with limits|Go|Reschedule/ }).first(),
  ).toContainText("Changed since the evening report");
  await expect(
    page.getByText("The verdict got worse: from Go to Go with limits."),
  ).toBeVisible();
});

test("wildlife shows public sightings with the reporting caveat, and counts crew reports", async ({
  page,
}) => {
  await openReport(page);
  const wildlife = page.locator("#wildlife");
  await expect(wildlife).toContainText("American alligator");
  await expect(wildlife).toContainText("No sightings does not mean no animals");
  await expect(wildlife).toContainText("iNaturalist");
  // the mock site has one open crew wildlife report
  await expect(wildlife).toContainText("1 open wildlife report(s)");
});

test("crew mud and wildlife reports appear as a map layer that can be turned off", async ({
  page,
}) => {
  await openReport(page);
  const crew = page
    .locator("#routes")
    .getByRole("checkbox", { name: "Crew reports" });
  await expect(crew).toBeEnabled();
  await expect(crew).toBeChecked();
  await expect(page.locator("#routes")).toContainText(
    "Orange dot: crew mud report",
  );
});

test("the detour planner takes two clicks and explains the result in words", async ({
  page,
}) => {
  await openReport(page);
  const routes = page.locator("#routes");
  await routes
    .getByRole("button", { name: "Pick start and end on the map" })
    .click();
  await expect(routes.getByRole("status")).toContainText(
    "Click the start point",
  );
  const map = routes.getByRole("img", { name: /Map of flagged routes/ });
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(routes.getByRole("status")).toContainText(
    "Now click the end point",
  );
  await page.mouse.click(
    box.x + box.width / 2 + 90,
    box.y + box.height / 2 + 70,
  );
  // either a path is described, or the planner says plainly that no road is near the click
  await expect(
    routes
      .getByText(/Direct route|more than 400 m from any mapped road/)
      .first(),
  ).toBeVisible();
  await routes.getByRole("button", { name: "Clear" }).click();
  await expect(routes.getByText("Direct route")).toHaveCount(0);
  // the planner's limits are stated
  await expect(routes).toContainText("Check it on the ground");
});

test("a report without road data says why detours are unavailable", async ({
  page,
}) => {
  const rep = sample("621");
  rep.routing = {
    status: "missing",
    reason: "overpass_roads_621: ReadTimeout",
  };
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: rep }),
  );
  await openReport(page);
  await expect(page.locator("#routes")).toContainText(
    "Detours: overpass_roads_621: ReadTimeout",
  );
  await expect(
    page.getByRole("button", { name: "Pick start and end on the map" }),
  ).toHaveCount(0);
});
