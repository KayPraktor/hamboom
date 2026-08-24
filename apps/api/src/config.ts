import { appEnvSchema, databaseEnvSchema, loadEnv } from "@hamboom/config";

/**
 * پیکربندیِ `apps/api` — فقط بخش‌هایی که **همین گام** مصرف‌کننده دارند
 * (appEnv برای LOG_LEVEL/APP_ENV، databaseEnv برای پلاگینِ db). بخش‌های احراز/نرخ/S3
 * با مصرف‌کننده‌شان اضافه می‌شوند (گام‌های بعدیِ فاز ۵) — همان اصلِ افزایشیِ `@hamboom/config`.
 *
 * ★ تایپ از `loadEnv` استخراج می‌شود (نه import مستقیمِ `zod`) — apps/api هنوز مصرف‌کننده‌ی
 *   مستقیمِ zod ندارد؛ وقتی اعتبارسنجیِ بدنه‌ها بیاید (endpointها) اضافه می‌شود.
 */
const apiEnvSchema = appEnvSchema.and(databaseEnvSchema);

export function loadApiConfig() {
  return loadEnv(apiEnvSchema);
}

export type ApiConfig = ReturnType<typeof loadApiConfig>;
