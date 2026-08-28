import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { requireSub } from "../auth-guard.ts";
import { toTeam, toUser, USER_COLUMNS, type TeamRow, type UserRow } from "../dto.ts";
import { HttpError } from "../errors.ts";
import { parseBody, patchMeBody } from "../schemas.ts";

export interface MeRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
}

export function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): void {
  // ── پروفایلِ کاربرِ جاری + تیم‌هایش (DTOهای shared-types) ────────────
  app.get("/me", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);

    const { rows } = await deps.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [sub],
    );
    if (rows.length === 0) throw new HttpError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");

    const teams = await deps.pool.query<TeamRow>(
      `SELECT t.id, t.slug, t.name, tm.role AS my_role,
              (SELECT count(*) FROM team_members m WHERE m.team_id = t.id) AS member_count,
              t.created_at
         FROM teams t
         JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
        WHERE t.deleted_at IS NULL
        ORDER BY t.is_personal DESC, t.created_at`,
      [sub],
    );

    return { user: toUser(rows[0]!), teams: teams.rows.map(toTeam) };
  });

  // ── ویرایشِ پروفایل ─────────────────────────────────────────────────
  app.patch("/me", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { displayName, locale } = parseBody(patchMeBody, req.body);
    // COALESCE: فقط فیلدهای داده‌شده عوض می‌شوند.
    await deps.pool.query(
      `UPDATE users SET display_name = COALESCE($1, display_name),
                        locale = COALESCE($2, locale), updated_at = now()
        WHERE id = $3 AND deleted_at IS NULL`,
      [displayName ?? null, locale ?? null, sub],
    );
    const { rows } = await deps.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [sub],
    );
    if (rows.length === 0) throw new HttpError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
    return { user: toUser(rows[0]!) };
  });
}
