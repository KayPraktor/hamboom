import {
  apiServerEnvSchema,
  assertProductionConfig,
  appEnvSchema,
  authEnvSchema,
  databaseEnvSchema,
  loadEnv,
  otpEnvSchema,
  paymentEnvSchema,
  rateLimitEnvSchema,
  s3EnvSchema,
  uploadEnvSchema,
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
  .and(s3EnvSchema)
  .and(uploadEnvSchema)
  .and(paymentEnvSchema);

export function loadApiConfig() {
  const config = loadEnv(apiEnvSchema);
  // ★★ گاردهای production (M5 گام ۴٫۱) — این‌جا و نه فقط در `buildApp`، چون
  //    اسکریپت‌های اپراتور هم از همین مسیر رد می‌شوند.
  assertProductionConfig(config);
  return config;
}

/**
 * ★ پیکربندیِ **باریکِ** کارِ آشتی‌دهی — M5 گام ۴٫۲.
 *
 * ⚠️ **یافته‌ی فاز ۲:** کانتینرِ یک‌بارمصرفِ آشتی‌دهی `loadApiConfig` را صدا می‌زد، پس
 * `JWT_SECRET` و کلیدهای `S3_*` را **لازم داشت** — با اینکه هیچ‌کدام را مصرف نمی‌کند.
 * یک ابزارِ اپراتور نباید رازِ امضای توکن را ببیند فقط به این دلیل که schema یک‌تکه بود.
 *
 * ⊕ `apiServerEnvSchema` این‌جاست چون `createPaymentGateway` برای URLِ صفحه‌ی mock به
 * `PORT` نگاه می‌کند؛ راز نیست و پیش‌فرض دارد.
 */
const reconcileEnvSchema = appEnvSchema
  .and(databaseEnvSchema)
  .and(apiServerEnvSchema)
  .and(paymentEnvSchema);

export function loadReconcileConfig() {
  const config = loadEnv(reconcileEnvSchema);
  assertProductionConfig(config);
  return config;
}

export type ReconcileConfig = ReturnType<typeof loadReconcileConfig>;

export type ApiConfig = ReturnType<typeof loadApiConfig>;

/** رازِ HS256 به بایت — auth-core آن را `Uint8Array` می‌گیرد (نه رشته). */
export function secretBytes(config: ApiConfig): Uint8Array {
  return new TextEncoder().encode(config.JWT_SECRET);
}
