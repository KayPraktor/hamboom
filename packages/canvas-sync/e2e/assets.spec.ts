import { expect, test, type Page } from "@playwright/test";

/**
 * ★★ گام ۳٫۶ در **مرورگرِ واقعی** — تصویر از الف به ب.
 *
 * ── چرا این تست فقط اینجا ممکن است ────────────────────────────────────
 *
 * سه چیز در jsdom **وجود ندارند** و هر سه در همین مسیرند:
 * `URL.createObjectURL` · `createImageBitmap` (ابعادِ واقعی) · و تاریخچه‌ی
 * خودِ موتور که ادعای undo را معنادار می‌کند.
 *
 * ★ و یک بدهیِ ثبت‌شده از گام ۳٫۲ اینجا تسویه می‌شود: «ترتیبِ capture در جریانِ
 * **چندمرحله‌ای**». تصویر تنها جریانِ دومرحله‌ای پروژه است
 * (`pending → saved`) و تا حالا موردی برای آزمودنش نبود.
 */

const PAIR = "/#pair";

/**
 * یک PNGِ **واقعی** با ابعادِ معلوم — تا `createImageBitmap` چیزی برای decode
 * داشته باشد.
 *
 * ⚠️ **نویزِ تصادفی، نه رنگِ یکدست.** اولین نسخه‌ی این تست یک مستطیلِ آبیِ
 * ۱۲۰×۸۰ می‌ساخت که PNG فقط **۴۵۹ بایت** فشرده‌اش می‌کرد — کوچک‌تر از خودِ
 * متادیتای عنصر در سند. ادعای «باینری در سند نیست» با چنین فایلی **هیچ چیز را
 * اثبات نمی‌کرد**؛ تست هم درست افتاد و همین را نشان داد.
 */
async function makePng(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(
    async ({ w, h }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const pixels = ctx.createImageData(w, h);
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i] = Math.floor(Math.random() * 256);
        pixels.data[i + 1] = Math.floor(Math.random() * 256);
        pixels.data[i + 2] = Math.floor(Math.random() * 256);
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      (window as unknown as { __hbPng: File }).__hbPng = new File([blob!], "probe.png", {
        type: "image/png",
      });
    },
    { w: width, h: height },
  );
}

const imagesOf = (page: Page, pane: "a" | "b") =>
  page.evaluate(
    (name) =>
      window
        .__hbPair![name]!.api.getSceneElements()
        .filter((element) => element.type === "image")
        .map((element) => ({
          fileId: (element as { fileId?: string }).fileId,
          status: (element as { status?: string }).status,
        })),
    pane,
  );

test.beforeEach(async ({ page }) => {
  await page.goto(PAIR);
  await expect(page.locator('[data-pane="a"] [data-action="add"]')).toBeEnabled();
  await expect(page.locator('[data-pane="b"] [data-action="add"]')).toBeEnabled();
});

test("★★ تصویرِ الف با همان `fileId` در ب ظاهر می‌شود و بایت‌ها در سند نیستند", async ({
  page,
}) => {
  await makePng(page, 300, 200);
  const bytesBefore = await page.evaluate(() => window.__hbPair!.b!.docBytes());

  const inserted = await page.evaluate(async () => {
    const file = (window as unknown as { __hbPng: File }).__hbPng;
    const element = await window.__hbPair!.a!.ingestImage(file);
    return { fileId: (element as { fileId?: string } | null)?.fileId, size: file.size };
  });
  expect(inserted.fileId).toBeTruthy();

  // ── ۱) عنصر با همان `fileId` و وضعیتِ نهایی به ب رسید ────────────────
  await expect
    .poll(() => imagesOf(page, "b"))
    .toEqual([{ fileId: inserted.fileId, status: "saved" }]);

  // ── ۲) موتورِ ب بایت‌ها را **می‌شناسد** ──────────────────────────────
  //
  // ★ بدونِ `registerSceneAssets` این آرایه خالی می‌مانْد و کاربرِ ب یک قابِ
  //   خالی می‌دید — عنصر سرِ جایش، ولی بدونِ تصویر.
  await expect
    .poll(() => page.evaluate(() => window.__hbPair!.b!.engineFiles()))
    .toEqual([inserted.fileId]);

  // ── ۳) متادیتا در سند است، با ابعادِ **واقعی** ───────────────────────
  const assets = await page.evaluate(() => window.__hbPair!.b!.assets());
  expect(assets).toEqual([
    expect.objectContaining({
      fileId: inserted.fileId,
      mime: "image/png",
      width: 300,
      height: 200,
      sizeBytes: inserted.size,
      uploadedBy: "u_a",
    }),
  ]);

  // ── ۴) ★★ و باینری در سند **نیست** ──────────────────────────────────
  //
  // ادعای P4 با عدد: فایل ده‌ها کیلوبایت است (نویزِ فشرده‌نشدنی) ولی سند فقط
  // چند صد بایتِ متادیتا گرفته — یعنی رشدِ سند به **حجمِ فایل** ربطی ندارد.
  const grew = (await page.evaluate(() => window.__hbPair!.b!.docBytes())) - bytesBefore;
  expect(inserted.size).toBeGreaterThan(50_000);
  expect(grew).toBeGreaterThan(0);
  expect(grew).toBeLessThan(3_000);
});

test("★★ یک `Ctrl+Z` کلِ تصویر را برمی‌دارد، نه فقط «saved» را", async ({ page }) => {
  // ⚠️ این همان بدهیِ گام ۳٫۲ است. جریانِ `pending → saved` دو نوشتنِ **صحنه**
  // دارد، ولی چون صاحبِ undo حالا Yjs است ([ADR-035](../../../ARCHITECTURE_DECISIONS.md#adr-035))
  // و ابزار فقط **یک بار** emit می‌کند، پشته‌ی Yjs یک ورودی می‌گیرد.
  //
  // اگر روزی کسی مرحله‌ی `pending` را هم emit کند، این تست قرمز می‌شود و
  // کاربر با یک `Ctrl+Z` یک تصویرِ نیمه‌کاره‌ی «pending» روی بوم می‌دید.
  await makePng(page, 60, 60);
  await page.evaluate(async () => {
    await window.__hbPair!.a!.ingestImage((window as unknown as { __hbPng: File }).__hbPng);
  });
  await expect.poll(() => imagesOf(page, "b")).toHaveLength(1);

  const container = page.locator('[data-pane="a"] .excalidraw-container');
  // ⚠️ y=300 و نه ۲۰: از گام ۳٫۷ ردیفِ آواتارِ همتاها گوشه‌ی بالا را گرفته
  //    (در RTL یعنی بالا-چپ) و کلیکِ فوکوس را می‌بلعد.
  await container.click({ position: { x: 20, y: 300 } });
  await container.focus();
  await page.keyboard.press("Control+KeyZ");

  // روی هر دو بوم — همگرایی حفظ می‌شود.
  await expect.poll(() => imagesOf(page, "a")).toEqual([]);
  await expect.poll(() => imagesOf(page, "b")).toEqual([]);
});

test("فایلِ غیرمجاز درج نمی‌شود و سند دست‌نخورده می‌مانَد", async ({ page }) => {
  const before = await page.evaluate(() => window.__hbPair!.a!.docBytes());

  const result = await page.evaluate(async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "virus.exe", {
      type: "application/x-msdownload",
    });
    return window.__hbPair!.a!.ingestImage(file);
  });

  // ابزارِ M1 خودش جلویش را می‌گیرد و اصلاً به پورت نمی‌رسد.
  expect(result).toBeNull();
  expect(await page.evaluate(() => window.__hbPair!.a!.assets())).toEqual([]);
  expect(await page.evaluate(() => window.__hbPair!.a!.docBytes())).toBe(before);
});
