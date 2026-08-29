import { randomUUID } from "node:crypto";

import { signRtToken } from "@hamboom/auth-core";
import type { BoardRole } from "@hamboom/ydoc-schema";
import pg from "pg";

/**
 * کمکِ مشترکِ سنجه‌های `rt:*` برای فاز ۷ — seedِ دسترسیِ بورد در Postgresِ **واقعی** + توکنِ **واقعیِ** rt.
 *
 * ★ چرا لازم شد: از فاز ۷ `main.ts` توکن را با `verifyRtToken`ِ auth-core می‌سنجد و نقش را از readerِ pgِ
 * مشترک می‌خواند (نه `DevBoardAuthority`ِ حافظه‌ای). پس سنجه باید یک بوردِ واقعی + عضویت seed کند و توکنِ
 * امضاشده‌ی واقعی بسازد — همان مسیرِ محصولی، نه میان‌بُر.
 */

/** رازِ ثابتِ سنجه‌ها — همین را به‌عنوان `JWT_SECRET` به فرزندِ `main.ts` می‌دهیم و توکن را با آن امضا می‌کنیم. */
export const RT_SEED_SECRET = "hamboom-rt-gauge-secret-at-least-32-chars!!";
const SECRET_BYTES = new TextEncoder().encode(RT_SEED_SECRET);

export interface SeededBoard {
  boardId: string;
  teamId: string;
  ownerId: string;
}

/** یک بورد (خصوصی) + مالک + تیم seed می‌کند، بدونِ عضو. `access_mode='private'` تا فقط نقشِ مستقیم اعمال شود. */
export async function seedBoard(pool: pg.Pool): Promise<SeededBoard> {
  const ownerId = randomUUID();
  const teamId = randomUUID();
  const boardId = randomUUID();
  await pool.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, 'seed-owner', '#4c8bf5')", [ownerId]);
  await pool.query("INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, 'seed', $3)", [
    teamId,
    `seed-${teamId.slice(0, 8)}`,
    ownerId,
  ]);
  await pool.query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [teamId, ownerId]);
  await pool.query("INSERT INTO boards (id, team_id, created_by, access_mode) VALUES ($1, $2, $3, 'private')", [
    boardId,
    teamId,
    ownerId,
  ]);
  return { boardId, teamId, ownerId };
}

/** یک کاربرِ نو + `board_member` با نقش می‌سازد؛ `userId` را می‌دهد (برای توکن). */
export async function addMember(pool: pg.Pool, boardId: string, role: BoardRole): Promise<string> {
  const userId = randomUUID();
  await pool.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, 'seed-member', '#f59e0b')", [userId]);
  await pool.query("INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)", [boardId, userId, role]);
  return userId;
}

/** convenience: بورد + یک عضو با نقش (`owner` → خودِ سازنده، بی‌نیاز به board_member). */
export async function seedBoardMember(
  pool: pg.Pool,
  role: BoardRole,
): Promise<SeededBoard & { userId: string }> {
  const board = await seedBoard(pool);
  const userId = role === "owner" ? board.ownerId : await addMember(pool, board.boardId, role);
  return { ...board, userId };
}

/** rt-tokenِ واقعی برای (userId, boardId, role) — با همان رازی که فرزندِ `main.ts` به‌عنوان JWT_SECRET دارد. */
export function seedToken(
  userId: string,
  boardId: string,
  role: BoardRole,
  ttlSeconds = 60,
): Promise<string> {
  return signRtToken(SECRET_BYTES, { sub: userId, boardId, role }, ttlSeconds);
}

/** overrideهای envِ فرزندِ `main.ts` — رازِ سنجه + پورت؛ S3/DB/Redis از `.env` می‌آیند. */
export function gaugeChildEnv(port: number, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RT_PORT: String(port),
    JWT_SECRET: RT_SEED_SECRET,
    RT_TOKEN_TTL_SECONDS: "60",
    APP_ENV: "local",
    LOG_LEVEL: "info",
    ...extra,
  };
}

/**
 * پاک‌کردنِ ردیف‌های seed. حذفِ بورد CASCADE می‌کند board_members/updates/snapshots را؛ کاربرانِ
 * `addMember` یتیم می‌مانند (بی‌آزار روی DBِ dev). owner صریح حذف می‌شود.
 */
export async function cleanupSeed(pool: pg.Pool, seed: SeededBoard): Promise<void> {
  await pool.query("DELETE FROM boards WHERE id = $1", [seed.boardId]);
  await pool.query("DELETE FROM teams WHERE id = $1", [seed.teamId]);
  await pool.query("DELETE FROM users WHERE id = $1", [seed.ownerId]);
}
