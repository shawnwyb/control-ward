import { test, expect } from "@playwright/test";

import { go, signIn } from "./helpers";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test
test("theme: Notion surfaces and fonts", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  await expect(page.locator("#risk-now")).toBeVisible();
  const { bg, font, emoji } = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return {
      bg: body.backgroundColor,
      font: body.fontFamily,
      // (c), (R) and TM (e.g. the map attribution) are pictographic but not emoji.
      emoji:
        document.body.innerText.match(
          /(?![\u00a9\u00ae\u2122])\p{Extended_Pictographic}/gu,
        ) ?? [],
    };
  });
  expect(bg).toBe("rgb(255, 255, 255)");
  expect(font).not.toContain("IBM Plex");
  expect(emoji).toEqual([]);
});

test("shell: sidebar pages and role guard", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  const nav = page.getByRole("navigation", { name: "Pages" });
  for (const name of [
    "Sites",
    "Alerts",
    "Next-day briefing",
    "Crew",
    "Reports",
  ])
    await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await go(page, "Crew");
  await expect(page.locator("#crew-roster")).toBeVisible();
  await expect(page).toHaveURL(/#\/crew$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.locator("#risk-now")).toBeVisible();

  // The query string survives page changes (the mock reads flags from it).
  await page.goto("/?safety=stale#/sign-in");
  await expect(page).toHaveURL(/\?safety=stale#\//);
});

test("shell: crew cannot open supervisor pages", async ({ page }) => {
  await signIn(page, "crew@planit.local");
  const nav = page.getByRole("navigation", { name: "Pages" });
  for (const name of ["My site", "Alerts", "Tomorrow's briefing", "Reports"])
    await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Crew" })).toHaveCount(0);
  await page.evaluate(() => (location.hash = "#/crew"));
  await expect(
    page.getByRole("heading", { name: "North Plant · Demo" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/site$/);
  await expect(page.locator("#crew-roster")).toHaveCount(0);
});

test("crew: my site is the map with report button", async ({ page }) => {
  await signIn(page, "crew@planit.local");
  await expect(page).toHaveURL(/#\/site$/);
  await expect(page.locator("#site-map")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "North Plant · Demo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report hazard" }),
  ).toBeVisible();
  // No Sites table, and the location toggle floats on the map.
  await expect(page.locator("#sites-title")).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "Share my location with my supervisor" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Pages" });
  await expect(
    nav.getByRole("link", { name: "Tomorrow's briefing" }),
  ).toBeVisible();
  const titles: [string, string][] = [
    ["Alerts", "Alerts"],
    ["Tomorrow's briefing", "Tomorrow's briefing"],
    ["Reports", "Reports"],
  ];
  for (const [link, heading] of titles) {
    await go(page, link);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
  }
});

test("supervisor: each page renders its title", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  for (const name of ["Alerts", "Next-day briefing", "Crew", "Reports"]) {
    await go(page, name);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  }
});

test("crew: stop-work banner shows on My site beside the map", async ({
  page,
}) => {
  await signIn(page, "crew@planit.local", "?clear=600");
  await expect(
    page.getByRole("alert").filter({ hasText: "Stop work" }),
  ).toBeVisible();
});

test("crew: stop-work frames the whole ring on My site", async ({ page }) => {
  await signIn(page, "crew@planit.local");
  await expect(
    page.getByRole("alert").filter({ hasText: "Stop work" }),
  ).toBeVisible();
  // A 10-mile ring fits at a far lower zoom than the street view the map opens at.
  await expect
    .poll(async () =>
      Number(await page.locator("#pin-map").getAttribute("data-zoom")),
    )
    .toBeLessThan(11);
});

test("supervisor: can share their location from the Sites map", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 29.65, longitude: -82.34 });
  await signIn(page, "supervisor@planit.local");
  const toggle = page.getByRole("switch", {
    name: "Share my location with my supervisor",
  });
  await expect(toggle).toBeVisible();
  await toggle.check();
  await expect(toggle).toBeChecked();
  // The sharing flow ran: it is remembered, and a granted fix raised no error.
  expect(
    await page.evaluate(() => localStorage.getItem("planit.shareLocation")),
  ).toBe("1");
  await expect(page.getByText("Couldn’t read your location")).toHaveCount(0);
});

for (const [label, width, height] of [
  ["desktop", 1280, 800],
  ["phone", 390, 844],
] as const)
  for (const stop of [true, false]) {
    test(`supervisor: location pill clears the banner and chips (${label}, ${stop ? "stop-work" : "clear"})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await signIn(page, "supervisor@planit.local");
      await page
        .getByRole("region", { name: "Sites" })
        .getByRole("button", { name: stop ? "North Plant" : "South Plant" })
        .click();
      const banner = page.getByRole("alert").filter({ hasText: "Stop work" });
      await expect(banner).toHaveCount(stop ? 1 : 0);
      const pill = page.getByRole("switch", {
        name: "Share my location with my supervisor",
      });
      await expect(pill).toBeVisible();
      await page.waitForTimeout(800);
      const box = async (l: typeof pill) => (await l.boundingBox())!;
      const pillBox = await box(pill.locator("xpath=.."));
      const others = [
        ...(stop ? [await box(banner)] : []),
        ...(await Promise.all(
          (await page.locator("#site-map button[aria-pressed]").all()).map(
            (c) => box(c),
          ),
        )),
      ];
      expect(others.length).toBeGreaterThan(0);
      for (const o of others) {
        const apart =
          pillBox.x + pillBox.width <= o.x ||
          o.x + o.width <= pillBox.x ||
          pillBox.y + pillBox.height <= o.y ||
          o.y + o.height <= pillBox.y;
        expect(apart, JSON.stringify({ pillBox, o })).toBe(true);
      }
    });
  }

test("reports: Mine with nothing reported says so", async ({ page }) => {
  await signIn(page, "crew@planit.local");
  await go(page, "Reports");
  await page.getByLabel("Mine").check();
  await expect(
    page.getByText("You haven't reported anything at this site yet."),
  ).toBeVisible();
});

test("sites: hazard detail agrees with the table for another site", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page
    .locator("#site")
    .selectOption({ label: "Jacksonville Terminal · Demo" });
  await expect(page.locator("#risk-now")).toContainText("4.1");
});

test("shell: signed-out visitors cannot open app pages", async ({ page }) => {
  await page.goto("/#/alerts");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page).toHaveURL(/#\/sign-in$/);
});

test("phone: sidebar collapses to a menu button and opens pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "supervisor@planit.local");
  const nav = page.getByRole("navigation", { name: "Pages" });
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Crew" }).click();
  await expect(page.locator("#crew-roster")).toBeVisible();
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Show on map" }).first().click();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.locator("#site-map")).toBeVisible();
});

test("reports: Mine narrows the list to the signed-in user's reports", async ({
  page,
}) => {
  await signIn(page, "crew@planit.local");
  await go(page, "Reports");
  const cards = page.locator(".report-card");
  await expect(cards.first()).toBeVisible();
  const before = await cards.count();
  expect(before).toBeGreaterThan(1);
  await go(page, "My site");
  await page.getByRole("button", { name: "Report hazard" }).click();
  await page.getByRole("radio", { name: /Wildlife/ }).check();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status")).toContainText("Report sent");
  await go(page, "Reports");
  await expect(cards).toHaveCount(before + 1);
  await page.getByLabel("Mine").check();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Wildlife");
  await page.getByLabel("Mine").uncheck();
  await expect(cards).toHaveCount(before + 1);
});

test("sidebar: Alerts badge counts the selected site's active alerts", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  const link = page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: /^Alerts/ });
  await page.locator("#site").selectOption("site-north");
  await expect(link).toHaveAccessibleName("Alerts 2 active");
  await page.locator("#site").selectOption("site-south");
  await expect(link).toHaveAccessibleName("Alerts 1 active");
});

test("site switcher: the choice survives a reload, and storage failures are harmless", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-south");
  await page.reload();
  await expect(page.locator("#site")).toHaveValue("site-south");

  // Blocked storage for our key must not stop the app loading or switching sites.
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) {
      if (key === "planit.site") throw new Error("blocked");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "planit.site") throw new Error("blocked");
      return set.call(this, key, value);
    };
  });
  await page.reload();
  await expect(page.locator("#site")).toBeVisible();
  await page.locator("#site").selectOption("site-north");
  await expect(page.locator("#site")).toHaveValue("site-north");
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
});

test("crew page: ticked workers stay ticked after visiting another page", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption({ label: "North Plant · Demo" });
  await go(page, "Crew");
  // The site switch finishes asynchronously; wait for it before ticking.
  await expect(
    page.locator("main").getByText("North Plant · Demo").first(),
  ).toBeVisible();
  await page.getByLabel("Select Jordan Lee").check();
  await go(page, "Reports");
  await go(page, "Crew");
  await expect(page.getByLabel("Select Jordan Lee")).toBeChecked();
  // A different site starts clean.
  await page.locator("#site").selectOption({ label: "South Plant · Demo" });
  await expect(
    page.locator("main").getByText("South Plant · Demo").first(),
  ).toBeVisible();
  await page.locator("#site").selectOption({ label: "North Plant · Demo" });
  await expect(
    page.locator("main").getByText("North Plant · Demo").first(),
  ).toBeVisible();
  await expect(page.getByLabel("Select Jordan Lee")).not.toBeChecked();
});

test("landing: judges see the pitch and reach sign-in", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", {
    level: 1,
    name: "Every hazard on site. One picture.",
  });
  await expect(h1).toBeVisible();
  // No paragraph between the headline and the buttons.
  const between = await page.evaluate(
    () => document.querySelector("h1")!.nextElementSibling?.tagName === "P",
  );
  expect(between).toBe(false);
  for (const name of [
    "Extreme heat",
    "Lightning",
    "Flooding",
    "Soil",
    "Wildfire",
    "Wildlife",
  ])
    await expect(
      page.getByRole("img", { name: new RegExp(`^${name}`) }),
    ).toBeVisible();
  await expect(
    page.getByText("Try it with 50+ real power plant sites."),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("Florida");
  await page
    .getByRole("button", { name: /Open live demo/ })
    .first()
    .click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(h1).toBeVisible();
});

test("landing: feature carousel slides", async ({ page }) => {
  await page.goto("/");
  const region = page.getByRole("region", { name: "What PlanIT Control does" });
  await region.scrollIntoViewIfNeeded();
  await expect(region.getByRole("listitem")).toHaveCount(6);
  const dot = (n: number) => region.getByRole("button", { name: `Slide ${n}` });
  await expect(dot(1)).toHaveAttribute("aria-current", "true");

  await region.getByRole("button", { name: "Next" }).click();
  await expect(dot(2)).toHaveAttribute("aria-current", "true");
  // Slide 2 has scrolled to the start of the track.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const track = document.querySelector("ul[data-carousel-track]")!;
        const slide = track.children[1] as HTMLElement;
        return Math.abs(
          slide.getBoundingClientRect().left -
            track.getBoundingClientRect().left,
        );
      }),
    )
    .toBeLessThan(80);

  // Hovering the track pauses auto-advance (focus is moved away first).
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  const track = region.locator("ul[data-carousel-track]");
  await track.hover();
  await page.waitForTimeout(6000);
  await expect(dot(2)).toHaveAttribute("aria-current", "true");

  // Moving away resumes it.
  await page.mouse.move(2, 2);
  await expect(dot(3)).toHaveAttribute("aria-current", "true", {
    timeout: 8000,
  });
});

test("landing: carousel does not auto-advance under reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const region = page.getByRole("region", { name: "What PlanIT Control does" });
  await region.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(6000);
  await expect(region.getByRole("button", { name: "Slide 1" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("landing: carousel navigation is steady and does not skip", async ({
  page,
}) => {
  await page.goto("/");
  const region = page.getByRole("region", { name: "What PlanIT Control does" });
  await region.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  const current = () =>
    region.evaluate((el) =>
      [...el.querySelectorAll("button[aria-label^='Slide ']")].findIndex(
        (b) => b.getAttribute("aria-current") === "true",
      ),
    );

  // During a Next transition the active dot only ever reports start or target.
  await region.getByRole("button", { name: "Next" }).click();
  const seen = new Set<number>();
  for (let i = 0; i < 12; i++) {
    seen.add(await current());
    await page.waitForTimeout(40);
  }
  expect([...seen].every((n) => n === 1)).toBe(true);
  await expect.poll(current).toBe(1);

  // Two quick clicks land two slides on.
  await region.getByRole("button", { name: "Next" }).dblclick();
  await expect.poll(current).toBe(3);
  await page.waitForTimeout(1200);
  expect(await current()).toBe(3);

  // Previous, a dot, and wrap-around both ways.
  await region.getByRole("button", { name: "Previous" }).click();
  await expect.poll(current).toBe(2);
  await region.getByRole("button", { name: "Slide 1" }).click();
  await expect.poll(current).toBe(0);
  await region.getByRole("button", { name: "Previous" }).click();
  await expect.poll(current).toBe(5);
  await region.getByRole("button", { name: "Next" }).click();
  await expect.poll(current).toBe(0);
});

for (const [width, height] of [
  [1280, 800],
  [390, 844],
]) {
  test(`landing: no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page
      .getByRole("region", { name: "What PlanIT Control does" })
      .scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("landing: see it running plays", async ({ page }) => {
  await page.goto("/");
  const demo = page.getByRole("img", { name: /^Animated demo/ });
  await demo.scrollIntoViewIfNeeded();
  const first = demo.locator('[data-demo-row][data-rank="0"]');
  await expect(first).toContainText("Big Cypress Sub", { timeout: 6000 });
  await expect(first).toContainText("8.6", { timeout: 6000 });
  const banner = demo.locator("[data-demo-banner]");
  await expect(banner).toContainText("Stop work", { timeout: 6000 });
  await expect(banner).toContainText(/\d\d:\d\d/);
});

test("landing: see it running shows the final state under reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const demo = page.getByRole("img", { name: /^Animated demo/ });
  await demo.scrollIntoViewIfNeeded();
  const first = demo.locator('[data-demo-row][data-rank="0"]');
  await expect(first).toContainText("Big Cypress Sub", { timeout: 1000 });
  await expect(first).toContainText("8.6", { timeout: 1000 });
  await expect(demo.locator("[data-demo-banner]")).toContainText("Stop work");
});

test("map: site pins and fly-to", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-north");
  const map = page.locator("#site-map");
  // One score pin per site, including main's Turkey Point report fixture.
  const pins = map.locator('[aria-label*="hazard index"]');
  await expect(pins).toHaveCount(7);
  await expect(
    map.getByRole("button", { name: "North Plant · Demo, hazard index 5.2" }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    map.getByRole("button", {
      name: "Port Everglades Tank Farm · Demo, hazard index no score",
    }),
  ).toBeAttached();

  const canvas = await page.locator(".maplibregl-map").elementHandle();
  // A report draft belongs to this site only.
  await page.getByRole("button", { name: "Report hazard" }).click();
  await page.getByRole("radio", { name: /Wildlife/ }).check();
  // The other plant is a few km away: zoom out until its pin is on screen.
  const south = map.getByRole("button", {
    name: "South Plant · Demo, hazard index 8.6",
  });
  await expect(async () => {
    await map.getByRole("button", { name: "Zoom out" }).click();
    await expect(south).toBeInViewport({ timeout: 800 });
  }).toPass({ timeout: 15000 });
  // A hazard marker can sit on top of the pin at some zoom levels, so click it directly.
  await south.dispatchEvent("click");
  await expect(page.locator("#site")).toHaveValue("site-south");
  await expect(south).toHaveAttribute("aria-current", "true");
  // Per-site state still resets without a remount: the drawer closes and the draft starts clean.
  await expect(
    page.getByRole("dialog", { name: "Report a hazard" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Report hazard" }).click();
  await expect(page.getByRole("radio", { name: /Debris/ })).toBeChecked();
  // Same map element: the site switch flew the map instead of remounting it.
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.locator(".maplibregl-map")).toHaveCount(1);

  // Pins are buttons: the keyboard selects a site too.
  await map
    .getByRole("button", { name: "North Plant · Demo, hazard index 5.2" })
    .press("Enter");
  await expect(page.locator("#site")).toHaveValue("site-north");
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
});

test("map: stop-work draws the lightning ring marker for the selected site", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-north");
  const bolt = page.locator("#site-map .stop-work-marker");
  await expect(bolt).toHaveCount(1);
  await page.locator("#site").selectOption("site-south");
  await expect(bolt).toHaveCount(0);
});

test("map: Show on map opens the worker's card on the map page", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-north");
  await go(page, "Crew");
  await page
    .locator("#crew-roster li", { hasText: "Jordan Lee" })
    .getByRole("button", { name: "Show on map" })
    .click();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(
    page.locator("#site-map .maplibregl-popup", { hasText: "Jordan Lee" }),
  ).toBeVisible();
});

test("map: weather layers are floating chips", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  const chips = page.getByRole("group", { name: "Weather layers" });
  for (const name of ["Rain", "Wind", "Temperature"])
    await expect(chips.getByRole("button", { name })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  await chips.getByRole("button", { name: "Rain" }).click();
  await expect(chips.getByRole("button", { name: "Rain" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const source = page.getByRole("group", { name: "Rain data" });
  await expect(
    source.getByRole("button", { name: "Radar, past 2 hours" }),
  ).toHaveAttribute("aria-pressed", "true");
  await source.getByRole("button", { name: "Forecast, next 12 hours" }).click();
  await expect(
    source.getByRole("button", { name: "Forecast, next 12 hours" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Pressing the active layer again turns the overlay off.
  await chips.getByRole("button", { name: "Rain" }).click();
  await expect(source).toHaveCount(0);
});

test("site switch: a late answer for the previous site is ignored", async ({
  page,
}) => {
  // North's alerts and lightning answer 1.5 s late; South answers at once.
  await signIn(page, "supervisor@planit.local", "?slow=site-north");
  const alertsLink = page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: /^Alerts/ });
  const bolt = page.locator("#site-map .stop-work-marker");
  await page.locator("#site").selectOption("site-south");
  await expect(alertsLink).toHaveAccessibleName("Alerts 1 active");
  // Visit North, and leave before its (stop-work) answer arrives.
  await page.locator("#site").selectOption("site-north");
  await page.locator("#site").selectOption("site-south");
  await expect(alertsLink).toHaveAccessibleName("Alerts 1 active");
  await page.waitForTimeout(2500); // North's late answers land now
  await expect(bolt).toHaveCount(0);
  await expect(alertsLink).toHaveAccessibleName("Alerts 1 active");
  // North itself still loads: its stop-work shows once its answer arrives.
  await page.locator("#site").selectOption("site-north");
  await expect(bolt).toHaveCount(1);
  await expect(alertsLink).toHaveAccessibleName("Alerts 2 active");
});

test("sites: ranked table drives the page", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  const table = page.getByRole("region", { name: "Sites" });
  const rows = table.getByRole("button", { name: /Demo/ });
  await expect(rows).toHaveCount(6);
  // Rows are positioned by rank; read them top to bottom.
  const ranked = async () =>
    rows.evaluateAll((els) =>
      els
        .map((el) => ({
          y: el.getBoundingClientRect().top,
          text: el.textContent ?? "",
        }))
        .sort((a, b) => a.y - b.y)
        .map((r) => r.text),
    );
  await expect.poll(async () => (await ranked())[0]).toContain("South Plant");
  const order = await ranked();
  expect(order[0]).toContain("8.6");
  expect(order[5]).toContain("Port Everglades");
  expect(order[5]).toContain("\u2014");
  await rows.filter({ hasText: "North Plant" }).click();
  await expect(rows.filter({ hasText: "North Plant" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator("#risk-now")).toContainText("5.2");
  await expect(page.locator("#site")).toHaveValue("site-north");
  const alertsLink = page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: /^Alerts/ });
  await expect(alertsLink).toHaveAccessibleName("Alerts 2 active");
  // Another site carries its own count.
  await rows.filter({ hasText: "South Plant" }).click();
  await expect(page.locator("#site")).toHaveValue("site-south");
  await expect(alertsLink).toHaveAccessibleName("Alerts 1 active");
});

test("sites: stop-work banner follows the selected site", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  const banner = page.getByRole("alert").filter({ hasText: "Stop work" });
  const row = (name: string) =>
    page.getByRole("region", { name: "Sites" }).getByRole("button", { name });
  // Signed in on Jacksonville, which is clear: no banner until North is picked from the table.
  await expect(page.locator("#site")).toHaveValue("site-jax");
  await expect(banner).toHaveCount(0);
  await row("North Plant").click();
  await expect(banner).toContainText("North Plant");
  await expect(banner).toContainText(/\d\d:\d\d/);
  await expect(banner).toContainText("6.2 mi");
  await row("South Plant").click();
  await expect(banner).toHaveCount(0);
  await row("North Plant").click();
  await expect(banner).toHaveCount(1);
});

test("sites: stop-work banner leaves when the countdown ends", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page, "supervisor@planit.local", "?clear=25");
  const banner = page.getByRole("alert").filter({ hasText: "Stop work" });
  await page
    .getByRole("region", { name: "Sites" })
    .getByRole("button", { name: /North Plant/ })
    .click();
  await expect(banner).toHaveCount(1);
  await expect(banner).toHaveCount(0, { timeout: 40000 });
});

test("sites: the banner shows even when the map cannot load", async ({
  page,
}) => {
  // No WebGL: the map reports itself unavailable.
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type.includes("webgl")) return null;
      return (real as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof real;
  });
  await signIn(page, "supervisor@planit.local");
  await expect(page.getByText("The map isn\u2019t available")).toBeVisible();
  await page
    .getByRole("region", { name: "Sites" })
    .getByRole("button", { name: /North Plant/ })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Stop work" }),
  ).toContainText("North Plant");
});

test("sites: rows are in rank order for Tab, and keep focus when re-ranked", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  const region = page.getByRole("region", { name: "Sites" });
  const rows = region.getByRole("button", { name: /Demo/ });
  const names = () =>
    rows.evaluateAll((els) =>
      els.map((el) => el.querySelector("span span")?.textContent ?? ""),
    );
  await expect(rows).toHaveCount(6);
  const before = await names();
  expect(before[0]).toContain("South Plant");
  expect(before[5]).toContain("Port Everglades");
  // Tab order: the first row takes focus after the view switch, then each next row in rank order.
  await region.getByRole("button", { name: "Map", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(rows.nth(1)).toBeFocused();
  // Jacksonville (4.1) jumps to the top while its row has focus.
  const jax = rows.filter({ hasText: "Jacksonville" });
  await jax.focus();
  await page.evaluate(() => {
    const w = window as unknown as {
      __mockFlags: { scores: Record<string, number> };
    };
    w.__mockFlags.scores["site-jax"] = 9.9;
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(async () => (await names())[0]).toContain("Jacksonville");
  await expect(jax).toBeFocused();
  await expect(rows.first()).toContainText("9.9");
});

test("sites: Table / Map switch hides the list", async ({ page }) => {
  await signIn(page, "supervisor@planit.local");
  const table = page.getByRole("region", { name: "Sites" });
  await expect(
    table.getByRole("button", { name: /South Plant/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(table.getByRole("button", { name: /South Plant/ })).toBeHidden();
  await expect(page.locator("#site-map")).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    table.getByRole("button", { name: /South Plant/ }),
  ).toBeVisible();
});

test("sites: the map legend closes on Escape and outside click", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  const legend = page.getByRole("button", { name: "Legend" });
  const text = page.getByText("Pins: each site");
  await expect(text).toBeHidden();
  await legend.click();
  await expect(legend).toHaveAttribute("aria-expanded", "true");
  await expect(text).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(text).toBeHidden();
  await expect(legend).toBeFocused();
  await legend.click();
  await expect(text).toBeVisible();
  await page.getByRole("heading", { name: "Sites", level: 1 }).click();
  await expect(text).toBeHidden();
});

// A 1x1 PNG.
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("report: drawer sends with location", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 29.652,
    longitude: -82.325,
    accuracy: 30,
  });
  await signIn(page, "supervisor@planit.local");
  // The fix is at North Plant, so report there (a fix far from the site is not used).
  await page.locator("#site").selectOption("site-north");
  const open = page.getByRole("button", { name: "Report hazard" });
  const drawer = page.getByRole("dialog", { name: "Report a hazard" });
  await expect(drawer).toBeHidden();
  await open.click();
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText(/Pinned at your location · ±\d+ ft/),
  ).toBeVisible();
  await drawer.getByRole("radio", { name: /Wildlife/ }).check();
  await drawer.getByRole("radio", { name: /Moderate/ }).check();
  await drawer.locator("#photo").setInputFiles({
    name: "gator.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await expect(drawer.getByText("gator.png")).toBeVisible();
  await drawer.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status")).toContainText("Report sent");
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await expect(page.locator(".hazard-marker").first()).toBeAttached();
});

test("report: Esc and the close button close the drawer and focus returns", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  const open = page.getByRole("button", { name: "Report hazard" });
  const drawer = page.getByRole("dialog", { name: "Report a hazard" });
  await open.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  // Not a trap: focus moves in on open, and Shift+Tab can still reach the map.
  await open.click();
  await expect(
    drawer.getByRole("heading", { name: "Report a hazard" }),
  ).toBeFocused();
  let reachedMap = false;
  for (let i = 0; i < 40 && !reachedMap; i++) {
    await page.keyboard.press("Shift+Tab");
    reachedMap = await page.evaluate(
      () => document.activeElement?.id === "pin-map",
    );
  }
  expect(reachedMap).toBe(true);
});

test("report: location denied falls back to site center", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
          setTimeout(() => fail({ code: 1, message: "denied" }), 0),
      },
    });
  });
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-north");
  await page.getByRole("button", { name: "Report hazard" }).click();
  const drawer = page.getByRole("dialog", { name: "Report a hazard" });
  await expect(
    drawer.getByText(
      "Couldn't get your location. Click the map to place the pin.",
    ),
  ).toBeVisible();
  // The mock lives in the page, so record what it is sent from there.
  await page.evaluate(() => {
    const w = window as unknown as { sent: Record<string, unknown>[] };
    w.sent = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes("submit_hazard_report"))
        w.sent.push(JSON.parse(String(init?.body)));
      return real(input, init);
    };
  });
  await drawer.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status")).toContainText(
    /Report sent|Merged with a nearby hazard/,
  );
  await expect(drawer).toBeHidden();
  const [body] = await page.evaluate(
    () => (window as unknown as { sent: Record<string, unknown>[] }).sent,
  );
  expect(Number(body.p_lat)).toBeCloseTo(29.652, 3);
  expect(Number(body.p_lon)).toBeCloseTo(-82.325, 3);
});

test("report: switching site closes drawer and discards photo", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
          setTimeout(() => fail({ code: 1, message: "denied" }), 0),
      },
    });
  });
  // ?fail makes the mock reject the send after the photo uploaded, so the photo waits to be discarded.
  await signIn(page, "supervisor@planit.local", "?fail");
  const drawer = page.getByRole("dialog", { name: "Report a hazard" });
  await page.evaluate(() => {
    const w = window as unknown as { deletes: string[] };
    w.deletes = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const method = (
        init?.method ??
        (input as Request).method ??
        "GET"
      ).toUpperCase();
      if (method === "DELETE") w.deletes.push(String(input));
      return real(input, init);
    };
  });
  await page.getByRole("button", { name: "Report hazard" }).click();
  await drawer.getByRole("radio", { name: /Wildlife/ }).check();
  await drawer.locator("#photo").setInputFiles({
    name: "gator.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await drawer.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status")).toContainText("you can retry");
  await expect(drawer).toBeVisible();
  await page.locator("#site").selectOption("site-south");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { deletes: string[] }).deletes.some((url) =>
          url.includes("/storage/"),
        ),
      ),
    )
    .toBe(true);
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Report hazard" }).click();
  await expect(drawer.getByText("gator.png")).toHaveCount(0);
  await expect(drawer.getByRole("radio", { name: /Debris/ })).toBeChecked();
});

for (const [name, size] of [
  ["1280x800", { width: 1280, height: 800 }],
  ["390x844", { width: 390, height: 844 }],
] as const) {
  test(`report: the pin is visible and not covered by the drawer (${name})`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 30.36, longitude: -81.62 });
    await page.setViewportSize(size);
    await signIn(page, "supervisor@planit.local");
    await page.getByRole("button", { name: "Report hazard" }).click();
    const drawer = page.getByRole("dialog", { name: "Report a hazard" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/Pinned at your location/)).toBeVisible();
    const pin = page.locator(".report-pin");
    await expect
      .poll(async () => {
        const [p, d, m] = await Promise.all([
          pin.boundingBox(),
          drawer.boundingBox(),
          page.locator("#site-map").boundingBox(),
        ]);
        if (!p || !d || !m) return false;
        const overlaps =
          p.x < d.x + d.width &&
          p.x + p.width > d.x &&
          p.y < d.y + d.height &&
          p.y + p.height > d.y;
        const inMap =
          p.x >= m.x &&
          p.x + p.width <= m.x + m.width &&
          p.y >= m.y &&
          p.y + p.height <= m.y + m.height;
        return inMap && !overlaps;
      })
      .toBe(true);
  });
}

test("report: switching site with the drawer open still flies to the new site", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-north");
  await page.getByRole("button", { name: "Report hazard" }).click();
  await expect(
    page.getByRole("dialog", { name: "Report a hazard" }),
  ).toBeVisible();
  await page.locator("#site").selectOption("site-south");
  const pin = page.locator('.site-pin[data-site-id="site-south"]');
  const map = page.locator("#site-map");
  await expect
    .poll(
      async () => {
        const [p, m] = await Promise.all([
          pin.boundingBox(),
          map.boundingBox(),
        ]);
        if (!p || !m) return false;
        const dx = p.x + p.width / 2 - (m.x + m.width / 2);
        const dy = p.y + p.height / 2 - (m.y + m.height / 2);
        return Math.abs(dx) < m.width / 4 && Math.abs(dy) < m.height / 4;
      },
      { timeout: 15000 },
    )
    .toBe(true);
});

test("report: one Escape closes only the legend, the next closes the drawer", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  const drawer = page.getByRole("dialog", { name: "Report a hazard" });
  await page.getByRole("button", { name: "Report hazard" }).click();
  await expect(drawer).toBeVisible();
  const legend = page.getByRole("button", { name: "Legend" });
  await legend.click();
  await expect(legend).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(legend).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("report: after denial, placing the pin by hand updates the hint", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
          setTimeout(() => fail({ code: 1, message: "denied" }), 0),
      },
    });
  });
  await signIn(page, "supervisor@planit.local");
  const drawer = page.getByRole("dialog", { name: "Report a hazard" });
  await page.getByRole("button", { name: "Report hazard" }).click();
  await expect(drawer.getByText(/Couldn't get your location/)).toBeVisible();
  await page.locator("#pin-map").click({ position: { x: 120, y: 200 } });
  await expect(drawer.getByText(/Pin placed on the map/)).toBeVisible();
});

const transformOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const card = document.querySelector("section li[class*='card']")!;
    return getComputedStyle(card).transform;
  });

test("motion: landing cards lift 2px on hover", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("section li[class*='card']").first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.waitForTimeout(400);
  expect(await transformOf(page)).toBe("matrix(1, 0, 0, 1, 0, -2)");
});

test("motion: reduced motion disables hover lift and animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const card = page.locator("section li[class*='card']").first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.waitForTimeout(100);
  expect(await transformOf(page)).toBe("none");
});

test("motion: reduced motion disables animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, "supervisor@planit.local");
  await expect(page.getByRole("region", { name: "Sites" })).toBeVisible();
  const long = await page.evaluate(() => {
    const seconds = (v: string) =>
      v.split(",").map((part) => parseFloat(part.trim()) || 0);
    const bad: string[] = [];
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      for (const prop of [cs.animationDuration, cs.transitionDuration])
        if (seconds(prop).some((s) => s > 0.01))
          bad.push(`${el.tagName}.${el.className}: ${prop}`);
    }
    return bad;
  });
  expect(long).toEqual([]);
});

test("location sharing keeps its watch when the worker leaves the map page", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await page.addInitScript(() => {
    const w = window as unknown as { watches: number[]; cleared: number[] };
    w.watches = [];
    w.cleared = [];
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: () => {
          const id = w.watches.length + 1;
          w.watches.push(id);
          return id;
        },
        clearWatch: (id: number) => w.cleared.push(id),
        getCurrentPosition: () => undefined,
      },
    });
  });
  await signIn(page, "crew@planit.local");
  await page
    .getByRole("switch", { name: "Share my location with my supervisor" })
    .check();
  const state = () =>
    page.evaluate(() => {
      const w = window as unknown as { watches: number[]; cleared: number[] };
      return { watches: w.watches.length, cleared: w.cleared.length };
    });
  await expect.poll(async () => (await state()).watches).toBe(1);
  await go(page, "Alerts");
  await expect(
    page.getByRole("heading", { level: 1, name: "Alerts" }),
  ).toBeVisible();
  await go(page, "Reports");
  await expect(
    page.getByRole("heading", { level: 1, name: "Reports" }),
  ).toBeVisible();
  expect(await state()).toEqual({ watches: 1, cleared: 0 });
});

test("report: a fix far from the site keeps the pin at the site centre", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          setTimeout(
            () =>
              ok({
                coords: { latitude: 30.5, longitude: -82.3, accuracy: 10 },
              }),
            0,
          ),
      },
    });
  });
  await signIn(page, "supervisor@planit.local");
  await page.locator("#site").selectOption("site-north");
  await page.getByRole("button", { name: "Report hazard" }).click();
  const drawer = page.getByRole("dialog", { name: "Report a hazard" });
  await expect(
    drawer.getByText(
      /You're \d+ mi from this site — pin placed at the site centre\. Click the map to move it\./,
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { sent: Record<string, unknown>[] };
    w.sent = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes("submit_hazard_report"))
        w.sent.push(JSON.parse(String(init?.body)));
      return real(input, init);
    };
  });
  await drawer.getByRole("button", { name: "Send report" }).click();
  await expect(drawer).toBeHidden();
  const [body] = await page.evaluate(
    () => (window as unknown as { sent: Record<string, unknown>[] }).sent,
  );
  expect(Number(body.p_lat)).toBeCloseTo(29.652, 3);
  expect(Number(body.p_lon)).toBeCloseTo(-82.325, 3);
});

test("phone: crew see the active alert count on the menu and My site", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "crew@planit.local");
  const menu = page.getByRole("button", { name: /^Menu, \d+ active alerts?$/ });
  await expect(menu).toBeVisible();
  const chip = page.getByRole("link", { name: /^\d+ active alerts?$/ });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/#\/alerts$/);
});

test("conditions: crew My site shows weather and hazard numbers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "crew@planit.local");
  const card = page.locator("#conditions-body");
  await expect(card.getByText("91°F", { exact: true })).toBeVisible();
  await expect(card.getByText("104°F")).toBeVisible();
  await expect(card.getByText("0.12 in/hr")).toBeVisible();
  await expect(card.getByText("12 mph WSW")).toBeVisible();
  await expect(card.getByText("gusts 22")).toBeVisible();
  await expect(card.getByText("Open-Meteo")).toBeVisible();
  const scores = card.getByRole("list", { name: "Hazard scores" });
  await expect(scores.getByText("Heat", { exact: true })).toBeVisible();
  await expect(scores.getByText(/^\d\.\d$/).first()).toBeVisible();
  await page.screenshot({
    path: ".superpowers/sdd/2026-10-17-ui-revamp/shots/conditions-crew.png",
  });
});

test("conditions: supervisor Sites hazard detail shows the weather numbers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "supervisor@planit.local");
  const detail = page.getByRole("region", { name: "Hazard detail" });
  await expect(detail.getByText("91°F", { exact: true })).toBeVisible();
  await expect(detail.getByText("0.12 in/hr")).toBeVisible();
  await expect(detail.getByText("12 mph WSW")).toBeVisible();
  await detail.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".superpowers/sdd/2026-10-17-ui-revamp/shots/conditions-sites.png",
  });
});

test("conditions: phone starts collapsed and opens without covering Report hazard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "crew@planit.local");
  const toggle = page.getByRole("button", { name: "Conditions" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#conditions-body")).toBeHidden();
  await toggle.click();
  const body = page.locator("#conditions-body");
  await expect(body.getByText("91°F", { exact: true })).toBeVisible();
  const report = await page
    .getByRole("button", { name: "Report hazard" })
    .boundingBox();
  const box = await body.boundingBox();
  expect(report && box).toBeTruthy();
  expect(box!.y + box!.height).toBeLessThanOrEqual(report!.y + 1);
});

const shots = ".superpowers/sdd/2026-10-17-ui-revamp/shots";

test("explain: Sites hazard detail explains the heat score", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "supervisor@planit.local");
  const sites = page.getByRole("region", { name: "Sites" });
  await sites.getByRole("button", { name: "North Plant" }).click();
  const detail = page.getByRole("region", { name: "Hazard detail" });
  await detail.scrollIntoViewIfNeeded();
  const heat = detail.getByRole("button", { name: /^Heat/ });
  await expect(heat).toHaveAttribute("aria-expanded", "false");
  // The raw value shows without expanding.
  await expect(heat).toContainText("Heat index 98°F");
  await heat.click();
  await expect(heat).toHaveAttribute("aria-expanded", "true");
  const panel = detail.locator("#explain-heat");
  await expect(panel).toContainText("WBGT 86°F · heat index 98°F");
  await expect(panel).toContainText(
    "WBGT 85–88°F → 5.0 · scheduled rest breaks",
  );
  await expect(panel).toContainText("Rises to 7.5 at WBGT 88°F");
  await expect(panel).not.toContainText("Readings updated");
  await page.screenshot({ path: `${shots}/explain-sites.png` });
});

test("explain: Sites shows how the overall index is built", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "supervisor@planit.local");
  await page
    .getByRole("region", { name: "Sites" })
    .getByRole("button", { name: "Tampa Bay" })
    .click();
  const line = page.locator("#risk-now-explain");
  await expect(line).toContainText(/^6\.9 = .*\(worst hazard\)|^6\.9 = ML/);
  await expect(line).toContainText("6.9 =");
});

test("explain: Sites flood explains the zone and river multipliers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "supervisor@planit.local");
  await page
    .getByRole("region", { name: "Sites" })
    .getByRole("button", { name: "South Plant" })
    .click();
  const detail = page.getByRole("region", { name: "Hazard detail" });
  const flood = detail.getByRole("button", { name: /^Flood/ });
  await flood.click();
  const panel = detail.locator("#explain-flood");
  await expect(panel).toContainText("31 mm (1.22 in)");
  await expect(panel).toContainText("×1.3 FEMA zone AE");
  await expect(panel).toContainText("×1.2 river 2.4 km away");
  await expect(flood).toContainText("6.2");
});

test("explain: crew My site conditions explain a hazard and the index", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "crew@planit.local");
  const card = page.locator("#conditions-body");
  const heat = card.getByRole("button", { name: /^Heat/ });
  await expect(heat).toHaveAttribute("aria-expanded", "false");
  await expect(heat).toContainText("Heat index 98°F");
  await heat.click();
  await expect(heat).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("#cond-explain-heat")).toContainText(
    "Rises to 7.5 at WBGT 88°F",
  );
  await expect(page.locator("#risk-now-explain")).toContainText("5.2");
  await page.screenshot({ path: `${shots}/explain-crew.png` });
});

test("explain: crew conditions card keeps Report hazard and the whole list reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "crew@planit.local");
  const body = page.locator("#conditions-body");
  const report = page.getByRole("button", { name: "Report hazard" });
  await expect(report).toBeVisible();
  const box = (await body.boundingBox())!;
  const rbox = (await report.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(800 - 120);
  const overlaps =
    box.x < rbox.x + rbox.width &&
    rbox.x < box.x + box.width &&
    box.y < rbox.y + rbox.height &&
    rbox.y < box.y + box.height;
  expect(overlaps).toBe(false);
  // The last hazard is reachable by scrolling the card.
  const last = body.getByRole("button", { name: /^Wildlife/ });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
  await page.screenshot({ path: `${shots}/explain-conditions.png` });
});

test("explain: a stored score that differs from the readings is flagged", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "supervisor@planit.local");
  await page.waitForFunction(
    () => (window as unknown as { __mockFlags?: object }).__mockFlags,
  );
  // Soil is stored as 2.0; make the served readings disagree with it.
  await page.evaluate(() => {
    (
      window as unknown as { __mockFlags: { readings: Record<string, number> } }
    ).__mockFlags.readings.soil_moisture_frac = 0.5;
  });
  await page
    .getByRole("region", { name: "Sites" })
    .getByRole("button", { name: "North Plant" })
    .click();
  const detail = page.getByRole("region", { name: "Hazard detail" });
  const soil = detail.getByRole("button", { name: /^Soil/ });
  await soil.click();
  await expect(soil).toContainText("2.0");
  await expect(detail.locator("#explain-soil")).toContainText(
    "Readings updated since last score.",
  );
});
