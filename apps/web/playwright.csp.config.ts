import { defineConfig } from "@playwright/test";

/**
 * اندازه‌گیریِ CSP روی **باندلِ ساخته‌شده پشتِ nginx** — M6 ردیفِ ۸٫۵.
 *
 * ⚠️⚠️ **این پیکربندی هیچ سروری بالا نمی‌آورد** — قرینه‌ی [`playwright.p2.config.ts`](playwright.p2.config.ts).
 * استکِ productionِ محلی باید از قبل بالا باشد و ایمیج‌هایش از درختِ **فعلی** ساخته شده باشند.
 *
 * ★★ **و این‌جا حتماً باید باندلِ build باشد، نه سرورِ dev** — وگرنه چیزی که اندازه می‌گیری
 * **Vite** است نه اپِ ما: سرورِ dev یک `<script type="module">`ِ **inline** برای preambleِ
 * react-refresh تزریق می‌کند و CSS را به‌شکلِ `<style>`ِ inline می‌دهد. یعنی `script-src` و
 * `style-src` — دقیقاً دو دایرکتیوی که این ردیف درباره‌شان است — در dev جوابِ **غلط** می‌دهند.
 * همان درسِ «ایمیجِ کهنه یک mockِ ناخواسته است» (ردیفِ ۸٫۲/۸٫۳)، یک پله بالاتر.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/csp-measure.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // ⚠️ هر پالیسی یک بارگذاریِ کاملِ بورد است (WS + snapshot) — مهلتِ پیش‌فرضِ ۳۰s کم است.
  timeout: 300_000,
  reporter: [["list"]],
  // ★★ تنها سرورِ این پیکربندی، **ابزارِ اندازه‌گیری** است نه اپ: یک پروکسیِ واقعی که هدرِ CSP
  //    را می‌گذارد. شرحِ اینکه چرا `route.fulfill` کافی نبود در [`e2e/csp-proxy.ts`](e2e/csp-proxy.ts).
  webServer: {
    command: "node e2e/csp-proxy.ts",
    url: "http://127.0.0.1:15974/__csp-proxy-ready",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { CSP_UPSTREAM: process.env.E2E_WEB_URL ?? "http://127.0.0.1:80" },
  },
  use: {
    baseURL: "http://127.0.0.1:15974",
    colorScheme: "light",
    viewport: { width: 1400, height: 900 },
    locale: "fa-IR",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
