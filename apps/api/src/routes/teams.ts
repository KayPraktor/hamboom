import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { requireSub } from "../auth-guard.ts";
import { toTeam, toTeamMember, type TeamMemberRow, type TeamRow } from "../dto.ts";
import { HttpError } from "../errors.ts";
import { withTransaction } from "../plugins/db.ts";
import {
  assertUuid,
  createInviteBody,
  createTeamBody,
  parseBody,
  patchMemberRoleBody,
  patchTeamBody,
} from "../schemas.ts";
import { getTeamRole, requireTeamRole } from "../services/teams.ts";

export interface TeamRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
  appEnv: string;
  inviteTtlSeconds: number;
}

const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");

export function registerTeamRoutes(app: FastifyInstance, deps: TeamRouteDeps): void {
  // ── ساختِ تیم ───────────────────────────────────────────────────────
  app.post("/teams", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { name, slug } = parseBody(createTeamBody, req.body);

    return withTransaction(deps.pool, async (tx) => {
      const teamId = randomUUID();
      const finalSlug = slug ?? `team-${randomBytes(4).toString("hex")}`;
      try {
        await tx.query(
          "INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, $3, $4)",
          [teamId, finalSlug, name, sub],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new HttpError(409, "CONFLICT", "این slug قبلاً گرفته شده.");
        }
        throw error;
      }
      await tx.query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [
        teamId,
        sub,
      ]);
      await tx.query("INSERT INTO usage_counters (team_id) VALUES ($1) ON CONFLICT DO NOTHING", [
        teamId,
      ]);
      const { rows } = await tx.query<TeamRow>(
        `SELECT t.id, t.slug, t.name, 'owner' AS my_role,
                (SELECT count(*) FROM team_members m WHERE m.team_id = t.id) AS member_count, t.created_at
           FROM teams t WHERE t.id = $1`,
        [teamId],
      );
      return toTeam(rows[0]!);
    });
  });

  // ── دریافتِ تیم ─────────────────────────────────────────────────────
  app.get("/teams/:id", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی تیم");
    const role = await requireTeamRole(deps.pool, id, sub, "member");
    const { rows } = await deps.pool.query<TeamRow>(
      `SELECT t.id, t.slug, t.name, $2::text AS my_role,
              (SELECT count(*) FROM team_members m WHERE m.team_id = t.id) AS member_count, t.created_at
         FROM teams t WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [id, role],
    );
    if (rows.length === 0) throw new HttpError(404, "TEAM_NOT_FOUND", "تیم یافت نشد.");
    return toTeam(rows[0]!);
  });

  // ── ویرایشِ تیم (admin+) ─────────────────────────────────────────────
  app.patch("/teams/:id", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی تیم");
    const role = await requireTeamRole(deps.pool, id, sub, "admin");
    const { name } = parseBody(patchTeamBody, req.body);
    if (name !== undefined) {
      await deps.pool.query("UPDATE teams SET name = $1, updated_at = now() WHERE id = $2", [
        name,
        id,
      ]);
    }
    const { rows } = await deps.pool.query<TeamRow>(
      `SELECT t.id, t.slug, t.name, $2::text AS my_role,
              (SELECT count(*) FROM team_members m WHERE m.team_id = t.id) AS member_count, t.created_at
         FROM teams t WHERE t.id = $1`,
      [id, role],
    );
    return toTeam(rows[0]!);
  });

  // ── فهرستِ اعضا (member+) ────────────────────────────────────────────
  app.get("/teams/:id/members", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی تیم");
    await requireTeamRole(deps.pool, id, sub, "member");
    const { rows } = await deps.pool.query<TeamMemberRow>(
      `SELECT u.id, u.display_name, u.presence_color, tm.role, tm.joined_at, tm.invited_by
         FROM team_members tm JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = $1 ORDER BY tm.joined_at`,
      [id],
    );
    return { members: rows.map(toTeamMember) };
  });

  // ── تغییرِ نقشِ عضو (admin+) ─────────────────────────────────────────
  app.patch("/teams/:id/members/:userId", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id, userId } = req.params as { id: string; userId: string };
    assertUuid(id, "شناسه‌ی تیم");
    assertUuid(userId, "شناسه‌ی کاربر");
    await requireTeamRole(deps.pool, id, sub, "admin");
    const { role } = parseBody(patchMemberRoleBody, req.body);

    const target = await getTeamRole(deps.pool, id, userId);
    if (target === null) throw new HttpError(404, "USER_NOT_FOUND", "این کاربر عضوِ تیم نیست.");
    if (target === "owner") throw new HttpError(403, "FORBIDDEN", "نقشِ مالک تغییرپذیر نیست.");

    await deps.pool.query("UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3", [
      role,
      id,
      userId,
    ]);
    return { userId, role };
  });

  // ── حذفِ عضو (admin+) ────────────────────────────────────────────────
  app.delete("/teams/:id/members/:userId", { preHandler: deps.requireAuth }, async (req, reply) => {
    const sub = requireSub(req);
    const { id, userId } = req.params as { id: string; userId: string };
    assertUuid(id, "شناسه‌ی تیم");
    assertUuid(userId, "شناسه‌ی کاربر");
    await requireTeamRole(deps.pool, id, sub, "admin");
    const target = await getTeamRole(deps.pool, id, userId);
    if (target === "owner") throw new HttpError(403, "FORBIDDEN", "مالک را نمی‌توان حذف کرد.");
    await deps.pool.query("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2", [
      id,
      userId,
    ]);
    return reply.code(204).send();
  });

  // ── ساختِ دعوت (admin+) ──────────────────────────────────────────────
  app.post("/teams/:id/invites", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی تیم");
    await requireTeamRole(deps.pool, id, sub, "admin");
    const { phone, email, role } = parseBody(createInviteBody, req.body);
    const destination = phone ?? email;
    if (destination === undefined) {
      throw new HttpError(400, "VALIDATION_ERROR", "شماره یا ایمیل لازم است.");
    }
    const channel = phone !== undefined ? "sms" : "email";

    const token = randomBytes(24).toString("base64url");
    const inviteId = randomUUID();
    await deps.pool.query(
      `INSERT INTO team_invites (id, team_id, channel, destination, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' seconds')::interval)`,
      [inviteId, id, channel, destination, role, sha256hex(token), sub, String(deps.inviteTtlSeconds)],
    );

    // dev: توکن در لاگ + بدنه (curl)؛ production: پیامک/ایمیلِ واقعی (فاز بعد).
    req.log.warn(`[invite mock — فقط dev] تیمِ ${id} → ${destination} (${role}): توکنِ دعوت ${token}`);
    return {
      inviteId,
      channel,
      destination,
      role,
      ...(deps.appEnv === "local" ? { token } : {}),
    };
  });

  // ── پذیرشِ دعوت (کاربرِ احرازشده) ────────────────────────────────────
  app.post("/invites/:token/accept", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { token } = req.params as { token: string };

    return withTransaction(deps.pool, async (tx) => {
      const { rows } = await tx.query<{ id: string; team_id: string; role: string }>(
        `SELECT id, team_id, role FROM team_invites
          WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [sha256hex(token)],
      );
      if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "دعوت نامعتبر یا منقضی است.");
      const invite = rows[0]!;
      await tx.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [invite.team_id, sub, invite.role],
      );
      await tx.query("UPDATE team_invites SET accepted_at = now(), accepted_by = $1 WHERE id = $2", [
        sub,
        invite.id,
      ]);
      return { teamId: invite.team_id, role: invite.role };
    });
  });
}
