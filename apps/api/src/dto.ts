import type {
  Board,
  BoardMember,
  BoardSummary,
  Folder,
  Invoice,
  Plan,
  Subscription,
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
  plan_code: string;
  subscription_status: string;
  max_members: number | string;
  max_boards: number | string;
  max_storage_bytes: number | string;
  usage_boards: number | string;
  usage_storage_bytes: number | string;
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
    planCode: r.plan_code,
    subscriptionStatus: r.subscription_status as Team["subscriptionStatus"],
    limits: {
      maxMembers: Number(r.max_members),
      maxBoards: Number(r.max_boards),
      maxStorageBytes: Number(r.max_storage_bytes),
    },
    usage: {
      // ★ `members` همان `member_count` است — یک عدد، دو نام در قرارداد (PLAN §۵٫۱).
      members: Number(r.member_count),
      boards: Number(r.usage_boards),
      storageBytes: Number(r.usage_storage_bytes),
    },
    createdAt: iso(r.created_at),
  };
}

/**
 * ★★ **رزولوشنِ پلنِ یک تیم — تنها تعریفِ آن در کلِ ریپو.**
 *
 * تیمِ بی‌اشتراک پلنِ پیش‌فرض می‌گیرد، و آن پیش‌فرض برای **فضای شخصی** فرق دارد:
 * `personal` (بوردِ نامحدود، یک نفر) در برابرِ `free` (۳ بورد، ۳ نفر) —
 * [migration ۰۰۰۵](../migrations/0005_personal_plan.sql)، تصمیمِ مالک ۱۴۰۵/۰۶/۱۵.
 *
 * ★ عمداً **SQL** است و نه یک `if` در TypeScript: گیتِ ظرفیت باید یک مسیر بماند و سقف‌ها
 * داده باشند نه کد. هرکس پلنِ تیمی را جای دیگری حساب کند، یک تعریفِ **دوم** ساخته است.
 */
export const PLAN_CODE_SQL =
  "COALESCE(s.plan_code, CASE WHEN t.is_personal THEN 'personal' ELSE 'free' END)";

/**
 * ★★ فضای مصرف‌شده‌ی یک تیم، به بایت — **de-dupe شده**.
 *
 * ⚠️ سه تله که یک `SUM(size_bytes)`ِ ساده در هر سه می‌افتد:
 *   ۱. **dedupeِ دارایی**: `routes/assets.ts` دو ردیفِ `files` را می‌تواند به **یک**
 *      `storage_key` وصل کند (بایتِ تکراری حذف می‌شود). جمعِ ردیفی همان بایت را دوبار
 *      می‌شمارد. پس `DISTINCT`ِ کلیدِ ذخیره‌سازی مبناست، نه ردیف.
 *   ۲. **ردیف‌های `pending`**: presign یک ردیف با اندازه‌ی **ادعاییِ کلاینت** می‌سازد که اگر
 *      commit نشود هرگز پاک نمی‌شود. فقط `ready` شمرده می‌شود.
 *   ۳. **`sum` روی `bigint` نوعِ `numeric` (OID 1700) می‌دهد** که کوئرسِ `int8→number`
 *      نمی‌گیردش و **رشته** برمی‌گردد (B-2، اثباتِ گام ۱٫۲). پس `::bigint` صریح.
 */
export const STORAGE_BYTES_SQL = `
  SELECT COALESCE(sum(f.size_bytes), 0)::bigint
    FROM (SELECT DISTINCT ON (storage_key) storage_key, size_bytes
            FROM files
           WHERE team_id = t.id AND status = 'ready' AND deleted_at IS NULL) f`;

/**
 * ستون‌های مالیِ تیم — پلن، وضعیتِ اشتراک، سقف‌ها و مصرف (M4 فاز ۵، ADR-053).
 *
 * ★★ **مصرف با `count(*)`ِ واقعی خوانده می‌شود، نه از `usage_counters`** — که تا امروز
 * درج می‌شد و هرگز به‌روز نمی‌شد (B-5)، پس `members_count`ش همیشه صفر بود. طبق ADR-053
 * جدول فقط **کشِ نمایش** است؛ اینجا و در گیتِ ظرفیت، عددِ واقعی مبناست. فقط
 * `storage_bytes` از کش می‌آید چون جمعِ اندازه‌ی فایل‌ها گران‌تر است و **دقتش حیاتی نیست**
 * (سقفِ فضا با آپلود اعمال می‌شود، نه با این عدد).
 *
 * ★ تیمِ بی‌اشتراک `free` می‌گیرد و وضعیتِ `none` — پس `Team.planCode` هرگز خالی نیست.
 * `subscriptions_active_uq` تضمین می‌کند این JOIN حداکثر یک ردیف بدهد.
 *
 * ⚠️ عمداً هیچ `sum()`ی اینجا نیست: `sum` روی `bigint` نوعِ `numeric` (OID 1700) می‌دهد که
 * کوئرسِ `int8→number` نمی‌گیردش و **رشته** برمی‌گردد (B-2، اثباتِ گام ۱٫۲).
 */
/** شمارشِ اعضای تیم — همان زیرپرس‌وجویی که هر چهار SELECTِ تیم لازم دارد. */
export const MC = "(SELECT count(*) FROM team_members m WHERE m.team_id = t.id) AS member_count";

export const TEAM_BILLING_COLUMNS = `
         ${PLAN_CODE_SQL} AS plan_code,
         COALESCE(s.status, 'none') AS subscription_status,
         p.max_members, p.max_boards, p.max_storage_bytes,
         (SELECT count(*) FROM boards b
           WHERE b.team_id = t.id AND b.deleted_at IS NULL) AS usage_boards,
         (${STORAGE_BYTES_SQL}) AS usage_storage_bytes`;

/** JOINهایی که `TEAM_BILLING_COLUMNS` لازم دارد. همیشه با هم می‌آیند. */
export const TEAM_BILLING_JOINS = `
    LEFT JOIN subscriptions s
           ON s.team_id = t.id AND s.status IN ('trialing', 'active', 'past_due')
    LEFT JOIN plans p ON p.code = ${PLAN_CODE_SQL}`;

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

// ── Billing (M4 فاز ۵) ───────────────────────────────────────────────────

export interface PlanRow {
  code: string;
  name: string;
  description: string | null;
  price_monthly_rial: number | string;
  price_yearly_rial: number | string;
  max_members: number | string;
  max_boards: number | string;
  max_storage_bytes: number | string;
  features: unknown;
  is_active: boolean;
  sort_order: number | string;
}
export function toPlan(r: PlanRow): Plan {
  return {
    code: r.code,
    name: r.name,
    description: r.description ?? "",
    priceMonthlyRial: Number(r.price_monthly_rial),
    priceYearlyRial: Number(r.price_yearly_rial),
    maxMembers: Number(r.max_members),
    maxBoards: Number(r.max_boards),
    maxStorageBytes: Number(r.max_storage_bytes),
    // `features` یک `jsonb` است؛ درایور آرایه می‌دهد، ولی ردیفِ خراب نباید ۵۰۰ بسازد.
    features: Array.isArray(r.features) ? r.features.map(String) : [],
    isActive: r.is_active,
    sortOrder: Number(r.sort_order),
  };
}

export interface SubscriptionRow {
  id: string;
  team_id: string;
  plan_code: string;
  status: string;
  period: string;
  seats: number | string;
  current_period_start: unknown;
  current_period_end: unknown;
  cancel_at_period_end: boolean;
}
export function toSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    teamId: r.team_id,
    planCode: r.plan_code,
    status: r.status as Subscription["status"],
    period: r.period as Subscription["period"],
    seats: Number(r.seats),
    currentPeriodStart: iso(r.current_period_start),
    currentPeriodEnd: iso(r.current_period_end),
    cancelAtPeriodEnd: r.cancel_at_period_end,
  };
}

export interface InvoiceRow {
  id: string;
  number: string;
  subtotal_rial: number | string;
  discount_rial: number | string;
  vat_rial: number | string;
  total_rial: number | string;
  status: string;
  line_items: unknown;
  issued_at: unknown;
  paid_at: unknown;
}
export function toInvoice(r: InvoiceRow): Invoice {
  return {
    id: r.id,
    number: r.number,
    subtotalRial: Number(r.subtotal_rial),
    discountRial: Number(r.discount_rial),
    vatRial: Number(r.vat_rial),
    totalRial: Number(r.total_rial),
    status: r.status as Invoice["status"],
    issuedAt: iso(r.issued_at),
    paidAt: isoOrNull(r.paid_at),
    lineItems: Array.isArray(r.line_items) ? (r.line_items as Invoice["lineItems"]) : [],
  };
}

/** ستون‌های `invoices` که `toInvoice` می‌خواهد — تا هیچ SELECTی یکی را جا نیندازد. */
export const INVOICE_COLUMNS =
  "id, number, subtotal_rial, discount_rial, vat_rial, total_rial, status, line_items, issued_at, paid_at";

/** ستون‌های `subscriptions` که `toSubscription` می‌خواهد. */
export const SUBSCRIPTION_COLUMNS =
  "id, team_id, plan_code, status, period, seats, current_period_start, current_period_end, cancel_at_period_end";
