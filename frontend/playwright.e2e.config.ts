/**
 * P8 end-to-end smoke suite against a REAL stack: Next.js (+ BFF) → FastAPI →
 * PostgreSQL on a fresh, migrated database. Not the simulation harness in
 * playwright.fulfillment.config.ts. See e2e/smoke/README.md.
 *
 *   npx playwright test -c playwright.e2e.config.ts
 */
import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e/smoke",
  // One worker: every spec writes to the same database. Specs never share
  // rows (unique SKUs per test), so order does not matter.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]] : "list",
  outputDir: "e2e-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
