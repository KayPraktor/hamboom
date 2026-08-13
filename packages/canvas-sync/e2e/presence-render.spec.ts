import { expect, test } from "@playwright/test";

import { handProject, pointAt, projectionOf, sample, settleViewport } from "./pair-helpers";

/**
 * ★★ گام ۳٫۷ — **G-1الف**: دو بومِ واقعی، حضورِ رندرشده، بدونِ سرور.
 *
 * ── چرا این گپ از M1 باز مانده بود ────────────────────────────────────
 *
 * M1 قرارداد و کامپوننت‌های حضور را ساخت، ولی binder نداشت: `applyPeers` را
 * هیچ‌کس صدا نمی‌زد. حضورِ دموی M1 از یک `BroadcastChannel`ِ **دوم** می‌آمد، نه
 * از دو موتورِ واقعی. حالا آداپتور هست، پس این تست بالاخره نوشتنی است.
 *
 * ── ★ روشِ سنجش: پروجکشنِ دست‌محاسبه ───────────────────────────────────
 *
 * مقدارِ انتظار **از خودِ `sceneToOverlayPixel` گرفته نمی‌شود** — وگرنه تست فقط
 * می‌گفت «کد با خودش سازگار است». به‌جایش همان ریاضی مستقل بازنویسی می‌شود:
 *
 *     pixel = (scene + scroll) × zoom + canvasOffset − overlayOrigin
 *
 * همان روشی که در M1 باگِ **panِ خالص** را بیرون کشید — و همین‌جا هم **باگِ B-1**
 * را گرفت (دو تستِ آخر).
 *
 * ⚠️ **دو لایه‌ی ادعا، عمداً جدا:**
 *
 * | تست‌ها | چه چیزی را می‌سنجند | صاحبش |
 * |---|---|---|
 * | بیشترشان | `transform` — یعنی خودِ **پروجکشن** و دوباره-پروجکت‌کردن | M2 |
 * | دو تستِ آخر (`نگهبانِ B-1`) | **پیکسلِ نهایی** روی صفحه | CSSِ M1 |
 *
 * بدونِ این تفکیک، شکستنِ CSSِ حضور همه‌ی تست‌ها را قرمز می‌کرد و پیدا کردنِ علت
 * سخت می‌شد. با آن، هر خرابی مستقیم می‌گوید کدام لایه شکسته است.
 */

const PAIR = "/#pair";

/** نقطه‌ای در صحنه که تست‌ها از آن استفاده می‌کنند. */
const PEER_POINT = { x: 220, y: 140 };

test.beforeEach(async ({ page }) => {
  await page.goto(PAIR);
  await expect(page.locator('[data-pane="a"] [data-action="add"]')).toBeEnabled();
  await expect(page.locator('[data-pane="b"] [data-action="add"]')).toBeEnabled();
});

test("★★ مکان‌نمای الف روی بومِ ب رندر می‌شود — دقیقاً روی پروجکشنِ دست‌محاسبه", async ({
  page,
}) => {
  await pointAt(page, PEER_POINT);

  const cursor = page.locator('[data-pane="b"] .hb-peer-cursor');
  await expect(cursor).toHaveCount(1);
  await expect(cursor).toContainText("کاربر الف");
  // و روی بومِ خودِ الف چیزی رندر نمی‌شود — فهرستِ همتاها خودمان را ندارد.
  await expect(page.locator('[data-pane="a"] .hb-peer-cursor')).toHaveCount(0);

  const { projection, translate } = await sample(page, "b", ".hb-peer-cursor");
  const expected = handProject(PEER_POINT, projection);

  expect(translate.x).toBeCloseTo(expected.x, 0);
  expect(translate.y).toBeCloseTo(expected.y, 0);
});

test("★★ panِ خالصِ ب مکان‌نما را دوباره پروجکت می‌کند — باگِ Q1", async ({ page }) => {
  // ⚠️ **چرخِ واقعیِ ماوس، نه `updateScene` برنامه‌ای.** `updateScene` اصلاً
  // `onScrollChange` نمی‌دهد، پس با آن، پیاده‌سازیِ **درست** هم دوباره پروجکت
  // نمی‌کرد و تست بی‌معنا می‌شد. این همان تفاوتی است که باگِ Q1 را ساخت.
  await pointAt(page, PEER_POINT);
  await expect(page.locator('[data-pane="b"] .hb-peer-cursor')).toHaveCount(1);

  const before = await sample(page, "b", ".hb-peer-cursor");

  const canvas = page.locator('[data-pane="b"] .excalidraw-container');
  await canvas.hover({ position: { x: 150, y: 150 } });
  await page.mouse.wheel(60, 90);
  await expect
    .poll(async () => (await projectionOf(page, "b")).viewport.scrollY)
    .not.toBe(before.projection.viewport.scrollY);

  const after = await sample(page, "b", ".hb-peer-cursor");
  // zoom دست نخورده — این یک panِ **خالص** است.
  expect(after.projection.viewport.zoom).toBe(before.projection.viewport.zoom);

  const expected = handProject(PEER_POINT, after.projection);
  expect(after.translate.x).toBeCloseTo(expected.x, 0);
  expect(after.translate.y).toBeCloseTo(expected.y, 0);

  // ★ و واقعاً تکان خورده — وگرنه یک لایه‌ی یخ‌زده هم این تست را پاس می‌کرد.
  expect(Math.abs(after.translate.y - before.translate.y)).toBeGreaterThan(10);
});

test("★★ zoomِ ب هم دوباره پروجکت می‌کند", async ({ page }) => {
  await pointAt(page, PEER_POINT);
  await expect(page.locator('[data-pane="b"] .hb-peer-cursor')).toHaveCount(1);

  const before = await projectionOf(page, "b");
  const canvas = page.locator('[data-pane="b"] .excalidraw-container');
  await canvas.hover({ position: { x: 150, y: 150 } });
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");

  await expect
    .poll(async () => (await projectionOf(page, "b")).viewport.zoom)
    .not.toBe(before.viewport.zoom);

  const { projection, translate } = await sample(page, "b", ".hb-peer-cursor");
  const expected = handProject(PEER_POINT, projection);
  expect(translate.x).toBeCloseTo(expected.x, 0);
  expect(translate.y).toBeCloseTo(expected.y, 0);
});

test("★ هاله‌ی انتخابِ الف دورِ همان عنصر در ب کشیده می‌شود", async ({ page }) => {
  await page.locator('[data-pane="a"] [data-action="add"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__hbPair!.b!.api.getSceneElements().length))
    .toBe(2);

  // ⚠️ **انتخاب با کلیکِ واقعی، نه با `emitSelection`ِ تزریقی.**
  //
  // نسخه‌ی اول شناسه را مستقیم emit می‌کرد و ۱ در ۳ اجرا می‌افتاد: خودِ پنلِ الف
  // هم روی `onChange` انتخاب را پخش می‌کند، و `onChange`ِ دیرهنگامِ بعد از ساخت،
  // مقدارِ تزریقی را با یک آرایه‌ی **خالی** بازمی‌نوشت. با کلیکِ واقعی فقط **یک**
  // منبع در کار است — همان مسیری که کاربر هم می‌رود.
  await page
    .locator('[data-pane="a"] .excalidraw-container')
    .click({ position: { x: 170, y: 170 } });

  await expect(page.locator('[data-pane="b"] .hb-peer-halo')).toHaveCount(1);

  // هندسه‌ی همان عنصری که واقعاً انتخاب شد (نه فرضِ «عنصرِ اول»).
  const target = await page.evaluate(() => {
    const api = window.__hbPair!.a!.api;
    const [id] = Object.keys(api.getAppState().selectedElementIds ?? {});
    const element = api.getSceneElements().find((item) => item.id === id)!;
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  });

  const { projection, translate } = await sample(page, "b", ".hb-peer-halo");
  const expected = handProject(target, projection);
  expect(translate.x).toBeCloseTo(expected.x, 0);
  expect(translate.y).toBeCloseTo(expected.y, 0);

  // اندازه‌ی هاله هم از **همان** پروجکشن می‌آید (گوشه تا گوشه).
  const corner = handProject(
    { x: target.x + target.width, y: target.y + target.height },
    projection,
  );
  const size = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('[data-pane="b"] .hb-peer-halo')!);
    return { width: parseFloat(style.inlineSize), height: parseFloat(style.blockSize) };
  });
  expect(size.width).toBeCloseTo(corner.x - expected.x, 0);
  expect(size.height).toBeCloseTo(corner.y - expected.y, 0);
});

test("★★ دنبال‌کردن: نمای ب دقیقاً روی مکان‌نمای الف می‌نشیند", async ({ page }) => {
  // نمای دو پنل **مستقل** است؛ اگر follow فقط scroll را کپی می‌کرد، با zoomِ
  // متفاوت روی نقطه‌ی اشتباه می‌نشست. پس اول zoomِ ب را عوض می‌کنیم.
  await pointAt(page, PEER_POINT);
  await expect(page.locator('[data-pane="b"] .hb-peer-cursor')).toHaveCount(1);

  const canvas = page.locator('[data-pane="b"] .excalidraw-container');
  await canvas.hover({ position: { x: 150, y: 150 } });
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await projectionOf(page, "b")).viewport.zoom).not.toBe(1);
  await settleViewport(page, "b");

  const clientId = await page.evaluate(() => window.__hbPair!.b!.peers()[0]!.clientId);
  await page.evaluate((id) => window.__hbPair!.b!.follow(id), clientId);

  const size = await page.evaluate(() => {
    const state = window.__hbPair!.b!.api.getAppState();
    return { width: state.width, height: state.height };
  });
  const { projection, translate } = await sample(page, "b", ".hb-peer-cursor");

  // ★ همان پروجکشنِ دست‌محاسبه، **و** آن نقطه واقعاً وسطِ بوم است.
  const expected = handProject(PEER_POINT, projection);
  expect(translate.x).toBeCloseTo(expected.x, 0);
  expect(translate.y).toBeCloseTo(expected.y, 0);
  expect(translate.x).toBeCloseTo(size.width / 2, -1);
  expect(translate.y).toBeCloseTo(size.height / 2, -1);
});

test("★ sync دو-نمونه‌ای با بومِ واقعی — و ب دوباره emit نمی‌کند", async ({ page }) => {
  // ⚠️ نگهبانِ echo واقعی **خطا پرتاب می‌کند** (`EchoLoopError`)؛ پس به‌جای
  // شمردنِ فراخوانی‌ها، به خطای صفحه گوش می‌دهیم — اگر ب تغییرِ رسیده را دوباره
  // emit کند، همان‌جا می‌ترکد.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.locator('[data-pane="a"] [data-action="add"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__hbPair!.b!.api.getSceneElements().length))
    .toBe(2);

  await page.locator('[data-pane="b"] [data-action="add"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__hbPair!.a!.api.getSceneElements().length))
    .toBe(4);

  expect(errors).toEqual([]);
});

/**
 * ★★★ **نگهبانِ B-1 — پیکسلِ واقعی روی صفحه، نه فقط `transform`.**
 *
 * ⚠️ این تست تا رفعِ B-1 وضعیتِ **غلط** را پین می‌کرد و با آن رفع **قرمز شد** —
 * همان‌طور که قرار بود. حالا ادعای درست را نگه می‌دارد.
 *
 * **باگی که گرفت:** `transform` همیشه درست بود، ولی مبدأ با
 * `inset-inline-start: 0` تعیین می‌شد و در سندِ `dir="rtl"` به `right: 0`
 * ترجمه می‌شد. سنجیده: `transform.x = 220` و `left`ِ واقعی **۷۷۹٫۴** (لایه
 * ۶۳۵px) — یعنی به اندازه‌ی کلِ عرضِ بوم پرت. محورِ y همیشه سالم بود.
 *
 * ★ رفع در [`peer-cursors.css`](../../canvas-core/src/ui/peer-cursors.css):
 * لایه‌ی حضور **فضای مختصاتِ بوم** است، پس `direction: ltr` — همان استثنایی که
 * گیتِ Stylelintِ ADR-016 برای بوم گذاشته. `left`ِ خام آنجا ممنوع است.
 *
 * ⚠️ **چرا این ادعا جدا از بقیه است:** تست‌های بالا `transform` را می‌سنجند
 * (خروجیِ M2)؛ این یکی جای‌گیریِ **نهایی** را می‌سنجد (کارِ CSSِ M1). اگر روزی
 * کسی آن `direction` را بردارد، فقط همین قرمز می‌شود و مستقیم می‌گوید کجا.
 */
test("★★★ نگهبانِ B-1: پیکسلِ واقعیِ حضور = پروجکشنِ دست‌محاسبه (در RTL هم)", async ({ page }) => {
  await pointAt(page, PEER_POINT);
  await expect(page.locator('[data-pane="b"] .hb-peer-cursor')).toHaveCount(1);

  const measured = await page.evaluate(() => {
    const root = document.querySelector('[data-pane="b"]')!;
    const layer = root.querySelector(".hb-peer-cursors")!;
    const layerBox = layer.getBoundingClientRect();
    const cursor = root.querySelector(".hb-peer-cursor")! as HTMLElement;
    const box = cursor.getBoundingClientRect();
    const label = root.querySelector(".hb-peer-label")!;
    return {
      documentDirection: getComputedStyle(document.documentElement).direction,
      layerDirection: getComputedStyle(layer).direction,
      labelDirection: getComputedStyle(label).direction,
      offsetLeft: box.left - layerBox.left,
      offsetTop: box.top - layerBox.top,
      projection: window.__hbPair!.b!.projection(),
    };
  });

  // سند همچنان RTL است — رفع، سراسری نبوده.
  expect(measured.documentDirection).toBe("rtl");
  expect(measured.layerDirection).toBe("ltr");
  // ★ و متنِ نامِ کاربر همچنان RTL می‌مانَد (P6) — لایه LTR شد، نه متن.
  expect(measured.labelDirection).toBe("rtl");

  // ★★ ادعای اصلی: پیکسلِ **واقعی** روی صفحه = پروجکشنِ دست‌محاسبه.
  const expected = handProject(PEER_POINT, measured.projection);
  expect(measured.offsetLeft).toBeCloseTo(expected.x, 0);
  expect(measured.offsetTop).toBeCloseTo(expected.y, 0);
});

test("★★★ نگهبانِ B-1 — همان ادعا برای هاله‌ی انتخاب", async ({ page }) => {
  await page.locator('[data-pane="a"] [data-action="add"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__hbPair!.b!.api.getSceneElements().length))
    .toBe(2);
  await page
    .locator('[data-pane="a"] .excalidraw-container')
    .click({ position: { x: 170, y: 170 } });
  await expect(page.locator('[data-pane="b"] .hb-peer-halo')).toHaveCount(1);

  const measured = await page.evaluate(() => {
    const root = document.querySelector('[data-pane="b"]')!;
    const layer = root.querySelector(".hb-peer-selections")!;
    const layerBox = layer.getBoundingClientRect();
    const box = root.querySelector(".hb-peer-halo")!.getBoundingClientRect();
    const api = window.__hbPair!.a!.api;
    const [id] = Object.keys(api.getAppState().selectedElementIds ?? {});
    const element = api.getSceneElements().find((item) => item.id === id)!;
    return {
      layerDirection: getComputedStyle(layer).direction,
      offsetLeft: box.left - layerBox.left,
      offsetTop: box.top - layerBox.top,
      target: { x: element.x, y: element.y },
      projection: window.__hbPair!.b!.projection(),
    };
  });

  expect(measured.layerDirection).toBe("ltr");
  const expected = handProject(measured.target, measured.projection);
  // ★ ۲ پیکسل ضخامتِ خودِ قاب است (`border: 2px`) — مرزِ بیرونیِ جعبه.
  expect(measured.offsetLeft).toBeCloseTo(expected.x, -0.5);
  expect(measured.offsetTop).toBeCloseTo(expected.y, -0.5);
});
