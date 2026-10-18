import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { go, signIn } from "./helpers";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test tests/ui-design/next-day-report.spec.ts
// The mock has a demo site mapped to Turkey Point (EIA 621). Its report is public/reports/621/latest.json,
// written by reports/next-day/run.sh build. Other states are made by answering that request with other files.
//
// Layout (docs/NEXT_DAY_REPORT_BRIEF.md, "Revision: field-briefing layout"): zone 1 verdict, hazard index and mud cards;
// zone 2 the work schedule (#weather, with #heat and #tasks inside); zone 3 map and flagged routes (#routes);
// zone 4 tide, air and wildlife tiles; and one footer fold (#gaps). Source notes sit in folds that open when printing.

const sample = (eia: string) =>
  JSON.parse(readFileSync(`public/reports/${eia}/latest.json`, "utf8"));

async function openReport(page: Page, siteName = "Turkey Point · Report demo") {
  await signIn(page, "supervisor@planit.local");
  const nav = page.getByRole("navigation", { name: "Pages" });
  await nav
    .or(page.getByRole("button", { name: /Menu/ }))
    .first()
    .waitFor();
  if (!(await nav.isVisible()))
    await page.getByRole("button", { name: /Menu/ }).click();
  await page.locator("#site").selectOption({ label: siteName });
  await go(page, "Next-day report");
}

async function serve(page: Page, report: unknown) {
  await page.route("**/reports/621/latest.json", (route) =>
    route.fulfill({ json: report }),
  );
}

test("shows the verdict, hazard index, mud, schedule, map, tiles and notes in four zones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReport(page);
  const report = page.locator("#next-day-report");
  await expect(report).toBeVisible();
  await expect(report.getByRole("heading", { level: 2 }).first()).toContainText(
    /Go|Reschedule/,
  );
  await expect(
    page.getByText("decision support", { exact: false }).first(),
  ).toBeVisible();

  // Let the map and the route table finish loading: they change the page height. Then measure everything at once.
  await expect(
    page.locator("#routes").getByRole("table", { name: /Flagged routes/ }),
  ).toBeVisible();
  const y = await page.evaluate(() =>
    Object.fromEntries(
      [
        "verdict",
        "hazard-index",
        "mud",
        "weather",
        "routes",
        "flood",
        "air",
        "gaps",
      ].map((id) => [
        id,
        document.getElementById(id)!.getBoundingClientRect().top,
      ]),
    ),
  );
  // zone 1: three cards side by side; then zones 2, 3 and 4 and the notes, in that order
  expect(Math.abs(y.verdict - y["hazard-index"])).toBeLessThan(2);
  expect(Math.abs(y.verdict - y.mud)).toBeLessThan(2);
  expect(y.verdict).toBeLessThan(y.weather);
  expect(y.weather).toBeLessThan(y.routes);
  expect(y.routes).toBeLessThan(y.flood);
  expect(Math.abs(y.flood - y.air)).toBeLessThan(2);
  expect(y.flood).toBeLessThan(y.gaps);

  await expect(
    page.getByRole("img", { name: /Hazard index \d+\.\d of 10/ }),
  ).toBeVisible();
  await expect(page.locator("#hazard-index")).toContainText("Top driver");
  await expect(page.locator("#mud")).toContainText(
    "does not certify a crossing is safe",
  );
  await expect(page.locator("#heat")).toContainText("Peak heat index");
  await expect(
    page
      .locator("#heat")
      .getByRole("list", { name: "Water and rest timeline" }),
  ).toBeVisible();
  await expect(page.locator("#heat")).toContainText("Chart read by hand");
  await expect(
    page.getByRole("region", { name: /Map of flagged routes/ }),
  ).toBeVisible();
  await expect(page.locator("#flood")).toContainText("High tide:");
  await expect(page.locator("#flood")).toContainText("Highest tide");
  await expect(page.locator("#flood")).toContainText(
    "Levees (National Levee Database)",
  );
  await expect(page.locator("#gaps")).toContainText("Limits that always apply");
});

test("the page has no emoji", async ({ page }) => {
  await openReport(page);
  const text = await page
    .locator("#next-day-report")
    .evaluate((el) => el.textContent ?? "");
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
});

test("the hero cards state the facts: window, short actions, score, share of route", async ({
  page,
}) => {
  const rep = sample("621");
  await openReport(page);
  const verdict = page.locator("#verdict");
  await expect(verdict).toContainText("Best window");
  const bullets = verdict.getByRole("list").first().getByRole("listitem");
  expect(await bullets.count()).toBeLessThanOrEqual(3);
  await expect(verdict).toContainText(
    "Heavy equipment: hold until routes are inspected",
  );
  await expect(verdict).toContainText("Low ground can flood near high tide");
  const mud = page.locator("#mud");
  const eq = rep.mud.equipment[0];
  await expect(mud).toContainText(`${eq.score.toFixed(1)}`);
  await expect(mud).toContainText(
    `${(eq.flagged_route_ft / 5280).toFixed(1)} of ${(eq.route_ft / 5280).toFixed(1)} mi`,
  );
  await expect(mud).toContainText("Hold");
  const pills = page.locator("#hazard-index").getByRole("list", {
    name: /Chance of a recorded event/,
  });
  await expect(pills.getByRole("listitem")).toHaveCount(4);
  await expect(pills.getByRole("listitem", { name: /top driver/ })).toHaveCount(
    1,
  );
  // model strings are folded
  const details = page.locator("#hazard-index details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details).toContainText(rep.hazard_index.model_version);
});

test("the equipment switch changes the rated result and the layers can be turned off", async ({
  page,
}) => {
  await openReport(page);
  const routes = page.locator("#routes");
  await expect(routes).toContainText("Road trucks");
  await routes.locator("label", { hasText: "Excavator" }).click();
  await expect(routes).toContainText("Tracked excavator");
  // the mud card follows the same switch
  await expect(page.locator("#mud")).toContainText("Tracked excavator");
  const tide = routes.getByRole("checkbox", { name: "Tide shading" });
  await expect(tide).toBeChecked();
  await tide.uncheck();
  await expect(tide).not.toBeChecked();
});

test("an inland site shows tide as not applicable and an empty river forecast in words", async ({
  page,
}) => {
  await serve(page, sample("6113"));
  await openReport(page);
  await expect(page.locator("#flood")).toContainText("Not a tidal site");
  await expect(page.locator("#gaps")).toContainText("Not applicable");
});

test("a report older than 24 hours says so", async ({ page }) => {
  const old = sample("621");
  old.meta.generated_at = "2026-01-01T00:00:00Z";
  await serve(page, old);
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
  await expect(
    page.getByText("No detailed forecast has been published", { exact: false }),
  ).toBeVisible();
});

test("a report in a newer format is refused with a clear message", async ({
  page,
}) => {
  const future = sample("621");
  future.schema_version = 99;
  await serve(page, future);
  await openReport(page);
  await expect(page.getByRole("alert")).toContainText("format 99");
});

test("a site without an EIA plant id explains why there is no report", async ({
  page,
}) => {
  await openReport(page, "North Plant · Demo");
  await expect(
    page.getByText("A detailed forecast is not available for this site.", {
      exact: false,
    }),
  ).toBeVisible();
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
  await serve(page, broken);
  await openReport(page);
  await expect(page.locator("#weather")).toContainText(
    "The forecast has no temperature",
  );
  await expect(page.locator("#flood")).toContainText("Highest tide");
  await expect(page.locator("#verdict")).toBeVisible();
});

test("a missing heat forecast alone is explained inside the schedule", async ({
  page,
}) => {
  const rep = sample("621");
  rep.heat = { status: "missing", reason: "No heat forecast for this test." };
  await serve(page, rep);
  await openReport(page);
  await expect(page.locator("#heat")).toContainText(
    "No heat forecast for this test.",
  );
  await expect(
    page.getByRole("table", { name: /Hourly work schedule/ }),
  ).toBeVisible();
});

test("the schedule blocks hours per task, shows why and lets a manager change a limit", async ({
  page,
}) => {
  const rep = sample("621");
  // make 1 PM windy so one task is blocked there
  rep.hourly = rep.hourly.map((h: { hour: number; gust: number | null }) =>
    h.hour === 13 ? { ...h, gust: 55 } : { ...h, gust: 10 },
  );
  rep.tasks.site_flags.mud = null;
  await serve(page, rep);
  await openReport(page);
  const schedule = page.locator("#weather");
  const table = schedule.getByRole("table");
  await expect(
    table.getByRole("rowheader", { name: "Heavy equipment moves" }),
  ).toBeVisible();
  await schedule.getByLabel("Aerial or line work", { exact: true }).check();
  await expect(
    table.getByRole("rowheader", { name: "Aerial or line work" }),
  ).toBeVisible();
  const notes = schedule.getByRole("list", { name: "Selected tasks" });
  const aerial = notes
    .getByRole("listitem")
    .filter({ hasText: /^Aerial or line work:/ });
  await expect(aerial).toContainText("Wind gusts 55 mph (limit 40)");
  await expect(
    table.getByRole("rowheader", { name: "All selected tasks together" }),
  ).toBeVisible();
  // raise the aerial-work wind limit above the gust: the block goes away for that task only
  await schedule.getByText("Task limits and sources").click();
  await schedule
    .getByLabel("Aerial or line work: limit for Wind gusts")
    .fill("60");
  await expect(aerial).not.toContainText("Wind gusts");
  await expect(aerial).toContainText("No limit is reached");
  await expect(
    notes.getByRole("listitem").filter({ hasText: /^Heavy equipment moves:/ }),
  ).toContainText("Wind gusts 55 mph (limit 40)");
  await expect(
    schedule
      .getByRole("region", { name: "Aerial or line work: limits" })
      .getByText("Confirm")
      .first(),
  ).toBeVisible();
});

test("picking an hour shows its gusts, rain chance, rain and CAPE, by mouse and by keyboard", async ({
  page,
}) => {
  await openReport(page);
  const schedule = page.locator("#weather");
  const detail = schedule.getByRole("status");
  await expect(detail).toContainText("Select an hour");
  await schedule.getByRole("button", { name: "Details for 2 PM" }).click();
  await expect(detail).toContainText("2 PM");
  await expect(detail).toContainText("Gusts");
  await expect(detail).toContainText("Rain chance");
  await expect(detail).toContainText("CAPE");
  await expect(
    schedule.getByRole("button", { name: "Details for 2 PM" }),
  ).toHaveAttribute("aria-pressed", "true");
  // keyboard: moving focus to the next hour selects it
  await schedule.getByRole("button", { name: "Details for 3 PM" }).focus();
  await expect(detail).toContainText("3 PM");
  // the full hourly table stays as a fold
  await expect(
    schedule.locator("details", { hasText: "Hourly detail" }),
  ).toHaveCount(1);
});

test("a good-air day has no air quality row in the schedule", async ({
  page,
}) => {
  await openReport(page);
  await expect(
    page.getByRole("table", { name: /Hourly work schedule/ }),
  ).toBeVisible();
  await expect(
    page.locator("#weather").getByRole("rowheader", { name: /Air quality/ }),
  ).toHaveCount(0);
  await expect(page.locator("#air")).toContainText("Peak AQI");
});

test("the air quality row appears in the schedule when the day reaches 101", async ({
  page,
}) => {
  const bad = sample("621");
  bad.air.peak = {
    ...bad.air.peak,
    us_aqi: 120,
    band: {
      min: 101,
      name: "Unhealthy for sensitive groups",
      meaning: "Sensitive groups may feel effects.",
    },
  };
  bad.air.hours = bad.air.hours.map((h: object) => ({ ...h, us_aqi: 120 }));
  await serve(page, bad);
  await openReport(page);
  await expect(
    page.locator("#weather").getByRole("rowheader", { name: /Air quality/ }),
  ).toBeVisible();
  await expect(page.locator("#air")).toContainText(
    "Unhealthy for sensitive groups",
  );
});

test("the acclimatization switch shows the NIOSH schedule", async ({
  page,
}) => {
  await openReport(page);
  const schedule = page.locator("#weather");
  await expect(schedule.getByText("Most time in the heat")).toHaveCount(0);
  await schedule
    .getByLabel("Some workers are new to the job or back after a break")
    .check();
  await expect(schedule.getByText("Most time in the heat")).toBeVisible();
  await expect(schedule).toContainText("20%");
  await expect(schedule).toContainText("Supervise new workers closely");
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
  await serve(page, rep);
  await openReport(page);
  const verdict = page.locator("#verdict");
  await expect(verdict).toContainText("Changed since the evening report");
  await verdict.getByText("Full reasons and changes").click();
  await expect(
    verdict.getByText("The verdict got worse: from Go to Go with limits."),
  ).toBeVisible();
});

test("wildlife shows only groups with sightings, the reporting caveat, and counts crew reports", async ({
  page,
}) => {
  const rep = sample("621");
  await openReport(page);
  const wildlife = page.locator("#wildlife");
  const seen = rep.wildlife.groups.filter(
    (g: { recent: number }) => g.recent > 0,
  );
  const none = rep.wildlife.groups.filter(
    (g: { recent: number }) => g.recent === 0,
  );
  for (const g of seen)
    await expect(
      wildlife.getByRole("list", { name: /Sightings/ }).getByText(g.label),
    ).toBeVisible();
  for (const g of none)
    await expect(
      wildlife.getByRole("list", { name: /Sightings/ }).getByText(g.label),
    ).toHaveCount(0);
  await expect(wildlife).toContainText("No sightings does not mean no animals");
  await expect(wildlife).toContainText(
    "Check banks and flooded ruts before entry",
  );
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
  await expect(map).toBeInViewport();
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
  await serve(page, rep);
  await openReport(page);
  await expect(page.locator("#routes")).toContainText(
    "Detours: overpass_roads_621: ReadTimeout",
  );
  await expect(
    page.getByRole("button", { name: "Pick start and end on the map" }),
  ).toHaveCount(0);
});

test("phones get section links that jump to a card; wide screens do not", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReport(page);
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav).toBeVisible();
  // nothing, including the hidden hour labels and the scrolling schedule, may widen the page
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
  await expect
    .poll(async () => {
      const heading = await page.locator("#routes h2").first().boundingBox();
      const links = await nav.boundingBox();
      return !!heading && !!links && heading.y >= links.y + links.height - 1;
    })
    .toBe(true);
  await nav.getByRole("link", { name: "Notes" }).click();
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

test("flagged routes are a table next to the map, worst first, with a way to see them all", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReport(page);
  const routes = page.locator("#routes");
  const table = routes.getByRole("table", { name: /Flagged routes/ });
  await expect(table).toBeVisible();
  // side by side on a wide screen: the table starts to the right of the map
  const map = await routes
    .getByRole("region", { name: /Map of flagged routes/ })
    .boundingBox();
  const tbl = await table.boundingBox();
  expect(tbl!.x).toBeGreaterThan(map!.x + map!.width - 1);
  const rows = table.locator("tbody tr");
  const first = await rows.count();
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(5);
  await expect(rows.first()).toContainText(/Hold|Inspect/);
  await expect(
    table.getByRole("columnheader", { name: "Predicted rut" }),
  ).toBeVisible();
  const all = routes.getByRole("button", { name: /Show all \d+ routes/ });
  if (await all.count()) {
    await all.click();
    expect(await rows.count()).toBeGreaterThan(first);
    await routes.getByRole("button", { name: "Show the worst 5 only" }).click();
    await expect(rows).toHaveCount(first);
  }
});

test("a row in the route table highlights that road, and picking it again clears it", async ({
  page,
}) => {
  await openReport(page);
  const routes = page.locator("#routes");
  const table = routes.getByRole("table", { name: /Flagged routes/ });
  const row = table.locator("tbody tr").first();
  const pick = row.getByRole("button");
  const name = (await pick.textContent())!.trim();
  await pick.click();
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  await expect(
    routes.getByText(`${name} is highlighted on the map.`),
  ).toHaveCount(1);
  await pick.focus();
  await page.keyboard.press("Enter");
  await expect(pick).toHaveAttribute("aria-pressed", "false");
});

test("the verdict says when the weather-only window hides a day-long block on heavy equipment", async ({
  page,
}) => {
  await openReport(page);
  const verdict = page.locator("#verdict");
  await expect(verdict).toContainText("weather limits only");
  await expect(verdict).toContainText(
    "Weather only. Heavy equipment moves are blocked all day",
  );
  await expect(verdict).toContainText("routes at hold");
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
  await serve(page, rep);
  await openReport(page);
  await expect(page.getByText("Weather only.")).toHaveCount(0);
});

test("the wildlife table fits its tile, so the last column is readable", async ({
  page,
}) => {
  await openReport(page);
  const wildlife = page.locator("#wildlife");
  await wildlife.getByText("Sightings by group").click();
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
  await serve(page, sample("6113"));
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
    page.locator("#weather abbr", { hasText: "CAPE" }).first(),
  ).toHaveAttribute("title", /convective available potential energy/);
  await expect(
    page.locator("#flood abbr", { hasText: "NAVD88" }),
  ).toHaveAttribute("title", /North American Vertical Datum/);
  await expect(
    page.locator("#flood abbr", { hasText: "MLLW" }).first(),
  ).toHaveAttribute("title", /mean lower low water/);
  await expect(
    page.locator("#weather td[aria-label], #weather li[aria-label]"),
  ).toHaveCount(0);
  await expect(
    page.locator("#weather td .sr-only", { hasText: "heat index" }).first(),
  ).toBeAttached();
});

test("source notes are folded and open for printing, and the caveats that change a decision stay visible", async ({
  page,
}) => {
  await openReport(page);
  await expect(page.locator("#mud")).toBeVisible();
  // The map draws its own attribution fold; only the report's folds are counted.
  const folds = page.locator(
    "#next-day-report details:not(.maplibregl-ctrl-attrib)",
  );
  const total = await folds.count();
  expect(total).toBeGreaterThan(3);
  await expect(folds.locator("xpath=self::*[@open]")).toHaveCount(0);
  // visible without opening anything
  await expect(page.locator("#verdict")).toContainText("does not clear");
  await expect(page.locator("#mud")).toContainText(
    "does not certify a crossing is safe",
  );
  await expect(page.locator("#heat")).toContainText("Chart read by hand");
  await expect(page.locator("#flood")).toContainText("ignores storm surge");
  await expect(page.locator("#flood")).toContainText(
    "Treat a leveed area as able to flood",
  );
  await expect(page.locator("#wildlife")).toContainText(
    "No sightings does not mean no animals",
  );
  // the footer holds the gaps and limits
  const footer = page.locator("#gaps details");
  await expect(footer).toContainText("Data gaps");
  await expect(footer).toContainText("Limits that always apply");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(folds.locator("xpath=self::*[@open]")).toHaveCount(total);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(folds.locator("xpath=self::*[@open]")).toHaveCount(0);
});

test("edited task limits are marked and can be reset", async ({ page }) => {
  await openReport(page);
  const schedule = page.locator("#weather");
  await schedule.getByLabel("Aerial or line work", { exact: true }).check();
  await schedule.getByText("Task limits and sources").click();
  const section = schedule.getByRole("region", {
    name: "Aerial or line work: limits",
  });
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
