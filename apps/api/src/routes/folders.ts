import { randomUUID } from "node:crypto";

import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { requireSub } from "../auth-guard.ts";
import { HttpError } from "../errors.ts";
import { assertUuid, createFolderBody, parseBody, patchFolderBody } from "../schemas.ts";
import { requireTeamRole } from "../services/teams.ts";

export interface FolderRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
}

/** تیمِ صاحبِ فولدر را می‌دهد یا ۴۰۴. */
async function folderTeam(pool: pg.Pool, folderId: string): Promise<string> {
  const { rows } = await pool.query<{ team_id: string }>(
    "SELECT team_id FROM folders WHERE id = $1 AND deleted_at IS NULL",
    [folderId],
  );
  if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "فولدر یافت نشد.");
  return rows[0]!.team_id;
}

export function registerFolderRoutes(app: FastifyInstance, deps: FolderRouteDeps): void {
  // ── فهرستِ فولدرهای تیم (member+) ────────────────────────────────────
  app.get("/teams/:teamId/folders", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { teamId } = req.params as { teamId: string };
    assertUuid(teamId, "شناسه‌ی تیم");
    await requireTeamRole(deps.pool, teamId, sub, "member");
    const { rows } = await deps.pool.query(
      `SELECT id, team_id, parent_id, name, position, created_at
         FROM folders WHERE team_id = $1 AND deleted_at IS NULL ORDER BY position, name`,
      [teamId],
    );
    return { folders: rows };
  });

  // ── ساختِ فولدر (member+) ────────────────────────────────────────────
  app.post("/teams/:teamId/folders", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { teamId } = req.params as { teamId: string };
    assertUuid(teamId, "شناسه‌ی تیم");
    await requireTeamRole(deps.pool, teamId, sub, "member");
    const { name, parentId } = parseBody(createFolderBody, req.body);

    if (parentId !== undefined) {
      const p = await deps.pool.query(
        "SELECT 1 FROM folders WHERE id = $1 AND team_id = $2 AND deleted_at IS NULL",
        [parentId, teamId],
      );
      if (p.rows.length === 0) throw new HttpError(400, "VALIDATION_ERROR", "فولدرِ والد نامعتبر است.");
    }

    const id = randomUUID();
    await deps.pool.query("INSERT INTO folders (id, team_id, parent_id, name) VALUES ($1, $2, $3, $4)", [
      id,
      teamId,
      parentId ?? null,
      name,
    ]);
    const { rows } = await deps.pool.query(
      "SELECT id, team_id, parent_id, name, position, created_at FROM folders WHERE id = $1",
      [id],
    );
    return rows[0];
  });

  // ── ویرایشِ فولدر (member+ همان تیم) ─────────────────────────────────
  app.patch("/folders/:id", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی فولدر");
    const teamId = await folderTeam(deps.pool, id);
    await requireTeamRole(deps.pool, teamId, sub, "member");
    const { name } = parseBody(patchFolderBody, req.body);
    if (name !== undefined) {
      await deps.pool.query("UPDATE folders SET name = $1 WHERE id = $2", [name, id]);
    }
    const { rows } = await deps.pool.query(
      "SELECT id, team_id, parent_id, name FROM folders WHERE id = $1",
      [id],
    );
    return rows[0];
  });

  // ── حذفِ نرمِ فولدر (member+) ─────────────────────────────────────────
  app.delete("/folders/:id", { preHandler: deps.requireAuth }, async (req, reply) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی فولدر");
    const teamId = await folderTeam(deps.pool, id);
    await requireTeamRole(deps.pool, teamId, sub, "member");
    await deps.pool.query("UPDATE folders SET deleted_at = now() WHERE id = $1", [id]);
    return reply.code(204).send();
  });
}
