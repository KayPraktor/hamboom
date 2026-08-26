import { effectiveBoardRole, signRtToken } from "@hamboom/auth-core";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { createPgBoardAccessReader } from "../adapters/board-access-reader.ts";
import { requireSub } from "../auth-guard.ts";
import { HttpError } from "../errors.ts";
import { withTransaction } from "../plugins/db.ts";
import { createBoardBody, parseBody } from "../schemas.ts";

export interface BoardRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
  /** رازِ HS256 و TTLِ rt-token — برای endpointِ پورتِ چهارم. */
  secret: Uint8Array;
  rtTokenTtlSeconds: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerBoardRoutes(app: FastifyInstance, deps: BoardRouteDeps): void {
  // ── لیستِ بوردهای در دسترسِ کاربر ───────────────────────────────────
  // ★ همان گیتینگِ effectiveBoardRole: مالک · عضوِ مستقیمِ بورد · عضوِ تیم فقط اگر access_mode='team'.
  //   (جستجوی pg_trgm و صفحه‌بندیِ cursor: گامِ بعد.)
  app.get("/boards", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { rows } = await deps.pool.query(
      `SELECT DISTINCT b.id, b.team_id, b.title, b.access_mode, b.element_count, b.last_activity_at
         FROM boards b
         LEFT JOIN team_members tm  ON tm.team_id  = b.team_id AND tm.user_id = $1
         LEFT JOIN board_members bm ON bm.board_id = b.id      AND bm.user_id = $1
        WHERE b.deleted_at IS NULL
          AND (b.created_by = $1
               OR bm.user_id IS NOT NULL
               OR (b.access_mode = 'team' AND tm.user_id IS NOT NULL))
        ORDER BY b.last_activity_at DESC
        LIMIT 50`,
      [sub],
    );
    return { boards: rows };
  });

  // ── ساختِ بورد (editor+ در تیم) ─────────────────────────────────────
  app.post("/boards", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { title, teamId: requestedTeamId } = parseBody(createBoardBody, req.body);

    const board = await withTransaction(deps.pool, async (tx) => {
      // تیم: یا داده‌شده (با بررسیِ عضویت) یا فضای شخصیِ کاربر.
      let teamId: string;
      if (requestedTeamId !== undefined) {
        const m = await tx.query("SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2", [
          requestedTeamId,
          sub,
        ]);
        if (m.rows.length === 0) throw new HttpError(403, "FORBIDDEN", "عضوِ این تیم نیستید.");
        teamId = requestedTeamId;
      } else {
        const t = await tx.query<{ id: string }>(
          "SELECT id FROM teams WHERE owner_user_id = $1 AND is_personal = true AND deleted_at IS NULL LIMIT 1",
          [sub],
        );
        if (t.rows.length === 0) throw new HttpError(404, "TEAM_NOT_FOUND", "فضای شخصی یافت نشد.");
        teamId = t.rows[0]!.id;
      }

      // ★ ساختِ بورد تک‌ردیفی است: `created_by` مالک را در همان INSERT تعیین می‌کند → بوردِ بی‌مالک ناممکن.
      const boardId = randomUUID();
      if (title !== undefined) {
        await tx.query(
          "INSERT INTO boards (id, team_id, created_by, title) VALUES ($1, $2, $3, $4)",
          [boardId, teamId, sub, title],
        );
      } else {
        await tx.query("INSERT INTO boards (id, team_id, created_by) VALUES ($1, $2, $3)", [
          boardId,
          teamId,
          sub,
        ]);
      }

      const { rows } = await tx.query(
        "SELECT id, team_id, title, access_mode, created_by, created_at FROM boards WHERE id = $1",
        [boardId],
      );
      return rows[0];
    });

    return board;
  });

  // ── خواندنِ بورد (viewer+، نقشِ موثر) ────────────────────────────────
  app.get("/boards/:id", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };

    // ★ یافته‌ی M2 #۱: شناسه‌ی بدشکل کدِ **خودش** را دارد، نه FORBIDDENِ گنگ.
    if (!UUID_RE.test(id)) {
      throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    }

    const input = await createPgBoardAccessReader(deps.pool).read(sub, id);
    if (input === null) throw new HttpError(404, "BOARD_NOT_FOUND", "بورد یافت نشد.");

    const role = effectiveBoardRole(input);
    if (role === null) throw new HttpError(403, "FORBIDDEN", "به این بورد دسترسی ندارید.");

    const { rows } = await deps.pool.query(
      `SELECT id, team_id, title, access_mode, element_count, created_at, updated_at
         FROM boards WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new HttpError(404, "BOARD_NOT_FOUND", "بورد یافت نشد.");

    return { ...rows[0], myRole: role };
  });

  // ── ★★ توکنِ اتصالِ realtime (پورتِ چهارم؛ [ADR-039](../../../ARCHITECTURE_DECISIONS.md#adr-039)) ──
  // نقشِ **همین‌حالا** (effectiveBoardRole) داخلِ توکن؛ کلاینت برای هر تلاشِ اتصال یکی تازه می‌سازد.
  // realtime همین را با auth-core می‌سنجد (فاز ۷) — همان verifyRtTokenِ مشترک.
  app.get("/boards/:id/rt-token", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) {
      throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    }

    const input = await createPgBoardAccessReader(deps.pool).read(sub, id);
    if (input === null) throw new HttpError(404, "BOARD_NOT_FOUND", "بورد یافت نشد.");
    const role = effectiveBoardRole(input);
    if (role === null) throw new HttpError(403, "FORBIDDEN", "به این بورد دسترسی ندارید.");

    // ★ signRtToken تنها امضاکننده است؛ `exp` را خودش از ثانیه می‌سازد (قفلِ exp، ADR-011).
    const token = await signRtToken(deps.secret, { sub, boardId: id, role }, deps.rtTokenTtlSeconds);
    return { token, expiresIn: deps.rtTokenTtlSeconds };
  });
}
