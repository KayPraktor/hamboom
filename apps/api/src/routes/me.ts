import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { requireSub } from "../auth-guard.ts";
import { HttpError } from "../errors.ts";

export interface MeRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
}

export function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): void {
  // ── پروفایلِ کاربرِ جاری + تیم‌هایش ─────────────────────────────────
  app.get("/me", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);

    const { rows } = await deps.pool.query(
      `SELECT id, phone, email, display_name, locale, presence_color, is_staff, created_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [sub],
    );
    if (rows.length === 0) throw new HttpError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");

    const teams = await deps.pool.query(
      `SELECT t.id, t.slug, t.name, t.is_personal, tm.role
         FROM teams t
         JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
        WHERE t.deleted_at IS NULL
        ORDER BY t.is_personal DESC, t.created_at`,
      [sub],
    );

    return { user: rows[0], teams: teams.rows };
  });
}
