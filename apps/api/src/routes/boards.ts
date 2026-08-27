import { effectiveBoardRole, signRtToken } from "@hamboom/auth-core";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { createPgBoardAccessReader } from "../adapters/board-access-reader.ts";
import { requireSub } from "../auth-guard.ts";
import { HttpError } from "../errors.ts";
import { withTransaction } from "../plugins/db.ts";
import { assertUuid, createBoardBody, parseBody, patchBoardBody } from "../schemas.ts";
import { assertDeletedBoardOwner, requireBoardRole } from "../services/boards.ts";

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
    const query = req.query as { q?: string; folderId?: string; favorite?: string };

    const params: unknown[] = [sub];
    const filters: string[] = [];
    if (typeof query.q === "string" && query.q.trim().length > 0) {
      params.push(`%${query.q.trim()}%`);
      filters.push(`b.title ILIKE $${params.length}`); // ایندکسِ gin_trgm (jestجوی فارسی عنوان)
    }
    if (typeof query.folderId === "string") {
      assertUuid(query.folderId, "folderId");
      params.push(query.folderId);
      filters.push(`b.folder_id = $${params.length}`);
    }
    // ?favorite=true → فقط نشان‌شده‌ها (JOINِ داخلی)؛ وگرنه همه، با پرچمِ is_favorite.
    const favoriteJoin =
      query.favorite === "true"
        ? "JOIN board_favorites fav ON fav.board_id = b.id AND fav.user_id = $1"
        : "LEFT JOIN board_favorites fav ON fav.board_id = b.id AND fav.user_id = $1";

    const { rows } = await deps.pool.query(
      `SELECT DISTINCT b.id, b.team_id, b.folder_id, b.title, b.access_mode, b.element_count,
              b.last_activity_at, (fav.board_id IS NOT NULL) AS is_favorite
         FROM boards b
         LEFT JOIN team_members tm  ON tm.team_id  = b.team_id AND tm.user_id = $1
         LEFT JOIN board_members bm ON bm.board_id = b.id      AND bm.user_id = $1
         ${favoriteJoin}
        WHERE b.deleted_at IS NULL
          AND (b.created_by = $1
               OR bm.user_id IS NOT NULL
               OR (b.access_mode = 'team' AND tm.user_id IS NOT NULL))
          ${filters.length > 0 ? `AND ${filters.join(" AND ")}` : ""}
        ORDER BY b.last_activity_at DESC
        LIMIT 50`,
      params,
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

  // ── ویرایشِ بورد (editor+) ──────────────────────────────────────────
  app.patch("/boards/:id", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    await requireBoardRole(deps.pool, sub, id, "editor");
    const { title, folderId } = parseBody(patchBoardBody, req.body);

    if (folderId !== undefined && folderId !== null) {
      const ok = await deps.pool.query(
        `SELECT 1 FROM folders f JOIN boards b ON b.team_id = f.team_id
          WHERE f.id = $1 AND b.id = $2 AND f.deleted_at IS NULL`,
        [folderId, id],
      );
      if (ok.rows.length === 0) {
        throw new HttpError(400, "VALIDATION_ERROR", "فولدرِ مقصد نامعتبر است.");
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (title !== undefined) {
      params.push(title);
      sets.push(`title = $${params.length}`);
    }
    if (folderId !== undefined) {
      params.push(folderId); // null → خروج از فولدر
      sets.push(`folder_id = $${params.length}`);
    }
    if (sets.length > 0) {
      params.push(id);
      await deps.pool.query(
        `UPDATE boards SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`,
        params,
      );
    }
    const { rows } = await deps.pool.query(
      "SELECT id, team_id, folder_id, title, access_mode FROM boards WHERE id = $1",
      [id],
    );
    return rows[0];
  });

  // ── حذفِ نرمِ بورد (owner) ───────────────────────────────────────────
  app.delete("/boards/:id", { preHandler: deps.requireAuth }, async (req, reply) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    await requireBoardRole(deps.pool, sub, id, "owner");
    await deps.pool.query("UPDATE boards SET deleted_at = now() WHERE id = $1", [id]);
    return reply.code(204).send();
  });

  // ── بازیابیِ بوردِ حذف‌شده (owner) ───────────────────────────────────
  app.post("/boards/:id/restore", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    await assertDeletedBoardOwner(deps.pool, sub, id);
    await deps.pool.query("UPDATE boards SET deleted_at = NULL, updated_at = now() WHERE id = $1", [id]);
    const { rows } = await deps.pool.query(
      "SELECT id, team_id, folder_id, title, access_mode FROM boards WHERE id = $1",
      [id],
    );
    return rows[0];
  });

  // ── تکثیرِ بورد (editor+) — فقط متادیتا؛ محتوای Y.Doc = فاز بعد (کپیِ snapshot از storage) ──
  app.post("/boards/:id/duplicate", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    await requireBoardRole(deps.pool, sub, id, "editor");
    const src = await deps.pool.query<{ team_id: string; folder_id: string | null; title: string }>(
      "SELECT team_id, folder_id, title FROM boards WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (src.rows.length === 0) throw new HttpError(404, "BOARD_NOT_FOUND", "بورد یافت نشد.");
    const s = src.rows[0]!;
    const newId = randomUUID();
    await deps.pool.query(
      "INSERT INTO boards (id, team_id, folder_id, title, created_by) VALUES ($1, $2, $3, $4, $5)",
      [newId, s.team_id, s.folder_id, `${s.title} (کپی)`, sub],
    );
    const { rows } = await deps.pool.query(
      "SELECT id, team_id, folder_id, title, access_mode, created_at FROM boards WHERE id = $1",
      [newId],
    );
    return rows[0];
  });

  // ── نشان‌کردن / برداشتنِ نشان (viewer+) ──────────────────────────────
  app.post("/boards/:id/favorite", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    await requireBoardRole(deps.pool, sub, id, "viewer");
    await deps.pool.query(
      "INSERT INTO board_favorites (user_id, board_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [sub, id],
    );
    return { favorite: true };
  });

  app.delete("/boards/:id/favorite", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    await requireBoardRole(deps.pool, sub, id, "viewer");
    await deps.pool.query("DELETE FROM board_favorites WHERE user_id = $1 AND board_id = $2", [
      sub,
      id,
    ]);
    return { favorite: false };
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
