// Captures the screenshots in this folder from the Next-day report tab, on the mock backend.
//   Terminal 1:  npm run dev:design -- --port 5173 --strictPort
//   Terminal 2:  node docs/screenshots/next-day-report/capture.mjs
// The mock has a demo site mapped to Turkey Point (EIA 621), so the tab shows public/reports/621/latest.json.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL(".", import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173/";
const browser = await chromium.launch();

async function open(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(BASE);
  await page.getByLabel("Email").fill("supervisor@planit.local");
  await page.getByLabel("Password").fill("CrewDemo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForSelector("#workspace select");
  await page.selectOption("#site", { label: "Turkey Point · Report demo" });
  await page.locator("label", { hasText: "Next-day report" }).click();
  await page.waitForSelector("#next-day-report", { timeout: 20000 });
  await page.waitForTimeout(4000); // map tiles, route and tide layers
  return page;
}

const desktop = await open(1280);
await desktop.screenshot({
  path: `${OUT}01-full-page-desktop.png`,
  fullPage: true,
});
const panels = {
  "03-header-verdict.png":
    "#verdict-title >> xpath=ancestor::section[@aria-labelledby='verdict-title']",
  "04-heat-water-breaks.png": "#heat",
  "05-weather-work-window.png": "#weather",
  "06-routes-tide-levees-map.png": "#routes",
  "07-task-planner.png": "#tasks",
  "08-flood-river-levees-tide.png": "#flood",
  "09-hazard-index.png": "#hazard-index",
  "10-air-quality.png": "#air",
  "11-wildlife.png": "#wildlife",
  "12-data-gaps.png": "#gaps",
};
for (const [file, selector] of Object.entries(panels)) {
  const el = desktop.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await desktop.waitForTimeout(400);
  await el.screenshot({ path: `${OUT}${file}` });
}

// Detour planner: two clicks on the map, then the result text.
const routes = desktop.locator("#routes");
await routes
  .getByRole("button", { name: "Pick start and end on the map" })
  .click();
const map = routes.getByRole("img", { name: /Map of flagged routes/ });
await map.scrollIntoViewIfNeeded();
await desktop.waitForTimeout(500);
const box = await map.boundingBox();
await desktop.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.22);
await desktop.waitForTimeout(400);
await desktop.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.8);
await desktop.waitForTimeout(1500);
await routes.screenshot({ path: `${OUT}13-detour-planner.png` });
await desktop.close();

const phone = await open(390);
await phone.screenshot({
  path: `${OUT}02-full-page-phone.png`,
  fullPage: true,
});
await phone.close();
await browser.close();
console.log(`Screenshots written to ${OUT}`);
