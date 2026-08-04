import type { z } from "zod";

/**
 * ★ **تنها نقطه‌ای در کل ریپو که `process.env` خوانده می‌شود** (PLAN بخش ۴).
 *
 * یک قاعده‌ی ESLint (`processEnvDiscipline`) این را در بقیه‌ی پکیج‌ها خطا می‌کند.
 * دلیلش سلیقه نیست: وقتی `process.env.FOO` در ده جا پخش باشد، هر کدام
 * پیش‌فرضِ خودش را می‌گذارد، `undefined` بی‌صدا به رشته‌ی `"undefined"` تبدیل
 * می‌شود، و متغیرِ گم‌شده به‌جای اینکه در بوت داد بزند، سه لایه پایین‌تر در
 * زمانِ اجرا خودش را نشان می‌دهد.
 */

/** خطای پیکربندی — همیشه در بوت رخ می‌دهد، هرگز وسطِ کار. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** منبعِ متغیرها — در تست می‌شود یک شیء ساختگی داد. */
export type EnvSource = Record<string, string | undefined>;

/**
 * خطاهای zod را به یک پیامِ **قابلِ عمل** تبدیل می‌کند.
 *
 * پیامِ خامِ zod برای این کار بد است: نامِ متغیر را وسطِ یک ساختارِ تودرتو
 * می‌گذارد و به کسی که `.env` را فراموش کرده نمی‌گوید کجا را نگاه کند.
 */
function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  const lines = issues.map((issue) => {
    const name = issue.path.join(".") || "(ریشه)";
    const missing = issue.code === "invalid_type" && issue.input === undefined;
    return missing ? `  • ${name} — تعریف نشده` : `  • ${name} — ${issue.message}`;
  });

  return [
    "‏[hamboom] پیکربندی نامعتبر است؛ اجرا متوقف شد.",
    ...lines,
    "",
    "‏`.env.example` را ببین (تنها منبعِ حقیقتِ نامِ متغیرها) و از رویش `.env` بساز.",
  ].join("\n");
}

/**
 * یک schema را روی متغیرهای محیطی اعتبارسنجی می‌کند و **در بوت** شکست می‌خورد.
 *
 * هر اپ فقط بخش‌هایی را که واقعاً لازم دارد ترکیب می‌کند؛ به این ترتیب پیامِ خطا
 * دقیقاً همان متغیرهایی را نام می‌برد که آن اپ نیاز دارد، نه کلِ فهرستِ پروژه.
 */
export function loadEnv<T extends z.ZodType>(
  schema: T,
  source: EnvSource = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) throw new ConfigError(formatIssues(result.error.issues));
  return result.data;
}
