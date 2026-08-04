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
  // انتظارِ **شرطی**، نه مهلتِ ثابت: روی اجرای سرد (وقتی Vite تازه dep-optimize
  // می‌کند) ۲۰۰ms کافی نبود و تست به‌جای رفتار، سرعتِ ماشین را می‌سنجید.
  await expect.poll(() => sceneElementCount(page)).toBe(3);
}

/**
 * ★ صبر تا وقتی کلیپ‌بوردِ **سیستم** واقعاً محتوای قابل‌شناسایی داشته باشد.
 *
 * ── چرا لازم است (flakeِ ۱ در ۵ که در M2 کشف شد) ──────────────────────
 *
 * `onCut` نشانه‌ی ما را روی رویداد می‌نویسد، ولی موتور هم روی همان Ctrl+X
 * کلیپ‌بورد را **به‌صورت async** با فرمتِ خودش بازنویسی می‌کند. کلیپ‌بوردِ سیستم
 * بینِ تست‌ها هم مشترک است. پس یک پنجره‌ی کوتاه هست که `paste` هنوز **نشانه‌ی
 * تستِ قبلی** را می‌بیند: نه با token فعلی برابر است، نه فرمتِ Excalidraw —
 * پس مسیرِ «متنِ خارجی» می‌رود و **یک استیکی (۲ عنصر)** می‌سازد به‌جای ۳.
 *
 * دقیقاً همان عددی که در اجرای سرد دیده شد. این **باگِ محصول نیست**؛ هیچ
 * انسانی Ctrl+X و Ctrl+V را در چند میلی‌ثانیه پشتِ هم نمی‌زند. ولی تست باید
 * صریح منتظرش بماند، وگرنه دارد زمان‌بندی را می‌آزماید نه رفتار را.
 */
async function waitForInternalClipboard(page: Parameters<typeof gotoDemo>[0]) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const text = await navigator.clipboard.readText();
          // دو شکلِ «داخلی» که خودِ `clipboard-tool` می‌پذیرد.
          return text.includes("hb-clip") || text.startsWith('{"type":"excalidraw/clipboard"');
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
}

test("Ctrl+C/Ctrl+V عناصر را کپی می‌کند و پیستِ دوباره آبشاری است", async ({ page }) => {
  await gotoDemo(page);
  await threeRects(page);

  await focusEngine(page);
  await page.keyboard.press("Control+KeyA");
  await expect.poll(() => selectedCount(page)).toBe(3);

  await page.keyboard.press("Control+KeyC");
  await waitForInternalClipboard(page);
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
  await waitForInternalClipboard(page);

  // چسباندن → **هر سه** برمی‌گردند (نه یک استیکی). این همان باگی بود که با گرفتنِ
  //   انتخاب در keydown (قبل از حذفِ موتور) رفع شد؛ این تست نگهبانِ رگرسیونش است.
  await page.keyboard.press("Control+KeyV");
  await expect.poll(() => sceneElementCount(page)).toBe(3);
});
