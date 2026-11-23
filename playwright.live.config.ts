import { defineConfig, devices } from "@playwright/test";
/** Live check of the public site (manual workflow only; not part of `npm run test:ui`). */
export default defineConfig({
  testDir: "./tests/live",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "https://oyueo-mm.github.io/YachtLab/", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
