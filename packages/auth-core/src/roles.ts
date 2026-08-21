import type { BoardAccessMode, BoardRole, TeamRole } from "@hamboom/shared-types";

/**
 * نقشِ موثرِ کاربر روی یک بورد — [ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012).
 *
 * دسترسی یک مقدارِ **محاسبه‌شده** است، نه یک ردیفِ ذخیره‌شده: از ترکیبِ منابع، **بیشترین**
 * نقش برنده می‌شود، و اگر هیچ منبعی نبود **`null`** (fail-closed). ★ **همین یک تابع** هم در
 * `apps/api` و هم در `apps/realtime` استفاده می‌شود — رایج‌ترین حفره‌ی امنیتیِ محصولاتِ مشابه این
 * است که REST درست چک کند ولی WebSocket نه. تابعِ خالص است: داده را ورودی می‌گیرد، DB را نمی‌بیند.
 */

/** رتبه‌ی امتیاز — برای «بیشترین». ⚠️ این ترتیبِ **امتیاز** است، نه ترتیبِ سیمِ `boardRoles`. */
const RANK: Record<BoardRole, number> = { owner: 3, editor: 2, commenter: 1, viewer: 0 };

/** ورودیِ `effectiveBoardRole` — همه‌ی منابعِ دسترسی. مصرف‌کننده (api/realtime) از DB پُرش می‌کند. */
export interface BoardAccessInput {
  /** staffِ پلتفرم — دسترسیِ کامل (پشتیبانی/ادمین). */
  isStaff: boolean;
  /** مالکِ **همین** بورد. */
  isBoardOwner: boolean;
  /** حالتِ دسترسیِ بورد — مسیرهای تیم/لینک را گِیت می‌کند. */
  accessMode: BoardAccessMode;
  /** نقشِ مستقیم در `board_members`، یا `null` اگر عضوِ مستقیم نیست. */
  directRole: BoardRole | null;
  /** نقشِ کاربر در تیمِ صاحبِ بورد، یا `null` اگر عضوِ تیم نیست. */
  teamRole: TeamRole | null;
  /** آیا یک توکنِ لینکِ اشتراکِ **معتبر** برای این بورد ارائه شده؟ */
  hasValidLink: boolean;
}

/**
 * نگاشتِ نقشِ تیم→بورد (OD-1، تاییدِ مالک ۱۴۰۵/۰۵/۲۸): owner/admin/member→editor، guest→viewer.
 *
 * ⚠️ **OD-3 — قیدِ مشروط:** `member→editor` معتبر است **فقط تا وقتی عضویتِ تیم صرفاً با افزودنِ
 * عمدیِ admin/owner** ساخته می‌شود. اگر روزی عضویتِ **باز** اضافه شد (لینکِ دعوتِ عمومی، ثبت‌نامِ
 * خودکار به تیم)، این نگاشت یعنی هرکس واردِ تیم شد همه‌ی بوردهای تیم را ویرایش می‌کند — یک حفره.
 * آن‌وقت این تابع باید بازنگری شود. (PROGRESS §OD-3، m4-handoff.)
 *
 * fail-closed: هر چیزِ خارج از owner/admin/member به کم‌ترین امتیاز (`viewer`) می‌افتد.
 */
function mapTeamRole(teamRole: TeamRole): BoardRole {
  if (teamRole === "owner" || teamRole === "admin" || teamRole === "member") return "editor";
  return "viewer";
}

/** بیشترین‌امتیازِ فهرست، یا `null` اگر خالی — همان قاعده‌ی «بیشترین برنده / fail-closed». */
function maxRole(roles: readonly BoardRole[]): BoardRole | null {
  if (roles.length === 0) return null;
  return roles.reduce((best, r) => (RANK[r] > RANK[best] ? r : best));
}

/**
 * نقشِ موثر را برمی‌گرداند، یا `null` اگر کاربر هیچ دسترسی‌ای ندارد.
 *
 * ★ **گیتینگِ `access_mode` (OD-1):**
 * - مسیرِ **تیم** فقط وقتی `access_mode='team'` است فعال می‌شود — بوردِ `private` عضویتِ تیم را
 *   نادیده می‌گیرد (فقط مالک + `board_members` + staff).
 * - مسیرِ **لینک** فقط در `link_view`/`link_edit` و با توکنِ معتبر.
 * - مالکِ بورد، `board_members`، و staff **همیشه** (مستقل از `access_mode`).
 */
export function effectiveBoardRole(input: BoardAccessInput): BoardRole | null {
  const candidates: BoardRole[] = [];

  // همیشه، مستقل از access_mode:
  if (input.isStaff) candidates.push("owner");
  if (input.isBoardOwner) candidates.push("owner");
  if (input.directRole !== null) candidates.push(input.directRole);

  // مسیرِ تیم — فقط access_mode='team'.
  if (input.accessMode === "team" && input.teamRole !== null) {
    candidates.push(mapTeamRole(input.teamRole));
  }

  // مسیرِ لینک — فقط حالت‌های لینک، با توکنِ معتبر.
  if (input.hasValidLink) {
    if (input.accessMode === "link_view") candidates.push("viewer");
    else if (input.accessMode === "link_edit") candidates.push("editor");
  }

  return maxRole(candidates);
}
