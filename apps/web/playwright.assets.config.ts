import { defineConfig } from "@playwright/test";

/**
 * مسیرِ **تصویر** روی باندلِ ساخته‌شده پشتِ nginx — M6 ردیفِ ۸٫۶.
 *
 * ★★ **چرا روی باندل و نه سرورِ dev:** باگِ بازِ ۸٫۶ فقط در **اولین استقرارِ واقعی** دیده شد و در
 * توسعه هرگز. ردیفِ ۸٫۵ همین هفته نشان داد dev و build در چیزهای مهمی فرق دارند، پس «در dev کار
 * می‌کند» درباره‌ی این باگ **هیچ** نمی‌گوید. این سنجه همان مسیر را روی باندلِ واقعی می‌رود.
 *
 * ★★★ **و چرا انبار از پشتِ پروکسی:** ریشه‌ی آن باگ تفاوتِ CORSِ MinIO و آروان بود
 * ([`storage-cors-proxy.ts`](e2e/storage-cors-proxy.ts))، پس سنجه‌ای که مستقیم به MinIO بزند آن کلاس را
 * هرگز نمی‌بیند. `webServer` همان پروکسی را بالا می‌آورد.
 *
 * ⚠️⚠️ استکِ productionِ محلی باید از قبل بالا باشد (قرینه‌ی [`playwright.p2.config.ts`](playwright.p2.config.ts))،
 * با **دو شرط** روی `S3_ENDPOINT`ش:
 *
 * ۱. به **پروکسی** اشاره کند، نه به خودِ MinIO: `http://host.docker.internal:15977`
 *    (`STORAGE_PROXY_PORT`). خودِ تست این را assert می‌کند — روی انبارِ غیرِسخت‌گیر **قرمز** می‌شود، نه
 *    سبزِ پوچ.
 * ۲. از **مرورگر** هم قابلِ دسترس باشد (نه `localhost`ِ داخلِ کانتینر): URLِ امضاشده را خودِ مرورگر باز
 *    می‌کند. `host.docker.internal` روی این ماشین هم از کانتینر و هم از هاست resolve می‌شود.
 *
 * و `STORAGE_PROXY_UPSTREAM` باید MinIOی هاست باشد (پیش‌فرض `http://127.0.0.1:9000`؛ روی این ماشین
 * `http://127.0.0.1:15900`). ⚠️ کانتینرهای api و realtime هم از همین پروکسی به انبار می‌رسند، پس اگر
 * استک را بیرون از این سنجه به کار می‌بری، پروکسی را خودت بالا نگه دار
 * (`node e2e/storage-cors-proxy.ts`؛ `reuseExistingServer` همان را برمی‌دارد).
 */
const PROXY_PORT = process.env.STORAGE_PROXY_PORT ?? "15977";

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
  webServer: {
    command: "node e2e/storage-cors-proxy.ts",
    url: `http://127.0.0.1:${PROXY_PORT}/__storage-proxy-ready`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
