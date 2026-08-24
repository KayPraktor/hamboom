/**
 * پیکربندیِ لاگِ P7 — [ADR-020](../../../ARCHITECTURE_DECISIONS.md#adr-020).
 *
 * ★ **هیچ PII در لاگ.** آخرین سدِ دفاعی: pino هر مسیرِ حساس را به `[Redacted]` تبدیل
 * می‌کند. این جای «ماسک در منبع» را نمی‌گیرد (شماره با `maskPhone`، کدِ OTP اصلاً لاگ
 * نمی‌شود) — بلکه دفاعِ لایه‌ایِ دوم است برای وقتی چیزی سهواً لاگ شود.
 *
 * ⚠️ **fastify به‌صورت پیش‌فرض هدرها را لاگ نمی‌کند** (سریالایزرِ req فقط method/url)، ولی
 * اگر جایی `req.headers` یا شیئی با توکن صریحاً لاگ شود، این فهرست می‌گیردش. نگهبانش
 * `logger.test.ts` است که با یک نشتِ عمدی ثابت می‌کند redact **شلیک می‌کند**.
 *
 * ⚠️ **یکی‌شدن با نسخه‌ی realtime** (`apps/realtime/src/log.ts`) نیتِ «لیستِ مرکزی»ِ ADR-020
 * است؛ فعلاً اینجا، انتقال به یک ابزارِ مشترک یک گامِ آینده است (ثبت‌شده در PROGRESS).
 */
export const LOG_REDACT_PATHS = [
  // هدرهایی که توکن/کوکی حمل می‌کنند:
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  'req.headers["x-refresh-token"]',
  // دفاعِ لایه‌ای روی هر شیئی که صریح لاگ شود (یک سطح عمق):
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.refresh_token",
  "*.code", // کدِ OTP
  "*.otp",
  "*.codeHash",
  "*.code_hash",
  "*.secret",
] as const;

export const LOG_REDACT_CENSOR = "[Redacted]";

/** گزینه‌های loggerِ pino که fastify مصرف می‌کند — تنها منبعِ redact. */
export function loggerOptions(level: string): {
  level: string;
  redact: { paths: string[]; censor: string };
} {
  return {
    level,
    redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR },
  };
}
