import { test, expect } from "@playwright/test";
import { go, signIn } from "./helpers";

test("revamped site detail retains the model's evidence links", async ({
  page,
}) => {
  await signIn(page, "supervisor@planit.local");
  const evidence = page.locator("#hazard-evidence");
  await expect(evidence).toContainText("Backing Evidence: FLOOD");
  await expect(evidence.getByRole("link")).toHaveCount(2);
  await expect(evidence.getByRole("link").first()).toHaveAttribute(
    "href",
    "https://water.weather.gov/ahps",
  );
});

test("crew retains access to the full next-day report through the sidebar", async ({
  page,
}) => {
  await signIn(page, "crew@planit.local");
  await go(page, "Daily safety");
  await page
    .getByText("View detailed forecast & sources", { exact: true })
    .click();
  await expect(page).toHaveURL(/#\/daily-safety$/);
  await expect(
    page.getByText("A detailed forecast is not available for this site.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("link", { name: "Crew", exact: true }),
  ).toHaveCount(0);
});
