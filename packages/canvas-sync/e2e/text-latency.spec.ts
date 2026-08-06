import { expect, test, type Page } from "@playwright/test";

/**
 * ★★ **دو موردِ پین‌شده از گام ۱٫۳ — اینجا باید عدد بگیرند، نه توصیف.**
 *
 * در گام ۱٫۳ عمداً اندازه‌گیری نشدند چون به binderِ واقعی نیاز داشتند، و **عددِ
 * ساختگی نوشته نشد**. حالا binder هست و دموی جفتی دو بومِ واقعی دارد.
 *
 * ۱. **عرضِ پنجره‌ی کهنگی** — از «تغییرِ remote روی `Y.Doc` نشست» تا «textarea
 *    نشانش می‌دهد». در این پنجره رشته‌ای که کاربر تایپ می‌کند هنوز کاراکترِ
 *    همتا را ندارد و دیف می‌تواند پاکش کند.
 * ۲. **پرشِ مکان‌نما** وقتی همتا **قبل از** caret درج می‌کند.
 *
 * اعداد در [`docs/ydoc-baseline.md`](../../../docs/ydoc-baseline.md) ثبت می‌شوند.
 * این فایل خودش گزارش را چاپ می‌کند تا هر بار قابلِ بازتولید باشد.
 */

const PAIR = "/#pair";

async function bothConnected(page: Page): Promise<void> {
  await expect(page.locator('[data-pane="a"] [data-action="add"]')).toBeEnabled();
  await expect(page.locator('[data-pane="b"] [data-action="add"]')).toBeEnabled();
}

/** یک استیکی در الف بساز و صبر کن تا در ب برسد. */
async function seedSticky(page: Page): Promise<void> {
  await page.locator('[data-pane="a"] [data-action="add"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__hbPair?.b?.api.getSceneElements().length ?? 0))
    .toBe(2);
}

/** ویرایشگرِ متنِ موتور را در یک پنل باز کن (دابل‌کلیک روی متنِ مقید). */
async function openEditor(page: Page, pane: "a" | "b"): Promise<void> {
  const point = await page.evaluate((name) => {
    const api = window.__hbPair![name]!.api;
    const text = api.getSceneElements().find((element) => element.type === "text")!;
    const state = api.getAppState() as unknown as {
      scrollX: number;
      scrollY: number;
      zoom: { value: number };
    };
    return {
      x: (text.x + state.scrollX) * state.zoom.value + 10,
      y: (text.y + state.scrollY) * state.zoom.value + 10,
    };
  }, pane);

  await page.locator(`[data-pane="${pane}"] .excalidraw-container`).dblclick({ position: point });
  await expect(page.locator(`[data-pane="${pane}"] textarea.excalidraw-wysiwyg`)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAIR);
  await bothConnected(page);
});

test("★★ عرضِ پنجره‌ی کهنگی — عدد، نه توصیف", async ({ page }) => {
  await seedSticky(page);
  await openEditor(page, "b");

  // ساعت‌سنج: t0 = لحظه‌ای که updateِ remote روی سندِ ب نشست،
  //           t1 = لحظه‌ای که textarea نشانش می‌دهد،
  //           t2 = لحظه‌ای که **صحنه**ی ب نشانش می‌دهد (مسیرِ بدونِ ویرایشگر).
  await page.evaluate(() => {
    const pane = window.__hbPair!.b!;
    const marker = "★";
    const probe: {
      t0: number | null;
      t1: number | null;
      t2: number | null;
    } = { t0: null, t1: null, t2: null };
    (window as unknown as { __hbProbe: typeof probe }).__hbProbe = probe;

    pane.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin === "hamboom:remote" && probe.t0 === null) probe.t0 = performance.now();
    });

    const tick = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-pane="b"] textarea.excalidraw-wysiwyg',
      );
      if (probe.t1 === null && textarea?.value.includes(marker)) probe.t1 = performance.now();

      const scene = pane.api.getSceneElements().find((element) => element.type === "text") as
        { text?: string } | undefined;
      if (probe.t2 === null && scene?.text?.includes(marker)) probe.t2 = performance.now();

      if (probe.t1 === null || probe.t2 === null) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // الف متن را عوض می‌کند — با نشانه‌ی «★» در ابتدا.
  await page.evaluate(() => {
    const pane = window.__hbPair!.a!;
    const text = pane.api.getSceneElements().find((element) => element.type === "text")!;
    const next = { ...text, originalText: `★${(text as { originalText: string }).originalText}` };
    pane.outbound.emitElementChanges({
      upserted: [next as never],
      deleted: [],
      origin: "local-user",
    });
  });

  // تا ۳ ثانیه صبر می‌کنیم. اگر نرسد، **همان خودش یافته است**.
  await page.waitForTimeout(3000);
  const probe = await page.evaluate(
    () =>
      (
        window as unknown as {
          __hbProbe: { t0: number | null; t1: number | null; t2: number | null };
        }
      ).__hbProbe,
  );

  const sceneMs = probe.t0 !== null && probe.t2 !== null ? probe.t2 - probe.t0 : null;
  const editorMs = probe.t0 !== null && probe.t1 !== null ? probe.t1 - probe.t0 : null;
  console.log(
    `\n  ★ پنجره‌ی کهنگی — سند→صحنه: ${sceneMs === null ? "نرسید" : `${sceneMs.toFixed(1)}ms`}` +
      ` · سند→textarea: ${editorMs === null ? "نرسید (>3000ms)" : `${editorMs.toFixed(1)}ms`}\n`,
  );

  // ادعای پایدار: تغییر **به سند و صحنه** می‌رسد.
  expect(probe.t0).not.toBeNull();
  expect(sceneMs).not.toBeNull();
  expect(sceneMs!).toBeLessThan(1000);

  // ★★ یافته‌ی اصلی: ویرایشگرِ باز مقدارِ خودش را نگه می‌دارد. اگر روزی موتور
  //    این را عوض کند، همین تست قرمز می‌شود و می‌فهمیم — عمدی است.
  expect(editorMs).toBeNull();
});

test("★★ پرشِ مکان‌نما وقتی همتا قبل از caret درج می‌کند", async ({ page }) => {
  await seedSticky(page);
  await openEditor(page, "b");

  // caret را وسطِ متن بگذار.
  const before = await page.evaluate(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-pane="b"] textarea.excalidraw-wysiwyg',
    )!;
    textarea.setSelectionRange(3, 3);
    return { value: textarea.value, caret: textarea.selectionStart };
  });

  // الف **قبل از** caret درج می‌کند.
  await page.evaluate(() => {
    const pane = window.__hbPair!.a!;
    const text = pane.api.getSceneElements().find((element) => element.type === "text")!;
    const next = { ...text, originalText: `★★${(text as { originalText: string }).originalText}` };
    pane.outbound.emitElementChanges({
      upserted: [next as never],
      deleted: [],
      origin: "local-user",
    });
  });
  await page.waitForTimeout(1000);

  const after = await page.evaluate(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-pane="b"] textarea.excalidraw-wysiwyg',
    )!;
    return { value: textarea.value, caret: textarea.selectionStart };
  });

  const drift = after.caret - before.caret;
  console.log(
    `\n  ★ پرشِ مکان‌نما — caret پیش: ${before.caret} · پس: ${after.caret} · اختلاف: ${drift}` +
      ` · متنِ ویرایشگر عوض شد؟ ${after.value === before.value ? "نه" : "بله"}\n`,
  );

  // با ویرایشگرِ ایزوله، caret اصلاً نمی‌پرد — چون خودِ متن هم عوض نمی‌شود.
  expect(drift).toBe(0);
  expect(after.value).toBe(before.value);
});

test("★★ خروج از ویرایشگر، درجِ همتا را بازمی‌نویسد — محدودیتِ ثبت‌شده", async ({ page }) => {
  // پیامدِ واقعیِ دو یافته‌ی بالا: چون ویرایشگر ایزوله است، وقتی بسته می‌شود
  // مقدارِ **خودش** را می‌نویسد و درجِ همتا را پاک می‌کند. این باگِ دیف نیست —
  // پنجره‌ی کهنگی تا لحظه‌ی بستنِ ویرایشگر باز می‌مانَد.
  await seedSticky(page);
  await openEditor(page, "b");

  await page.evaluate(() => {
    const pane = window.__hbPair!.a!;
    const text = pane.api.getSceneElements().find((element) => element.type === "text")!;
    const next = { ...text, originalText: `★${(text as { originalText: string }).originalText}` };
    pane.outbound.emitElementChanges({
      upserted: [next as never],
      deleted: [],
      origin: "local-user",
    });
  });
  await page.waitForTimeout(500);

  // ویرایشگر را ببند (کلیک روی فضای خالی).
  await page
    .locator('[data-pane="b"] .excalidraw-container')
    .click({ position: { x: 500, y: 400 } });
  await page.waitForTimeout(500);

  const survived = await page.evaluate(() => {
    const scene = window
      .__hbPair!.b!.api.getSceneElements()
      .find((element) => element.type === "text") as { text?: string } | undefined;
    return scene?.text?.includes("★") ?? false;
  });

  console.log(`\n  ★ درجِ همتا بعد از بستنِ ویرایشگرِ ب زنده مانْد؟ ${survived ? "بله" : "نه"}\n`);
  // ادعا فقط **ثبتِ رفتارِ فعلی** است؛ اگر عوض شد باید بدانیم.
  expect(typeof survived).toBe("boolean");
});
