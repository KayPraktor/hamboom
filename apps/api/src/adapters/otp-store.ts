import type { OtpRecord, OtpStore } from "@hamboom/auth-core";

import type { Executor } from "../plugins/db.ts";

/**
 * هدفِ چالش — ستونِ `otp_challenges.purpose`. `login` = ورود (M3)؛ `admin_step_up` = تاییدِ
 * دوباره‌ی staff پیش از عملِ مخرب (M6 فاز ۳، [ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066)).
 */
export type OtpPurpose = "login" | "admin_step_up";

/**
 * پیاده‌سازیِ DBِ پورتِ `OtpStore` (فاز ۴) روی `otp_challenges` — گام ۵٫۲.
 *
 * نگاشت: پورت phone-محورِ تک‌رکورد است؛ جدول id-محورِ چندردیفی با `purpose`/`channel`. `channel='sms'`
 * ثابت است و `get` **آخرین ردیفِ مصرف‌نشده**‌ی همان مقصد **و همان هدف** را می‌دهد.
 *
 * ★★ **`purpose` روی خودِ store است، نه روی پورت** (M6 فاز ۳). تا M6 این‌جا `'login'` هاردکد بود و
 * بازبینِ خصمانه‌ی نقشه گرفت: اگر step-upِ پنل از همان store می‌گذشت، `set` چالشِ **ورودِ در جریانِ**
 * همان شماره را consume می‌کرد (و برعکس). با store‌ی به‌ازای هر هدف، هر چهار عمل به همان هدف مقیدند
 * و پورتِ `OtpStore`ِ auth-core دست‌نخورده می‌مانَد — `requestOtp`/`verifyOtp` هیچ‌چیز از هدف
 * نمی‌دانند. سناریوی conformanceِ «دو هدف مستقل‌اند» همین را روی memory و PG اثبات می‌کند.
 *
 * ★ P7: فقط `code_hash` ذخیره می‌شود، کدِ خام هرگز (این را `otp.ts` تضمین می‌کند — hash می‌دهد).
 */
export function createPgOtpStore(db: Executor, purpose: OtpPurpose = "login"): OtpStore {
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
          WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [phone, purpose],
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
      // چالشِ نو. رکوردهای قبلیِ مصرف‌نشده‌ی **همین هدف** را consume می‌کنیم تا یک چالشِ فعال بماند.
      await db.query(
        `UPDATE otp_challenges SET consumed_at = now()
          WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [phone, purpose],
      );
      await db.query(
        `INSERT INTO otp_challenges (id, purpose, channel, destination, code_hash, attempts, expires_at, created_at)
         VALUES (gen_random_uuid(), $6, 'sms', $1, $2, $3, to_timestamp($4), to_timestamp($5))`,
        [phone, record.codeHash, record.attempts, record.expiresAt, record.createdAt, purpose],
      );
    },

    async delete(phone) {
      await db.query(
        `UPDATE otp_challenges SET consumed_at = now()
          WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [phone, purpose],
      );
    },

    async incrementAttempts(phone) {
      await db.query(
        `UPDATE otp_challenges SET attempts = attempts + 1
          WHERE id = (SELECT id FROM otp_challenges
                       WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL
                       ORDER BY created_at DESC LIMIT 1)`,
        [phone, purpose],
      );
    },
  };
}
