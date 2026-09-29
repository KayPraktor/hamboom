import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { codeFromLog, compose } from "./compose.ts";

/**
 * P2 روی **باندلِ واقعی، پشتِ nginxِ واقعی** — M6 ردیفِ ۸٫۳.
 *
 * M5 گام ۹٫۳ همین را برای «ورود → بورد → استیکی» سنجید (۲۰ درخواست، همه هم‌مبدأ). چیزی که
 * M6 اضافه کرده **chunkِ پنل** است، و این فایل فقط همان دلتا را می‌سنجد.
 *
 * ⚠️⚠️ **این تست استکِ productionِ محلی را لازم دارد و خودش بالا نمی‌آوردش** — قرینه‌ی
 * [`playwright.server.config.ts`ِ canvas-sync](../../../packages/canvas-sync/playwright.server.config.ts).
 * نبودنش یعنی **شکست**، نه skipِ خاموش. رویه در PROGRESS (ردیفِ ۸٫۳).
 *
 * ⚠️⚠️ **محدودیتی که این‌جا ثبت شده بود، در ردیفِ ۸٫۵ دوباره سنجیده شد و دیگر برقرار نیست.**
 * نوشته بودم «مرورگرِ این sandbox egress ندارد، پس نمی‌شود «تماس نگرفت» را از «شبکه بست»
 * تفکیک کرد». اندازه‌گیریِ دوباره (۱۴۰۵/۰۷/۰۷) خلافش را نشان داد: یک `fetch`ِ عمدی به
 * `https://example.com/` پاسخِ **opaque** با **۹۹۹ms** و یک entryِ واقعی در resource timing داد.
 * ⇒ ابزار **می‌تواند** تماسِ خارجی را ببیند، و اپ هیچ تماسی نمی‌گیرد. کنترلِ مثبتِ دومی هم در
 * ۸٫۵ آمد: روی یک بوردِ واقعی، ۲۳۰ نشانیِ فونتِ `esm.sh` فقط **اعلام** می‌شوند و هیچ‌کدام fetch
 * نمی‌شوند (هر ۲۳۰ با `duration=0` و `transferSize=0`).
 * ⊕ گیتِ دائمیِ [`check-p2.ts`](../../../scripts/check-p2.ts) روی **سورس** سرِ جایش می‌مانَد، و
 * ابزارِ این فایل با یک مبدأِ **قابلِ دسترسِ متفاوت** هم اعتبارسنجی شد (`http://127.0.0.1:15402`
 * گرفته شد و تست قرمز شد).
 *
 * ★★ **و ادعا «صفر رشته‌ی میزبان در باندل» نیست** — آن ادعا غلط است و اندازه‌گیری‌اش هم شد:
 * باندلِ ساخته‌شده ۳۷ میزبانِ غیرِ لوکال **به‌عنوانِ رشته** دارد (namespaceِ XML، متنِ لایسنس،
 * لینکِ مستندات، و قابلیتِ embedِ ویدیوی excalidraw). ادعای واقعیِ P2 این است که مرورگر هنگامِ
 * **استفاده** هیچ‌کدام را صدا نمی‌زند — و آن، دقیقاً همین چیزی است که این‌جا سنجیده می‌شود.
 */

const BASE = process.env.E2E_WEB_URL ?? "http://localhost";

test("★★ chunkِ پنل روی باندلِ واقعی: صفر درخواستِ غیرِ هم‌مبدأ", async ({ page }) => {
  const phone = `0912${String(randomInt(1_000_000, 9_999_999))}`;

  // ── از این لحظه **هر** درخواستِ مرورگر ثبت می‌شود ──
  const origins = new Map<string, number>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "data:" || u.protocol === "blob:") return;
    const key = u.origin;
    origins.set(key, (origins.get(key) ?? 0) + 1);
  });

  await page.goto(`${BASE}/login`);
  await page.getByLabel("شماره‌ی موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد" }).click();
  await page.getByLabel("کد ورود").fill(codeFromLog());
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  // ── staff **بعد از** ورود اعطا می‌شود، و این ترتیب اجباری است ──
  //
  // ⚠️ اگر پیش از ورود از راهِ api یک OTP بگیریم، کول‌داونِ ۶۰ ثانیه‌ای درخواستِ **مرورگر** را
  //    بی‌صدا رد می‌کند و تست در فرمِ ورود گیر می‌کند (دیده شد). پس کلِ چرخه یک OTP می‌گیرد.
  // ⊕ `grant-staff` سرویسِ واقعیِ همین compose است — تنها نویسنده‌ی `is_staff` (ADR-066) — و به
  //    دیتابیسِ **همین استک** می‌زند، نه دیتابیسِ dev.
  // ⚠️⚠️ **فرمِ کامل اجباری است:** ایمیجِ پایه‌ی node آرگومانِ «-»دار را **اسمِ فایل** می‌گیرد
  //    (`node: bad option`) — همان تله‌ای که M5 فاز ۱۰ در چهار خطِ سند پیدایش کرد.
  compose(
    "--profile",
    "ops",
    "run",
    "--rm",
    "grant-staff",
    "node",
    "scripts/admin-grant-staff.ts",
    `--phone=${phone}`,
  );
  // ★ نشست `isStaff` را از `/me` می‌خوانَد، پس یک بارگذاریِ تازه لازم است تا گاردِ پنل باز شود.
  //   ⚠️ و باید **منتظرِ بازسازیِ نشست** ماند: بارگذاریِ سرد توکن را از حافظه می‌بَرد و تا
  //      `/auth/refresh` جواب ندهد، `RequireAuth` کاربر را به `/login` می‌فرستد.
  await page.reload();
  await expect(page.getByRole("button", { name: "خروج" })).toBeVisible({ timeout: 30_000 });

  // ── هر شش بخشِ پنل، با ادعای **سرتیترِ خودش** ──
  //
  // ⚠️⚠️ **ادعای قبلی `getByRole("heading").first()` بود و این تست را کاملاً پوچ کرده بود:**
  //    هر شش بازدید به `/login` ریدایرکت می‌شد و آن ادعا سرتیترِ «ورود به هم‌بوم» را می‌پذیرفت.
  //    نتیجه: «۷۶ درخواست، همه هم‌مبدأ» — درست، ولی درباره‌ی چیزی که هرگز بار نشد. با نامِ
  //    صریحِ هر صفحه، پوچ‌شدنِ دوباره ناممکن است.
  const PAGES: readonly [string, string][] = [
    ["/panel", "پنلِ ادمین"],
    ["/panel/users", "کاربران و تیم‌ها"],
    ["/panel/payments", "پرداخت‌ها"],
    ["/panel/audit", "ممیزی"],
    ["/panel/stats", "آمار"],
    ["/panel/system", "وضعیتِ سیستم"],
  ];
  for (const [path, heading] of PAGES) {
    await page.goto(`${BASE}${path}`);
    await expect(
      page.getByRole("heading", { level: 1, name: new RegExp(heading) }),
      `صفحه‌ی ${path} بار نشد — سرتیترش «${heading}» نیست`,
    ).toBeVisible({ timeout: 30_000 });
  }

  const expected = new URL(BASE).origin;
  const foreign = [...origins.entries()].filter(([o]) => o !== expected);
  // ★ عددها در گزارش می‌آیند تا «صفر» یک ادعای خالی نباشد.
  console.log(
    `مبدأها: ${[...origins.entries()].map(([o, n]) => `${o}×${String(n)}`).join(" · ")}`,
  );
  expect(foreign, `درخواستِ غیرِ هم‌مبدأ: ${JSON.stringify(foreign)}`).toEqual([]);
  expect(origins.get(expected) ?? 0).toBeGreaterThan(10);

  // ── ★★ کنترلِ مثبت — **بعد از** ادعای بالا، چون عمداً یک مبدأ اضافه می‌کند ──
  //
  // «صفر درخواستِ خارجی» تا وقتی نشان ندهی ابزار **می‌توانست** ببیند، یک ادعای پوچ است. این
  // چند خط یک تماسِ خارجیِ عمدی می‌زند و انتظار دارد در همان شمارنده بنشیند. اگر روزی شبکه
  // بسته باشد این ادعا قرمز می‌شود — و **همان درست است**: آن روز این فایل حق ندارد بگوید
  // «اپ تماسِ خارجی نمی‌گیرد»، چون اصلاً نمی‌توانسته ببیند.
  await page.evaluate(() => fetch("https://example.com/", { mode: "no-cors" }).catch(() => null));
  await expect
    .poll(() => origins.has("https://example.com"), { timeout: 20_000 })
    .toBe(true);
});
