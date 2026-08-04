import { defineConfig } from "@playwright/test";

/**
 * پیکربندی تست‌های E2E (مرورگرِ واقعی) — گام ۶٫۱.
 *
 * ── چرا اصلاً E2E ─────────────────────────────────────────────────────
 *
 * jsdom پیکسل تولید نمی‌کند و رویدادِ trusted نمی‌سازد؛ کلِ کلاسِ باگ‌هایی که این
 * ماژول در مرورگر یاد گرفت (جهتِ متنِ canvas، همپوشانیِ overlay، undoِ موتور، …)
 * در تستِ واحد نامرئی است. Playwright یک **Chromiumِ واقعی** اجرا می‌کند که
 * composite می‌کند و رویدادِ **trusted** می‌فرستد — همان چیزی که موتور می‌پذیرد.
 *
 * ── محیط ──────────────────────────────────────────────────────────────
 *
 * `webServer` خودِ دموی Vite را بالا می‌آورد (همان `pnpm dev` روی ۵۱۸۰) و تست‌ها
 * به آن وصل می‌شوند. باینریِ مرورگر با `pnpm exec playwright install chromium`
 * یک‌بار نصب می‌شود (فقط برای تست؛ dev/runtime به آن نیازی ندارد — اصل P3).
 */
export default defineConfig({
  testDir: "./e2e",
  // صحنه حالتِ مشترک دارد؛ ترتیبی و تک‌کارگر تا نتیجه قطعی بماند.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:15180",
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    // deviceScaleFactor ثابت تا اسنپ‌شات‌ها بین اجراها یکسان بمانند.
    deviceScaleFactor: 1,
  },
  // اسنپ‌شات‌های پیکسلی حساسیتِ کوچک را تحمل کنند (آنتی‌الیاسِ فونت بینِ اجراها).
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm run dev",
    url: "http://127.0.0.1:15180",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
