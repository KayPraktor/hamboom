/**
 * انتخابِ فرستنده‌ی پیامک از روی پیکربندی — M5 فازِ ۴٫۵.
 *
 * ★ دقیقاً جفتِ [`plugins/payment.ts`](plugins/payment.ts): پورت در `auth-core` است، دو
 * پیاده‌سازی دارد، و انتخاب **فقط** با یک متغیرِ محیطی انجام می‌شود.
 *
 * ⚠️ **چرا `Pick` و نه کلِ `ApiConfig`:** همان درسِ فاز ۴ — یک تابع که کلِ config را
 * بگیرد، فردا می‌تواند بی‌سروصدا به `JWT_SECRET` هم نگاه کند و هیچ تستی نمی‌گیردش.
 */
import type { SmsProvider } from "@hamboom/auth-core";
import { createMockSmsProvider, createSmsIrProvider } from "@hamboom/auth-core";

import type { ApiConfig } from "./config.ts";

export type SmsConfig = Pick<
  ApiConfig,
  | "SMS_PROVIDER"
  | "SMS_IR_API_KEY"
  | "SMS_IR_TEMPLATE_ID"
  | "SMS_IR_PARAM_NAME"
  | "SMS_IR_BASE_URL"
  | "SMS_IR_TIMEOUT_MS"
>;

/**
 * `onMockCode` فقط برای `mock` صدا زده می‌شود.
 *
 * ★★ توجه: با `smsir` هیچ راهی برای دیدنِ کد در لاگ **وجود ندارد** — و این عمدی است.
 * چاپِ کد فقط خاصیتِ mock است (P7)، نه یک قابلیتِ عمومی که بشود در production روشنش کرد.
 */
export function createSmsProvider(
  config: SmsConfig,
  onMockCode: (phone: string, code: string) => void,
): SmsProvider {
  if (config.SMS_PROVIDER === "smsir") {
    // ⚠️ پیکربندیِ ناقص همین‌جا می‌شکند (`SmsIrConfigError`) — سرِ بوت، نه سرِ اولین
    //    ورودِ یک کاربرِ واقعی. همان الگوی `ZARINPAL_MERCHANT_ID`ِ M4.
    return createSmsIrProvider({
      apiKey: config.SMS_IR_API_KEY,
      templateId: config.SMS_IR_TEMPLATE_ID,
      parameterName: config.SMS_IR_PARAM_NAME,
      baseUrl: config.SMS_IR_BASE_URL,
      timeoutMs: config.SMS_IR_TIMEOUT_MS,
    });
  }
  return createMockSmsProvider(onMockCode);
}
