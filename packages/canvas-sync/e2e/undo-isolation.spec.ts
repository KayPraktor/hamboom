import { expect, test, type Page } from "@playwright/test";

/**
 * ★★ معیارِ پذیرشِ گام ۳٫۲ — **`Ctrl+Z` کارِ همتا را برنمی‌گرداند.**
 *
 * ── چرا مرورگرِ واقعی و نه jsdom ──────────────────────────────────────
 *
 * تاریخچه‌ی undo مالِ **خودِ موتور** است و در jsdom اصلاً وجود ندارد. تستِ واحد
 * فقط می‌تواند ثابت کند پرچمِ `captureUpdate` درست فرستاده شده؛ اینکه آن پرچم
 * واقعاً undo را ایزوله می‌کند فقط اینجا دیده می‌شود.
 *
 * ── چرا این باگ خطرناک است ────────────────────────────────────────────
 *
 * با `IMMEDIATELY` (یا با `updateScene`ِ خامِ بدونِ انتخاب) کارِ کاربرِ دیگر در
 * undo stackِ **محلی** می‌نشیند. هیچ خطایی نمی‌دهد؛ فقط یک روز کاربر `Ctrl+Z`
 * می‌زند و کارِ همکارش پاک می‌شود — همان چیزی که ADR-012 منع کرده.
 */

const PAIR = "/#pair";

/** تعدادِ عناصرِ زنده‌ی یک پنل، مستقیم از موتور. */
async function liveCount(page: Page, pane: "a" | "b"): Promise<number> {
  return page.evaluate((name) => {
    const api = window.__hbPair?.[name]?.api;
    if (!api) return -1;
    return api.getSceneElements().length;
  }, pane);
}

async function addSticky(page: Page, pane: "a" | "b"): Promise<void> {
  const before = await liveCount(page, pane);
  await page.locator(`[data-pane="${pane}"] [data-action="add"]`).click();
  // هر استیکی دو عنصر است: ظرف + متنِ مقید.
  await expect.poll(() => liveCount(page, pane)).toBe(before + 2);
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAIR);
  // هر دو آداپتور باید وصل شده باشند، وگرنه دکمه‌ها غیرفعالند.
  await expect(page.locator('[data-pane="a"] [data-action="add"]')).toBeEnabled();
  await expect(page.locator('[data-pane="b"] [data-action="add"]')).toBeEnabled();
});

test("★★ سه بار Ctrl+Z در ب، استیکیِ الف را برنمی‌گرداند", async ({ page }) => {
  // ب یک استیکیِ **خودش** می‌سازد → یک ورودیِ undo محلی.
  await addSticky(page, "b");
  // الف یک استیکی می‌سازد → از راهِ remote به ب می‌رسد.
  await addSticky(page, "a");

  await expect.poll(() => liveCount(page, "b")).toBe(4);

  // ★ کیبورد باید به خودِ کانتینرِ موتور برود — تله‌ی ثبت‌شده‌ی M1.
  const containerB = page.locator('[data-pane="b"] .excalidraw-container');
  await containerB.click({ position: { x: 20, y: 20 } });
  await containerB.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+KeyZ");

  // ★ ب فقط کارِ خودش را پس گرفته: دو عنصرِ الف باقی‌اند.
  await expect.poll(() => liveCount(page, "b")).toBe(2);

  // و بومِ الف هر دو استیکی را دارد — یعنی `Ctrl+Z`ِ ب هیچ‌چیز از الف نبرد.
  // ⚠️ چهار است نه دو: استیکیِ **ب** هم از راهِ remote به الف رسیده بود.
  // (همگام‌سازیِ خودِ undo با همتا کارِ گام ۳٫۴ است، نه این گام.)
  expect(await liveCount(page, "a")).toBe(4);
});

test("استیکیِ الف واقعاً در ب دیده می‌شود (مسیرِ remote زنده است)", async ({ page }) => {
  // اگر این تست سبز نباشد، تستِ بالا بی‌معنی است: «چیزی پاک نشد» وقتی اصلاً
  // چیزی نرسیده بود، هیچ چیزی اثبات نمی‌کند.
  expect(await liveCount(page, "b")).toBe(0);
  await addSticky(page, "a");
  await expect.poll(() => liveCount(page, "b")).toBe(2);
});

test("Ctrl+Z در ب روی بومِ الف اثری ندارد", async ({ page }) => {
  await addSticky(page, "b");
  await expect.poll(() => liveCount(page, "a")).toBe(2);

  const containerB = page.locator('[data-pane="b"] .excalidraw-container');
  await containerB.click({ position: { x: 20, y: 20 } });
  await containerB.focus();
  await page.keyboard.press("Control+KeyZ");

  // ب کارِ خودش را پس گرفت …
  await expect.poll(() => liveCount(page, "b")).toBe(0);
  // … ولی الف هنوز عنصر را دارد. (همگام‌سازیِ undo به همتا کارِ گام ۳٫۴ است.)
  expect(await liveCount(page, "a")).toBe(2);
});
