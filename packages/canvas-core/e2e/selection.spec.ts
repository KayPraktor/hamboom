import { expect, test } from "@playwright/test";

import { focusEngine, gotoDemo, panelSections, selectedCount } from "./helpers";

/**
 * انتخاب و — مهم‌تر از همه — **نگهبانِ فیکسِ `refreshCounts`**.
 *
 * ★ چرا این مهم‌ترین تستِ این فایل است: دمو انتخاب را برای پنل از **appStateِ
 * آرگومانِ `onChange`** می‌خواند، نه `api.getAppState()` که یک فریمْ کهنه است
 * (درسِ Q1). این مسیر در session‌های قبلی **هرگز خودکار اجرا نشد** (onChangeِ انتخاب
 * در pane fire نمی‌شد) و فقط چشمی تایید شده بود. اگر کسی به getAppState برش گرداند،
 * پنل «یک انتخاب عقب» می‌مانَد و هیچ تستِ واحدی نمی‌گیردش. اینجا در مرورگرِ واقعی
 * می‌گیریمش: بخشِ هم‌ترازی فقط با ۲+ و توزیع فقط با ۳+ انتخاب ظاهر می‌شود.
 *
 * ⚠️ همین تست یک باگِ واقعی را هم بیرون کشید: زیر StrictMode مسیرِ
 * `onChange → refreshCounts → setSnapshot` مرده می‌ماند و پنل با هیچ انتخابِ موتوری
 * به‌روز نمی‌شد. StrictMode از دمو برداشته شد (توضیح در `dev/main.tsx`).
 */

test("پنل بخشِ هم‌ترازی/توزیع را با تعدادِ **فعلیِ** انتخاب نشان می‌دهد (نگهبانِ refreshCounts)", async ({
  page,
}) => {
  await gotoDemo(page);
  const panel = page.locator(".hb-style-panel");

  // سه مستطیل بساز؛ هر ساخت فقط خودش را انتخاب می‌کند → در پایان ۱ انتخاب.
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "مستطیل", exact: true }).click();
  }
  await expect(panel).toBeVisible();
  await expect.poll(() => selectedCount(page)).toBe(1);
  // با ۱ انتخاب: نه هم‌ترازی، نه توزیع.
  expect(await panelSections(page)).toEqual({ align: false, distribute: false });

  // همه را انتخاب کن (۳). اگر refreshCounts کهنه بخواند، پنل روی «۱» می‌مانَد و
  // این ادعا می‌افتد — دقیقاً همان رگرسیونی که فقط چشمی پوشش داشت.
  await focusEngine(page);
  await page.keyboard.press("Control+KeyA");
  await expect.poll(() => selectedCount(page)).toBe(3);
  await expect.poll(() => panelSections(page)).toEqual({ align: true, distribute: true });

  // لغوِ انتخاب با کلیک روی فضای خالیِ بوم → پنل باید بسته شود (مسیرِ دیگرِ
  //   refreshCounts: از انتخاب به صفر). مستطیل‌ها نزدیکِ مبدأ (سمتِ چپ) اند، پس
  //   گوشه‌ی پایین-راست خالی است.
  await page.mouse.click(1050, 650);
  await expect.poll(() => selectedCount(page)).toBe(0);
  await expect(panel).toHaveCount(0);
});
