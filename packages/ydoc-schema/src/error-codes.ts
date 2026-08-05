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
  DOC_TOO_LARGE: "DOC_TOO_LARGE",
  ROOM_CLOSED: "ROOM_CLOSED",
} as const;

export type HbErrorCode = (typeof HB_ERROR_CODES)[keyof typeof HB_ERROR_CODES];
