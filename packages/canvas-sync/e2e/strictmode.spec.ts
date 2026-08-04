import { expect, test, type Page } from "@playwright/test";

/**
 * ★ probeِ گام ۱٫۱ — اشتراکِ رویدادهای موتور زیر `<StrictMode>`.
 * [ADR-028](../../../ARCHITECTURE_DECISIONS.md#adr-028) →
 * [ADR-032](../../../ARCHITECTURE_DECISIONS.md#adr-032)
 *
 * ── چرا این دروازه‌ی فاز ۳ است ────────────────────────────────────────
 *
 * binderِ M2 دقیقاً همان کاری را می‌کند که در M1 شکست: به `onChange` مشترک می‌شود
 * تا تغییرِ محلی را بگیرد. اگر آن اشتراک زیر StrictMode مرده بمانَد، binder
 * **بی‌صدا هیچ‌چیز emit نمی‌کند** — هیچ خطایی نمی‌دهد، فقط «همکاری کار نمی‌کند».
 *
 * ── طراحیِ آزمایش ─────────────────────────────────────────────────────
 *
 * اعدادِ readout از **state ری‌اکت** می‌آیند. ولی readout به‌تنهایی مبهم است: صفر
 * ماندنش هم می‌تواند «اشتراک مرده» باشد و هم «تعاملِ تست چیزی نکشید».
 * پس یک **شاهدِ کنترل** داریم: `window.__hbProbeApi` حالتِ موتور را مستقل از
 * ری‌اکت می‌دهد. اول ثابت می‌کنیم موتور عنصر دارد، بعد می‌پرسیم ری‌اکت خبردار شد.
 * (اجرای اولِ همین probe بدونِ این شاهد گمراه شد و نزدیک بود یک باگِ تست به‌عنوان
 * یافته‌ی معماری گزارش شود.)
 */

async function waitForCanvas(page: Page) {
  await page.waitForSelector(".excalidraw-container", { timeout: 30_000 });
  await page.waitForSelector("canvas.excalidraw__canvas", { timeout: 30_000 });
  await page.waitForFunction(() => window.__hbProbeApi !== undefined, { timeout: 30_000 });
}

/** آنچه **ری‌اکت** می‌داند. */
async function fromReact(page: Page) {
  const el = page.getByTestId("readout");
  return {
    changes: Number(await el.getAttribute("data-changes")),
    selected: Number(await el.getAttribute("data-selected")),
    elements: Number(await el.getAttribute("data-elements")),
    apiReady: (await el.getAttribute("data-api-ready")) === "yes",
  };
}

/** آنچه **موتور** می‌داند — شاهدِ کنترل، بدونِ عبور از ری‌اکت. */
async function fromEngine(page: Page) {
  return page.evaluate(() => {
    const api = window.__hbProbeApi;
    if (!api) return { elements: -1, selected: -1, tool: "none" };
    const state = api.getAppState();
    return {
      elements: api.getSceneElements().length,
      selected: Object.keys(state.selectedElementIds ?? {}).length,
      tool: state.activeTool?.type ?? "unknown",
    };
  });
}

/**
 * کشیدنِ یک مستطیل با ابزارِ خودِ موتور.
 *
 * ⚠️ تله‌ی ثبت‌شده‌ی M1: موتور صفحه‌کلید را روی کانتینرِ خودش گوش می‌دهد، نه
 * `document`. بدونِ focusِ صریح، `KeyR` به ابزار نمی‌رسد و درگ به‌جای شکل یک
 * **کادرِ انتخاب** می‌کشد — که onChange می‌دهد ولی عنصری نمی‌سازد. اجرای اولِ این
 * probe دقیقاً به همین خورد.
 */
async function drawRectangle(page: Page, x: number, y: number) {
  await page.locator(".excalidraw-container").focus();
  await page.keyboard.press("KeyR");
  await expect.poll(async () => (await fromEngine(page)).tool).toBe("rectangle");

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 90, { steps: 8 });
  await page.mouse.up();
}

/**
 * ★ الگوی تاییدشده — **این همان چیزی است که binder در فاز ۳ باید به کار ببرد.**
 *
 * اگر روزی این تست قرمز شود، یعنی binder دیگر تغییراتِ محلی را نمی‌بیند و
 * همکاری بی‌صدا از کار افتاده است.
 */
test("الگوی effect زیر StrictMode زنده می‌مانَد (نگهبانِ binder)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/#effect");
  await waitForCanvas(page);
  await expect.poll(async () => (await fromReact(page)).apiReady, { timeout: 15_000 }).toBe(true);

  // ── شاهدِ کنترل: تعامل واقعاً کار کرد؟ ──────────────────────────────
  await drawRectangle(page, 500, 300);
  const engine = await fromEngine(page);
  expect(engine.elements, "موتور بعد از درگ عنصری ندارد — ایرادِ تعاملِ تست است، نه الگو").toBe(1);
  expect(engine.selected, "شکلِ تازه باید انتخاب‌شده باشد").toBe(1);

  // ── ادعای اصلی: ری‌اکت همان را دید؟ ────────────────────────────────
  await expect
    .poll(async () => (await fromReact(page)).changes, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => (await fromReact(page)).elements, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await fromReact(page)).selected, { timeout: 10_000 }).toBe(1);

  // ── و **تغییرِ** انتخاب را هم دنبال می‌کند، نه فقط یک‌بار درست شد ──
  //    شکستِ M1 دقیقاً همین بود: پنل با هیچ انتخابِ بعدی به‌روز نمی‌شد.
  await drawRectangle(page, 800, 300);
  await page.locator(".excalidraw-container").focus();
  await page.keyboard.press("Control+KeyA");

  await expect.poll(async () => (await fromEngine(page)).selected).toBe(2);
  await expect.poll(async () => (await fromReact(page)).selected, { timeout: 10_000 }).toBe(2);

  expect(errors, `خطای کنسول: ${errors.join(" | ")}`).toEqual([]);
});

/**
 * ★ الگوی معیوب — **این تست عمداً ثابت می‌کند که هنوز خراب است.**
 *
 * چرا یک تست برای چیزی که کار نمی‌کند: ADR-028 مکانیزم را «محتمل» توصیف کرده بود.
 * حالا بازتولیدِ قطعی داریم. دو فایده:
 *
 * ۱. **مستندسازیِ اجرایی** — هرکس بعداً وسوسه شد اشتراک را در `onReady` ببندد
 *    (طبیعی‌ترین کار در نگاه اول)، این تست می‌گوید چرا نباید.
 * ۲. **آشکارسازِ رفعِ بالادست** — اگر نسخه‌ی بعدیِ Excalidraw این را درست کند،
 *    **این تست قرمز می‌شود** و ما می‌فهمیم که فرضِ ADR-032 دیگر لازم نیست.
 *    یک تستِ سبزِ همیشگی این را هرگز به ما نمی‌گفت.
 */
test("الگوی onReady زیر StrictMode هنوز مرده است (ناسازگاریِ ثبت‌شده)", async ({ page }) => {
  await page.goto("/#onready");
  await waitForCanvas(page);

  await drawRectangle(page, 500, 300);

  // موتور کاملاً درست کار می‌کند …
  const engine = await fromEngine(page);
  expect(engine.elements, "شاهدِ کنترل: موتور باید عنصر ساخته باشد").toBe(1);
  expect(engine.selected).toBe(1);

  // … ولی هیچ‌کدام از این‌ها به ری‌اکت نمی‌رسد. فرصتِ کافی می‌دهیم تا «کند بودن»
  // با «مرده بودن» اشتباه نشود.
  await page.waitForTimeout(2_000);
  const react = await fromReact(page);
  expect(react.changes, "اگر این عدد > ۰ شده، یعنی بالادست رفع شده — ADR-032 را بازبینی کن").toBe(
    0,
  );
  expect(react.selected).toBe(0);
  expect(react.elements).toBe(0);
});
