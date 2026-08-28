import type {
  Board,
  BoardMember,
  BoardSummary,
  Folder,
  Team,
  TeamMember,
  User,
  UserPublic,
} from "@hamboom/shared-types";

/**
 * لایه‌ی serialize — ردیفِ خامِ DB (snake_case) → DTOهای camelCaseِ `shared-types`. گام ۶ (اصلاحِ فاز ۵).
 *
 * ★ **چرا لازم شد:** api ردیفِ خام برمی‌گرداند ولی قرارداد (و OpenAPI/sdk) camelCaseِ پرمحتواست. بی این،
 * typeهای sdk دروغ بودند (`board.teamId === undefined`، چون کلیدِ واقعی `team_id` است). این‌جا **تنها نقطه‌ی**
 * نگاشتِ ردیف→DTO است — routeها ردیف را از این می‌گذرانند، نه اینکه خام برگردانند.
 *
 * ⚠️ فیلدهای «آینده» در M3 مقدارِ صادقِ پیش‌فرض دارند: `avatarUrl`/`thumbnailUrl`/`templateId` → `null`،
 * `docSizeBytes` → عددِ واقعیِ ستون. `linkToken` در پاسخِ بورد همیشه `null` است (توکنِ خام فقط یک‌بار در
 * `PUT /access` برمی‌گردد؛ سرور فقط hash را دارد).
 */

const iso = (v: unknown): string =>
  v instanceof Date
    ? v.toISOString()
    : typeof v === "string"
      ? v
      : new Date(v as number).toISOString();

const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

// ── User ────────────────────────────────────────────────────────────────
export interface UserRow {
  id: string;
  phone: string | null;
  phone_verified_at: unknown;
  email: string | null;
  email_verified_at: unknown;
  display_name: string;
  locale: string;
  created_at: unknown;
  last_seen_at: unknown;
}
export function toUser(r: UserRow): User {
  return {
    id: r.id,
    phone: r.phone,
    phoneVerified: r.phone_verified_at !== null && r.phone_verified_at !== undefined,
    email: r.email,
    emailVerified: r.email_verified_at !== null && r.email_verified_at !== undefined,
    displayName: r.display_name,
    avatarUrl: null,
    locale: r.locale as User["locale"],
    createdAt: iso(r.created_at),
    lastSeenAt: isoOrNull(r.last_seen_at),
  };
}

/** ستون‌های لازم برای `User` در یک SELECT (بازاستفاده در چند route). */
export const USER_COLUMNS =
  "id, phone, phone_verified_at, email, email_verified_at, display_name, locale, created_at, last_seen_at";

// ── UserPublic ──────────────────────────────────────────────────────────
export interface UserPublicRow {
  id: string;
  display_name: string;
  presence_color: string;
}
export function toUserPublic(r: UserPublicRow): UserPublic {
  return { id: r.id, displayName: r.display_name, avatarUrl: null, color: r.presence_color };
}

// ── Team ────────────────────────────────────────────────────────────────
export interface TeamRow {
  id: string;
  slug: string;
  name: string;
  my_role: string;
  member_count: number | string;
  created_at: unknown;
}
export function toTeam(r: TeamRow): Team {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    avatarUrl: null,
    myRole: r.my_role as Team["myRole"],
    memberCount: Number(r.member_count),
    createdAt: iso(r.created_at),
  };
}

// ── TeamMember ──────────────────────────────────────────────────────────
export interface TeamMemberRow {
  id: string;
  display_name: string;
  presence_color: string;
  role: string;
  joined_at: unknown;
  invited_by: string | null;
}
export function toTeamMember(r: TeamMemberRow): TeamMember {
  return {
    user: { id: r.id, displayName: r.display_name, avatarUrl: null, color: r.presence_color },
    role: r.role as TeamMember["role"],
    joinedAt: iso(r.joined_at),
    invitedBy: r.invited_by,
  };
}

// ── Board (کامل) ─────────────────────────────────────────────────────────
export interface BoardRow {
  id: string;
  team_id: string;
  folder_id: string | null;
  title: string;
  access_mode: string;
  element_count: number;
  doc_size_bytes: number | string;
  last_activity_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  template_id: string | null;
  is_favorite: boolean;
  creator_id: string;
  creator_name: string;
  creator_color: string;
}
export function toBoard(r: BoardRow, myRole: Board["myRole"]): Board {
  return {
    id: r.id,
    teamId: r.team_id,
    folderId: r.folder_id,
    title: r.title,
    thumbnailUrl: null,
    accessMode: r.access_mode as Board["accessMode"],
    linkToken: null,
    myRole,
    createdBy: {
      id: r.creator_id,
      displayName: r.creator_name,
      avatarUrl: null,
      color: r.creator_color,
    },
    elementCount: r.element_count,
    docSizeBytes: Number(r.doc_size_bytes),
    lastActivityAt: iso(r.last_activity_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    isFavorite: r.is_favorite,
    templateId: r.template_id,
  };
}

/** SELECTِ یک بوردِ کامل: خودِ بورد + سازنده (createdBy) + is_favoriteِ کاربر. `$1`=userId, `$2`=boardId. */
export const BOARD_FULL_SELECT = `
  SELECT b.id, b.team_id, b.folder_id, b.title, b.access_mode, b.element_count, b.doc_size_bytes,
         b.last_activity_at, b.created_at, b.updated_at, b.template_id,
         u.id AS creator_id, u.display_name AS creator_name, u.presence_color AS creator_color,
         (fav.board_id IS NOT NULL) AS is_favorite
    FROM boards b
    JOIN users u ON u.id = b.created_by
    LEFT JOIN board_favorites fav ON fav.board_id = b.id AND fav.user_id = $1
   WHERE b.id = $2 AND b.deleted_at IS NULL`;

// ── BoardSummary (فهرست) ─────────────────────────────────────────────────
export interface BoardSummaryRow {
  id: string;
  title: string;
  folder_id: string | null;
  last_activity_at: unknown;
  is_favorite: boolean;
}
export function toBoardSummary(r: BoardSummaryRow, myRole: BoardSummary["myRole"]): BoardSummary {
  return {
    id: r.id,
    title: r.title,
    thumbnailUrl: null,
    folderId: r.folder_id,
    lastActivityAt: iso(r.last_activity_at),
    myRole,
    isFavorite: r.is_favorite,
  };
}

// ── BoardMember ─────────────────────────────────────────────────────────
export interface BoardMemberRow {
  id: string;
  display_name: string;
  presence_color: string;
  role: string;
  added_by: string | null;
  added_at: unknown;
}
export function toBoardMember(r: BoardMemberRow): BoardMember {
  return {
    user: { id: r.id, displayName: r.display_name, avatarUrl: null, color: r.presence_color },
    role: r.role as BoardMember["role"],
    addedBy: r.added_by,
    addedAt: iso(r.added_at),
  };
}

// ── Folder ──────────────────────────────────────────────────────────────
export interface FolderRow {
  id: string;
  team_id: string;
  name: string;
  parent_id: string | null;
  created_at: unknown;
}
export function toFolder(r: FolderRow): Folder {
  return {
    id: r.id,
    teamId: r.team_id,
    name: r.name,
    parentId: r.parent_id,
    createdAt: iso(r.created_at),
  };
}
