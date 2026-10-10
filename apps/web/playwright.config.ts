import { defineConfig } from "@playwright/test";

/**
 * E2Eِ پنلِ ادمین روی استکِ **واقعی** — M6 ردیفِ ۸٫۱.
 *
 * ★ **دو سرورِ واقعی، هیچ mockی از api:** ادعای این ردیف «روی استکِ واقعی» است، پس هم
 * `apps/api` بالا می‌آید هم `apps/web`. تنها چیزِ ساختگی درگاهِ پرداخت است
 * (`PAYMENT_PROVIDER=mock`) و سرویسِ پیامک — هر دو با تصمیمِ ثبت‌شده‌ی خودشان (ADR-049/031).
 *
 * ⚠️ **Postgres باید بالا باشد** (`pnpm db:up && pnpm db:migrate`). نبودش این‌جا یعنی
 * **شکست**، نه skipِ خاموش — همان قاعده‌ی `playwright.server.config.ts`ِ `canvas-sync`.
 *
 * ⚠️ `OTP_DEV_FIXED_CODE` لازم است (در `.env` محلی `424242` است): بدونش کدِ ورود تصادفی
 * می‌شود و تست به **خواندنِ لاگِ سرور** وابسته می‌شد.
 */
export default defineConfig({
  testDir: "./e2e",
  // ⚠️⚠️ **صریح، نه `**/*.spec.ts`** — رگرسیونِ خودم که گیتِ نهاییِ فاز ۹ گرفت (M6 ۹٫۴).
  //    این پیکربندی دو سرورِ **dev** را بالا می‌آورد. از ردیفِ ۸٫۳ سه specِ دیگر به همین پوشه آمدند
  //    (`p2-bundle`، `csp-measure`، `asset-upload`) که استکِ **production**ِ محلی می‌خواهند و هرکدام
  //    پیکربندیِ خودشان را دارند. گلابِ باز همه را این‌جا هم اجرا می‌کرد ⇒ `test:e2e` از همان روز
  //    **قرمز** بود (۳ سبز، ۳ شکست) و چون هیچ‌کس دوباره نزدش، سندها همچنان «۳/۳» می‌گفتند.
  testMatch: ["**/panel.spec.ts"],
  // ★ سریالی: هر سه تست روی **یک** کاربرِ هدف کار می‌کنند (تعلیق ⇒ رفعِ تعلیق) و ترتیبشان معنا دارد.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://127.0.0.1:15380",
    colorScheme: "light",
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
    locale: "fa-IR",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      // ⊕ از ریشه اجرا می‌شود چون `.env` آن‌جاست (پورت‌ها، رازها، کدِ ثابتِ OTP).
      command: "node --env-file-if-exists=.env apps/api/src/server.ts",
      cwd: "../..",
      // ⚠️⚠️ **سقفِ OTP این‌جا بالا می‌رود، و این یک دلیلِ اندازه‌گیری‌شده دارد:** کلِ این
      //    سوئیت از **یک IP** (لوپ‌بک) شش بار OTP می‌زند — سه بار در فیکسچرها و یکی به‌ازای
      //    هر تست — و پیش‌فرضِ ۵ باعث شد تستِ سوم بی‌صدا در فرمِ ورود گیر کند. خودِ سقف در
      //    ۴۲۹ی nginx/api روی استک سنجیده می‌شود (ردیفِ ۸٫۲)، نه این‌جا.
      env: { RATE_LIMIT_OTP_MAX: "60" },
      url: "http://localhost:15402/readyz",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm run dev",
      url: "http://127.0.0.1:15380",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
