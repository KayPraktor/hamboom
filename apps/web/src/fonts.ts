/**
 * گیتِ فونت — [ADR-017](../../../ARCHITECTURE_DECISIONS.md#adr-017).
 *
 * ⚠️ **چرا گیت لازم است (برای بوم، فاز ۸٫۴):** رندرِ متن روی canvas به
 * اندازه‌گیریِ دقیقِ عرض نیاز دارد؛ اگر با فونتِ fallback اندازه گرفته شود، بعد از
 * سواپِ Vazirmatn متن جابه‌جا می‌شود. پوسته‌ی UI با `font-display: swap` مشکلی
 * ندارد، ولی گیت یک‌جا می‌مانَد تا بوم هم از همین یکی مصرف کند.
 *
 * فونت **خودمیزبان** است (`@fontsource-variable/vazirmatn`، OFL-1.1) — هیچ
 * درخواستی به Google Fonts یا CDN خارجی زده نمی‌شود (اصل P2).
 */

/** نامِ خانواده‌ای که `@fontsource-variable/vazirmatn` ثبت می‌کند. */
export const FONT_FAMILY = "Vazirmatn Variable";

/**
 * منتظرِ آماده‌شدنِ فونت‌ها می‌مانَد — ولی نه بی‌نهایت. شبکه‌ی کند نباید رندر را
 * ابدی بلوکه کند، پس یک سقفِ زمانی هست.
 */
export async function whenFontsReady(timeoutMs = 3000): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  await Promise.race([
    document.fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
