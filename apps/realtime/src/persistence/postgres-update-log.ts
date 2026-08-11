import type pg from "pg";

import { createLogger, type Logger } from "../log.ts";
import type { AppendedUpdate, UpdateLog } from "./update-log.ts";

/**
 * لاگِ update روی PostgreSQL — جدولِ `board_updates` از
 * [migrationِ ۰۰۰۱](../../../../infra/sql/migrations/0001_realtime_documents.sql).
 *
 * ── ★★ چرا `seq` در **یک** دستور گرفته می‌شود ─────────────────────────
 *
 * وسوسه‌اش این بود: `SELECT max(seq)` بعد `INSERT`. آن دو دستور یعنی یک پنجره‌ی
 * مسابقه بینشان — دو نوشتنِ همزمان هر دو `max` یکسانی می‌بینند و یکی‌شان
 * ایندکسِ یکتا را می‌شکند (یا بدتر، اگر ایندکس نبود، لاگ سوراخ می‌شد).
 *
 * پس `seq` **درونِ همان `INSERT`** محاسبه می‌شود. ایندکسِ یکتای
 * `(board_id, seq)` هم سرِ جایش می‌مانَد و **سدِ دوم** است: اگر باز هم دو نوشتن
 * به هم رسیدند، یکی‌شان خطا می‌گیرد و ما دوباره تلاش می‌کنیم — نه اینکه بی‌صدا
 * روی هم بنویسند. قفلِ صاحبِ گام ۴٫۷ سدِ سوم است، نه جایگزینِ این دو.
 *
 * ── ★★ و چرا `board_snapshots` هم در همان محاسبه هست (گام ۴٫۴) ─────────
 *
 * فشرده‌سازی ردیف‌های قدیمی را **حذف** می‌کند، پس `MAX(seq)`ِ `board_updates`
 * دیگر بلندترین شماره‌ی تاریخِ بورد نیست — و اگر همه‌ی ردیف‌ها فشرده شوند، صفر
 * می‌شود. آن‌وقت updateِ بعدی `seq = 1` می‌گیرد در حالی که snapshot می‌گوید «تا
 * ۵۰۰ در من هست»، و بارگذاریِ بعدی که `seq > 500` می‌خواهد **آن را نمی‌بیند**.
 * ★ هیچ خطایی هم نمی‌دهد؛ فقط کارِ کاربر ناپدید می‌شود. پس شمارنده از
 * `GREATEST(MAX(seq), MAX(seq_upto))` می‌آید.
 *
 * ⚠️ **زمان از ساعتِ دیتابیس خوانده می‌شود** (`RETURNING created_at`)، نه از
 * ساعتِ اپ: `SaveState.at` چیزی است که کاربر می‌بیند، و اگر ساعتِ نودها با هم
 * اختلاف داشته باشند «ذخیره شد در ۱۲:۰۳» روی دو تب دو عدد می‌شود.
 */

/**
 * تلاشِ دوباره روی برخوردِ ایندکسِ یکتا.
 *
 * ⚠️ **این سدِ دوم است، نه راهکارِ همزمانی.** گام ۴٫۴ به‌سختی یاد گرفت که چرا:
 * پایین را بخوان («صفِ هر بورد»).
 */
const MAX_SEQ_RETRIES = 5;
const UNIQUE_VIOLATION = "23505";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ★★ **دوام نباید به یک فیلدِ ممیزی گره بخورد.**
 *
 * `origin_user_id` ستونِ `uuid` است (PLAN بخش ۶؛ M3 رویش FK می‌گذارد)، ولی
 * `sub`ِ توکن لزوماً uuid نیست. اولین بار که این پیش آمد، **هر** appendی با
 * `invalid input syntax for type uuid` می‌افتاد — یعنی پایداری کامل خراب بود،
 * در حالی که همه‌ی تست‌های واحد سبز بودند (لاگِ حافظه‌ای uuid نمی‌فهمد).
 *
 * ⚠️ تستِ SIGKILL این را گرفت، نه بازبینی. درسش: هر ستونی که **لازمِ** دوام
 * نیست، نباید بتواند دوام را بشکند.
 */
export function auditableUserId(sub: string | null): string | null {
  return sub !== null && UUID.test(sub) ? sub : null;
}

export interface PostgresUpdateLogOptions {
  /** استخرِ مشترک — [`createPgPool`](./pg-pool.ts). */
  pool: pg.Pool;
  logger?: Logger;
}

export function createPostgresUpdateLog({
  pool,
  logger = createLogger(),
}: PostgresUpdateLogOptions): UpdateLog {
  /** فقط یک بار هشدار بده — وگرنه هر update یک خط لاگ می‌شود. */
  let warnedAboutSub = false;

  /**
   * ★★ **صفِ هر بورد — کشفِ گران‌قیمتِ گام ۴٫۴.**
   *
   * سنجه‌ی ۵۰۰ updateِ واقعی نشان داد **۴۳ تا از ۵۰۰** append گم می‌شوند. علتش
   * ساده و مهلک است: `seq` از `GREATEST(MAX(seq), …) + 1` می‌آید، و دو
   * تراکنشِ همزمان زیرِ `READ COMMITTED` **ردیفِ commitنشده‌ی هم را نمی‌بینند**،
   * پس هر دو یک عدد می‌گیرند. یکی می‌نشیند، آن یکی به ایندکسِ یکتا می‌خورد.
   * با ۵۰۰ نوشتنِ همزمان این تصادف نادر نیست — قاعده است؛ پنج تلاش تمام می‌شود
   * و update **از بین می‌رود**.
   *
   * ⚠️ و در تستِ گام ۴٫۳ هرگز دیده نمی‌شد: آنجا **یک** update بود. همزمانی
   * چیزی است که فقط با بار دیده می‌شود.
   *
   * ★ پس تخصیصِ `seq` برای هر بورد **سریالی** است. سه سود دارد و یک هزینه:
   *   ۱. برخورد از بین می‌رود، نه اینکه با تلاشِ بیشتر پنهان شود.
   *   ۲. ترتیبِ نوشتن = ترتیبِ رسیدن، پس `since` هم همان ترتیب را می‌دهد.
   *   ۳. `room.seq` دیگر عقب نمی‌رود (پیش‌تر یک appendِ کندترِ با seqِ کوچک‌تر
   *      عددِ بزرگ‌ترِ قبلی را بازمی‌نوشت و «ذخیره شد» پس می‌رفت).
   *   ⚠️ هزینه: نوشتنِ یک بورد موازی نمی‌شود. برای یک بورد اشکالی ندارد —
   *      قفلِ صاحبِ گام ۴٫۷ همین را در سطحِ نود رسمی می‌کند — ولی بوردهای
   *      مختلف همچنان کاملاً موازی‌اند، چون صف **به‌ازای بورد** است.
   *
   * ⚠️ ایندکسِ یکتا و تلاشِ دوباره **نمی‌مانند برای زینت**: این صف فقط داخلِ یک
   * فرایند است. دو نودِ همزمان باز هم به هم می‌رسند، و آنجا ایندکس تنها سدِ
   * باقی‌مانده است تا وقتی ۴٫۷ قفلِ صاحب را بیاورد.
   */
  const queues = new Map<string, Promise<unknown>>();

  function enqueue<T>(boardId: string, task: () => Promise<T>): Promise<T> {
    const prior = queues.get(boardId) ?? Promise.resolve();
    // ⚠️ `then(task, task)`: نوبتِ بعدی نباید به موفقیتِ قبلی گره بخورد، وگرنه
    //    یک شکست کلِ صفِ آن بورد را تا ابد می‌خواباند.
    const next = prior.then(task, task);
    const guarded = next.catch(() => undefined);
    queues.set(boardId, guarded);
    // صف را رها کن وقتی خالی شد، وگرنه نقشه به تعدادِ بوردهای دیده‌شده رشد می‌کند.
    void guarded.then(() => {
      if (queues.get(boardId) === guarded) queues.delete(boardId);
    });
    return next;
  }

  /** خودِ نوشتن — همیشه از راهِ `enqueue` صدا زده می‌شود، هرگز مستقیم. */
  async function appendNow(
    boardId: string,
    payload: Uint8Array,
    originUserId: string | null,
  ): Promise<AppendedUpdate> {
    const bytes = Buffer.from(payload);
    const auditUser = auditableUserId(originUserId);
    if (originUserId !== null && auditUser === null && !warnedAboutSub) {
      warnedAboutSub = true;
      // ★ ساکت نمی‌مانَد: ممیزی از دست می‌رود و باید دیده شود — ولی دوام
      //   قربانیِ آن نمی‌شود.
      logger.warn("‏sub توکن uuid نیست؛ origin_user_id خالی ثبت می‌شود", { boardId });
    }

    for (let attempt = 1; attempt <= MAX_SEQ_RETRIES; attempt++) {
      try {
        const result = await pool.query<{ seq: string; created_at: Date }>(
          `INSERT INTO board_updates (board_id, seq, payload, byte_size, origin_user_id)
             SELECT $1,
                    GREATEST(
                      COALESCE((SELECT MAX(seq) FROM board_updates WHERE board_id = $1), 0),
                      COALESCE((SELECT MAX(seq_upto) FROM board_snapshots WHERE board_id = $1), 0)
                    ) + 1,
                    $2, $3, $4
             RETURNING seq, created_at`,
          [boardId, bytes, bytes.byteLength, auditUser],
        );

        const row = result.rows[0];
        if (!row) throw new Error("‏[hamboom] INSERT چیزی برنگرداند.");
        return { seq: Number(row.seq), at: row.created_at.getTime() } satisfies AppendedUpdate;
      } catch (cause) {
        const code = (cause as { code?: string } | null)?.code;
        // ★ فقط برخوردِ `seq` تلاشِ دوباره دارد؛ هر خطای دیگری باید بالا برود،
        //   وگرنه یک خرابیِ واقعیِ دیتابیس پشتِ چند تلاش پنهان می‌شود.
        if (code !== UNIQUE_VIOLATION || attempt === MAX_SEQ_RETRIES) throw cause;
      }
    }

    throw new Error("‏[hamboom] گرفتنِ seq بعد از چند تلاش نشد.");
  }

  return {
    append(boardId, payload, originUserId) {
      return enqueue(boardId, () => appendNow(boardId, payload, originUserId));
    },

    async since(boardId, afterSeq, uptoSeq) {
      // ★ کرانِ بالا در خودِ SQL، نه در JS: بازه‌ی بزرگ نباید بی‌خود از سیم رد شود.
      const result = await pool.query<{ payload: Buffer }>(
        `SELECT payload FROM board_updates
         WHERE board_id = $1 AND seq > $2 AND ($3::bigint IS NULL OR seq <= $3::bigint)
         ORDER BY seq ASC`,
        [boardId, afterSeq, uptoSeq ?? null],
      );
      return result.rows.map((row) => new Uint8Array(row.payload));
    },

    async latestSeq(boardId) {
      // ⚠️ همان دلیلِ `GREATEST` در `append` — ردیف‌های فشرده‌شده دیگر اینجا نیستند.
      const result = await pool.query<{ max: string | null }>(
        `SELECT GREATEST(
                  COALESCE((SELECT MAX(seq) FROM board_updates WHERE board_id = $1), 0),
                  COALESCE((SELECT MAX(seq_upto) FROM board_snapshots WHERE board_id = $1), 0)
                ) AS max`,
        [boardId],
      );
      return Number(result.rows[0]?.max ?? 0);
    },

    async prune(boardId, uptoSeq) {
      const result = await pool.query(
        "DELETE FROM board_updates WHERE board_id = $1 AND seq <= $2",
        [boardId, uptoSeq],
      );
      return result.rowCount ?? 0;
    },

    // ⚠️ عمداً `close` ندارد: استخر دیگر مالِ این لاگ نیست، مالِ صدازننده است
    //    (`main.ts`). چیزی که مالکش نیستی را نبند — کاتالوگ هم روی همان استخر است.
  };
}
