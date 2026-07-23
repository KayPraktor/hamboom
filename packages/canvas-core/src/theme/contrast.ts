/**
 * محاسبه‌ی کنتراست رنگ طبق WCAG 2.1.
 *
 * ── چرا خودمان می‌نویسیم ──────────────────────────────────────────────
 *
 * این تابع **گیت پالت** است: تستی که مطمئن می‌شود هیچ رنگ استیکی با متن
 * روی آن غیرقابل‌خواندن نیست. یک گیت که خودش آزموده نشده، گیت نیست — پس
 * فرمول با مقادیر مرجع شناخته‌شده (سیاه روی سفید = ۲۱، رنگ روی خودش = ۱)
 * تست می‌شود، نه فقط با رنگ‌های خودمان.
 *
 * فرمول: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */

/** آستانه‌ی WCAG AA برای متن معمولی. */
export const WCAG_AA_TEXT = 4.5;

/** آستانه‌ی WCAG AA برای متن بزرگ و اجزای رابط (مثل نوار انتخاب). */
export const WCAG_AA_LARGE = 3;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#RGB` یا `#RRGGBB` → مولفه‌های ۰ تا ۲۵۵. */
export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`رنگ نامعتبر: «${hex}» — انتظار #RGB یا #RRGGBB`);
  }

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** خطی‌سازی یک مولفه‌ی sRGB — گام لازم قبل از محاسبه‌ی روشنایی. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** روشنایی نسبی (۰ = سیاه، ۱ = سفید). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** نسبت کنتراست بین دو رنگ — بین ۱ (یکسان) و ۲۱ (سیاه/سفید). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** آیا این جفت برای متن معمولی به WCAG AA می‌رسد؟ */
export function meetsWcagAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= WCAG_AA_TEXT;
}

/** آیا این جفت برای اجزای رابط (نه متن) به WCAG AA می‌رسد؟ */
export function meetsWcagAALarge(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= WCAG_AA_LARGE;
}
