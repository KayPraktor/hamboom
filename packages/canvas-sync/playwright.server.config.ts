import { defineConfig } from "@playwright/test";

/**
 * ★ اجرای **جداگانه‌ی** تست‌هایی که زیرساختِ واقعی می‌خواهند — گام ۶٫۱.
 *
 * ⚠️ چرا جدا: [`e2e/g1-server.spec.ts`](e2e/g1-server.spec.ts) به Postgres و
 * Redisِ بالا نیاز دارد (معیارِ پذیرشِ G-1ب صریحاً همین را می‌خواهد). اگر در
 * اجرای پیش‌فرض بود، کلِ E2Eِ این پکیج به داکر گره می‌خورد — دقیقاً همان دلیلی
 * که هفت سنجه‌ی `rt:*` بیرونِ `pnpm verify` اند.
 *
 * ★ و **skip نمی‌شود**: نبودنِ دیتابیس اینجا یعنی شکست، نه سبزِ خاموش.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/g1-server.spec.ts"],
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
