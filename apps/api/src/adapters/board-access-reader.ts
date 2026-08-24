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
 * ⚠️ **DP-4 (باز):** `hasValidLink` فعلاً همیشه `false` — امضای `read(sub, boardId)` توکنِ لینکِ
 * درخواست را نمی‌بیند. برای عضوِ تیم/مالک/عضوِ مستقیم بی‌اهمیت است (این سه مسیر مستقل‌اند). مهمانِ
 * لینک تا تصمیمِ DP-4 (گرنتِ ماندگار) پشتیبانی نمی‌شود. `null` = بورد وجود ندارد.
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
      }>(
        `SELECT b.access_mode,
                (b.created_by = $1) AS is_board_owner,
                u.is_staff,
                bm.role AS direct_role,
                tm.role AS team_role
           FROM boards b
           LEFT JOIN users u        ON u.id = $1
           LEFT JOIN board_members bm ON bm.board_id = b.id      AND bm.user_id = $1
           LEFT JOIN team_members tm  ON tm.team_id  = b.team_id AND tm.user_id = $1
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
        hasValidLink: false, // DP-4
      };
    },
  };
}
