import { expect, test } from "@playwright/test";

import { collectConsoleErrors, expectPersianDigits, gotoDemo, rectsOverlap } from "./helpers";

/**
 * رگرسیونِ بصریِ رابط — همان موارد که قبلاً «فقط تاییدِ چشمیِ مالک» بودند، حالا
 * خودکار. تاکید بر **ادعاهای قطعی** (شمارش، متن، هندسه‌ی جای‌گذاری) نه اسنپ‌شاتِ
 * شکننده؛ فقط پالت یک golden پیکسلی دارد چون رنگ‌ها CSSـیِ قطعی‌اند.
 */

test("دمو بدونِ خطای کنسول بالا می‌آید و RTL/فارسی است", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await gotoDemo(page);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  expect(errors, `خطاهای کنسول: ${errors.join(" | ")}`).toEqual([]);
});

test("پالتِ استیکی ۱۲ رنگ دارد (شمارش + golden)", async ({ page }) => {
  await gotoDemo(page);
  const chips = page.locator(".hb-palette-picker .hb-chip");
  await expect(chips).toHaveCount(12);
  // golden فقط برای پالت: رنگ‌ها از CSS می‌آیند و بینِ اجراها ثابت‌اند.
  await expect(page.locator(".hb-palette-picker")).toHaveScreenshot("sticky-palette.png");
});

test("نوار ابزار ۱۱ ابزار دارد و هر کدام نامِ در دسترس دارد", async ({ page }) => {
  await gotoDemo(page);
  const toolbar = page.locator(".hb-toolbar[role='toolbar']");
  await expect(toolbar).toBeVisible();
  const tools = toolbar.locator("button.hb-tool");
  await expect(tools).toHaveCount(11);
  // هر دکمه aria-label دارد (نگهبانِ دسترس‌پذیریِ گام ۵٫۴ در مرورگرِ واقعی).
  const count = await tools.count();
  for (let i = 0; i < count; i++) {
    await expect(tools.nth(i)).toHaveAttribute("aria-label", /.+/);
  }
});

test("نوار وضعیت فارسیِ native است، بدونِ متنِ انگلیسی", async ({ page }) => {
  await gotoDemo(page);
  const status = page.locator(".hb-statusbar");
  await expect(status).toBeVisible();
  const text = await status.innerText();
  expect(text).toContain("متصل"); // connected
  expect(text).toContain("ذخیره"); // saved
  // نباید حرفِ لاتین داشته باشد (اصلِ فارسیِ native).
  expect(text).not.toMatch(/[A-Za-z]/);
});

test("درصدِ zoom با ارقامِ فارسی است", async ({ page }) => {
  await gotoDemo(page);
  const percent = page.locator(".hb-zoom-percent");
  await expect(percent).toBeVisible();
  expectPersianDigits((await percent.innerText()).trim());
});

test("★ نوار وضعیت و پنلِ استایل همپوشانی ندارند (نگهبانِ ADR-027)", async ({ page }) => {
  await gotoDemo(page);

  // یک مستطیل بساز تا انتخاب شود و پنلِ استایل (top-start) ظاهر شود.
  await page.getByRole("button", { name: "مستطیل", exact: true }).click();
  const panel = page.locator(".hb-style-panel");
  await expect(panel).toBeVisible();

  const statusBox = await page.locator(".hb-statusbar").boundingBox();
  const panelBox = await panel.boundingBox();
  expect(statusBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  // همان باگی که در گام ۵٫۱ دیده شد: هر دو top بودند و رویِ هم می‌افتادند.
  expect(rectsOverlap(statusBox!, panelBox!)).toBe(false);
});
