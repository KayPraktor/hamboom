import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { codeFromLog } from "./compose.ts";

/**
 * **مسیرِ کاملِ تصویر روی باندلِ واقعی** — M6 ردیفِ ۸٫۶.
 *
 * باگِ بازِ اولین استقرار این بود: «تصویر آپلود می‌شود ولی روی بوم نمی‌آید». این سنجه همان ژست
 * را روی استکِ productionِ محلی می‌رود و **هر چهار حلقه‌ی زنجیره** را جدا assert می‌کند، تا اگر
 * روزی شکست، معلوم باشد **کدام** حلقه:
 *
 *   ۱. `presign` → ۲۰۰  ۲. POSTِ مستقیم به انبار → ۲xx  ۳. `commit` → ۲۰۰
 *   ۴. `GET /assets/:id` → **۳۰۲** و بعد بایت‌ها از خودِ انبار → ۲۰۰
 *
 * ★★ و یک ادعای پنجم که از همه مهم‌تر است: **هیچ پیامِ «بایتِ تصویر … خوانده نشد» در کنسول
 * نباشد.** آن پیام تازه در همین ردیف اضافه شد، چون نگارشِ قبلی خطا را می‌بلعید و باگ از بیرون
 * اصلاً قابلِ دیدن نبود.
 *
 * ⚠️ این سنجه **نمی‌گوید** باگِ زنده حل شده — انبارِ این‌جا MinIO است نه آروان. چیزی که می‌گوید
 * این است: آیا مسیر روی یک انبارِ سالم و روی **باندلِ build** (نه سرورِ dev) درست کار می‌کند.
 */

const BASE = process.env.E2E_WEB_URL ?? "http://localhost";

/** یک PNGِ ۱×۱ واقعی — کوچک‌ترین چیزی که sniffِ سمتِ سرور قبولش کند. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("★★ درجِ تصویر روی بومِ باندلِ واقعی — هر چهار حلقه", async ({ page }) => {
  const phone = `0912${String(randomInt(1_000_000, 9_999_999))}`;

  const calls: { url: string; status: number }[] = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (/\/assets(\/|$)/.test(u.pathname) || u.origin !== new URL(BASE).origin) {
      calls.push({ url: `${u.origin}${u.pathname}`, status: r.status() });
    }
  });
  const assetErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("بایتِ تصویر")) assetErrors.push(m.text());
  });

  await page.goto(`${BASE}/login`);
  await page.getByLabel("شماره‌ی موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد" }).click();
  await page.getByLabel("کد ورود").fill(codeFromLog());
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  await page.getByRole("button", { name: "بوردِ جدید" }).click();
  const boardLink = page.locator('a[href^="/b/"]').first();
  await expect(boardLink).toBeVisible({ timeout: 30_000 });
  await page.goto(`${BASE}${(await boardLink.getAttribute("href")) ?? ""}`);
  await expect(page.getByRole("toolbar", { name: "ابزارها" })).toBeVisible({ timeout: 30_000 });

  // ── ابزارِ تصویر یک انتخابگرِ فایلِ واقعی باز می‌کند ──
  const chooser = page.waitForEvent("filechooser", { timeout: 20_000 });
  await page.getByRole("button", { name: "تصویر" }).click();
  await (await chooser).setFiles({ name: "probe.png", mimeType: "image/png", buffer: PNG_1PX });
  // موتور بعد از انتخابِ فایل منتظرِ یک کلیک روی بوم است تا جای عنصر را بگیرد.
  await page.mouse.click(700, 450);

  // ── حلقه‌های ۱–۳: presign / آپلودِ مستقیم / commit ──
  await expect
    .poll(() => calls.filter((c) => c.url.endsWith("/assets/presign")).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const presign = calls.find((c) => c.url.endsWith("/assets/presign"));
  expect(presign?.status, "presign باید ۲۰۰ بدهد").toBe(200);

  const store = new URL(BASE).origin;
  await expect
    .poll(() => calls.filter((c) => !c.url.startsWith(store)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const upload = calls.find((c) => !c.url.startsWith(store));
  expect(upload?.status, `آپلودِ مستقیم به انبار (${String(upload?.url)}) باید ۲xx باشد`).toBeLessThan(
    300,
  );

  await expect
    .poll(() => calls.filter((c) => /\/assets\/[0-9a-f-]{36}\/commit$/.test(c.url)).length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  expect(
    calls.find((c) => /\/commit$/.test(c.url))?.status,
    "commit باید ۲۰۰ بدهد — یعنی سرور بایتِ واقعی را در انبار دید و sha را تایید کرد",
  ).toBe(200);

  // ── حلقه‌ی ۴: خواندنِ بایت‌ها برای رندر ──
  //    ⊕ در همان بارگذاری معمولاً از راهِ `registerSceneAssets` صدا زده می‌شود؛ یک reload
  //      قطعی‌اش می‌کند چون سند از snapshot می‌آید و همه‌ی دارایی‌ها resolve می‌شوند.
  await page.reload();
  await expect(page.getByRole("toolbar", { name: "ابزارها" })).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => calls.filter((c) => /\/assets\/[0-9a-f-]{36}$/.test(c.url)).length, {
      timeout: 40_000,
    })
    .toBeGreaterThan(0);
  const read = calls.filter((c) => /\/assets\/[0-9a-f-]{36}$/.test(c.url));
  console.log(`تماس‌ها: ${calls.map((c) => `${c.url}→${String(c.status)}`).join(" · ")}`);
  expect(
    read.map((c) => c.status),
    "‏`GET /assets/:id` باید ۳۰۲ بدهد (و مرورگر دنبالش کند) — ۴۰۴ یعنی ردیفِ files هنوز ready نیست",
  ).toContain(302);

  // ── ★★ ادعای پنجم: سکوت ≠ سلامت. اگر رندر نشده باشد، حالا صدا دارد ──
  expect(assetErrors, `خطای خواندنِ بایتِ تصویر: ${assetErrors.join(" | ")}`).toEqual([]);

  // ── ★★★ شکستنِ عمدی: «صفر خطا» تا وقتی نشان ندهی ابزار خطا را **می‌بیند**، پوچ است ──
  //
  // خواندنِ بایت از انبار را عمداً قطع می‌کنیم. دقیقاً همان چیزی که یک CORSِ بسته یا یک ۴۰۳ی
  // امضا در تولید می‌سازد: `TypeError` داخلِ `resolveBlob`. اگر این پیام **نیاید**، یعنی
  // ادعای بالا هیچ‌وقت چیزی را اثبات نمی‌کرده.
  // ⚠️ روی خودِ `/assets/:id`ِ **هم‌مبدأ** قطع می‌کنیم، نه روی نشانیِ انبار: پاسخِ انبار
  //    کش‌پذیر است و بعد از reload ممکن است اصلاً درخواستی نرود (آزموده شد — شکستنِ عمدی
  //    بی‌صدا هیچ نشد). مسیرِ api `cache-control: no-store` دارد، پس همیشه واقعاً می‌رود.
  assetErrors.length = 0;
  await page.route(/\/assets\/[0-9a-f-]{36}$/, (route) => route.abort("failed"));
  await page.reload();
  await expect(page.getByRole("toolbar", { name: "ابزارها" })).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => assetErrors.length, { timeout: 40_000 })
    .toBeGreaterThan(0);
  expect(assetErrors.join(" "), "پیامِ شکست باید **علت** را بگوید، نه فقط «نشد»").toMatch(
    /TypeError|api \d{3}/,
  );
});
