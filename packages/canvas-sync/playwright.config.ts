import { defineConfig } from "@playwright/test";

/**
 * Playwright برای probeِ گام ۱٫۱ (و در فاز ۳، G-1الف).
 *
 * همان الگوی اثبات‌شده‌ی canvas-core: یک Chromiumِ **واقعی** که composite می‌کند و
 * رویدادِ **trusted** می‌سازد — تنها چیزی که موتور می‌پذیرد.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:15280",
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm run dev",
    url: "http://127.0.0.1:15280",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
