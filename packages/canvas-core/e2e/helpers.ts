import { expect, type Page } from "@playwright/test";

/**
 * کمک‌کارهای مشترکِ E2E — یک منبع تا هر spec خودش canvas را از نو منتظر نماند.
 */

/** رفتن به یک صفحه‌ی دمو و صبر تا **خودِ canvasِ موتور** رندر شود (نه اسپینرِ فونت). */
export async function gotoDemo(page: Page, hash = ""): Promise<void> {
  await page.goto(`/${hash}`, { waitUntil: "networkidle" });
  // بوم تا `document.fonts.ready` «در حال آماده‌سازی…» است؛ منتظرِ canvasِ واقعی می‌مانیم.
  await page.waitForSelector("canvas.excalidraw__canvas", { timeout: 30_000 });
  await page.waitForTimeout(600); // فرصت برای اولین رندرِ کامل
}

/** مقدارِ یک ردیفِ هدر (`<dt>label</dt><dd>value</dd>`) بر اساس برچسبِ فارسی. */
export async function headerRowValue(page: Page, label: string): Promise<string> {
  const row = page.locator(".hb-row", { has: page.getByText(label, { exact: true }) });
  return (await row.locator("dd").innerText()).trim();
}

/**
 * تعدادِ عناصرِ **زنده**ی صحنه از خودِ موتور — دقیق‌تر از شمارنده‌ی دمو.
 * App دسته را روی `__hbApi` و #spike روی `__api` می‌گذارد.
 */
export async function sceneElementCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __hbApi?: { getSceneElements(): { isDeleted?: boolean }[] };
      __api?: { getSceneElements(): { isDeleted?: boolean }[] };
    };
    const api = w.__hbApi ?? w.__api;
    if (!api) return -1;
    return api.getSceneElements().filter((el) => !el.isDeleted).length;
  });
}

/**
 * کانتینرِ excalidraw را صریح focus می‌کند تا کیبورد به موتور برسد.
 * ★ تله‌ی ثبت‌شده: موتور صفحه‌کلید را روی کانتینرِ خودش گوش می‌دهد نه document، و
 * کلیکِ برنامه‌ایِ ماوس این focus را برقرار نمی‌کند. در مرورگرِ واقعی بعدِ تعاملِ
 * کاربر خودکار است؛ اینجا صریح می‌کنیمش.
 */
export async function focusEngine(page: Page): Promise<void> {
  await page.locator(".excalidraw-container").evaluate((el) => {
    (el as HTMLElement).tabIndex = -1;
    (el as HTMLElement).focus();
  });
}

/** تعدادِ عناصرِ انتخاب‌شده از appStateِ موتور. */
export async function selectedCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __hbApi?: { getAppState(): { selectedElementIds?: Record<string, boolean> } };
      __api?: { getAppState(): { selectedElementIds?: Record<string, boolean> } };
    };
    const api = w.__hbApi ?? w.__api;
    if (!api) return -1;
    return Object.keys(api.getAppState().selectedElementIds ?? {}).length;
  });
}

/**
 * کدام بخش‌های شرطیِ پنلِ استایل الان دیده می‌شوند.
 * ★ تطبیق روی «ترازی»/«توزیع» (بدونِ ZWNJ) تا سلکتورِ CSS با نیم‌فاصله‌ی aria-label
 * درگیر نشود — «هم‌ترازی» یک U+200C دارد که مطابقتِ رشته‌ای را می‌شکند.
 */
export async function panelSections(page: Page): Promise<{ align: boolean; distribute: boolean }> {
  return page.evaluate(() => {
    const p = document.querySelector(".hb-style-panel");
    if (!p) return { align: false, distribute: false };
    const labels = [...p.querySelectorAll("[aria-label]")].map(
      (e) => e.getAttribute("aria-label") ?? "",
    );
    return {
      align: labels.some((l) => l.includes("ترازی")),
      distribute: labels.some((l) => l.includes("توزیع")),
    };
  });
}

/** خطِ راهنما: هیچ دو مستطیلی نباید همپوشانی داشته باشند (نگهبانِ ADR-027). */
export function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** صبر تا کنسول هیچ خطایی نداده باشد — با شنونده‌ای که spec نصب می‌کند. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** تاییدِ اینکه یک متن فقط ارقامِ فارسی دارد (نه لاتین) — نگهبانِ P6/فارسیِ native. */
export function expectPersianDigits(text: string): void {
  expect(text).toMatch(/[۰-۹]/);
  expect(text).not.toMatch(/[0-9]/);
}
