import pg from "pg";

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
 * ⚠️ **زمان از ساعتِ دیتابیس خوانده می‌شود** (`RETURNING created_at`)، نه از
 * ساعتِ اپ: `SaveState.at` چیزی است که کاربر می‌بیند، و اگر ساعتِ نودها با هم
 * اختلاف داشته باشند «ذخیره شد در ۱۲:۰۳» روی دو تب دو عدد می‌شود.
 */

/** تلاشِ دوباره روی برخوردِ ایندکسِ یکتا — بیشتر از این یعنی مشکل جای دیگری است. */
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
  connectionString: string;
  ssl?: boolean;
  /** سقفِ اتصال‌ها — `DATABASE_POOL_MAX`. */
  max?: number;
  logger?: Logger;
}

export function createPostgresUpdateLog({
  connectionString,
  ssl = false,
  max = 10,
  logger = createLogger(),
}: PostgresUpdateLogOptions): UpdateLog {
  const pool = new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max,
  });
  /** فقط یک بار هشدار بده — وگرنه هر update یک خط لاگ می‌شود. */
  let warnedAboutSub = false;

  return {
    async append(boardId, payload, originUserId) {
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
                    COALESCE((SELECT MAX(seq) FROM board_updates WHERE board_id = $1), 0) + 1,
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
    },

    async since(boardId, afterSeq) {
      const result = await pool.query<{ payload: Buffer }>(
        `SELECT payload FROM board_updates
         WHERE board_id = $1 AND seq > $2
         ORDER BY seq ASC`,
        [boardId, afterSeq],
      );
      return result.rows.map((row) => new Uint8Array(row.payload));
    },

    async latestSeq(boardId) {
      const result = await pool.query<{ max: string | null }>(
        "SELECT MAX(seq) AS max FROM board_updates WHERE board_id = $1",
        [boardId],
      );
      return Number(result.rows[0]?.max ?? 0);
    },

    close: () => pool.end(),
  };
}
