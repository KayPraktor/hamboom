import type { HbErrorCode } from "@hamboom/ydoc-schema";

/**
 * خطایی که به کلاینت **کدِ پروتکلی** می‌دهد و اتصال را می‌بندد.
 *
 * ── چرا یک پایه‌ی مشترک ───────────────────────────────────────────────
 *
 * گام ۴٫۱ فقط یک منبعِ رد داشت (احراز هویت) و `AuthError` کافی بود. گام ۴٫۲
 * منبعِ دوم را آورد (سقفِ اتاق و حجمِ سند) و همان‌جا معلوم شد که سرور نباید
 * بداند خطا از کدام لایه آمده — فقط باید بداند **کدش چیست**. یک پایه یعنی یک
 * مسیرِ رد در `server.ts`، نه یکی به‌ازای هر لایه.
 *
 * ★ `message` چیزی است که **کاربر** می‌بیند و باید بی‌جزئیات باشد؛ `detail` فقط
 * برای لاگِ سرور است و هرگز روی سیم نمی‌رود.
 */
export class RtProtocolError extends Error {
  readonly code: HbErrorCode;
  /** فقط برای لاگِ سرور — هرگز روی سیم نمی‌رود. */
  readonly detail?: string;

  constructor(code: HbErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "RtProtocolError";
    this.code = code;
    this.detail = detail;
  }
}
