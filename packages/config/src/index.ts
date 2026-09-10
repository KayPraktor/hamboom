/**
 * `@hamboom/config` — خواندن و اعتبارسنجیِ متغیرهای محیطی.
 *
 * ★ **تنها نقطه‌ی `process.env` در کل ریپو** (PLAN بخش ۴). قاعده‌ی ESLintِ
 * `processEnvDiscipline` بقیه‌ی پکیج‌ها را از خواندنِ مستقیم منع می‌کند.
 *
 * ```ts
 * const env = loadEnv(appEnvSchema.and(databaseEnvSchema));
 * //    ^ در بوت شکست می‌خورد، با نامِ دقیقِ متغیرِ گم‌شده — نه سه لایه پایین‌تر
 * ```
 */

// ⚠️ پسوندِ `.ts` روی importهای نسبی **لازم** است، نه سلیقه: این پکیج مستقیماً با
// Node اجرا می‌شود (`node scripts/migrate.ts`، و بعداً `apps/realtime`). Node
// برخلاف Vite پسوند را حدس نمی‌زند و با `ERR_MODULE_NOT_FOUND` می‌افتد.
// جزئیات در `CLAUDE.md` همین پکیج.
export { ConfigError, loadEnv } from "./load.ts";
export type { EnvSource } from "./load.ts";

// ★★ گاردهای بوتِ production (M5 گام ۴٫۱) — بینِ بخش‌ها، پس نمی‌توانند داخلِ zod باشند.
export {
  assertProductionConfig,
  isRemoteDatabaseHost,
  ProductionConfigError,
  weakSecretReason,
} from "./production-guards.ts";
export type { ProductionGuardInput } from "./production-guards.ts";

export {
  apiServerEnvSchema,
  appEnvSchema,
  authEnvSchema,
  backupEnvSchema,
  databaseEnvSchema,
  otpEnvSchema,
  paymentEnvSchema,
  rateLimitEnvSchema,
  realtimeEnvSchema,
  redisEnvSchema,
  retentionEnvSchema,
  s3EnvSchema,
  smsEnvSchema,
  uploadEnvSchema,
} from "./sections.ts";
export type {
  ApiServerEnv,
  AppEnv,
  AuthEnv,
  BackupEnv,
  DatabaseEnv,
  OtpEnv,
  PaymentEnv,
  RateLimitEnv,
  RealtimeEnv,
  RedisEnv,
  RetentionEnv,
  S3Env,
  SmsEnv,
  UploadEnv,
} from "./sections.ts";
