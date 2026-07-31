import { expect, test } from "@playwright/test";

import { gotoDemo } from "./helpers";

/**
 * G-2 (از گام ۱٫۴) — نگهبانِ رگرسیونِ جهتِ متنِ فارسی. [ADR-025](../../../ARCHITECTURE_DECISIONS.md#adr-025)
 *
 * راه‌حلِ جهتِ متنِ فارسی روی canvas یک wrapper روی `fillText` است که `ctx.direction`
 * را ست می‌کند. این **بی‌صدا** می‌شکند اگر موتور مسیرِ رندر را عوض کند و دیگر از
 * `fillText` رد نشود. jsdom این را نمی‌گیرد (پیکسل و رندرِ واقعی ندارد). خودِ ADR-025
 * ملاکِ سلامت را «**شمارنده‌ی فراخوانیِ wrapper هنگام رندرِ واقعی**» گذاشته: اگر روی
 * صفر بماند، wrapper در مسیرِ رندر نیست. این تست همان شمارنده را در **مرورگرِ واقعی**
 * می‌سنجد — همان چیزی که تا حالا فقط دستی در `#spike` دیده می‌شد.
 *
 * ── چرا «هش پیکسلی» نه (یافته‌های ثبت‌شده در همین probe) ─────────────────
 *
 * دو مسیرِ پیکسلی امتحان و رد شد، تا کسی دوباره سراغشان نرود:
 * - **`getImageData` روی canvasِ موتور** همیشه سفیدِ خالی برمی‌گرداند — canvasِ
 *   Excalidraw روی GPU composite می‌شود و خواندنِ مستقیمِ پیکسل بلانک است (اسکرین‌شاتِ
 *   Playwright محتوا را می‌بیند، ولی `getImageData` نه).
 * - **سنجشِ اثرِ خودِ `ctx.direction`** بی‌فایده بود: در این Chromiumِ هدلس، خروجیِ
 *   `fillText` با ltr/rtl **هیچ فرقی** نمی‌کند و run‌های دوجهته در canvas بازچینش
 *   نمی‌شوند. پس diff پیکسلیِ جهت قابلِ سنجش نیست.
 * - **golden از canvas** ناپایدار است: rough.js هر شکل را با seedِ تازه می‌کشد.
 *   (golden فقط برای رابطِ CSSـیِ قطعی به‌کار می‌رود — نگاه کن به `ui-regression`.)
 *
 * پس نگهبانِ قطعیِ ADR-025 همان شمارنده است، نه پیکسل.
 */

test("wrapperِ جهتِ متن هنگام رندرِ واقعیِ بوم صدا زده می‌شود (ADR-025)", async ({ page }) => {
  await gotoDemo(page, "#spike");

  // ردیفِ «hook جهت نصب است؟» → «بله».
  const installed = page.locator(".hb-row", {
    has: page.getByText("hook جهت نصب است؟", { exact: true }),
  });
  await expect(installed.locator("dd")).toHaveText("بله");

  // ردیفِ «فراخوانی hook» زنده هر ۴۰۰ms به‌روز می‌شود؛ باید از ۰ بالا برود.
  // اگر روی صفر ماند = موتور از fillText رد نمی‌شود = رگرسیونِ خاموشِ ADR-025.
  const invocations = page.locator(".hb-row", {
    has: page.getByText("فراخوانی hook", { exact: true }),
  });
  await expect
    .poll(async () => parseInt((await invocations.locator("dd").innerText()).trim(), 10), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});
