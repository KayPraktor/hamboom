import { effectiveBoardRole, signRtToken } from "@hamboom/auth-core";
import { createPgBoardAccessReader } from "@hamboom/board-access-db";
import type { BoardAccessMode, BoardRole, BoardSummary, TeamRole } from "@hamboom/shared-types";
import type { ObjectStore } from "@hamboom/storage";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { requireSub } from "../auth-guard.ts";
import {
  BOARD_FULL_SELECT,
  toBoard,
  toBoardSummary,
  type BoardRow,
  type BoardSummaryRow,
} from "../dto.ts";
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
  /** ObjectStoreِ باکتِ snapshots — بوتِ سریعِ بورد (`GET /boards/:id/snapshot`). */
  snapshots: ObjectStore;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerBoardRoutes(app: FastifyInstance, deps: BoardRouteDeps): void {
  // ── لیستِ بوردهای در دسترسِ کاربر ───────────────────────────────────
  // ★ همان گیتینگِ effectiveBoardRole: مالک · عضوِ مستقیمِ بورد · عضوِ تیم فقط اگر access_mode='team'.
  //   (جستجوی pg_trgm و صفحه‌بندیِ cursor: گامِ بعد.)
  app.get("/boards", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const query = req.query as {
      q?: string;
      folderId?: string;
      favorite?: string;
      trashed?: string;
    };
    // ★ سطلِ بازیافت: تنها راهِ *لیست‌کردنِ* بوردهای حذف‌شده. فقط بوردهایی که کاربر
    //   می‌تواند بازیابی کند (مالک) — همان تعریفِ مالکیتِ `assertDeletedBoardOwner`.
    const trashed = query.trashed === "true";

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

    // بوردِ زنده: `deleted_at IS NULL` + گیتِ effectiveBoardRole (مالک/عضوِ مستقیم/عضوِ تیمِ team-access).
    // سطل: `deleted_at IS NOT NULL` + گیتِ owner (created_by یا board_members.role='owner').
    const deletionPredicate = trashed ? "b.deleted_at IS NOT NULL" : "b.deleted_at IS NULL";
    const accessPredicate = trashed
      ? "(b.created_by = $1 OR bm.role = 'owner')"
      : "(b.created_by = $1 OR bm.user_id IS NOT NULL OR (b.access_mode = 'team' AND tm.user_id IS NOT NULL))";

    // ★ ورودی‌های effectiveBoardRole per-row می‌آیند تا myRoleِ هر بورد در JS (بی‌کوئریِ اضافه) حساب شود
    //   — همان تابعِ مشترکِ auth-core (یک منبعِ حقیقتِ دسترسی، ADR-012).
    const { rows } = await deps.pool.query<
      BoardSummaryRow & {
        access_mode: BoardAccessMode;
        is_board_owner: boolean;
        is_staff: boolean | null;
        direct_role: BoardRole | null;
        team_role: TeamRole | null;
        has_valid_link: boolean;
      }
    >(
      `SELECT DISTINCT b.id, b.title, b.folder_id, b.last_activity_at,
              (fav.board_id IS NOT NULL) AS is_favorite,
              b.access_mode, (b.created_by = $1) AS is_board_owner, u.is_staff,
              bm.role AS direct_role, tm.role AS team_role,
              (lg.link_token_hash IS NOT NULL AND b.link_token_hash IS NOT NULL
               AND lg.link_token_hash = b.link_token_hash) AS has_valid_link
         FROM boards b
         LEFT JOIN users u              ON u.id = $1
         LEFT JOIN team_members tm      ON tm.team_id  = b.team_id AND tm.user_id = $1
         LEFT JOIN board_members bm     ON bm.board_id = b.id      AND bm.user_id = $1
         LEFT JOIN board_link_grants lg ON lg.board_id = b.id      AND lg.user_id = $1
         ${favoriteJoin}
        WHERE ${deletionPredicate}
          AND ${accessPredicate}
          ${filters.length > 0 ? `AND ${filters.join(" AND ")}` : ""}
        ORDER BY b.last_activity_at DESC
        LIMIT 50`,
      params,
    );
    const boards = rows
      .map((r) => {
        // در سطل همه مالک‌اند (گیتِ owner بالا)؛ نقشِ 'owner' بدونِ کوئریِ اضافه.
        const role: BoardRole | null = trashed
          ? "owner"
          : effectiveBoardRole({
              isStaff: r.is_staff ?? false,
              isBoardOwner: r.is_board_owner,
              accessMode: r.access_mode,
              directRole: r.direct_role,
              teamRole: r.team_role,
              hasValidLink: r.has_valid_link,
            });
        return role === null ? null : toBoardSummary(r, role);
      })
      .filter((b): b is BoardSummary => b !== null);
    return { boards };
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

      const { rows } = await tx.query<BoardRow>(BOARD_FULL_SELECT, [sub, boardId]);
      return toBoard(rows[0]!, "owner"); // سازنده مالک است
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

    const { rows } = await deps.pool.query<BoardRow>(BOARD_FULL_SELECT, [sub, id]);
    if (rows.length === 0) throw new HttpError(404, "BOARD_NOT_FOUND", "بورد یافت نشد.");
    return toBoard(rows[0]!, role);
  });

  // ── snapshotِ بوت (octet-stream از انبار) — viewer+ ──────────────────
  // بایت‌ها در باکتِ snapshots اند، متادیتا در `board_snapshots` (storage_key). کلاینت این را
  // یک‌بار برای بوتِ سریع می‌گیرد و بعد تتمه را از WS همگام می‌کند (ADR-031).
  app.get("/boards/:id/snapshot", { preHandler: deps.requireAuth }, async (req, reply) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) {
      throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    }
    await requireBoardRole(deps.pool, sub, id, "viewer");

    const { rows } = await deps.pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM board_snapshots WHERE board_id = $1 ORDER BY seq_upto DESC LIMIT 1",
      [id],
    );
    // بوردی که هنوز فشرده نشده snapshot ندارد — ۲۰۴، و کلاینت از راهِ WS از صفر می‌سازد.
    if (rows.length === 0) return reply.code(204).send();

    const bytes = await deps.snapshots.getObject(rows[0]!.storage_key);
    if (bytes === null) {
      // ردیفِ کاتالوگ هست ولی بایت نیست — با ترتیبِ امنِ compactor نباید رخ دهد. fail-loud در لاگ،
      // ولی تاب‌آور در پاسخ: کلاینت از WS بوت می‌کند تا فایلِ گم‌شده کلِ بورد را نشکند.
      req.log.warn({ boardId: id }, "snapshot catalog row without bytes in store");
      return reply.code(204).send();
    }
    return reply
      .header("content-type", "application/octet-stream")
      .header("cache-control", "no-store")
      .send(Buffer.from(bytes));
  });

  // ── ویرایشِ بورد (editor+) ──────────────────────────────────────────
  app.patch("/boards/:id", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    const role = await requireBoardRole(deps.pool, sub, id, "editor");
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
    const { rows } = await deps.pool.query<BoardRow>(BOARD_FULL_SELECT, [sub, id]);
    return toBoard(rows[0]!, role);
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
    const { rows } = await deps.pool.query<BoardRow>(BOARD_FULL_SELECT, [sub, id]);
    return toBoard(rows[0]!, "owner");
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
    const { rows } = await deps.pool.query<BoardRow>(BOARD_FULL_SELECT, [sub, newId]);
    return toBoard(rows[0]!, "owner"); // سازنده‌ی کپی مالک است
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
