import { defineConfig, devices } from "@playwright/test";
/** A3 개발용 미리보기 전용 (dev 서버가 match-result-preview.html을 제공; 운영 빌드에는 없음). */
export default defineConfig({
  testDir: "./tests/ui-preview",
  timeout: 30000,
  workers: 1,
  reporter: "list",
  webServer: { command: "npx vite --host 127.0.0.1 --port 5180 --strictPort", url: "http://127.0.0.1:5180/YachtLab/match-result-preview.html", reuseExistingServer: true, timeout: 60000 },
  use: {
    baseURL: "http://127.0.0.1:5180/YachtLab/",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
    { name: "small", use: { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true } },
  ],
});
