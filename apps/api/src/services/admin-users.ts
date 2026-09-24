import { escapeLike } from "./audit-log.ts";
import type { SubscriptionRow } from "../dto.ts";
import {
  MC,
  PLAN_CODE_SQL,
  SUBSCRIPTION_COLUMNS,
  TEAM_BILLING_COLUMNS,
  TEAM_BILLING_JOINS,
} from "../dto.ts";
import type { Executor } from "../plugins/db.ts";

/**
 * خواندنِ کاربران و تیم‌ها برای پنل — M6 فاز ۵٫۱ ([ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066)).
 *
 * ★ **فقط خواندن، و فقط با کوئری‌های خودش:** هیچ‌کدام از این توابع predicateِ مسیرهای کاربر
 * (`GET /boards`، `GET /teams/:id`) را reuse نمی‌کند — آن‌ها «چه چیزی برای **این** کاربر دیده می‌شود»
 * هستند و این‌ها «staff درباره‌ی **آن** کاربر چه می‌بیند». قاطی‌کردنشان یعنی یک روز گیتِ کاربر با
 * نیازِ پنل شل می‌شود. ستون‌های مالیِ تیم (`TEAM_BILLING_COLUMNS`) استثنای عمدی‌اند: تعریفِ پلن و
 * ظرفیت **یک** جا دارد (dto.ts) و پنل باید همان عدد را نشان دهد که گیتِ ظرفیت می‌بیند (ADR-053).
 *
 * ★ **شماره در این لایه خام می‌مانَد و در DTO ماسک می‌شود** (`toAdminUserSummary`) — تنها مسیرِ
 * «کامل» `POST /admin/users/:id/phone/reveal` است که ردیفِ audit می‌نویسد (عددِ سیاستیِ TODO §۰).
 *
 * جست‌وجو (`classifyQuery`): ارقامِ فارسی/عربی نرمال می‌شوند؛ شماره‌ی **کاملِ** `09…` تطبیقِ دقیق است (پیشوند
 * عمداً نه)؛ UUID شناسه؛ بقیه متن (trgm روی `display_name`/`teams.name` — ایندکسِ `0008`
 * — و پیشوندِ `slug`). بوردهای کاربر (۵٫۴) با همان سه منبعِ `effectiveBoardRole` جمع می‌شوند
 * (سازنده، عضوِ مستقیم، عضوِ تیم با `access_mode='team'`) ولی نقشِ خودِ **کاربر** برمی‌گردد، نه staff.
 */

export type SearchKind =
  { kind: "phone"; phone: string } | { kind: "id"; id: string } | { kind: "text"; text: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ارقامِ فارسی/عربی → لاتین (همان قاعده‌ی `admin-grant-staff`؛ اپراتور ممکن است فارسی تایپ کند). */
export function latinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** نوعِ جست‌وجو از شکلِ ورودی — خالص. `null` = بعد از trim چیزی نماند. */
export function classifyQuery(raw: string): SearchKind | null {
  const q = latinDigits(raw).trim();
  if (q.length === 0) return null;
  // ★ شماره فقط **کامل** (۱۱ رقم، تطبیقِ دقیق). پیشوندِ ۴–۱۰ رقمی عمداً شماره نیست: با LIKE prefix یک staff
  //   می‌توانست پنج رقمِ ماسک را رقم‌به‌رقم (≤۵۰ جست‌وجو) بازسازی کند بی‌آنکه ردیفِ `user.phone.reveal` بنویسد
  //   (یافته‌ی بازبینیِ ۵٫۵). رقم‌های ناقص متن‌اند و روی نام جست‌وجو می‌شوند (عملاً هیچ).
  if (/^09\d{9}$/.test(q)) return { kind: "phone", phone: q };
  if (UUID_RE.test(q)) return { kind: "id", id: q.toLowerCase() };
  return { kind: "text", text: q };
}

// ── کاربر ─────────────────────────────────────────────────────────────

export interface AdminUserRow {
  id: string;
  display_name: string;
  phone: string | null;
  status: string;
  is_staff: boolean;
  created_at: unknown;
  last_seen_at: unknown;
}

const USER_COLS =
  "u.id, u.display_name, u.phone, u.status, u.is_staff, u.created_at, u.last_seen_at";

/** SQL + پارامترهای جست‌وجوی کاربر — خالص. */
export function buildUserSearch(
  kind: SearchKind,
  limit: number,
): { text: string; params: unknown[] } {
  const base = `SELECT ${USER_COLS} FROM users u WHERE u.deleted_at IS NULL AND `;
  switch (kind.kind) {
    case "phone":
      return { text: `${base}u.phone = $1 LIMIT $2`, params: [kind.phone, limit] };
    case "id":
      return { text: `${base}u.id = $1 LIMIT $2`, params: [kind.id, limit] };
    case "text":
      // trgm: `ILIKE %q%` از ایندکسِ gin استفاده می‌کند؛ ترتیب با شباهت تا «علی» قبل از «علی‌رضا» بیاید.
      return {
        text: `${base}u.display_name ILIKE $1 ORDER BY similarity(u.display_name, $2) DESC, u.created_at DESC LIMIT $3`,
        params: [`%${escapeLike(kind.text)}%`, kind.text, limit],
      };
  }
}

export async function searchUsers(
  db: Executor,
  kind: SearchKind,
  limit: number,
): Promise<AdminUserRow[]> {
  const q = buildUserSearch(kind, limit);
  const { rows } = await db.query<AdminUserRow>(q.text, q.params);
  return rows;
}

export interface UserTeamRow {
  team_id: string;
  slug: string;
  name: string;
  is_personal: boolean;
  role: string;
  plan_code: string;
  joined_at: unknown;
}

export interface UserDetailRows {
  user: AdminUserRow;
  teams: UserTeamRow[];
  /** بوردهای زنده‌ای که این کاربر ساخته. */
  boardCount: number;
  /** refresh tokenهای زنده = دستگاه‌های واردشده (`revoked_at IS NULL`، نچرخیده، منقضی‌نشده). */
  activeSessions: number;
}

/** `null` = کاربر نیست (یا حذف‌شده). چهار کوئریِ کوچک، بدونِ تراکنش — نمای لحظه‌ای کافی است. */
export async function readUserDetail(db: Executor, userId: string): Promise<UserDetailRows | null> {
  const u = await db.query<AdminUserRow>(
    `SELECT ${USER_COLS} FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  const user = u.rows[0];
  if (user === undefined) return null;
  const [teams, boards, sessions] = await Promise.all([
    db.query<UserTeamRow>(
      `SELECT t.id AS team_id, t.slug, t.name, t.is_personal, tm.role, tm.joined_at,
              ${PLAN_CODE_SQL} AS plan_code
         FROM team_members tm
         JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
         LEFT JOIN subscriptions s
                ON s.team_id = t.id AND s.status IN ('trialing', 'active', 'past_due')
        WHERE tm.user_id = $1
        ORDER BY t.is_personal DESC, tm.joined_at`,
      [userId],
    ),
    db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM boards WHERE created_by = $1 AND deleted_at IS NULL",
      [userId],
    ),
    db.query<{ n: number | string }>(
      `SELECT count(*) AS n FROM auth_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND rotated_at IS NULL AND expires_at > now()`,
      [userId],
    ),
  ]);
  return {
    user,
    teams: teams.rows,
    boardCount: Number(boards.rows[0]?.n ?? 0),
    activeSessions: Number(sessions.rows[0]?.n ?? 0),
  };
}

/** یک ردیفِ کاربر (برای پاسخِ بعد از تعلیق/رفعِ تعلیق) — `null` = نیست/حذف‌شده. */
export async function readUserRow(db: Executor, userId: string): Promise<AdminUserRow | null> {
  const { rows } = await db.query<AdminUserRow>(
    `SELECT ${USER_COLS} FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  return rows[0] ?? null;
}

/** شماره‌ی کامل — فقط برای مسیرِ ممیزی‌شده‌ی reveal. `null` = کاربر نیست یا شماره ندارد. */
export async function readPhone(db: Executor, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ phone: string | null }>(
    "SELECT phone FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId],
  );
  return rows[0]?.phone ?? null;
}

// ── تیم ───────────────────────────────────────────────────────────────

export interface AdminTeamRow {
  id: string;
  slug: string;
  name: string;
  is_personal: boolean;
  owner_user_id: string;
  member_count: number | string;
  board_count: number | string;
  plan_code: string;
  subscription_status: string;
  created_at: unknown;
}

const TEAM_COLS = `t.id, t.slug, t.name, t.is_personal, t.owner_user_id, t.created_at, ${MC},
       (SELECT count(*) FROM boards b WHERE b.team_id = t.id AND b.deleted_at IS NULL) AS board_count,
       ${PLAN_CODE_SQL} AS plan_code, COALESCE(s.status, 'none') AS subscription_status`;
const TEAM_JOIN = `FROM teams t
       LEFT JOIN subscriptions s ON s.team_id = t.id AND s.status IN ('trialing', 'active', 'past_due')`;

/** SQL + پارامترهای جست‌وجوی تیم — خالص. پیشوندِ شماره تیمی ندارد ⇒ `null` (مصرف‌کننده `[]` می‌دهد). */
export function buildTeamSearch(
  kind: SearchKind,
  limit: number,
): { text: string; params: unknown[] } | null {
  const base = `SELECT ${TEAM_COLS} ${TEAM_JOIN} WHERE t.deleted_at IS NULL AND `;
  switch (kind.kind) {
    case "phone":
      return null;
    case "id":
      return { text: `${base}t.id = $1 LIMIT $2`, params: [kind.id, limit] };
    case "text":
      return {
        text: `${base}(t.name ILIKE $1 OR lower(t.slug) LIKE $2)
        ORDER BY similarity(t.name, $3) DESC, t.created_at DESC LIMIT $4`,
        params: [
          `%${escapeLike(kind.text)}%`,
          `${escapeLike(kind.text.toLowerCase())}%`,
          kind.text,
          limit,
        ],
      };
  }
}

export async function searchTeams(
  db: Executor,
  kind: SearchKind,
  limit: number,
): Promise<AdminTeamRow[]> {
  const q = buildTeamSearch(kind, limit);
  if (q === null) return [];
  const { rows } = await db.query<AdminTeamRow>(q.text, q.params);
  return rows;
}

export interface TeamMemberAdminRow {
  user_id: string;
  display_name: string;
  role: string;
  status: string;
  joined_at: unknown;
}

export interface TeamDetailRows {
  team: AdminTeamRow & {
    max_members: number | string;
    max_boards: number | string;
    max_storage_bytes: number | string;
    usage_boards: number | string;
    usage_storage_bytes: number | string;
  };
  members: TeamMemberAdminRow[];
  /** اشتراکِ زنده (trialing/active/past_due) یا `null` — همان JOINِ `TEAM_BILLING_JOINS`. */
  subscription: SubscriptionRow | null;
}

/** `null` = تیم نیست. ظرفیت با `count(*)`ِ زنده — همان ستون‌های گیتِ ظرفیت، نه کشِ نمایش (ADR-053). */
export async function readTeamDetail(db: Executor, teamId: string): Promise<TeamDetailRows | null> {
  const t = await db.query<TeamDetailRows["team"]>(
    `SELECT t.id, t.slug, t.name, t.is_personal, t.owner_user_id, t.created_at, ${MC},
            (SELECT count(*) FROM boards b WHERE b.team_id = t.id AND b.deleted_at IS NULL) AS board_count,
            ${TEAM_BILLING_COLUMNS}
       FROM teams t ${TEAM_BILLING_JOINS}
      WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [teamId],
  );
  const team = t.rows[0];
  if (team === undefined) return null;
  const [members, sub] = await Promise.all([
    db.query<TeamMemberAdminRow>(
      `SELECT u.id AS user_id, u.display_name, tm.role, u.status, tm.joined_at
         FROM team_members tm JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = $1
        ORDER BY tm.joined_at`,
      [teamId],
    ),
    db.query<SubscriptionRow>(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
        WHERE team_id = $1 AND status IN ('trialing', 'active', 'past_due')
        LIMIT 1`,
      [teamId],
    ),
  ]);
  return { team, members: members.rows, subscription: sub.rows[0] ?? null };
}

// ── بوردهای یک کاربر (۵٫۴ — نمای پشتیبانی) ────────────────────────────

export interface UserBoardRow {
  id: string;
  title: string;
  team_id: string;
  team_name: string;
  access_mode: string;
  is_board_owner: boolean;
  direct_role: string | null;
  team_role: string | null;
  last_activity_at: unknown;
  deleted_at: unknown;
}

/**
 * بوردهایی که کاربر به آن‌ها راه دارد — سه منبعِ `effectiveBoardRole` (سازنده، عضوِ مستقیم، عضوِ تیمِ
 * `team`-access)؛ لینک عمداً نه (گرنتِ لینک عضویت نیست). حذف‌شده‌ها هم می‌آیند (`deleted_at` پر) —
 * پشتیبانی معمولاً دنبالِ «بوردم گم شده» است. نقش را مصرف‌کننده با همان تابعِ مشترک حساب می‌کند.
 */
export async function listUserBoards(db: Executor, userId: string): Promise<UserBoardRow[]> {
  const { rows } = await db.query<UserBoardRow>(
    `SELECT DISTINCT b.id, b.title, b.team_id, t.name AS team_name, b.access_mode,
            (b.created_by = $1) AS is_board_owner, bm.role AS direct_role, tm.role AS team_role,
            b.last_activity_at, b.deleted_at
       FROM boards b
       JOIN teams t ON t.id = b.team_id
       LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1
       LEFT JOIN team_members tm ON tm.team_id = b.team_id AND tm.user_id = $1
      WHERE b.created_by = $1
         OR bm.user_id IS NOT NULL
         OR (b.access_mode = 'team' AND tm.user_id IS NOT NULL)
      ORDER BY b.last_activity_at DESC
      LIMIT 200`,
    [userId],
  );
  return rows;
}
