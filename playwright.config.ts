import { defineConfig } from "@playwright/test";

// PLAYWRIGHT_MODE=design runs against the in-browser mock backend (no Supabase needed).
const design = process.env.PLAYWRIGHT_MODE === "design";

export default defineConfig({
  testDir: design ? "./tests/ui-design" : "./tests/ui",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run ${design ? "dev:design" : "dev"} -- --port 5173 --strictPort`,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
