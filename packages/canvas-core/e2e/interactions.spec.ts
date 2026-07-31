import { expect, test } from "@playwright/test";

import { gotoDemo, sceneElementCount } from "./helpers";

/**
 * تعاملِ واقعی با رویدادهای **trusted** — چیزی که pane و jsdom نمی‌توانستند.
 *
 * موتور رویدادِ مصنوعی را رد می‌کند و صفحه‌کلید را روی **خودِ canvas** گوش می‌دهد،
 * نه `document` (دو تله‌ی ثبت‌شده). ماوس/کیبوردِ Playwright رویدادِ trusted می‌سازد،
 * پس مسیرِ واقعیِ کاربر — و مهم‌تر: **undo/redoِ خودِ موتور** — قابلِ آزمودن می‌شود.
 * این همان harnessِ مرورگریِ undo است که از گام ۵٫۲/۳ به اینجا موکول شده بود.
 */

test("ساختِ گروهی با کلیکِ trusted، سپس undo/redo با کیبوردِ trustedِ موتور", async ({ page }) => {
  await gotoDemo(page);
  expect(await sceneElementCount(page)).toBe(0);

  // «فریم + دو استیکی» = ۵ عنصر (فریم + ۲ ظرف + ۲ متنِ مقید) در **یک ژست** (ADR-026).
  await page.getByRole("button", { name: "فریم + دو استیکی", exact: true }).click();
  await expect.poll(() => sceneElementCount(page)).toBe(5);

  // ★ تله‌ی ثبت‌شده: موتور صفحه‌کلید را روی **کانتینرِ خودش** گوش می‌دهد، نه document.
  // کلیکِ برنامه‌ایِ ماوس focus را به موتور نمی‌رساند؛ کانتینر را صریح focus می‌کنیم —
  // همان حالتی که بعدِ تعاملِ واقعیِ کاربر برقرار است. (در مرورگرِ واقعی خودکار است.)
  await page.locator(".excalidraw-container").evaluate((el) => {
    (el as HTMLElement).tabIndex = -1;
    (el as HTMLElement).focus();
  });

  // یک Ctrl+Z کلِ ژست را برمی‌گرداند (نه یک عنصر) — اتمیک‌بودنِ ژست در موتورِ واقعی.
  await page.keyboard.press("Control+KeyZ");
  await expect.poll(() => sceneElementCount(page)).toBe(0);

  // redo کلِ ژست را بازمی‌گرداند.
  await page.keyboard.press("Control+Shift+KeyZ");
  await expect.poll(() => sceneElementCount(page)).toBe(5);
});

test("ابزارِ استیکی با میانبرِ N فعال می‌شود (رویدادِ trustedِ صفحه‌کلید)", async ({ page }) => {
  await gotoDemo(page);
  const stickyToolRow = page.locator(".hb-row", {
    has: page.getByText("ابزار استیکی", { exact: true }),
  });
  await expect(stickyToolRow.locator("dd")).toHaveText("خاموش");

  // N روی صفحه (نه canvas) — دمو این میانبر را روی document می‌گیرد.
  await page.locator("body").press("n");
  await expect(stickyToolRow.locator("dd")).toHaveText("فعال");
});
