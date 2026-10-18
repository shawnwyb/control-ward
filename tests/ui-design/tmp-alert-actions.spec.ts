import { expect, test } from "@playwright/test";
import { go, signIn } from "./helpers";

for (const size of [
  { width: 1280, height: 800 },
  { width: 390, height: 800 },
]) {
  test(`ack and clear are adjacent at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, "supervisor@planit.local");
    await page.locator("#site").selectOption({ label: "North Plant · Demo" });
    await go(page, "Crew");
    await page.locator("#push-title-input").fill("Wrap up early");
    await page.locator("#push-body").fill("Storm cell moving in.");
    await page.getByRole("button", { name: "Send alert" }).click();
    await expect(page.getByText("Alert sent")).toBeVisible();
    await page.setViewportSize(size);
    await go(page, "Alerts");
    const message = page
      .getByText("Wrap up early", { exact: true })
      .locator("../..");
    const ack = message.getByRole("button", { name: "Acknowledge", exact: true });
    const clear = message.getByRole("button", { name: "Clear", exact: true });
    await expect(ack).toBeVisible();
    const a = (await ack.boundingBox())!;
    const c = (await clear.boundingBox())!;
    const row = (await message.boundingBox())!;
    console.log(JSON.stringify({ size, ack: a, clear: c, row }));
    expect(Math.abs(a.y - c.y)).toBeLessThan(4);
    expect(c.x - (a.x + a.width)).toBeGreaterThanOrEqual(0);
    expect(c.x - (a.x + a.width)).toBeLessThan(16);
    await page.screenshot({
      path: `/private/tmp/claude-501/-Users-tienle-Documents-Coding-swamphacks2026/f1c494f4-822d-49f4-8fa1-7195167b0be8/scratchpad/alerts-${size.width}.png`,
    });
  });
}
