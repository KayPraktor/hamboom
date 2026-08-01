import { expect, test } from "@playwright/test";

import { focusEngine, gotoDemo, sceneElementCount, selectedCount } from "./helpers";

/**
 * کلیپ‌بورد (گام ۵٫۳) با رویدادِ **trusted**. Ctrl+C/X/V را ابزارِ کلیپ‌بورد در فاز
 * capture می‌گیرد؛ کلونِ داخلی روی `cloneElements` سوار است و cut از `deleteElements`.
 * تا حالا فقط تاییدِ چشمیِ مالک بود چون به کلیپ‌بوردِ واقعیِ مرورگر نیاز دارد — که
 * Playwright با دسترسیِ زیر فراهم می‌کند (فقط برای همین فایل).
 */
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function threeRects(page: Parameters<typeof gotoDemo>[0]) {
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "مستطیل", exact: true }).click();
  }
  await page.waitForTimeout(200);
}

test("Ctrl+C/Ctrl+V عناصر را کپی می‌کند و پیستِ دوباره آبشاری است", async ({ page }) => {
  await gotoDemo(page);
  await threeRects(page);
  expect(await sceneElementCount(page)).toBe(3);

  await focusEngine(page);
  await page.keyboard.press("Control+KeyA");
  await expect.poll(() => selectedCount(page)).toBe(3);

  await page.keyboard.press("Control+KeyC");
  await page.keyboard.press("Control+KeyV");
  await expect.poll(() => sceneElementCount(page)).toBe(6); // ۳ کپیِ نو

  // پیستِ دوباره: کپی‌های تازه‌پیست‌شده انتخاب‌اند → آبشاری روی همان‌ها.
  await page.keyboard.press("Control+KeyV");
  await expect.poll(() => sceneElementCount(page)).toBe(9);
});

test("Ctrl+X عناصر را می‌بُرد و Ctrl+V هر سه را برمی‌گرداند", async ({ page }) => {
  await gotoDemo(page);
  await threeRects(page);

  await focusEngine(page);
  await page.keyboard.press("Control+KeyA");
  await expect.poll(() => selectedCount(page)).toBe(3);

  // برش = کپی + حذف → صحنه خالی می‌شود.
  await page.keyboard.press("Control+KeyX");
  await expect.poll(() => sceneElementCount(page)).toBe(0);

  // چسباندن → **هر سه** برمی‌گردند (نه یک استیکی). این همان باگی بود که با گرفتنِ
  //   انتخاب در keydown (قبل از حذفِ موتور) رفع شد؛ این تست نگهبانِ رگرسیونش است.
  await page.keyboard.press("Control+KeyV");
  await expect.poll(() => sceneElementCount(page)).toBe(3);
});
