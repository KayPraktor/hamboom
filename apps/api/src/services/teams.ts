import type { TeamRole } from "@hamboom/shared-types";

import { HttpError } from "../errors.ts";
import type { Executor } from "../plugins/db.ts";

/** رتبه‌ی دسترسیِ نقشِ تیم — برای «حداقل نقش». */
const RANK: Record<TeamRole, number> = { owner: 3, admin: 2, member: 1, guest: 0 };

export async function getTeamRole(
  db: Executor,
  teamId: string,
  userId: string,
): Promise<TeamRole | null> {
  const { rows } = await db.query<{ role: TeamRole }>(
    "SELECT tm.role FROM team_members tm JOIN teams t ON t.id = tm.team_id " +
      "WHERE tm.team_id = $1 AND tm.user_id = $2 AND t.deleted_at IS NULL",
    [teamId, userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * نقشِ requester را می‌گیرد و اگر عضو نبود یا کمتر از `min` بود، خطا می‌اندازد.
 *
 * ★ برای **غیرعضو** عمداً ۴۰۴ (نه ۴۰۳): وجودِ تیم به غیرِعضو لو نرود.
 */
export async function requireTeamRole(
  db: Executor,
  teamId: string,
  userId: string,
  min: TeamRole,
): Promise<TeamRole> {
  const role = await getTeamRole(db, teamId, userId);
  if (role === null) throw new HttpError(404, "TEAM_NOT_FOUND", "تیم یافت نشد.");
  if (RANK[role] < RANK[min]) throw new HttpError(403, "FORBIDDEN", "دسترسیِ کافی نداری.");
  return role;
}
