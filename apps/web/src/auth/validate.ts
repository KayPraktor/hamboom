import { toLatinDigits } from "@hamboom/i18n";

/**
 * نرمال‌سازی + اعتبارِ فرمتِ ورودی‌های ورود.
 *
 * ★ خالص و آزمودنی — عمداً از کامپوننت جدا: نگرانیِ واقعی «کاربر ارقام را **فارسی**
 * تایپ می‌کند» است و سرور ASCII می‌خواهد. این تنها جای تبدیل است.
 * ⚠️ اعتبارِ **تجاری** (شماره‌ی ثبت‌شده؟ کدِ درست؟) کارِ سرور است، نه اینجا.
 */

/** `09xxxxxxxxx`ِ نرمال‌شده، یا `null` اگر فرمت درست نباشد. */
export function normalizePhone(input: string): string | null {
  const normalized = toLatinDigits(input).trim();
  return /^09\d{9}$/.test(normalized) ? normalized : null;
}

/** کدِ ۶ رقمیِ نرمال‌شده، یا `null`. */
export function normalizeCode(input: string): string | null {
  const normalized = toLatinDigits(input).trim();
  return /^\d{6}$/.test(normalized) ? normalized : null;
}
