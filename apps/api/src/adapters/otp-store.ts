import type { OtpRecord, OtpStore } from "@hamboom/auth-core";

import type { Executor } from "../plugins/db.ts";

/**
 * پیاده‌سازیِ DBِ پورتِ `OtpStore` (فاز ۴) روی `otp_challenges` — گام ۵٫۲.
 *
 * نگاشت: پورت phone-محورِ تک‌رکورد است؛ جدول id-محورِ چندردیفی با `purpose`/`channel`. اینجا
 * `purpose='login'`/`channel='sms'` ثابت است و `get` **آخرین ردیفِ مصرف‌نشده**‌ی همان مقصد را می‌دهد.
 *
 * ★ P7: فقط `code_hash` ذخیره می‌شود، کدِ خام هرگز (این را `otp.ts` تضمین می‌کند — hash می‌دهد).
 */
export function createPgOtpStore(db: Executor): OtpStore {
  return {
    async get(phone) {
      const { rows } = await db.query<{
        code_hash: string;
        attempts: number;
        expires_at: string;
        created_at: string;
      }>(
        `SELECT code_hash, attempts,
                extract(epoch from expires_at)::bigint AS expires_at,
                extract(epoch from created_at)::bigint AS created_at
           FROM otp_challenges
          WHERE destination = $1 AND consumed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [phone],
      );
      if (rows.length === 0) return null;
      const r = rows[0]!;
      return {
        codeHash: r.code_hash,
        attempts: r.attempts,
        expiresAt: Number(r.expires_at),
        createdAt: Number(r.created_at),
      };
    },

    async set(phone, record: OtpRecord) {
      // چالشِ نو. رکوردهای قبلیِ مصرف‌نشده را consume می‌کنیم تا یک چالشِ فعال بماند.
      await db.query(
        "UPDATE otp_challenges SET consumed_at = now() WHERE destination = $1 AND consumed_at IS NULL",
        [phone],
      );
      await db.query(
        `INSERT INTO otp_challenges (id, purpose, channel, destination, code_hash, attempts, expires_at, created_at)
         VALUES (gen_random_uuid(), 'login', 'sms', $1, $2, $3, to_timestamp($4), to_timestamp($5))`,
        [phone, record.codeHash, record.attempts, record.expiresAt, record.createdAt],
      );
    },

    async delete(phone) {
      await db.query(
        "UPDATE otp_challenges SET consumed_at = now() WHERE destination = $1 AND consumed_at IS NULL",
        [phone],
      );
    },

    async incrementAttempts(phone) {
      await db.query(
        `UPDATE otp_challenges SET attempts = attempts + 1
          WHERE id = (SELECT id FROM otp_challenges
                       WHERE destination = $1 AND consumed_at IS NULL
                       ORDER BY created_at DESC LIMIT 1)`,
        [phone],
      );
    },
  };
}
