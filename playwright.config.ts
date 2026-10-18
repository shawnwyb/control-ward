import { defineConfig } from "@playwright/test";

// PLAYWRIGHT_MODE=design runs against the in-browser mock backend (no Supabase needed).
const design = process.env.PLAYWRIGHT_MODE === "design";
const safety = process.env.PLAYWRIGHT_MODE === "safety";
const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);

export default defineConfig({
  testDir: design ? "./tests/ui-design" : "./tests/ui",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run ${design ? "dev:design" : safety ? "safety:dev" : "dev"} -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
