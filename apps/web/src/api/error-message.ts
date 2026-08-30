import { SdkError } from "@hamboom/sdk";

/**
 * پیامِ فارسیِ خطا برای نمایش. `SdkError` پیامِ §۵ی سرور را دارد (فارسیِ آماده)؛
 * هر چیزِ دیگر (قطعِ شبکه و…) یک پیامِ عمومی می‌گیرد.
 */
export function errorMessage(error: unknown): string {
  return error instanceof SdkError
    ? error.message
    : "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";
}
