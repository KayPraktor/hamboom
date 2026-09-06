import type pg from "pg";

import type { ApiConfig } from "./config.ts";

/**
 * فیکسچرهای مشترکِ تست — `TEST_CONFIG` + `fakeDb`. (نه تستِ خودش؛ vitest فقط `*.test.ts` را اجرا می‌کند.)
 *
 * db تزریق می‌شود پس اتصالِ واقعی نمی‌خورد؛ نمونه‌ی S3Client تنبل است (تا درخواستی نیاید شبکه نمی‌زند).
 */
export const TEST_CONFIG: ApiConfig = {
  NODE_ENV: "test",
  APP_ENV: "local",
  LOG_LEVEL: "fatal",
  DATABASE_URL: "postgres://unused@localhost/none",
  DATABASE_SSL: false,
  DATABASE_POOL_MAX: 1,
  JWT_SECRET: "test_secret_at_least_thirty_two_chars_long",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  RT_TOKEN_TTL_SECONDS: 60,
  OTP_TTL_SECONDS: 120,
  OTP_MAX_ATTEMPTS: 5,
  OTP_COOLDOWN_SECONDS: 60,
  OTP_DEV_FIXED_CODE: undefined,
  PORT: 3002,
  RATE_LIMIT_MAX: 100,
  RATE_LIMIT_WINDOW_SECONDS: 60,
  RATE_LIMIT_OTP_MAX: 5,
  S3_ENDPOINT: "http://localhost:9999",
  S3_REGION: "ir-thr-at1",
  S3_ACCESS_KEY_ID: "unused",
  S3_SECRET_ACCESS_KEY: "unused",
  S3_FORCE_PATH_STYLE: true,
  S3_PRESIGN_TTL_SECONDS: 900,
  S3_BUCKET_ASSETS: "hamboom-assets",
  S3_BUCKET_SNAPSHOTS: "hamboom-snapshots",
  UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  // ── billing (M4 فاز ۵) — تست هرگز به درگاهِ واقعی نمی‌رسد؛ `buildApp` هم `gateway`
  //    را تزریق‌پذیر گرفته، پس این‌ها فقط برای کاملی تایپ‌اند.
  PAYMENT_PROVIDER: "mock",
  ZARINPAL_MODE: "sandbox",
  ZARINPAL_MERCHANT_ID: undefined,
  ZARINPAL_CURRENCY: "IRR",
  ZARINPAL_CALLBACK_URL: "http://localhost:3002/billing/zarinpal/callback",
  VAT_PERCENT: 0,
  WEB_BASE_URL: "http://localhost:5173",
  // ── آشتی‌دهی (M4 فاز ۷) — در تست **خاموش**: یک تایمر در تستِ واحد فقط نویز و نشتِ
  //    handle است. رفتارِ روشنش جای دیگری اثبات می‌شود (سنجه‌ی زنده‌ی فاز ۷).
  BILLING_RECONCILE_ENABLED: false,
  BILLING_RECONCILE_INTERVAL_SECONDS: 300,
  BILLING_PENDING_STALE_MINUTES: 20,
  BILLING_PENDING_EXPIRE_HOURS: 72,
  BILLING_RECONCILE_BATCH: 50,
  BILLING_ADOPT_ORPHANS: false,
};

/** استخرِ دروغینِ db — فقط `query`/`end`. تست بدونِ Postgres. */
export function fakeDb(queryImpl: () => Promise<{ rows: unknown[] }>): pg.Pool {
  return { query: queryImpl, end: (): Promise<void> => Promise.resolve() } as unknown as pg.Pool;
}
