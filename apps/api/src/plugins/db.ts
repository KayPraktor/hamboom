import pg from "pg";

/**
 * پلاگینِ دیتابیس — استخرِ `pg` + **کوئرسِ `int8`→number** (P5،
 * [ADR-015](../../../../ARCHITECTURE_DECISIONS.md#adr-015)).
 *
 * ★★ **چرا این کوئرس حیاتی است:** درایورِ `pg` به‌صورت پیش‌فرض `bigint` را **رشته**
 * می‌دهد تا دقت گم نشود. ولی پول در هم‌بوم `BIGINT` ریال است و همه‌جا `number` انتظار
 * می‌رود؛ اگر یک ستونِ رشته و یکی عدد باشد، محاسبه‌ها بی‌صدا خراب می‌شوند. پس در **یک**
 * جا (اینجا) OIDِ ۲۰ (`int8`) به `number` تبدیل می‌شود.
 *
 * ⚠️ **fail-loud روی سرریز:** اگر مقداری از `Number.MAX_SAFE_INTEGER` بگذرد، `number`
 * دقت را بی‌صدا از دست می‌دهد — که دقیقاً همان چیزی است که P5 می‌خواهد جلویش را بگیرد.
 * پس به‌جای تبدیلِ خاموش، **خطا** می‌دهیم. مبالغِ ریالِ واقعی خیلی زیرِ این سقف‌اند.
 */

const INT8_OID = 20;

/** پارسرِ ستونِ `bigint` — رشته → number، با خطا روی خارج از محدوده‌ی امن (P5). */
export function parseBigintColumn(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(
      `مقدارِ int8 خارج از محدوده‌ی امنِ JavaScript number است: «${value}» ` +
        "(P5/ADR-015). این یعنی احتمالِ گم‌شدنِ دقت در مبلغِ ریالی — به‌جای تبدیلِ خاموش خطا می‌دهیم.",
    );
  }
  return n;
}

let int8ParserRegistered = false;

/** کوئرسِ `int8`→number را **یک‌بار** روی درایورِ `pg` ثبت می‌کند (idempotent). */
export function registerInt8Parser(): void {
  if (int8ParserRegistered) return;
  pg.types.setTypeParser(INT8_OID, parseBigintColumn);
  int8ParserRegistered = true;
}

export interface DbPoolConfig {
  connectionString: string;
  ssl: boolean;
  poolMax: number;
}

/** استخرِ `pg` می‌سازد و کوئرسِ P5 را تضمین می‌کند. */
export function createDbPool(config: DbPoolConfig): pg.Pool {
  registerInt8Parser();
  return new pg.Pool({
    connectionString: config.connectionString,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: config.poolMax,
  });
}

/** هرچه `query` دارد — استخر یا کلاینتِ **درونِ تراکنش**. adapterها این را می‌گیرند تا هم مستقل و هم اتمی کار کنند. */
export type Executor = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

/**
 * یک واحدِ کار را در **یک تراکنش** اجرا می‌کند: BEGIN → fn → COMMIT، و روی هر خطا ROLLBACK.
 *
 * ★★ **قیدِ اتمی‌بودنِ فاز ۴→۵:** `rotateSession`ِ auth-core باید find+markUsed را در یک تراکنش
 * ببیند وگرنه دو درخواستِ همزمان reuse detection را دور می‌زنند. مصرف‌کننده `createPgSessionStore(tx)`
 * را با همین `tx` می‌سازد تا `SELECT … FOR UPDATE` واقعاً قفل کند.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (tx: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
