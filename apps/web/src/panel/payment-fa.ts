import type { PaymentStatus } from "@hamboom/shared-types";

/**
 * برچسب‌های فارسیِ پرداخت — جدا از کامپوننت‌ها (Fast Refresh)، مثلِ [`status-fa.ts`](./status-fa.ts).
 *
 * ⚠️ `canceled` و `failed` عمداً **دو برچسبِ متفاوت** دارند: اولی یعنی کاربر رها کرد (یا ما باطل کردیم)،
 * دومی یعنی خودِ پرداخت شکست — و پشتیبانی باید بتواند این دو را در فهرست از هم تشخیص دهد.
 */
export const PAYMENT_STATUS_FA: Record<PaymentStatus, string> = {
  pending: "در انتظار",
  paid: "پرداخت‌شده",
  failed: "ناموفق",
  canceled: "باطل‌شده",
  refunded: "مسترد",
  verify_failed: "خطای تایید",
};

/** ریال → تومانِ خوانا. ★ نمایش تومان است و ذخیره ریال (P5) — تبدیل فقط همین‌جا. */
export const toman = (rial: number): string =>
  `${new Intl.NumberFormat("fa-IR").format(Math.round(rial / 10))} تومان`;
