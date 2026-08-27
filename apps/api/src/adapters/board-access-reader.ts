import type { BoardAccessReader } from "@hamboom/auth-core";
import type { BoardAccessMode, BoardRole, TeamRole } from "@hamboom/shared-types";

import type { Executor } from "../plugins/db.ts";

/**
 * پیاده‌سازیِ DBِ پورتِ `BoardAccessReader` (فاز ۴) — گام ۵٫۲.
 *
 * ★ **یک کوئریِ JOINدارِ ایندکس‌شده** (نه ۳-۴ کوئری): `boards` + LEFT JOIN روی `users` (staff)،
 * `board_members` (نقشِ مستقیم)، `team_members` (نقشِ تیم). مسیرِ داغِ realtime این را روی هر update
 * صدا **نمی‌زند** (نقش در `session.role` کش است)، ولی endpointهای REST هر بار می‌سنجند.
 *
 * ★ **DP-4 (حل‌شده — گرنتِ ماندگار):** `hasValidLink` از `board_link_grants` می‌آید — گرنتی که مهمان
 * هنگامِ `resolve` گرفت، **فقط اگر** `link_token_hash`ش با توکنِ **فعلیِ** بورد بخواند. پس امضای پورت
 * دست‌نخورده مانْد و ابطال (تغییرِ access_mode یا توکنِ نو) خودکار کار می‌کند. `null` = بورد وجود ندارد.
 */
export function createPgBoardAccessReader(db: Executor): BoardAccessReader {
  return {
    async read(sub, boardId) {
      const { rows } = await db.query<{
        access_mode: BoardAccessMode;
        is_board_owner: boolean;
        is_staff: boolean | null;
        direct_role: BoardRole | null;
        team_role: TeamRole | null;
        has_valid_link: boolean;
      }>(
        `SELECT b.access_mode,
                (b.created_by = $1) AS is_board_owner,
                u.is_staff,
                bm.role AS direct_role,
                tm.role AS team_role,
                (lg.link_token_hash IS NOT NULL
                 AND b.link_token_hash IS NOT NULL
                 AND lg.link_token_hash = b.link_token_hash) AS has_valid_link
           FROM boards b
           LEFT JOIN users u             ON u.id = $1
           LEFT JOIN board_members bm    ON bm.board_id = b.id      AND bm.user_id = $1
           LEFT JOIN team_members tm     ON tm.team_id  = b.team_id AND tm.user_id = $1
           LEFT JOIN board_link_grants lg ON lg.board_id = b.id     AND lg.user_id = $1
          WHERE b.id = $2 AND b.deleted_at IS NULL`,
        [sub, boardId],
      );
      if (rows.length === 0) return null; // بورد نیست
      const r = rows[0]!;
      return {
        isStaff: r.is_staff ?? false,
        isBoardOwner: r.is_board_owner,
        accessMode: r.access_mode,
        directRole: r.direct_role ?? null,
        teamRole: r.team_role ?? null,
        hasValidLink: r.has_valid_link,
      };
    },
  };
}
