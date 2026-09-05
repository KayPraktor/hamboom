import { z } from "zod";

/**
 * کدهای خطای **HTTP** — [PLAN §۵](../../../../PLAN.md).
 *
 * ⚠️ جدا از `HB_ERROR_CODES`ِ پروتکلِ WS (در `ydoc-schema`): دو سطحِ متفاوت‌اند. فهرست فعلاً
 * همان‌هایی که endpointهای M3 تولید می‌کنند؛ فقط به **انتها** اضافه می‌شود.
 */
export const apiErrorCodes = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
  "USER_NOT_FOUND",
  "TEAM_NOT_FOUND",
  "BOARD_NOT_FOUND",
  "BOARD_ID_MALFORMED", // یافته‌ی M2 #۱: خطای «شکلِ» boardId کدِ خودش را دارد
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_TOO_MANY",
  "TOKEN_REUSED",
  // ── M4 (billing)، فاز ۲ — به **انتها** اضافه شدند، طبقِ قاعده‌ی بالا ──
  "PLAN_NOT_FOUND",
  "PLAN_INACTIVE",
  "SUBSCRIPTION_NOT_FOUND",
  "COUPON_INVALID",
  "COUPON_EXHAUSTED",
  "INVOICE_NOT_FOUND",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_FAILED",
  "GATEWAY_UNAVAILABLE",
  "QUOTA_EXCEEDED", // عبور از سقفِ پلن (ADR-053) — نه ۴۰۳ی مبهم، نه ۵۰۰
] as const;
export const apiErrorCode = z.enum(apiErrorCodes);
export type ApiErrorCode = z.infer<typeof apiErrorCode>;

/** قالبِ یکسانِ خطا — [PLAN §۵](../../../../PLAN.md). `message` فارسی و قابلِ نمایش به کاربر. */
export const apiError = z.object({
  error: z.object({
    code: apiErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiError>;
