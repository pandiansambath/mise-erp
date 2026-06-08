import { defineConfig } from "@playwright/test";

// Device-compatibility testing: every spec runs at mobile, tablet, and desktop
// widths so we catch responsive breakage early.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Cap workers: the whole suite shares ONE Next server + ONE backend, so too
  // much parallelism starves the single backend and makes data-heavy pages
  // (e.g. /reports) render slowly enough to trip layout/overflow checks.
  workers: 3,
  reporter: "list",
  retries: process.env.CI ? 2 : 1,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
