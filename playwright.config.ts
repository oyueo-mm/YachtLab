import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173/YachtLab/",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Functional tests run without dice motion (3D throws take ~1.3 s each). Tests that check
    // animation opt back in with `withMotion()` from tests/ui/helpers.ts.
    contextOptions: { reducedMotion: "reduce" },
    // Local sandboxes with a preinstalled Chromium can point at it; CI installs its own.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
  ],
});
