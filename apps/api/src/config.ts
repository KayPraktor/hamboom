import {
  apiServerEnvSchema,
  appEnvSchema,
  authEnvSchema,
  databaseEnvSchema,
  loadEnv,
  otpEnvSchema,
  rateLimitEnvSchema,
  s3EnvSchema,
} from "@hamboom/config";

/**
 * پیکربندیِ `apps/api` — بخش‌هایی که مصرف‌کننده دارند: appEnv (LOG/APP_ENV)، databaseEnv
 * (پلاگینِ db)، authEnv (JWT/TTL)، otpEnv، rateLimit، و s3 (snapshot/asset — گام ۵٫۴/۵٫۵).
 * هر بخش با مصرف‌کننده‌اش اضافه می‌شود — اصلِ افزایشیِ config.
 *
 * ★ تایپ از `loadEnv` استخراج می‌شود (نه import مستقیمِ `zod`).
 */
const apiEnvSchema = appEnvSchema
  .and(databaseEnvSchema)
  .and(authEnvSchema)
  .and(otpEnvSchema)
  .and(apiServerEnvSchema)
  .and(rateLimitEnvSchema)
  .and(s3EnvSchema);

export function loadApiConfig() {
  return loadEnv(apiEnvSchema);
}

export type ApiConfig = ReturnType<typeof loadApiConfig>;

/** رازِ HS256 به بایت — auth-core آن را `Uint8Array` می‌گیرد (نه رشته). */
export function secretBytes(config: ApiConfig): Uint8Array {
  return new TextEncoder().encode(config.JWT_SECRET);
}
