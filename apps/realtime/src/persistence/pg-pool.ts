import pg from "pg";

/**
 * استخرِ اتصالِ مشترکِ لایه‌ی پایداری.
 *
 * ★ **یک استخر برای هر دو جدول** (`board_updates` و `board_snapshots`) — نه از
 * سرِ صرفه‌جویی: در گام ۴٫۴ محاسبه‌ی `seq` به `board_snapshots` هم نگاه می‌کند،
 * پس این دو در یک دیتابیس و یک دیدِ تراکنشی‌اند. دو استخرِ جدا این را پنهان
 * می‌کرد و `DATABASE_POOL_MAX` را هم بی‌معنا (دو برابرِ سقفِ اعلام‌شده).
 */
export interface PgPoolOptions {
  connectionString: string;
  ssl?: boolean;
  /** `DATABASE_POOL_MAX`. */
  max?: number;
}

export function createPgPool({ connectionString, ssl = false, max = 10 }: PgPoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max,
  });
}
