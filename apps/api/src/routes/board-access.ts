import { createHash, randomBytes } from "node:crypto";

import type { BoardAccessMode } from "@hamboom/shared-types";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { requireSub } from "../auth-guard.ts";
import { toBoardMember, type BoardMemberRow } from "../dto.ts";
import { HttpError } from "../errors.ts";
import {
  addBoardMemberBody,
  assertUuid,
  parseBody,
  patchBoardMemberRoleBody,
  putAccessBody,
  resolveLinkBody,
} from "../schemas.ts";
import { requireBoardRole } from "../services/boards.ts";

export interface BoardAccessRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
}

const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");

export function registerBoardAccessRoutes(app: FastifyInstance, deps: BoardAccessRouteDeps): void {
  // ── وضعیتِ اشتراک + اعضای مستقیم (viewer+) ──────────────────────────
  app.get("/boards/:id/access", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی بورد");
    await requireBoardRole(deps.pool, sub, id, "viewer");

    const board = await deps.pool.query<{ access_mode: BoardAccessMode; link_active: boolean }>(
      "SELECT access_mode, (link_token_hash IS NOT NULL) AS link_active FROM boards WHERE id = $1",
      [id],
    );
    const members = await deps.pool.query<BoardMemberRow>(
      `SELECT u.id, u.display_name, u.presence_color, bm.role, bm.added_by, bm.added_at
         FROM board_members bm JOIN users u ON u.id = bm.user_id
        WHERE bm.board_id = $1 ORDER BY bm.added_at`,
      [id],
    );
    return {
      accessMode: board.rows[0]!.access_mode,
      linkActive: board.rows[0]!.link_active,
      members: members.rows.map(toBoardMember),
    };
  });

  // ── تنظیمِ حالتِ اشتراک + تولید/ابطالِ لینک (owner) ──────────────────
  app.put("/boards/:id/access", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی بورد");
    await requireBoardRole(deps.pool, sub, id, "owner");
    const { accessMode, regenerate } = parseBody(putAccessBody, req.body);

    const cur = await deps.pool.query<{ link_token_hash: string | null }>(
      "SELECT link_token_hash FROM boards WHERE id = $1",
      [id],
    );
    const isLinkMode = accessMode === "link_view" || accessMode === "link_edit";
    let linkToken: string | undefined;
    let newHash: string | null = cur.rows[0]?.link_token_hash ?? null;

    if (isLinkMode) {
      // توکنِ نو اگر لینکی نبود یا regenerate خواسته شد (لینکِ قبلی و مهمان‌هایش باطل می‌شوند).
      if (newHash === null || regenerate === true) {
        linkToken = randomBytes(24).toString("base64url");
        newHash = sha256hex(linkToken);
      }
    } else {
      newHash = null; // خاموش‌کردنِ لینک (ابطال)
    }

    await deps.pool.query(
      "UPDATE boards SET access_mode = $1, link_token_hash = $2, updated_at = now() WHERE id = $3",
      [accessMode, newHash, id],
    );

    // ★ linkToken فقط همین‌بار برمی‌گردد (hash ذخیره می‌شود)؛ برای اشتراک باید کپی شود.
    return { accessMode, linkActive: newHash !== null, ...(linkToken !== undefined ? { linkToken } : {}) };
  });

  // ── مهمان لینک را resolve می‌کند → گرنتِ ماندگار (DP-4) ──────────────
  app.post("/public/boards/resolve", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { linkToken } = parseBody(resolveLinkBody, req.body);
    const hash = sha256hex(linkToken);

    const { rows } = await deps.pool.query<{ id: string; access_mode: string }>(
      `SELECT id, access_mode FROM boards
        WHERE link_token_hash = $1 AND deleted_at IS NULL
          AND access_mode IN ('link_view', 'link_edit')`,
      [hash],
    );
    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "لینک نامعتبر یا غیرفعال است.");
    const board = rows[0]!;

    // گرنت به توکنِ **فعلی** گره می‌خورد؛ reader همین را با boards.link_token_hash می‌سنجد.
    await deps.pool.query(
      `INSERT INTO board_link_grants (board_id, user_id, link_token_hash) VALUES ($1, $2, $3)
       ON CONFLICT (board_id, user_id) DO UPDATE SET link_token_hash = EXCLUDED.link_token_hash, created_at = now()`,
      [board.id, sub, hash],
    );
    const role = board.access_mode === "link_edit" ? "editor" : "viewer";
    return { boardId: board.id, role };
  });

  // ── افزودنِ عضوِ مستقیمِ بورد (owner) ────────────────────────────────
  app.post("/boards/:id/members", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی بورد");
    await requireBoardRole(deps.pool, sub, id, "owner");
    const { userId, role } = parseBody(addBoardMemberBody, req.body);

    const u = await deps.pool.query("SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL", [
      userId,
    ]);
    if (u.rows.length === 0) throw new HttpError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");

    await deps.pool.query(
      `INSERT INTO board_members (board_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [id, userId, role, sub],
    );
    return { userId, role };
  });

  // ── تغییرِ نقشِ عضوِ مستقیم (owner) ──────────────────────────────────
  app.patch("/boards/:id/members/:userId", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id, userId } = req.params as { id: string; userId: string };
    assertUuid(id, "شناسه‌ی بورد");
    assertUuid(userId, "شناسه‌ی کاربر");
    await requireBoardRole(deps.pool, sub, id, "owner");
    const { role } = parseBody(patchBoardMemberRoleBody, req.body);

    const upd = await deps.pool.query(
      "UPDATE board_members SET role = $1 WHERE board_id = $2 AND user_id = $3",
      [role, id, userId],
    );
    if (upd.rowCount === 0) throw new HttpError(404, "USER_NOT_FOUND", "این کاربر عضوِ مستقیمِ بورد نیست.");
    return { userId, role };
  });

  // ── حذفِ عضوِ مستقیم (owner) ─────────────────────────────────────────
  app.delete("/boards/:id/members/:userId", { preHandler: deps.requireAuth }, async (req, reply) => {
    const sub = requireSub(req);
    const { id, userId } = req.params as { id: string; userId: string };
    assertUuid(id, "شناسه‌ی بورد");
    assertUuid(userId, "شناسه‌ی کاربر");
    await requireBoardRole(deps.pool, sub, id, "owner");
    await deps.pool.query("DELETE FROM board_members WHERE board_id = $1 AND user_id = $2", [
      id,
      userId,
    ]);
    return reply.code(204).send();
  });
}
