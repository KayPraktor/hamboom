import { randomBytes, randomUUID } from "node:crypto";

import type pg from "pg";

/**
 * پیدا-یا-ساختِ کاربر با شماره‌ی موبایل + فضای شخصی — گام ۵٫۳ (OTP verify).
 *
 * ★★ **باید در یک تراکنش صدا زده شود** (`tx`): کاربرِ نو + تیمِ شخصی + عضویت **اتمیک**‌اند، وگرنه
 * کاربرِ بی‌فضا یا فضای بی‌مالک ساخته می‌شود. (سوالِ ۳ مالک: نوشتنِ چندجدولی همیشه تراکنش.)
 */
export interface AccountResult {
  userId: string;
  personalTeamId: string;
  isNewUser: boolean;
}

async function createPersonalTeam(tx: pg.PoolClient, userId: string): Promise<string> {
  const teamId = randomUUID();
  await tx.query(
    "INSERT INTO teams (id, slug, name, owner_user_id, is_personal) VALUES ($1, $2, $3, $4, true)",
    [teamId, `personal-${teamId.slice(0, 8)}`, "فضای شخصی", userId],
  );
  await tx.query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [
    teamId,
    userId,
  ]);
  await tx.query(
    "INSERT INTO usage_counters (team_id) VALUES ($1) ON CONFLICT (team_id) DO NOTHING",
    [teamId],
  );
  return teamId;
}

export async function findOrCreateUserByPhone(
  tx: pg.PoolClient,
  phone: string,
): Promise<AccountResult> {
  const existing = await tx.query<{ id: string }>(
    "SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL",
    [phone],
  );

  if (existing.rows.length > 0) {
    const userId = existing.rows[0]!.id;
    const team = await tx.query<{ id: string }>(
      "SELECT id FROM teams WHERE owner_user_id = $1 AND is_personal = true AND deleted_at IS NULL LIMIT 1",
      [userId],
    );
    const personalTeamId = team.rows[0]?.id ?? (await createPersonalTeam(tx, userId));
    return { userId, personalTeamId, isNewUser: false };
  }

  const userId = randomUUID();
  const presenceColor = `#${randomBytes(3).toString("hex")}`;
  await tx.query(
    `INSERT INTO users (id, phone, phone_verified_at, display_name, presence_color)
     VALUES ($1, $2, now(), $3, $4)`,
    [userId, phone, `کاربر ${phone.slice(-4)}`, presenceColor],
  );
  const personalTeamId = await createPersonalTeam(tx, userId);
  return { userId, personalTeamId, isNewUser: true };
}
