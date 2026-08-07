/**
 * کدهای خطای پروتکل — [PLAN بخش ۵٫۳](../../../PLAN.md)، پیامِ `0x14 HB_ERROR`.
 *
 * ⚠️ **این تکه‌ای از گام ۲٫۴ است که زودتر آمد**، و عمداً: گام ۲٫۳ به
 * `CLIENT_TOO_OLD` نیاز داشت و تنها گزینه‌ی دیگر یک **رشته‌ی جادویی** بود که بعداً
 * در `protocol.ts` تکرار می‌شد. یک enum که دو نسخه دارد، enum نیست. گام ۲٫۴ همین
 * را مصرف می‌کند، نه یک کپیِ دوم.
 */
export const HB_ERROR_CODES = {
  /** سندِ اتاق از چیزی که این کلاینت می‌فهمد جلوتر است → باید رفرش کند. */
  CLIENT_TOO_OLD: "CLIENT_TOO_OLD",
  /** نقشِ کاربر اجازه‌ی این کار را نمی‌دهد ([ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012)). */
  FORBIDDEN: "FORBIDDEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  /**
   * ★ سه کدِ **جدا** برای سه وضعیتِ احراز هویت (گام ۴٫۱) — عمداً، چون کارِ کلاینت
   * در هرکدام فرق می‌کند: نبودِ توکن یعنی «اصلاً وارد نشده‌ای» (برو ورود)،
   * انقضا یعنی «توکنت کهنه است» (تازه‌اش کن — `HB_AUTH_REFRESH` برای همین است)،
   * و نامعتبر یعنی «امضا نخواند» که یک رویدادِ **امنیتی** است، نه یک خطای عادی.
   *
   * ⚠️ ولی «توکنِ معتبر برای بوردِ دیگر» عمداً `FORBIDDEN` می‌شود، نه کدی که
   * بگوید آن بورد وجود دارد یا نه — وگرنه همین خطا به یک ابزارِ شمارشِ بورد
   * تبدیل می‌شود.
   */
  TOKEN_INVALID: "TOKEN_INVALID",
  TOKEN_MISSING: "TOKEN_MISSING",
  DOC_TOO_LARGE: "DOC_TOO_LARGE",
  ROOM_CLOSED: "ROOM_CLOSED",
} as const;

export type HbErrorCode = (typeof HB_ERROR_CODES)[keyof typeof HB_ERROR_CODES];
