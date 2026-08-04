import { z } from "zod";

/**
 * بخش‌های schema متغیرهای محیطی — PLAN.md بخش ۴.
 *
 * عمداً **ترکیب‌پذیر** است، نه یک schema بزرگِ واحد: هر اپ فقط بخش‌هایی را که
 * مصرف می‌کند لازم دارد. اگر یک schema واحد بود، `apps/realtime` برای بالا آمدن
 * مجبور بود `ZARINPAL_MERCHANT_ID` هم داشته باشد — و آن‌وقت اولین کاری که کسی
 * می‌کند این است که یک مقدارِ الکی بگذارد تا رد شود، و از آن به بعد گیت مرده است.
 *
 * M3/M4 بخش‌های خودشان (S3، احراز هویت، پیامک، زرین‌پال) را از PLAN بخش ۴
 * همین‌جا اضافه می‌کنند.
 */

/**
 * بولینِ محیطی.
 *
 * `Boolean("false") === true` است، پس `z.coerce.boolean()` برای متغیرِ محیطی
 * **غلط** است و بی‌صدا هر مقداری را `true` می‌کند. اینجا فقط دو رشته‌ی صریح.
 */
function envBoolean(defaultValue: "true" | "false") {
  return z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");
}

/** عددِ صحیحِ مثبت از رشته‌ی محیطی. */
function envInt(defaultValue: number) {
  return z.coerce.number().int().positive().default(defaultValue);
}

/** ── عمومی ─────────────────────────────────────────────────────────── */
export const appEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * ★ محیطِ منطقیِ اپ — با `NODE_ENV` یکی نیست.
   *
   * گیتِ [ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031) روی **همین** می‌نشیند:
   * با `production`، پیاده‌سازی‌های dev (مثلِ `DevBoardAuthority`) نباید بالا بیایند.
   */
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});
export type AppEnv = z.infer<typeof appEnvSchema>;

/** ── PostgreSQL ────────────────────────────────────────────────────── */
export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "باید یک رشته‌ی اتصالِ معتبرِ postgres باشد"),
  DATABASE_SSL: envBoolean("false"),
  DATABASE_POOL_MAX: envInt(20),
});
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/** ── Redis ─────────────────────────────────────────────────────────── */
export const redisEnvSchema = z.object({
  REDIS_URL: z.string().min(1, "باید یک رشته‌ی اتصالِ معتبرِ redis باشد"),
  REDIS_TLS: envBoolean("false"),
});
export type RedisEnv = z.infer<typeof redisEnvSchema>;

/** ── Realtime (M2) ─────────────────────────────────────────────────── */
export const realtimeEnvSchema = z.object({
  RT_PORT: envInt(3001),
  RT_MAX_ROOMS_PER_NODE: envInt(500),
  RT_ROOM_IDLE_TIMEOUT_MS: envInt(120_000),
  /** باید **کوتاه‌تر** از idle timeoutِ لودبالانسر باشد — ADR-006. */
  RT_HEARTBEAT_INTERVAL_MS: envInt(25_000),
  RT_SNAPSHOT_EVERY_UPDATES: envInt(500),
  RT_SNAPSHOT_EVERY_MS: envInt(60_000),
  /** سقفِ سختِ حجمِ هر بورد — ریسکِ ثبت‌شده در PLAN بخش ۱۰. */
  RT_MAX_DOC_BYTES: envInt(52_428_800),
});
export type RealtimeEnv = z.infer<typeof realtimeEnvSchema>;

/**
 * ── احراز هویتِ توسعه‌ای ────────────────────────────────────────────
 *
 * ★ فقط تا وقتی M3 نیامده ([ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031)).
 * حداقلِ ۳۲ کاراکتر الزامی است تا کسی در محیطِ مشترک با یک کلیدِ کوتاه توکن جعل نکند.
 */
export const devAuthEnvSchema = z.object({
  RT_DEV_JWT_SECRET: z.string().min(32, "حداقل ۳۲ کاراکتر لازم است"),
});
export type DevAuthEnv = z.infer<typeof devAuthEnvSchema>;
