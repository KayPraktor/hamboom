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
 * ★★★ **انبارِ این سنجه باید «سخت‌گیر» باشد** — و این خودش assert می‌شود (پایینِ تست). تا ریشه‌یابیِ
 * ۸٫۶ این سنجه مستقیم روی MinIO اجرا می‌شد و با خودِ باگِ زنده هم **سبز** بود: MinIO به هر پاسخی
 * `Access-Control-Allow-Credentials: true` می‌چسباند، آروان نه، و خواندنِ بایت با
 * `credentials: "include"` فقط روی دومی می‌شکست. حالا انبار از پشتِ
 * [`storage-cors-proxy.ts`](storage-cors-proxy.ts) می‌آید که CORSِ MinIO را به شکلِ اندازه‌گیری‌شده‌ی
 * آروان درمی‌آورد. روی همین چیدمان: باندلِ قبل از رفع **قرمز** («بایتِ تصویر … خوانده نشد —
 * TypeError: Failed to fetch»، زنجیره روی ۳۰۲ تمام شد)، باندلِ بعد از رفع **سبز**.
 *
 * ⚠️ هنوز **نمی‌گوید** باگِ زنده حل شده: این یک MinIOست با هدرهای آروان، نه خودِ آروان. تاییدِ نهایی
 * فقط روی سایتِ زنده، بعد از استقرار.
 */

const BASE = process.env.E2E_WEB_URL ?? "http://localhost";

/** یک PNGِ ۱×۱ واقعی — کوچک‌ترین چیزی که sniffِ سمتِ سرور قبولش کند. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("★★ درجِ تصویر روی بومِ باندلِ واقعی — هر چهار حلقه", async ({ page }) => {
  const phone = `0912${String(randomInt(1_000_000, 9_999_999))}`;

  const calls: { url: string; status: number; method: string }[] = [];
  /** هر پاسخِ انبار که `Access-Control-Allow-Credentials` داشت — روی انبارِ سخت‌گیر باید **تهی** بماند. */
  const lenientStorage: string[] = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    const crossOrigin = u.origin !== new URL(BASE).origin;
    if (/\/assets(\/|$)/.test(u.pathname) || crossOrigin) {
      calls.push({ url: `${u.origin}${u.pathname}`, status: r.status(), method: r.request().method() });
    }
    if (crossOrigin && r.headers()["access-control-allow-credentials"] !== undefined) {
      lenientStorage.push(`${r.request().method()} ${u.origin}`);
    }
  });
  const assetErrors: string[] = [];
  /** پیامِ خودِ مرورگر — مستقل از کدِ ما، و همان چیزی که روی سایتِ زنده در کنسول دیده می‌شود. */
  const corsErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().includes("بایتِ تصویر")) assetErrors.push(m.text());
    if (/CORS policy/i.test(m.text())) corsErrors.push(m.text());
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
  expect(
    read.map((c) => c.status),
    "‏`GET /assets/:id` باید ۳۰۲ بدهد (و مرورگر دنبالش کند) — ۴۰۴ یعنی ردیفِ files هنوز ready نیست",
  ).toContain(302);

  // ── ★★ و بایت‌ها **واقعاً** از انبار رسیدند — ادعای مثبت، نه فقط «خطایی نبود» ──
  //    وقتی مرورگر پاسخِ انبار را به‌خاطرِ CORS دور می‌ریزد، این ردیف اصلاً در `calls` نمی‌نشیند
  //    (دیده شد: زنجیره روی ۳۰۲ تمام می‌شد). پس نبودنش خودِ نشانه‌ی باگِ «قابِ خالی» است.
  const storageGets = (): { status: number }[] =>
    calls.filter((c) => !c.url.startsWith(store) && c.method === "GET");
  // تا یکی از این دو رخ بدهد صبر می‌کنیم: بایت‌ها رسیدند، یا مرورگر/اپ گفتند چرا نرسیدند.
  await expect
    .poll(() => storageGets().length > 0 || assetErrors.length > 0 || corsErrors.length > 0, {
      timeout: 30_000,
      message: "نه بایتی از انبار رسید و نه خطایی در کنسول نشست — خواندن اصلاً شروع نشده؟",
    })
    .toBe(true);
  console.log(`تماس‌ها: ${calls.map((c) => `${c.method} ${c.url}→${String(c.status)}`).join(" · ")}`);

  // ⊕ اول پیامِ خودِ مرورگر — گویاترینِ هر سه، و مستقل از کدِ ما (روی هر باندلی، حتی قدیمی، می‌آید).
  //   ⚠️ نشانیِ امضاشده از متن بریده می‌شود: امضا و شناسه‌ی کلید جایشان در خروجیِ تست نیست، حتی برای
  //   انبارِ محلی.
  expect(
    corsErrors.map((t) => t.replace(/\?[^'\s]*/g, "?…")),
    "مرورگر پاسخِ انبار را به‌خاطرِ CORS دور ریخت",
  ).toEqual([]);
  // ── ★★ ادعای پنجم: سکوت ≠ سلامت. اگر رندر نشده باشد، حالا صدا دارد ──
  expect(assetErrors, `خطای خواندنِ بایتِ تصویر: ${assetErrors.join(" | ")}`).toEqual([]);
  expect(
    storageGets().map((c) => c.status),
    "هاپِ دوم (خودِ انبار) باید ۲۰۰ بدهد",
  ).toContain(200);

  // ── ★★★ کنترلِ مثبتِ خودِ ابزار: انبارِ این استک **سخت‌گیر** بود؟ ──
  //
  // ریشه‌ی باگِ زنده این بود که MinIO به هر پاسخی `Access-Control-Allow-Credentials: true`
  // می‌چسباند و آروان نه. اگر این سنجه مستقیم روی MinIO اجرا شود، با همان باگ هم **سبز** می‌مانَد —
  // دقیقاً همان‌طور که از M3 تا M6 سبز مانْد. پس سخت‌گیربودنِ انبار خودش assert می‌شود.
  expect(
    calls.filter((c) => !c.url.startsWith(store)).length,
    "هیچ پاسخی از انبار دیده نشد ⇒ کنترلِ سخت‌گیری پوچ است",
  ).toBeGreaterThan(1);
  expect(
    lenientStorage,
    "⚠️ انبارِ این استک سخت‌گیر نیست (Access-Control-Allow-Credentials می‌دهد — MinIOی مستقیم؟). " +
      "`S3_ENDPOINT`ِ استک باید به `storage-cors-proxy.ts` اشاره کند؛ وگرنه این سنجه ریشه‌ی ۸٫۶ را نمی‌بیند.",
  ).toEqual([]);

  // ── ★★★ شکستنِ عمدی: «صفر خطا» تا وقتی نشان ندهی ابزار خطا را **می‌بیند**، پوچ است ──
  //
  // خواندنِ بایت از انبار را عمداً قطع می‌کنیم. دقیقاً همان چیزی که یک CORSِ بسته یا یک ۴۰۳ی
  // امضا در تولید می‌سازد: `TypeError` داخلِ `resolveBlob`. اگر این پیام **نیاید**، یعنی
  // ادعای بالا هیچ‌وقت چیزی را اثبات نمی‌کرده.
  // ⚠️ روی خودِ `/assets/:id`ِ **هم‌مبدأ** قطع می‌کنیم، نه روی نشانیِ انبار: playwright درخواستِ
  //    **ری‌دایرکت‌شده** را اصلاً به handlerِ route نمی‌دهد، و هاپِ انبار دقیقاً یک ری‌دایرکت است.
  //    (اندازه‌گیری‌شده در ریشه‌یابیِ ۸٫۶: از سه درخواستِ انبار — POST، GET، GET — فقط POST به route
  //    رسید. ⚠️ کامنتِ قبلیِ همین‌جا علت را «کش‌پذیربودنِ پاسخِ انبار» می‌گفت — یک حدسِ اندازه‌نگرفته.)
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
