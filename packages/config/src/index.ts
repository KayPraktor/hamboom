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

export {
  appEnvSchema,
  databaseEnvSchema,
  devAuthEnvSchema,
  realtimeEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
} from "./sections.ts";
export type { AppEnv, DatabaseEnv, DevAuthEnv, RealtimeEnv, RedisEnv, S3Env } from "./sections.ts";
