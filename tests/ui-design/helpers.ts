import { expect, type Page } from "@playwright/test";

export const demoPassword = "CrewDemo123!";

/** Signs in on the mock backend. `query` (e.g. "?safety=stale") stays in the URL ahead of the hash route. */
export async function signIn(page: Page, email: string, query = "") {
  await page.goto(`/${query}#/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.locator("#sidebar")).toBeAttached();
}

/** Opens a page from the sidebar (opening the phone menu first when it is collapsed). */
export async function go(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Pages" });
  const menu = page.getByRole("button", { name: "Menu" });
  // Wide screens show the nav; phones show the menu button (the nav is hidden until it is opened).
  await nav.or(menu).first().waitFor();
  if (!(await nav.isVisible())) await menu.click();
  await nav.getByRole("link", { name }).click();
}
