import { defineConfig } from "@playwright/test";

/**
 * مسیرِ **تصویر** روی باندلِ ساخته‌شده پشتِ nginx — M6 ردیفِ ۸٫۶.
 *
 * ★★ **چرا روی باندل و نه سرورِ dev:** باگِ بازِ ۸٫۶ فقط در **اولین استقرارِ واقعی** دیده شد و در
 * توسعه هرگز. ردیفِ ۸٫۵ همین هفته نشان داد dev و build در چیزهای مهمی فرق دارند، پس «در dev کار
 * می‌کند» درباره‌ی این باگ **هیچ** نمی‌گوید. این سنجه همان مسیر را روی باندلِ واقعی می‌رود.
 *
 * ⚠️⚠️ استکِ productionِ محلی باید از قبل بالا باشد (قرینه‌ی [`playwright.p2.config.ts`](playwright.p2.config.ts)).
 * ⊕ و انبار باید از **مرورگر** هم قابلِ دسترس باشد: `S3_ENDPOINT` نباید `localhost`ِ داخلِ
 *   کانتینر باشد، چون URLِ امضاشده را خودِ مرورگر باز می‌کند.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/asset-upload.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost",
    colorScheme: "light",
    viewport: { width: 1400, height: 900 },
    locale: "fa-IR",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
