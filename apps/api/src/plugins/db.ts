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
  /** سقفِ اجرای یک دستور. صفر یعنی بی‌سقف (پیش‌فرضِ خودِ Postgres). */
  statementTimeoutMs?: number;
  /** ★ سقفِ **بی‌کاریِ داخلِ تراکنش** — نگهبانِ واقعیِ M4 (پایین). */
  idleInTransactionTimeoutMs?: number;
  /**
   * ★★ سقفِ **برقراریِ اتصال** — M5 گام ۵٫۳، از یک اندازه‌گیری آمد نه از سلیقه.
   *
   * ⚠️ بدونِ این، وقتی میزبانِ دیتابیس **غیرقابلِ دسترس** باشد (نه «رد شده»)، `pool.query`
   * منتظرِ تایم‌اوتِ TCPِ سیستم‌عامل می‌مانَد: `/readyz` اندازه‌گیری شد و **۲۱ ثانیه** طول
   * کشید. یک probeِ استقرار که ۲۱ ثانیه جواب ندهد، عملاً یعنی نودِ سالم هم unhealthy
   * علامت می‌خورد. (با اتصالِ **refused** مسئله‌ای نبود: ۸ میلی‌ثانیه.)
   */
  connectionTimeoutMs?: number;
}

/**
 * سقف‌های زمانیِ اتصال — ارثیه‌ی ثبت‌شده‌ی M4 فاز ۵٫۹، این‌جا بسته می‌شود.
 *
 * ★★ **مسئله‌ی مشخص:** `settlePayment` عمداً تماسِ شبکه‌ایِ درگاه را **داخلِ** تراکنش نگه
 * می‌دارد (ADR-055) تا verify و فعال‌سازی اتمیک بمانند. یعنی یک اتصالِ استخر برای تمامِ
 * رفت‌وبرگشتِ درگاه اشغال است — و آن اتصال در آن لحظه **دستوری اجرا نمی‌کند**، پس
 * `statement_timeout` اصلاً نمی‌بیندش. نگهبانش `idle_in_transaction_session_timeout` است:
 * اگر درگاه هرگز جواب ندهد و حتی `AbortSignal` هم به هر دلیلی نگیرد، Postgres خودش نشست را
 * می‌بندد، تراکنش rollback می‌شود، ردیف `pending` می‌مانَد و **آشتی‌دهی دوباره سراغش می‌رود**.
 * بدونِ آن، `DATABASE_POOL_MAX` اتصالِ آویزان کافی است تا کلِ api از کار بیفتد.
 *
 * ⚠️ عدد باید از سقفِ خودِ درگاه (۱۵ ثانیه، `zarinpal-gateway.ts`) **بزرگ‌تر** باشد، وگرنه
 * یک پرداختِ کُندِ سالم را وسطِ کار می‌کُشد.
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;
/** ⚠️ باید از سقفِ probeِ استقرار کوتاه‌تر باشد. دلیلِ عددش در `connectionTimeoutMs`. */
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

/** استخرِ `pg` می‌سازد و کوئرسِ P5 را تضمین می‌کند. */
export function createDbPool(config: DbPoolConfig): pg.Pool {
  registerInt8Parser();
  return new pg.Pool({
    connectionString: config.connectionString,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: config.poolMax,
    statement_timeout: config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout:
      config.idleInTransactionTimeoutMs ?? DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
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
