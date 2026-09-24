import { effectiveBoardRole, type BoardAccessInput } from "@hamboom/auth-core";
import { createPgBoardAccessReader } from "@hamboom/board-access-db";
import type { BoardRole } from "@hamboom/shared-types";
import type pg from "pg";

import { recordAudit, type AuditActor } from "../audit.ts";
import { HttpError } from "../errors.ts";
import { withTransaction } from "../plugins/db.ts";

const RANK: Record<BoardRole, number> = { owner: 3, editor: 2, commenter: 1, viewer: 0 };

/** پنجره‌ی de-dupeِ `support.board.view` — ردیفِ تازه‌تر از این برای همان staff/بورد ⇒ ردیفِ نو نمی‌نویسیم. */
export const SUPPORT_VIEW_WINDOW_MINUTES = 10;

/** آیا این نقش **فقط** از staff آمده؟ (بدونِ staff هیچ منبعِ دسترسی نبود) — خالص. */
export function isStaffOnlyAccess(input: BoardAccessInput): boolean {
  return input.isStaff && effectiveBoardRole({ ...input, isStaff: false }) === null;
}

/**
 * ★★ نمای پشتیبانی (M6 ۵٫۳، [ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066) §۱): ردیفِ
 * `support.board.view` وقتی staff بوردی را می‌بیند که بدونِ staff به آن راه نداشت. در تراکنشِ خودش
 * (خواندن هیچ نوشتنِ دیگری ندارد)؛ de-dupe داخلِ همان tx. کلاینت هر ۴۵s rt-token می‌گیرد (`authRefreshMs`) ⇒
 * یک ردیف = یک بازه‌ی `SUPPORT_VIEW_WINDOW_MINUTES` دقیقه‌ای نمایش، نه یک ردیف در هر mint.
 *
 * ⚠️ از داخلِ `requireBoardRole` صدا زده می‌شود تا **هر** خواندنِ RESTِ بورد (متادیتا، snapshot، اعضا، دارایی)
 * را بگیرد، نه فقط mintِ rt-token — وگرنه staff می‌توانست محتوا را با `GET /boards/:id/snapshot` بخوانَد بی‌ردیف
 * (یافته‌ی بازبینیِ ۵٫۵). `ip`/`userAgent` فقط وقتی هست که مسیر `actor` بدهد؛ ردیف **همیشه** نوشته می‌شود.
 */
export async function recordSupportView(
  pool: pg.Pool,
  actor: AuditActor,
  boardId: string,
): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const recent = await tx.query(
      `SELECT 1 FROM audit_logs
        WHERE actor_user_id = $1 AND action = 'support.board.view' AND target_type = 'board'
          AND target_id = $2 AND created_at > now() - ($3::int * interval '1 minute')
        LIMIT 1`,
      [actor.userId, boardId, SUPPORT_VIEW_WINDOW_MINUTES],
    );
    if (recent.rows.length > 0) return;
    await recordAudit(tx, {
      actor,
      action: "support.board.view",
      target: { type: "board", id: boardId },
      metadata: { role: "viewer", windowMinutes: SUPPORT_VIEW_WINDOW_MINUTES },
    });
  });
}

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
  /** ip/UA برای ردیفِ نمای پشتیبانی — بدونش هم ردیف نوشته می‌شود (با `null`). */
  actor?: Pick<AuditActor, "ip" | "userAgent">,
): Promise<BoardRole> {
  const input = await createPgBoardAccessReader(pool).read(sub, boardId);
  if (input === null) throw new HttpError(404, "BOARD_NOT_FOUND", "بورد یافت نشد.");
  const role = effectiveBoardRole(input);
  if (role === null) throw new HttpError(403, "FORBIDDEN", "به این بورد دسترسی نداری.");
  if (RANK[role] < RANK[min]) throw new HttpError(403, "FORBIDDEN", "دسترسیِ کافی نداری.");
  // ★ M6 ۵٫۳: خواندنِ staff روی بوردی که بدونِ staff به آن راه نداشت ⇒ ردیفِ نمای پشتیبانی.
  if (isStaffOnlyAccess(input)) {
    await recordSupportView(
      pool,
      { userId: sub, ip: actor?.ip ?? null, userAgent: actor?.userAgent ?? null },
      boardId,
    );
  }
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
