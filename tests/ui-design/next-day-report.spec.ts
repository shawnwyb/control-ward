import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { go, signIn } from "./helpers";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test tests/ui-design/next-day-report.spec.ts
// The mock has a demo site mapped to Turkey Point (EIA 621). Its report is public/reports/621/latest.json,
// written by reports/next-day/run.sh build. Other states are made by answering that request with other files.

const sample = (eia: string) =>
  JSON.parse(readFileSync(`public/reports/${eia}/latest.json`, "utf8"));

async function openReport(page: Page, siteName = "Turkey Point · Report demo") {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption({ label: siteName });
  await go(page, "Next-day report");
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
    page.getByRole("region", { name: /Map of flagged routes/ }),
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
    "Choose the start point",
  );
  const map = routes.getByRole("region", { name: /Map of flagged routes/ });
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(routes.getByRole("status")).toContainText(
    "Now choose the end point",
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

test("phones get section links that jump to a panel; wide screens do not", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReport(page);
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav).toBeVisible();
  // nothing, including the hidden hour labels and the scrolling strips, may widen the page
  await expect(page.locator("#heat")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await nav.getByRole("link", { name: "Routes" }).click();
  await expect(page.locator("#routes")).toBeInViewport();
  await nav.getByRole("link", { name: "Gaps" }).click();
  await expect(page.locator("#gaps")).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(nav).toBeHidden();
});

test("the detour can be planned with the keyboard alone", async ({ page }) => {
  await openReport(page);
  const routes = page.locator("#routes");
  await routes
    .getByRole("button", { name: "Pick start and end on the map" })
    .click();
  const map = routes.getByRole("region", { name: /Map of flagged routes/ });
  await expect(map).toBeFocused();
  await expect(routes.getByRole("status")).toContainText(
    "Choose the start point",
  );
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(routes.getByRole("status")).toContainText(
    "Now choose the end point",
  );
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(
    routes
      .getByText(/Direct route|more than 400 m from any mapped road/)
      .first(),
  ).toBeVisible();
});

test("Escape cancels picking, and 'Start at the plant' fills in the start", async ({
  page,
}) => {
  await openReport(page);
  const routes = page.locator("#routes");
  await routes
    .getByRole("button", { name: "Pick start and end on the map" })
    .click();
  await page.keyboard.press("Escape");
  await expect(routes.getByRole("status")).toHaveText("");
  await routes.getByRole("button", { name: "Start at the plant" }).click();
  await expect(routes.getByRole("status")).toContainText(
    "Now choose the end point",
  );
  await page.keyboard.press("Enter");
  await expect(
    routes
      .getByText(/Direct route|more than 400 m from any mapped road/)
      .first(),
  ).toBeVisible();
});

test("routes to avoid are also listed in words, worst first, with a way to see them all", async ({
  page,
}) => {
  await openReport(page);
  const routes = page.locator("#routes");
  const list = routes.getByRole("list", { name: "Flagged routes" });
  await expect(list).toBeVisible();
  const first = await list.getByRole("listitem").count();
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(5);
  await expect(list.getByRole("listitem").first()).toContainText(
    /hold|inspect/,
  );
  const all = routes.getByRole("button", { name: /Show all \d+ routes/ });
  if (await all.count()) {
    await all.click();
    expect(await list.getByRole("listitem").count()).toBeGreaterThan(first);
    await routes.getByRole("button", { name: "Show the worst 5 only" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(first);
  }
});

test("the header says when the weather-only window hides a day-long block on heavy equipment", async ({
  page,
}) => {
  await openReport(page);
  const header = page
    .getByRole("region", { name: /Go with limits|Go|Reschedule/ })
    .first();
  await expect(header).toContainText(
    "Weather only. Heavy equipment moves are blocked all day",
  );
  await expect(header).toContainText("routes at hold");
});

test("no weather-only note when the planner is not blocked all day", async ({
  page,
}) => {
  const rep = sample("621");
  rep.tasks.site_flags.mud = null;
  rep.hourly = rep.hourly.map((h: object) => ({
    ...h,
    mm: 0,
    pop: 0,
    gust: 5,
    wbgt: 70,
  }));
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: rep }),
  );
  await openReport(page);
  await expect(page.getByText("Weather only.")).toHaveCount(0);
});

test("the wildlife table fits its panel, so the last column is readable", async ({
  page,
}) => {
  await openReport(page);
  const wildlife = page.locator("#wildlife");
  await expect(
    wildlife.getByRole("columnheader", { name: "Compared with a usual month" }),
  ).toBeVisible();
  const table = await wildlife.locator("table").boundingBox();
  const panel = await wildlife.boundingBox();
  expect(table!.x + table!.width).toBeLessThanOrEqual(
    panel!.x + panel!.width + 1,
  );
  await expect(
    wildlife.getByRole("cell", { name: /reports/ }).first(),
  ).toBeVisible();
});

test("a layer that fails to load is named, and a missing layer says why", async ({
  page,
}) => {
  await page.route("**/tide_shading.geojson", (route) =>
    route.fulfill({ status: 500, body: "no" }),
  );
  await openReport(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not load" }),
  ).toContainText("tide shading");
});

test("layers that do not apply are listed with the reason", async ({
  page,
}) => {
  const inland = sample("6113");
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: inland }),
  );
  await openReport(page);
  await expect(page.locator("#routes")).toContainText("Not shown:");
  await expect(page.locator("#routes")).toContainText(
    "Tide shading (Not a tidal site",
  );
});

test("technical terms have their long form, and hour cells are read from hidden text", async ({
  page,
}) => {
  await openReport(page);
  await expect(page.locator("#heat abbr", { hasText: "WBGT" })).toHaveAttribute(
    "title",
    /wet bulb globe temperature/,
  );
  await expect(
    page.locator("#weather abbr", { hasText: "CAPE" }),
  ).toHaveAttribute("title", /convective available potential energy/);
  await expect(
    page.locator("#flood abbr", { hasText: "NAVD88" }),
  ).toHaveAttribute("title", /North American Vertical Datum/);
  await expect(page.locator("#heat ol li[aria-label]")).toHaveCount(0);
  await expect(page.locator("#heat ol li").first()).toContainText("heat index");
});

test("source notes are folded, and open for printing", async ({ page }) => {
  await openReport(page);
  const notes = page
    .locator("#next-day-report details")
    .filter({ has: page.locator("summary", { hasText: /^About/ }) });
  await expect(page.locator("#routes")).toContainText("does not certify");
  await expect(page.locator("#wildlife")).toBeVisible();
  const total = await notes.count();
  expect(total).toBeGreaterThan(3);
  await expect(notes.locator("xpath=self::*[@open]")).toHaveCount(0);
  // the caveats that change a decision stay visible
  await expect(page.locator("#routes")).toContainText(
    "does not certify a crossing is safe",
  );
  await expect(page.locator("#wildlife")).toContainText(
    "No sightings does not mean no animals",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(notes.locator("xpath=self::*[@open]")).toHaveCount(total);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(notes.locator("xpath=self::*[@open]")).toHaveCount(0);
});

test("edited task limits are marked and can be reset", async ({ page }) => {
  await openReport(page);
  const planner = page.locator("#tasks");
  await planner.getByLabel("Aerial or line work").check();
  const section = planner.getByRole("region", { name: "Aerial or line work" });
  await section.getByText("Limits for this task").click();
  await section
    .getByLabel("Aerial or line work: limit for Wind gusts")
    .fill("30");
  await expect(section.getByText("Edited, default 40")).toBeVisible();
  await section.getByRole("button", { name: /limits to the defaults/ }).click();
  await expect(section.getByText("Edited, default 40")).toHaveCount(0);
  await expect(
    section.getByLabel("Aerial or line work: limit for Wind gusts"),
  ).toHaveValue("40");
});
