import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Runs against the mock backend: PLAYWRIGHT_MODE=design npx playwright test tests/ui-design/model-flow.spec.ts
// The mock has a demo site mapped to Turkey Point (EIA 621), which has a real report in public/reports/621.

/** Animations that belong to a model flow diagram, optionally only those in one play state. */
const flowAnimations = (page: Page, state?: AnimationPlayState) =>
  page.evaluate(
    (wanted) =>
      document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return (
          target instanceof Element &&
          target.closest("figure") &&
          (!wanted || a.playState === wanted)
        );
      }).length,
    state,
  );

const landingFigures = (page: Page) =>
  page.locator("section[aria-labelledby='models-title'] figure");

test("the landing diagrams wait off screen, play when scrolled in and finish on their last frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const figures = landingFigures(page);
  await expect(figures).toHaveCount(2);
  const [hazard, mud] = [figures.nth(0), figures.nth(1)];
  await expect(hazard).not.toHaveAttribute("data-playing");

  await hazard.scrollIntoViewIfNeeded();
  await expect(hazard).toHaveAttribute("data-playing");
  await expect.poll(() => flowAnimations(page, "running")).toBeGreaterThan(0);

  // The longest sequence (the mud diagram) takes about 6 s.
  await expect
    .poll(() => flowAnimations(page, "running"), { timeout: 15_000 })
    .toBe(0);
  await expect(hazard).toContainText("6.5");
  await expect(hazard).toContainText("chance × injury severity");
  await expect(mud).toContainText("Worst 10% of route");
  await expect(mud).toContainText("4.5");
  await expect(hazard).toContainText("Example values");
});

test("Replay runs the animation again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await landingFigures(page).first().scrollIntoViewIfNeeded();
  await expect
    .poll(() => flowAnimations(page, "running"), { timeout: 15_000 })
    .toBe(0);

  await page
    .getByRole("button", { name: "Replay the Mud trafficability animation" })
    .click();
  await expect.poll(() => flowAnimations(page, "running")).toBeGreaterThan(0);
  await expect
    .poll(() => flowAnimations(page, "running"), { timeout: 15_000 })
    .toBe(0);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the diagrams show their finished state with nothing animating and no Replay", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const figures = landingFigures(page);
    await figures.first().scrollIntoViewIfNeeded();
    await expect(figures.first()).toContainText("6.5");
    await expect(figures.nth(1)).toContainText("4.5");
    // The truck is the one piece driven from script; it must not start either.
    await page.waitForTimeout(500);
    expect(await flowAnimations(page)).toBe(0);
    await expect(page.getByRole("button", { name: /Replay/ })).toHaveCount(0);
  });
});

test("on the Sites page a site with a report shows its own values, matching the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "supervisor@planit.local");
  await page.goto("/#/sites");
  const section = page.locator("section[aria-labelledby='models-title']");
  await expect(section).toBeVisible();
  await page
    .locator("#site")
    .selectOption({ label: "Turkey Point · Report demo" });

  for (const [card, title] of [
    ["model-hi-title", "Hazard Index"],
    ["model-mud-title", "Mud trafficability"],
  ] as const) {
    const article = section.locator(`article[aria-labelledby='${card}']`);
    const figure = article.locator("figure");
    await expect(figure).toContainText("This site, tomorrow.");
    // The marker's number is the card's headline number.
    const reading = (await article.locator("strong").first().textContent())!;
    await expect(figure.getByRole("img")).toHaveAttribute(
      "aria-label",
      new RegExp(`It is ${reading.trim()} here\\.`),
    );
    await expect(
      article.getByRole("button", { name: `Replay the ${title} animation` }),
    ).toBeVisible();
  }
});
