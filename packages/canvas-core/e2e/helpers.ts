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

interface EngineApi {
  getAppState(): {
    scrollX: number;
    scrollY: number;
    zoom: { value: number };
    selectedElementIds?: Record<string, boolean>;
  };
  getSceneElements(): Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    isDeleted?: boolean;
    groupIds?: string[];
  }>;
  scrollToContent(els: unknown, opts: { fitToContent: boolean; animate: boolean }): void;
  updateScene(data: { elements: unknown; captureUpdate: string }): void;
}

/**
 * عناصرِ زنده را در یک ردیفِ افقیِ **بدونِ همپوشانی** بچین و وسط بیاور — تا کلیکِ
 * دقیق روی هر کدام ممکن شود (سازنده‌های دمو عناصر را تصادفی نزدیکِ مبدأ می‌گذارند
 * که روی هم می‌افتند و کلیکِ دقیق را ناممکن می‌کنند). NEVER چون ژستِ کاربر نیست.
 */
export async function spreadElementsInRow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __hbApi?: EngineApi; __api?: EngineApi };
    const api = (w.__hbApi ?? w.__api)!;
    const els = api.getSceneElements().filter((e) => !e.isDeleted);
    // پرکردنِ رنگ لازم است: شکلِ بدونِ پر فقط با کلیک روی **لبه** انتخاب می‌شود، نه
    // مرکزِ توخالی — پس برای کلیکِ قابلِ‌اتکا در مرکز، یک پس‌زمینه می‌دهیم.
    api.updateScene({
      elements: els.map((e, i) => ({ ...e, x: i * 400, y: 0, backgroundColor: "#a5d8ff" })),
      captureUpdate: "NEVER",
    });
    api.scrollToContent(api.getSceneElements(), { fitToContent: true, animate: false });
  });
  await page.waitForTimeout(300);
}

/** جعبه‌ی محیطیِ همه‌ی عناصرِ زنده در مختصاتِ **صفحه** — برای box-select با ماوس. */
async function sceneUnionBox(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __hbApi?: EngineApi; __api?: EngineApi };
    const api = (w.__hbApi ?? w.__api)!;
    const st = api.getAppState();
    const r = document.querySelector("canvas.excalidraw__canvas.static")!.getBoundingClientRect();
    const z = st.zoom.value;
    const a = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const e of api.getSceneElements().filter((x) => !x.isDeleted)) {
      const sx = r.left + (e.x + st.scrollX) * z;
      const sy = r.top + (e.y + st.scrollY) * z;
      a.minX = Math.min(a.minX, sx);
      a.minY = Math.min(a.minY, sy);
      a.maxX = Math.max(a.maxX, sx + e.width * z);
      a.maxY = Math.max(a.maxY, sy + e.height * z);
    }
    return a;
  });
}

/** مرکزِ صفحه‌ایِ همه‌ی عناصرِ زنده — برای کلیک/Shift+کلیک. */
export async function elementCenters(page: Page): Promise<Array<{ x: number; y: number }>> {
  return page.evaluate(() => {
    const w = window as unknown as { __hbApi?: EngineApi; __api?: EngineApi };
    const api = (w.__hbApi ?? w.__api)!;
    const st = api.getAppState();
    const r = document.querySelector("canvas.excalidraw__canvas.static")!.getBoundingClientRect();
    const z = st.zoom.value;
    return api
      .getSceneElements()
      .filter((e) => !e.isDeleted)
      .map((e) => ({
        x: r.left + (e.x + e.width / 2 + st.scrollX) * z,
        y: r.top + (e.y + e.height / 2 + st.scrollY) * z,
      }));
  });
}

/** همه‌ی محتوا را وسط بیاور، بعد با یک درگِ ماوس دورشان کادر بکش (box-select). */
export async function boxSelectEverything(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __hbApi?: EngineApi; __api?: EngineApi };
    const api = (w.__hbApi ?? w.__api)!;
    api.scrollToContent(api.getSceneElements(), { fitToContent: true, animate: false });
  });
  await page.waitForTimeout(300);
  const b = await sceneUnionBox(page);
  await page.mouse.move(b.minX - 30, b.minY - 30);
  await page.mouse.down();
  await page.mouse.move(b.maxX + 30, b.maxY + 30, { steps: 10 });
  await page.mouse.up();
}

/** عناصرِ زنده را در موقعیت‌های داده‌شده بگذار (با پر، برای کلیک/درگِ قابلِ‌اتکا) و وسط بیاور. */
export async function placeElements(
  page: Page,
  positions: Array<{ x: number; y: number }>,
): Promise<void> {
  await page.evaluate((pos) => {
    const w = window as unknown as { __hbApi?: EngineApi; __api?: EngineApi };
    const api = (w.__hbApi ?? w.__api)!;
    const els = api.getSceneElements().filter((e) => !e.isDeleted);
    api.updateScene({
      elements: els.map((e, i) => ({
        ...e,
        x: pos[i]?.x ?? e.x,
        y: pos[i]?.y ?? e.y,
        backgroundColor: "#a5d8ff",
      })),
      captureUpdate: "NEVER",
    });
    api.scrollToContent(api.getSceneElements(), { fitToContent: true, animate: false });
  }, positions);
  await page.waitForTimeout(400);
}

/** x‌های گردشده‌ی همه‌ی عناصرِ زنده (به ترتیبِ صحنه). */
export async function elementXs(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __hbApi?: EngineApi; __api?: EngineApi };
    const api = (w.__hbApi ?? w.__api)!;
    return api
      .getSceneElements()
      .filter((e) => !e.isDeleted)
      .map((e) => Math.round(e.x));
  });
}

/** عنصرِ شماره‌ی `index` را با درگِ ماوس به اندازه‌ی (dx,dy) در مختصاتِ **صحنه** جابه‌جا کن. */
export async function dragElementBy(
  page: Page,
  index: number,
  dxScene: number,
  dyScene: number,
): Promise<void> {
  const d = await page.evaluate((i) => {
    const w = window as unknown as { __hbApi?: EngineApi; __api?: EngineApi };
    const api = (w.__hbApi ?? w.__api)!;
    const st = api.getAppState();
    const r = document.querySelector("canvas.excalidraw__canvas.static")!.getBoundingClientRect();
    const z = st.zoom.value;
    const e = api.getSceneElements().filter((x) => !x.isDeleted)[i]!;
    return {
      cx: r.left + (e.x + e.width / 2 + st.scrollX) * z,
      cy: r.top + (e.y + e.height / 2 + st.scrollY) * z,
      z,
    };
  }, index);
  await page.mouse.move(d.cx, d.cy);
  await page.mouse.down();
  await page.mouse.move(d.cx + dxScene * d.z, d.cy + dyScene * d.z, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** شناسه‌ی گروه‌هایی که عناصرِ انتخاب‌شده به آن‌ها تعلق دارند. */
export async function selectedGroupIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __hbApi?: EngineApi; __api?: EngineApi };
    const api = (w.__hbApi ?? w.__api)!;
    const sel = api.getAppState().selectedElementIds ?? {};
    const gids = new Set<string>();
    for (const e of api.getSceneElements()) {
      if (sel[e.id]) for (const g of e.groupIds ?? []) gids.add(g);
    }
    return [...gids];
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
