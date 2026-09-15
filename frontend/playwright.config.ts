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
    // Point the suite at a deployed box with BASE_URL=https://... — the local
    // server needs a backend and a database, which this machine does not have,
    // so "check it on the thing that is actually serving it" is the only
    // honest verification available here.
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  // Only boot a local server when we are testing a local server.
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          // `next dev`, NOT `next start`.
          //
          // next.config sets `output: "standalone"` for the container build,
          // and `next start` DOES NOT WORK with it — it prints a warning and
          // then serves the HTML with NO STYLESHEET AT ALL. The page still
          // returns 200 and every selector still resolves, so a test run looks
          // completely normal; it is just measuring unstyled markup.
          //
          // That is the worst kind of broken instrument. A contrast check read
          // rgb(0,0,0) on all sixteen themes and I nearly filed it as a bug in
          // the page. `npm run responsive` measures layout, so on an unstyled
          // page every one of its numbers is meaningless too — it only ever
          // gave real answers when a dev server happened to be up on 3000 and
          // `reuseExistingServer` silently used that instead.
          //
          // The standalone server can be run locally, but it needs .next/static
          // and public/ copied in by hand first (the Dockerfile does it). Dev
          // is the honest default; BASE_URL=... still points at prod.
          command: "npm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),
});
