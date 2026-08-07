/**
 * لاگِ سرور — کمینه، ساخت‌یافته، و **بدونِ PII** (اصل P7).
 *
 * ── چرا کتابخانه نیاورد ───────────────────────────────────────────────
 *
 * `pino` گزینه‌ی طبیعی بود، ولی مانیتورینگ و لاگِ متمرکز کارِ **M5** است
 * ([ADR-020](../../../ARCHITECTURE_DECISIONS.md#adr-020)) و هنوز تصمیمِ فرمت
 * گرفته نشده. آوردنِ pino الان یعنی انتخابِ آن تصمیم از پیش، برای سه فراخوانیِ
 * لاگ. این فایل عمداً کوچک است تا M5 راحت جایگزینش کند.
 *
 * ── ★★ چرا ماسک‌کردن **ساختاری** است، نه یک قرارداد ───────────────────
 *
 * P7 می‌گوید «شناسه‌ی کاربر ماسک‌شده، توکن هرگز». اگر این فقط یک **قاعده** بود،
 * اولین `log.info({ sub })`ِ فراموش‌شده نقضش می‌کرد و هیچ‌جا دیده نمی‌شد. پس:
 *
 * - `maskSubject` تنها راهِ گذاشتنِ شناسه‌ی کاربر در لاگ است.
 * - `logger` هر مقداری را که **شبیهِ توکن** باشد قبل از نوشتن حذف می‌کند
 *   (`redactSecrets`) — یعنی حتی اگر کسی توکن را پاس بدهد، به خروجی نمی‌رسد.
 *
 * نگهبانش تستی است که خروجیِ کلِ مسیرِ دست‌دادن را برای الگوی توکن اسکن می‌کند.
 */

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const ORDER: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/**
 * شناسه‌ی کاربر → شکلِ قابلِ ردگیری ولی **غیرقابلِ شناسایی**.
 *
 * ★ چهار کاراکترِ اول کافی است که دو نشستِ یک کاربر را در لاگ به هم وصل کنی،
 * ولی نه کافی که کاربر را از روی لاگ پیدا کنی. برای شناسه‌ی کوتاه هم چیزی لو
 * نمی‌دهد چون طولِ خروجی ثابت است.
 *
 * ⚠️ همین قاعده برای شماره‌ی موبایل هم هست (P7)، ولی این سرور اصلاً شماره
 * نمی‌بیند — اگر روزی دید، همین‌جا تابعِ خودش را بگیرد، نه اینکه از این یکی
 * استفاده کند.
 */
export function maskSubject(sub: string): string {
  if (sub.length === 0) return "u_؟";
  return `${sub.slice(0, 4)}…`;
}

/**
 * حذفِ هر چیزی که شبیهِ راز است — **آخرین سد**، نه اولین.
 *
 * الگو عمداً پهن است: هر رشته‌ی بلندِ base64url‌مانند یا سه‌بخشیِ JWT. مثبتِ کاذب
 * (مثلاً یک شناسه‌ی طولانی) هزینه‌اش خوانایی است؛ منفیِ کاذب هزینه‌اش نشتِ توکن.
 */
const SECRET_SHAPES: RegExp[] = [
  /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /[A-Za-z0-9_-]{40,}/g, // رشته‌ی بلندِ تصادفی
];

export function redactSecrets(value: string): string {
  let out = value;
  for (const shape of SECRET_SHAPES) out = out.replace(shape, "[redacted]");
  return out;
}

export interface Logger {
  fatal(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** مقصد — تزریق‌پذیر تا تستِ نگهبانِ P7 خروجی را واقعاً بخواند. */
  write?: (line: string) => void;
}

export function createLogger({
  level = "info",
  write = (line) => process.stdout.write(`${line}\n`),
}: LoggerOptions = {}): Logger {
  const threshold = ORDER[level];

  const emit = (severity: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[severity] > threshold) return;
    const line = JSON.stringify({
      level: severity,
      time: new Date().toISOString(),
      message,
      ...fields,
    });
    // ★ redact روی **کلِ خط** اجرا می‌شود، نه فقط روی فیلدهای شناخته‌شده — چون
    //   چیزی که از قلم می‌افتد همیشه همان فیلدی است که کسی فکرش را نکرده.
    write(redactSecrets(line));
  };

  return {
    fatal: (message, fields) => emit("fatal", message, fields),
    error: (message, fields) => emit("error", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    info: (message, fields) => emit("info", message, fields),
    debug: (message, fields) => emit("debug", message, fields),
  };
}
