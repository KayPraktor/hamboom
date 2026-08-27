import { AssetValidationError, type AssetService } from "@hamboom/assets";
import { assetPresignRequest } from "@hamboom/shared-types";
import type { ObjectStore } from "@hamboom/storage";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { requireSub } from "../auth-guard.ts";
import { HttpError } from "../errors.ts";
import { parseBody } from "../schemas.ts";
import { requireBoardRole } from "../services/boards.ts";

/**
 * endpointهای دارایی (تصویر) — گام ۵٫۴، [PLAN §۵٫۲](../../../../PLAN.md).
 *
 * جریان: کلاینت `presign` می‌گیرد → **مستقیم** به Object Storage آپلود می‌کند → `commit` می‌زند و
 * ★★ **سرور بایت‌های واقعی را می‌سنجد** (sha256 بازمحاسبه، نوعِ sniff‌شده، اندازه از headObject — به ادعای
 * کلاینت اعتماد نمی‌شود). منطقِ اعتبارسنجی در `@hamboom/assets` است؛ اینجا فقط DB + سیم‌کشیِ `ctx` از توکن.
 */
export interface AssetRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
  /** لایه‌ی دامنه‌ی دارایی — presign/validateUploaded/resolve روی باکتِ assets. */
  assets: AssetService;
  /** ObjectStoreِ خامِ باکتِ assets — فقط برای حذفِ ابجکتِ تکراری هنگامِ دی‌دوپ. */
  assetStore: ObjectStore;
  /** نامِ باکتِ assets — در رکوردِ `files` ذخیره می‌شود. */
  assetBucket: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FileRow {
  team_id: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
}

export function registerAssetRoutes(app: FastifyInstance, deps: AssetRouteDeps): void {
  // ── presign آپلود (editor+) ─────────────────────────────────────────
  // ★ teamId/boardId/uploadedBy از توکن+مسیر می‌آیند، هرگز از بدنه‌ی کلاینت (assets خط‌قرمزِ ۳).
  app.post("/boards/:boardId/assets/presign", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { boardId } = req.params as { boardId: string };
    if (!UUID_RE.test(boardId)) {
      throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
    }
    await requireBoardRole(deps.pool, sub, boardId, "editor");
    const body = parseBody(assetPresignRequest, req.body);

    const board = await deps.pool.query<{ team_id: string }>(
      "SELECT team_id FROM boards WHERE id = $1 AND deleted_at IS NULL",
      [boardId],
    );
    if (board.rows.length === 0) throw new HttpError(404, "BOARD_NOT_FOUND", "بورد یافت نشد.");
    const teamId = board.rows[0]!.team_id;

    let resp;
    try {
      resp = await deps.assets.presign(body, { teamId, boardId, uploadedBy: sub });
    } catch (e) {
      if (e instanceof AssetValidationError) throw new HttpError(400, "VALIDATION_ERROR", e.message);
      throw e;
    }

    // رکوردِ pending — تا commit بتواند declared/key را پیدا کند (sha256 هنوز ادعای کلاینت است).
    await deps.pool.query(
      `INSERT INTO files
         (id, team_id, board_id, uploader_id, bucket, storage_key, mime_type, size_bytes, sha256, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
      [
        resp.fileId,
        teamId,
        boardId,
        sub,
        deps.assetBucket,
        resp.fields.key,
        body.mimeType,
        body.sizeBytes,
        body.sha256,
      ],
    );
    return resp;
  });

  // ── commit: تاییدِ بایت‌های واقعی + ثبتِ ready + دی‌دوپ (editor+) ──────
  app.post(
    "/boards/:boardId/assets/:fileId/commit",
    { preHandler: deps.requireAuth },
    async (req) => {
      const sub = requireSub(req);
      const { boardId, fileId } = req.params as { boardId: string; fileId: string };
      if (!UUID_RE.test(boardId)) {
        throw new HttpError(400, "BOARD_ID_MALFORMED", "شناسه‌ی بورد بدشکل است.");
      }
      if (!UUID_RE.test(fileId)) throw new HttpError(404, "NOT_FOUND", "فایل یافت نشد.");
      await requireBoardRole(deps.pool, sub, boardId, "editor");

      const f = await deps.pool.query<FileRow>(
        `SELECT team_id, storage_key, mime_type, size_bytes, sha256, status
           FROM files WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL`,
        [fileId, boardId],
      );
      if (f.rows.length === 0) throw new HttpError(404, "NOT_FOUND", "فایل یافت نشد.");
      const file = f.rows[0]!;
      // idempotent: اگر قبلاً commit شده، همان را برگردان (commitِ دوباره خطا نیست).
      if (file.status === "ready") {
        return {
          fileId,
          boardId,
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes,
          sha256: file.sha256,
          status: "ready",
        };
      }

      let verified;
      try {
        verified = await deps.assets.validateUploaded({
          key: file.storage_key,
          declared: {
            mimeType: file.mime_type,
            sizeBytes: file.size_bytes,
            sha256: file.sha256,
          },
        });
      } catch (e) {
        if (e instanceof AssetValidationError) {
          await deps.pool.query("UPDATE files SET status = 'failed' WHERE id = $1", [fileId]);
          throw new HttpError(422, "VALIDATION_ERROR", e.message);
        }
        throw e;
      }

      // ★ دی‌دوپِ سطحِ تیم (بعد از **تاییدِ** sha256، نه ادعای کلاینت): اگر فایلِ readyِ بیت‌به‌بیت‌همسانی
      //   در تیم هست، رکوردِ تازه را به همان بایت‌ها اشاره بده و ابجکتِ تکراری را حذف کن. fileId ثابت می‌مانَد.
      const dup = await deps.pool.query<{ storage_key: string }>(
        `SELECT storage_key FROM files
          WHERE team_id = $1 AND sha256 = $2 AND status = 'ready' AND deleted_at IS NULL AND id <> $3
          ORDER BY created_at ASC LIMIT 1`,
        [file.team_id, verified.sha256, fileId],
      );

      let finalKey = file.storage_key;
      if (dup.rows.length > 0 && dup.rows[0]!.storage_key !== file.storage_key) {
        await deps.assetStore.deleteObject(file.storage_key); // ابجکتِ تکراری را برمی‌داریم
        finalKey = dup.rows[0]!.storage_key;
      }

      await deps.pool.query(
        `UPDATE files SET storage_key = $1, mime_type = $2, size_bytes = $3, sha256 = $4, status = 'ready'
          WHERE id = $5`,
        [finalKey, verified.mime, verified.sizeBytes, verified.sha256, fileId],
      );
      return {
        fileId,
        boardId,
        mimeType: verified.mime,
        sizeBytes: verified.sizeBytes,
        sha256: verified.sha256,
        status: "ready",
      };
    },
  );

  // ── GET /assets/:fileId → ۳۰۲ به presigned GET (viewer+) ────────────
  app.get("/assets/:fileId", { preHandler: deps.requireAuth }, async (req, reply) => {
    const sub = requireSub(req);
    const { fileId } = req.params as { fileId: string };
    if (!UUID_RE.test(fileId)) throw new HttpError(404, "NOT_FOUND", "فایل یافت نشد.");

    const f = await deps.pool.query<{ board_id: string | null; storage_key: string; status: string }>(
      "SELECT board_id, storage_key, status FROM files WHERE id = $1 AND deleted_at IS NULL",
      [fileId],
    );
    if (f.rows.length === 0 || f.rows[0]!.status !== "ready" || f.rows[0]!.board_id === null) {
      throw new HttpError(404, "NOT_FOUND", "فایل یافت نشد.");
    }
    const file = f.rows[0]!;
    // دسترسی از راهِ بوردِ فایل سنجیده می‌شود (viewer+) — همان گیتِ effectiveBoardRole.
    await requireBoardRole(deps.pool, sub, file.board_id as string, "viewer");

    const url = await deps.assets.resolve(file.storage_key);
    // ۳۰۲ + Location دستی (به‌جای reply.redirect) تا امضای بین‌نسخه‌ای مبهم نباشد.
    return reply.code(302).header("location", url).header("cache-control", "no-store").send();
  });
}
