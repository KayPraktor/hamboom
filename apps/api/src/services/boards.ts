import { effectiveBoardRole } from "@hamboom/auth-core";
import type { BoardRole } from "@hamboom/shared-types";
import type pg from "pg";

import { createPgBoardAccessReader } from "../adapters/board-access-reader.ts";
import { HttpError } from "../errors.ts";

const RANK: Record<BoardRole, number> = { owner: 3, editor: 2, commenter: 1, viewer: 0 };

/**
 * نقشِ موثرِ requester روی یک بوردِ **زنده** را می‌گیرد و «حداقل نقش» را تضمین می‌کند.
 *
 * ★ همان `effectiveBoardRole`ِ مشترک — یک منبعِ حقیقتِ دسترسی برای REST و realtime (ADR-012).
 */
export async function requireBoardRole(
  pool: pg.Pool,
  sub: string,
  boardId: string,
  min: BoardRole,
): Promise<BoardRole> {
  const input = await createPgBoardAccessReader(pool).read(sub, boardId);
  if (input === null) throw new HttpError(404, "BOARD_NOT_FOUND", "بورد یافت نشد.");
  const role = effectiveBoardRole(input);
  if (role === null) throw new HttpError(403, "FORBIDDEN", "به این بورد دسترسی نداری.");
  if (RANK[role] < RANK[min]) throw new HttpError(403, "FORBIDDEN", "دسترسیِ کافی نداری.");
  return role;
}

/**
 * برای `restore`: بوردِ **حذف‌شده** را `BoardAccessReader` نمی‌بیند (فیلترِ `deleted_at IS NULL`)،
 * پس مالکیت را مستقیم می‌سنجیم. مالک = سازنده یا `board_members.role='owner'` (همان منابعِ owner
 * در `effectiveBoardRole`؛ نقشِ تیم به owner نمی‌رسد).
 */
export async function assertDeletedBoardOwner(
  pool: pg.Pool,
  sub: string,
  boardId: string,
): Promise<void> {
  const { rows } = await pool.query<{ created_by: string; direct_role: string | null }>(
    `SELECT b.created_by, bm.role AS direct_role
       FROM boards b
       LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1
      WHERE b.id = $2 AND b.deleted_at IS NOT NULL`,
    [sub, boardId],
  );
  if (rows.length === 0) throw new HttpError(404, "BOARD_NOT_FOUND", "بوردِ حذف‌شده یافت نشد.");
  const r = rows[0]!;
  if (r.created_by !== sub && r.direct_role !== "owner") {
    throw new HttpError(403, "FORBIDDEN", "فقط مالکِ بورد آن را بازیابی می‌کند.");
  }
}
