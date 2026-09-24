import type { SessionRecord, SessionStore } from "@hamboom/auth-core";

import type { Executor } from "../plugins/db.ts";

/**
 * پیاده‌سازیِ DBِ پورتِ `SessionStore` (فاز ۴) روی `auth_sessions` — گام ۵٫۲.
 *
 * ★★ **اتمیک‌بودنِ find+markUsed (قیدِ صریحِ مالک):** `findByHash` با `SELECT … FOR UPDATE` ردیف را
 * قفل می‌کند. وقتی `executor` یک **کلاینتِ درونِ تراکنش** باشد (از `withTransaction`)، قفل تا COMMIT
 * نگه داشته می‌شود؛ پس دو `rotateSession`ِ همزمان روی یک توکن **سریالی** می‌شوند — دومی بعد از commitِ
 * اولی `used=true` می‌بیند و reuse detection شلیک می‌کند. بدونِ این، هر دو `used=false` می‌دیدند.
 *
 * ⚠️ پس این store برای مسیرِ چرخش **باید** با `createPgSessionStore(tx)` ساخته شود، نه با استخرِ خام
 * (که هر query را autocommit می‌کند و قفل را همان لحظه رها می‌کند). conformance این را می‌سنجد.
 *
 * نگاشتِ مدل: `used` = `rotated_at IS NOT NULL`؛ `burnFamily` = `revoked_at` روی کلِ خانواده؛
 * `findByHash` فقط ردیفِ **باطل‌نشده** را می‌گیرد (خانواده‌ی سوخته → null → «invalid»).
 *
 * ★ M6 (ADR-066 §۴): `revokeAllForUser` = `revoked_at` روی **همه‌ی** ردیف‌های زنده‌ی کاربر (ایندکسِ
 * `auth_sessions_user_idx` روی `revoked_at IS NULL`)؛ تعداد را برمی‌گرداند. با `tx`ِ تعلیق صدا زده می‌شود تا
 * سوزاندن و `status='suspended'` و ردیفِ audit یک واحد باشند.
 */
export function createPgSessionStore(db: Executor): SessionStore {
  return {
    async findByHash(tokenHash) {
      const { rows } = await db.query<{
        refresh_token_hash: string;
        family_id: string;
        user_id: string;
        used: boolean;
        expires_at: string;
      }>(
        `SELECT refresh_token_hash, family_id, user_id,
                (rotated_at IS NOT NULL) AS used,
                extract(epoch from expires_at)::bigint AS expires_at
           FROM auth_sessions
          WHERE refresh_token_hash = $1 AND revoked_at IS NULL
          FOR UPDATE`,
        [tokenHash],
      );
      if (rows.length === 0) return null;
      const r = rows[0]!;
      return {
        tokenHash: r.refresh_token_hash,
        familyId: r.family_id,
        sub: r.user_id,
        used: r.used,
        expiresAt: Number(r.expires_at),
      };
    },

    async insert(record: SessionRecord) {
      await db.query(
        `INSERT INTO auth_sessions (id, user_id, family_id, refresh_token_hash, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, to_timestamp($4))`,
        [record.sub, record.familyId, record.tokenHash, record.expiresAt],
      );
    },

    async markUsed(tokenHash) {
      await db.query("UPDATE auth_sessions SET rotated_at = now() WHERE refresh_token_hash = $1", [
        tokenHash,
      ]);
    },

    async burnFamily(familyId) {
      await db.query(
        "UPDATE auth_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL",
        [familyId],
      );
    },

    async revokeAllForUser(sub) {
      // همه‌ی ردیف‌های باطل‌نشده می‌سوزند (چرخانده/منقضی هم — بی‌ضرر)، ولی عدد فقط **زنده‌ها** را می‌شمارد:
      // همان تعریفِ `activeSessions`ِ پنل، تا `sessionsRevoked`ِ audit با آن نخوانَد نه بخوانَد (یافته‌ی ۵٫۵).
      const { rows } = await db.query<{ live: boolean }>(
        `UPDATE auth_sessions SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL
          RETURNING (rotated_at IS NULL AND expires_at > now()) AS live`,
        [sub],
      );
      return rows.filter((r) => r.live).length;
    },
  };
}
