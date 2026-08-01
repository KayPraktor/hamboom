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

// ⚠️ **cut/paste عمداً اینجا تست نشد — یک ناهنجاریِ واقعی پیدا شد که باید مالک بررسی کند.**
//    برشِ N عنصر (Ctrl+X) صحنه را درست خالی می‌کند (→۰)، ولی Ctrl+V بعدش صرفِ‌نظر از N
//    همیشه به **۲** می‌رسد (n=۱/۲/۳ همه → ۲؛ با contextِ تازه و عناصرِ جدا هم تکرارشد).
//    copy/paste (بالا) تمیز round-trip می‌کند، پس ایراد در مسیرِ **cut→paste** است
//    (احتمالاً تعاملِ کلیپ‌بوردِ سیستم در ابزار). چون تاییدِ صحتش نامعلوم است، تستِ
//    cut نوشته نشد تا رفتارِ مشکوک codify نشود — گزارش به مالک برای بررسیِ clipboard-tool.
