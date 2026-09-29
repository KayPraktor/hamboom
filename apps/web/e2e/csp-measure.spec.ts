import { randomInt } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { codeFromLog } from "./compose.ts";
import { writePolicy } from "./csp-proxy.ts";

/**
 * **اندازه‌گیریِ CSP** روی باندلِ واقعی پشتِ nginx — M6 ردیفِ ۸٫۵.
 *
 * ★★ **این ردیف عمداً چیزی را enforce نمی‌کند.** خروجی‌اش یک **سند** است: کدام دایرکتیو بوم را
 * می‌شکند و کدام نه. دلیلِ نبودِ CSP در [`security-headers.conf`](../../../infra/nginx/security-headers.conf)
 * یک **حدس** بود — «استایلِ inline و workerِ blob:». این فایل همان حدس را به عدد تبدیل می‌کند، و
 * ⚠️ نیمی‌اش غلط از آب درآمد (جدول در PROGRESS ردیفِ ۸٫۵).
 *
 * ── روش ────────────────────────────────────────────────────────────────────
 *
 * برای هر پالیسی، پاسخِ **سندِ** ناوبری با `route.fulfill` هدرِ `Content-Security-Policy`
 * می‌گیرد — دقیقاً همان کاری که `add_header`ِ nginx می‌کند. بعد یک بوردِ واقعی باز می‌شود، یک
 * استیکی کشیده می‌شود، و هر `securitypolicyviolation` جمع می‌شود.
 *
 * ⚠️ **تخلف‌ها از رویداد خوانده می‌شوند، نه از متنِ کنسول:** تنها آن رویداد **دایرکتیوِ موثر** را
 * می‌دهد (`style-src-attr` در برابرِ `style-src-elem`) و `sourceFile`/`lineNumber` هم دارد.
 *
 * ⚠️⚠️ و **باندل باید buildِ فعلی باشد** — شرح در [`playwright.csp.config.ts`](../playwright.csp.config.ts).
 */

interface Violation {
  directive: string;
  blocked: string;
  /** ★ بدونِ این، «`script-src ← eval`» یک سرنخ است نه یک یافته — نمی‌گوید **کدام** کد. */
  source: string;
}

interface Metrics {
  canvases: number;
  canvasW: number;
  toolbar: boolean;
  status: string;
}

declare global {
  interface Window {
    __hbCsp?: Violation[];
  }
}

/**
 * ★★ هشِ تنها اسکریپتِ inlineِ `index.html` (تنظیمِ `window.EXCALIDRAW_ASSET_PATH`).
 *
 * خودِ مرورگر این عدد را در پیامِ تخلف می‌دهد. ⚠️ **با هر تغییرِ آن اسکریپت عوض می‌شود** —
 * به همین دلیل پالیسیِ نهایی (اگر روزی enforce شود) بهتر است اسکریپت را به یک فایلِ
 * **جدا** ببرد تا `script-src 'self'` کافی باشد و هیچ هشی لازم نشود.
 */
const INLINE_SCRIPT_HASH = "'sha256-aWIw8EuIkLFe5K5CvT9NnOcctau8jNs3D3dX5yL3wio='";

/** پالیسیِ نامزد — چیزی که اگر روزی enforce شود، همین خواهد بود. */
const CANDIDATE = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SCRIPT_HASH}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** جایگزینیِ یک دایرکتیو در پالیسیِ نامزد — برای شکستن‌های عمدیِ تک‌متغیره. */
const withDirective = (name: string, value: string): string =>
  CANDIDATE.split("; ")
    .map((d) => (d.startsWith(`${name} `) ? `${name} ${value}` : d))
    .join("; ");

const POLICIES: readonly { key: string; policy: string | null }[] = [
  // کنترل — امروز همین است. باید صفر تخلف بدهد، وگرنه ابزار خراب است نه اپ.
  { key: "۰ بدونِ CSP", policy: null },
  // ساده‌ترین پالیسیِ «سخت‌گیرانه» — انتظار: اپ اصلاً بوت نمی‌شود.
  { key: "۱ default-src 'self'", policy: "default-src 'self'" },
  // نامزد **بدونِ** هشِ اسکریپتِ inline — جداکردنِ «تنها بلاک‌کننده‌ی بوت».
  { key: "۲ نامزد − هشِ inline", policy: withDirective("script-src", "'self'") },
  { key: "۳ نامزد", policy: CANDIDATE },
  { key: "۴ نامزد − unsafe-inline", policy: withDirective("style-src", "'self'") },
  { key: "۵ نامزد − data:/blob: تصویر", policy: withDirective("img-src", "'self'") },
  { key: "۶ نامزد − blob: worker", policy: withDirective("worker-src", "'self'") },
  // ★ اعتبارسنجیِ خودِ ابزار: این یکی **باید** بشکند.
  { key: "۷ نامزد − connect-src", policy: withDirective("connect-src", "'none'") },
  // ★★ کنترلِ **پایانی** — بدونِ آن هر تفاوتی با سطرِ ۰ به CSP نسبت داده می‌شود، در حالی که
  //    می‌تواند اثرِ **تکرارِ بازکردنِ بورد** باشد (اتاق، توکنِ rt، backoffِ اتصالِ مجدد).
  { key: "۸ بدونِ CSP (کنترلِ پایانی)", policy: null },
];

/** ورود از فرمِ واقعی؛ کدِ mock از لاگِ کانتینرِ api. */
async function login(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("شماره‌ی موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد" }).click();
  await page.getByLabel("کد ورود").fill(codeFromLog());
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

test("★★ کدام دایرکتیوهای CSP بوم را می‌شکنند — اندازه‌گیری روی باندلِ واقعی", async ({
  page,
}) => {
  // ── جمع‌آوریِ تخلف‌ها: **پیش از** هر اسکریپتِ صفحه، در هر ناوبری ──
  await page.addInitScript(() => {
    window.__hbCsp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__hbCsp?.push({
        directive: e.effectiveDirective || e.violatedDirective,
        blocked: e.blockedURI,
        source: `${e.sourceFile}:${String(e.lineNumber)}`,
      });
    });
  });

  // ★ خطاهای کنسول هم جمع می‌شوند — یک بار همین تفاوتِ «تخلفِ صفر ولی رفتارِ خراب» را روشن کرد.
  let consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Content Security Policy")) {
      // ⚠️ **دُمِ پیام مهم است، نه سرش:** پیامِ شکستِ WebSocket نشانی و توکنِ بلند را اول
      //    می‌آورد و **علت** را آخر — یک `slice(0,160)` دقیقاً همان علت را می‌بُرد (دیده شد).
      const t = m.text();
      consoleErrors.push(t.length > 200 ? `${t.slice(0, 60)} … ${t.slice(-140)}` : t);
    }
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 160)}`));

  const phone = `0912${String(randomInt(1_000_000, 9_999_999))}`;
  await login(page, phone);

  // ── یک بوردِ واقعی می‌سازیم و نشانی‌اش را برمی‌داریم ──
  await page.getByRole("button", { name: "بوردِ جدید" }).click();
  const boardLink = page.locator('a[href^="/b/"]').first();
  await expect(boardLink).toBeVisible({ timeout: 30_000 });
  const boardUrl = (await boardLink.getAttribute("href")) ?? "";
  expect(boardUrl).toMatch(/^\/b\//);

  // ★★ هدرِ **واقعیِ** پاسخِ سند — تنها راهی که «تخلفِ صفر» را از «پالیسی اصلاً نرسید» جدا می‌کند.
  let documentCsp: string | undefined;
  page.on("response", (r) => {
    if (r.request().resourceType() === "document") {
      documentCsp = r.headers()["content-security-policy"];
    }
  });

  const rows: { key: string; m: Metrics; v: string; n: number }[] = [];

  for (const { key, policy } of POLICIES) {
    // ★★ پالیسی را **سرورِ واقعی** می‌گذارد، نه `route.fulfill` — دلیلش (و سبزِ دروغینی که
    //    ساخته بود) در [`csp-proxy.ts`](./csp-proxy.ts) نوشته شده.
    writePolicy(policy);
    consoleErrors = [];
    documentCsp = undefined;
    await page.goto(boardUrl);
    expect(documentCsp, `پالیسیِ «${key}» روی پاسخِ سند ننشست — ابزار خراب است، نه اپ`).toBe(
      policy ?? undefined,
    );

    let canvasOk = true;
    try {
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("toolbar", { name: "ابزارها" })).toBeVisible({ timeout: 20_000 });
    } catch {
      canvasOk = false;
    }

    if (canvasOk) {
      // یک ژستِ واقعی: استیکی (میان‌بُرِ `n`) روی بوم — تا مسیرِ فونت/متن/همگام‌سازی هم اجرا شود.
      //
      // ⚠️ **با `locator("canvas").click()` کار نمی‌کند:** excalidraw سه بومِ روی‌هم دارد و
      //    `.first()` زیرین را می‌گیرد؛ playwright تا ابد «بومِ `interactive` رویدادِ اشاره‌گر را
      //    می‌گیرد» می‌گوید و تایم‌اوت می‌شود (دیده شد). ماوسِ خام همان کارِ کاربر را می‌کند.
      await page.mouse.click(700, 450);
      await page.keyboard.press("n");
      await page.mouse.click(700, 450);
      await page.keyboard.type("سلام");
      await page.keyboard.press("Escape");
      // ★ و یک بارگذاریِ **اجباریِ** فونت: فونت‌ها تنبل‌اند، پس بدونِ این، «font-src سالم است»
      //   یعنی «هیچ فونتی خواسته نشد» — یک سبزِ دروغینِ تمام‌عیار.
      await page
        .evaluate(async () => {
          await document.fonts.load("20px Excalifont", "AB");
          await document.fonts.load("20px Virgil", "AB");
        })
        .catch(() => undefined);
    }

    // ★ وضعیتِ اتصال یک **انتظار** است نه یک عکسِ فوری: هر بارگذاری از نو وصل می‌شود و اگر
    //   همان لحظه بخوانی «اتصالِ مجدد…» می‌گیری و آن را اشتباهاً به CSP نسبت می‌دهی (دیده شد).
    if (canvasOk) {
      await page
        .locator(".board-chrome__status-text")
        .filter({ hasNotText: /اتصال/ })
        .first()
        .waitFor({ timeout: 25_000 })
        .catch(() => undefined);
    }

    // فرصتِ رسیدنِ تخلف‌های ناهمگام (فونت، worker، تصویر) پیش از خواندن.
    await page.waitForTimeout(2_000);

    const metrics: Metrics = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      return {
        canvases: document.querySelectorAll("canvas").length,
        canvasW: c instanceof HTMLCanvasElement ? c.width : 0,
        toolbar: document.querySelector('[aria-label="ابزارها"]') !== null,
        status: document.querySelector(".board-chrome__status-text")?.textContent ?? "(بی‌متن)",
      };
    });
    const violations = (await page.evaluate(() => window.__hbCsp ?? [])) as Violation[];

    const grouped = new Map<string, { n: number; blocked: Set<string>; src: string }>();
    for (const v of violations) {
      const g = grouped.get(v.directive) ?? { n: 0, blocked: new Set<string>(), src: v.source };
      g.n += 1;
      g.blocked.add((v.blocked || "(inline)").split("/").pop()?.slice(0, 28) ?? "");
      grouped.set(v.directive, g);
    }
    const summary =
      grouped.size === 0
        ? "صفر"
        : [...grouped.entries()]
            .map(([d, g]) => `${d}×${String(g.n)}←{${[...g.blocked].slice(0, 2).join(",")}}`)
            .join(" · ");

    rows.push({ key, m: metrics, v: summary, n: violations.length });
    console.log(
      `${key.padEnd(24)} | بوم=${metrics.canvases}/${metrics.toolbar ? "نوار✓" : "نوار✗"} | ${metrics.status.padEnd(14)} | تخلف=${String(violations.length)} | ${summary}`,
    );
    for (const [d, g] of grouped) console.log(`      ↳ ${d} @ ${g.src}`);
    for (const e of [...new Set(consoleErrors)].slice(0, 5)) console.log(`      ⚠ ${e}`);
  }

  console.log("\n— جدولِ ۸٫۵ (برای PROGRESS) —");
  for (const r of rows) {
    console.log(
      `| ${r.key} | ${r.m.canvases > 0 && r.m.toolbar ? "✓" : "✗"} | ${r.m.status} | ${String(r.n)} | ${r.v} |`,
    );
  }

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const row = (k: string) => {
    const r = byKey.get(k);
    if (r === undefined) throw new Error(`سطرِ «${k}» اندازه‌گیری نشد`);
    return r;
  };

  // ── کنترل: بدونِ CSP هیچ تخلفی ممکن نیست، و بوم باید کار کند ──
  expect(row("۰ بدونِ CSP").v, "بدونِ CSP نباید تخلفی باشد").toBe("صفر");
  expect(row("۰ بدونِ CSP").m.toolbar, "بدونِ CSP نوارِ ابزار باید بیاید").toBe(true);

  // ── ★ اعتبارسنجیِ خودِ ابزار: یک شکستنِ عمدی که **باید** تخلف بدهد ──
  //    بدونِ این، «تخلفِ صفر» در سطرهای دیگر می‌تواند یعنی «رویداد اصلاً شنیده نمی‌شود».
  expect(row("۷ نامزد − connect-src").v, "با connect-src 'none' حتماً باید تخلف ببینیم").toMatch(
    /connect-src/,
  );

  // ── ★★ تنها چیزی که بوت را می‌شکند: اسکریپتِ inlineِ index.html ──
  expect(row("۲ نامزد − هشِ inline").v, "بدونِ هش، اسکریپتِ inline باید بلاک شود").toMatch(
    /script-src-elem/,
  );
  expect(row("۲ نامزد − هشِ inline").m.toolbar, "بدونِ هش، اپ اصلاً بالا نمی‌آید").toBe(false);

  // ── ★★ پالیسیِ نامزد بوم را نمی‌شکند ──
  expect(row("۳ نامزد").m.toolbar, "با پالیسیِ نامزد نوارِ ابزار باید بیاید").toBe(true);
  expect(row("۳ نامزد").m.canvases, "با پالیسیِ نامزد بومِ excalidraw باید رندر شود").toBeGreaterThan(
    0,
  );
  // ★★ ادعای وب‌سوکت **نسبی** است، نه مطلق: با کنترلِ پایانی مقایسه می‌شود. اگر هر دو یک وضعیت
  //    داشته باشند، هرچه دیده می‌شود اثرِ **تکرارِ بازکردن** است نه CSP — و همین یک بار جلوی یک
  //    نتیجه‌گیریِ غلط را گرفت (سطرِ ۰ وصل بود، سطرهای ۳–۶ «اتصالِ مجدد»).
  expect(
    row("۳ نامزد").m.status,
    "وضعیتِ اتصال با پالیسیِ نامزد باید همان کنترلِ پایانی باشد — وگرنه connect-src مقصر است",
  ).toBe(row("۸ بدونِ CSP (کنترلِ پایانی)").m.status);
  expect(row("۳ نامزد").v, "با پالیسیِ نامزد نباید تخلفِ style/img/worker/connect باشد").not.toMatch(
    /style-src|img-src|worker-src|connect-src|script-src-elem/,
  );

  // ── ★★ دو ادعای مستندِ قدیمی که این اندازه‌گیری **باطل** کرد ──
  //    اگر روزی واقعاً لازم شوند، همین دو assert قرمز می‌شوند و سند به‌روز می‌شود.
  expect(
    row("۴ نامزد − unsafe-inline").v,
    "ادعای «بوم استایلِ inline می‌خواهد» — امروز غلط است (React با CSSOM می‌نویسد، نه صفتِ style)",
  ).not.toMatch(/style-src/);
  expect(row("۴ نامزد − unsafe-inline").m.toolbar, "بدونِ unsafe-inline هم بوم می‌آید").toBe(true);
  expect(
    row("۶ نامزد − blob: worker").v,
    "ادعای «بوم workerِ blob: می‌خواهد» — در این مسیرها هیچ workerی ساخته نشد",
  ).not.toMatch(/worker-src/);

  // ── ★ و یک چیزی که **واقعاً** لازم است ──
  expect(row("۵ نامزد − data:/blob: تصویر").v, "آیکون‌های excalidraw data:URI اند").toMatch(
    /img-src/,
  );
});
