import { defineConfig } from "@playwright/test";

/**
 * P2 روی **باندلِ ساخته‌شده پشتِ nginx** — M6 ردیفِ ۸٫۳.
 *
 * ⚠️⚠️ **این پیکربندی هیچ سروری بالا نمی‌آورد.** استکِ productionِ محلی باید از قبل بالا باشد
 * (رویه در PROGRESS ردیفِ ۸٫۳): ایمیج‌های api و web از درختِ **فعلی** ساخته شوند، وگرنه چیزی
 * که می‌سنجی باندلِ کهنه است — همان سبزِ دروغینی که ردیفِ ۸٫۲ با آن شروع شد.
 *
 * ★ جدا از [`playwright.config.ts`](playwright.config.ts) است چون آن یکی روی سرورِ **dev** و
 *   پورت ۱۵۳۸۰ اجرا می‌شود؛ ادعای این ردیف صریحاً «باندلِ واقعی» است.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/p2-bundle.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost",
    colorScheme: "light",
    viewport: { width: 1400, height: 900 },
    locale: "fa-IR",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
