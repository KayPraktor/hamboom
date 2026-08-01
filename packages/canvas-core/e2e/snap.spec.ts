import { expect, test } from "@playwright/test";

import { dragElementBy, elementXs, gotoDemo, placeElements } from "./helpers";

/**
 * snap به عناصرِ دیگر — گام ۵٫۱ (`objectsSnapModeEnabled: true` در
 * [`HamboomCanvas`](../src/engine/HamboomCanvas.tsx)). تا حالا فقط config در مرورگر
 * تایید شده بود و **دیدنِ چسبیدن** به تاییدِ چشمیِ مالک موکول بود. اینجا با رویدادِ
 * trusted درگ می‌کنیم و **مختصاتِ نهایی** را می‌سنجیم: چسبیدن یعنی عدد دقیقاً
 * هم‌تراز می‌شود، نه نزدیکِ آن.
 */

test("درگِ یک شکل نزدیکِ شکلِ دیگر، لبه‌ها را snap می‌کند (مختصاتِ دقیق)", async ({ page }) => {
  await gotoDemo(page);

  // دو مستطیل: A در x=0، B در x=60 (کمی ناهم‌تراز، پایین‌تر تا روی هم نیفتند).
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "مستطیل", exact: true }).click();
  }
  await page.waitForTimeout(200);
  await placeElements(page, [
    { x: 0, y: 0 },
    { x: 60, y: 300 },
  ]);
  expect(await elementXs(page)).toEqual([0, 60]);

  // B را ~۵۵px به چپ درگ کن → x به ~۵ می‌رسد. با snapِ روشن باید به **دقیقاً ۰**
  //   (لبه‌ی چپِ A) بچسبد. بدونِ snap روی ~۵ می‌مانْد — همین تفاوت، snap را اثبات می‌کند.
  await dragElementBy(page, 1, -55, 0);

  const xs = await elementXs(page);
  expect(xs[0]).toBe(0); // A تکان نخورده
  expect(xs[1]).toBe(0); // B به لبه‌ی A چسبیده (نه ۵)
});
