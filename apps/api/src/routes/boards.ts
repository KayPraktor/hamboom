import { effectiveBoardRole } from "@hamboom/auth-core";
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
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerBoardRoutes(app: FastifyInstance, deps: BoardRouteDeps): void {
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
}
