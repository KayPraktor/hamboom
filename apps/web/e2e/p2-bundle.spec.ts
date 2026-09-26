import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

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
 * ⚠️⚠️ **محدودیتِ این محیط، صریح:** مرورگرِ این sandbox **egress ندارد** و درخواست به یک
 * میزبانِ واقعاً خارجی حتی رویدادِ `request` هم تولید نمی‌کند (آزموده شد). پس این probe به‌تنهایی
 * نمی‌تواند «اپ هیچ تماسی نمی‌گیرد» را از «شبکه همه را می‌بندد» تفکیک کند — برای میزبانِ
 * **غیرقابلِ‌دسترس**. ⇒ گیتِ دائمیِ [`check-p2.ts`](../../../scripts/check-p2.ts) روی **سورس** جای
 * این شکاف را پر می‌کند، و ابزارِ این فایل با یک مبدأِ **قابلِ دسترسِ متفاوت** اعتبارسنجی شد
 * (`http://127.0.0.1:15402` گرفته شد و تست قرمز شد) — یعنی خودِ سنجه کور نیست، فقط شبکه است.
 *
 * ★★ **و ادعا «صفر رشته‌ی میزبان در باندل» نیست** — آن ادعا غلط است و اندازه‌گیری‌اش هم شد:
 * باندلِ ساخته‌شده ۳۷ میزبانِ غیرِ لوکال **به‌عنوانِ رشته** دارد (namespaceِ XML، متنِ لایسنس،
 * لینکِ مستندات، و قابلیتِ embedِ ویدیوی excalidraw). ادعای واقعیِ P2 این است که مرورگر هنگامِ
 * **استفاده** هیچ‌کدام را صدا نمی‌زند — و آن، دقیقاً همین چیزی است که این‌جا سنجیده می‌شود.
 */

const BASE = process.env.E2E_WEB_URL ?? "http://localhost";
const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? "hamboom-p2";
// ⚠️ `compose run` هم `--env-file` می‌خواهد، نه فقط `up` — وگرنه همه‌ی متغیرها خالی می‌روند
//    و اسکریپت با یک خطای مبهم می‌افتد (دیده شد).
const ENV_FILE = process.env.E2E_COMPOSE_ENV_FILE;
const COMPOSE = [
  "-f",
  "infra/docker/docker-compose.prod.yml",
  ...(ENV_FILE === undefined ? [] : ["--env-file", ENV_FILE]),
  "-p",
  PROJECT,
];
const ROOT = new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const compose = (...args: string[]): string =>
  execFileSync("docker", ["compose", ...COMPOSE, ...args], { cwd: ROOT, encoding: "utf8" });

/**
 * ★★ کدِ ورود از **لاگِ providerِ mock** خوانده می‌شود، نه از `OTP_DEV_FIXED_CODE`.
 *
 * ⚠️ دلیلش یک واقعیتِ ثبت‌شده است: compose متغیرهای **dev-only** را به کانتینر نمی‌دهد و
 * گاردِ بوتِ production هم وجودشان را تخلف می‌شمارد (M5 فاز ۴). پس در یک استکِ production-mode
 * کدِ ثابت وجود ندارد — و چاپِ کد در لاگ **فقط** خاصیتِ `mock` است (P7)، همان چیزی که
 * `SMS_PROVIDER=smsir` آن را هم می‌بندد.
 */
const codeFromLog = (): string => {
  const log = compose("logs", "--tail=80", "api");
  const hits = [...log.matchAll(/کدِ ورود (\d{6})/g)];
  const last = hits.at(-1);
  if (last === undefined) throw new Error("کدِ mock در لاگِ api پیدا نشد");
  return last[1]!;
};

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
});
