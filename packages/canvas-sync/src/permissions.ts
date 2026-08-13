import type { CanvasPermissions } from "@hamboom/canvas-core/sync";
import { BOARD_ROLES, type BoardRole } from "@hamboom/ydoc-schema";

/**
 * نقش → مجوزهای **رابط** (گام ۵٫۳).
 *
 * ── ⚠️ این **اعمال‌کننده‌ی مجوز نیست** ─────────────────────────────────
 *
 * [ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012) صریح است: تنها گیتِ
 * واقعی سرور است و **روی هر update** می‌سنجد
 * ([`permission.ts`](../../../apps/realtime/src/permission.ts)، گام ۴٫۵). این
 * جدول فقط جواب می‌دهد که «چه چیزی را به کاربر نشان بدهیم» — ابزارِ ویرایش باز
 * باشد یا نه.
 *
 * پس اگر روزی این دو از هم واگرا شوند، نتیجه‌اش **حفره‌ی امنیتی نیست**؛ یک
 * تجربه‌ی بد است: کاربر ابزاری می‌بیند که هر بار بی‌صدا رد می‌شود. آن هم بد
 * است، برای همین تستِ این فایل فهرستِ نویسنده‌ها را **کلمه‌به‌کلمه** با فهرستِ
 * سرور مقایسه می‌کند.
 *
 * ⚠️ **دو نسخه‌ای بودنش عمدی و موقتی است.** `canvas-sync` حق ندارد
 * `apps/realtime` را import کند (قاعده‌ی مرزی، ADR-029) و بردنِ جدول به
 * `shared-types` قیدِ فعالِ M2 را می‌شکند. وقتی M3 `packages/auth-core` را ساخت،
 * `effectiveBoardRole` صاحبِ واحدِ این جدول می‌شود — در فهرستِ گام ۶٫۴ ثبت است.
 */

/**
 * ★ **کسانی که می‌نویسند** — باید دقیقاً همان `WRITERS`ِ سرور باشد.
 *
 * ترتیبش هم مثلِ `BOARD_ROLES` معنا دارد نه سلیقه: تستی که این را با فهرستِ
 * سرور می‌سنجد به همین شکل تکیه می‌کند.
 */
const WRITERS: readonly BoardRole[] = ["owner", "editor"];
/** کامنت‌گذارها — `commenter` می‌نویسد ولی فقط کامنت، نه عنصر. */
const COMMENTERS: readonly BoardRole[] = ["owner", "editor", "commenter"];
/** مدیریتِ دسترسی فقط مالک. */
const MANAGERS: readonly BoardRole[] = ["owner"];

/**
 * ★ **fail closed** — نقشِ ناشناخته چیزی نمی‌تواند.
 *
 * `decodeMessage` از قبل ایندکسِ ناشناخته را به `viewer` نگاشت می‌کند (گام ۲٫۴)،
 * پس در عمل به اینجا نمی‌رسد. ولی این تابع صادراتی است و ممکن است از جای دیگری
 * صدا زده شود؛ جهتِ امن باید **در خودِ تابع** باشد، نه در صداکننده‌اش.
 */
/**
 * هیچ‌کاری — نقشِ ناشناخته، و همچنین کلاینتی که خودش را کنار کشیده
 * (`CLIENT_TOO_OLD`، گام ۵٫۳).
 *
 * ⚠️ `canExport` عمداً `true` مانده: خروجی‌گرفتن یک عملِ خواندنی است و کاربری
 * که نمی‌تواند بنویسد نباید کارش را هم نتواند بردارد.
 */
export const READ_ONLY_PERMISSIONS: CanvasPermissions = {
  canEdit: false,
  canComment: false,
  canExport: true,
  canManageAccess: false,
};

export function permissionsForRole(role: string): CanvasPermissions {
  const known = (BOARD_ROLES as readonly string[]).includes(role) ? (role as BoardRole) : null;
  if (!known) return READ_ONLY_PERMISSIONS;
  return {
    canEdit: WRITERS.includes(known),
    canComment: COMMENTERS.includes(known),
    // ⚠️ خروجی‌گرفتن یک عملِ **خواندنی** است؛ تماشاگر هم حقش را دارد.
    canExport: true,
    canManageAccess: MANAGERS.includes(known),
  };
}

/** فهرستِ نویسنده‌ها — فقط برای تستی که آن را با سرور می‌سنجد. */
export const WRITER_ROLES = WRITERS;
