/**
 * آیتم‌های منوی راست‌کلیک — گام ۴٫۳ (فرادادهٔ خالص).
 *
 * برچسب‌ها کلیدِ i18n اند. `comingSoon` یعنی کنش هنوز پیاده نشده (کلیپ‌بورد در
 * گام ۵٫۳، گروه/لایه در ۵٫۱، export بعدتر) — آیتم دیده می‌شود ولی غیرفعال است،
 * تا منو کامل به‌نظر برسد و مسیر بعدی روشن بماند. کنش‌های M1: تکثیر، حذف، قفل.
 */

export type MenuActionId =
  | "copy"
  | "paste"
  | "duplicate"
  | "delete"
  | "lock"
  | "group"
  | "bringToFront"
  | "sendToBack"
  | "copyAsImage";

export interface MenuItemMeta {
  id: MenuActionId;
  labelKey: string;
  /** نیاز به انتخابِ عنصر دارد؟ (بدون انتخاب، غیرفعال) */
  requiresSelection: boolean;
  /** هنوز پیاده نشده — غیرفعالِ «به‌زودی». */
  comingSoon?: boolean;
  /** میانبرِ نمایشی (کنترلی‌ها را خودِ موتور می‌گیرد؛ اینجا فقط راهنماست). */
  shortcut?: string;
  /** خطِ جداکننده بعد از این آیتم. */
  dividerAfter?: boolean;
}

export const HB_MENU_ITEMS: readonly MenuItemMeta[] = [
  {
    id: "copy",
    labelKey: "action.copy",
    requiresSelection: true,
    comingSoon: true,
    shortcut: "Ctrl+C",
  },
  {
    id: "paste",
    labelKey: "action.paste",
    requiresSelection: false,
    comingSoon: true,
    shortcut: "Ctrl+V",
    dividerAfter: true,
  },
  { id: "duplicate", labelKey: "action.duplicate", requiresSelection: true, shortcut: "Ctrl+D" },
  {
    id: "delete",
    labelKey: "action.delete",
    requiresSelection: true,
    shortcut: "Del",
    dividerAfter: true,
  },
  { id: "lock", labelKey: "action.lock", requiresSelection: true },
  { id: "group", labelKey: "action.group", requiresSelection: true, comingSoon: true },
  {
    id: "bringToFront",
    labelKey: "action.bringToFront",
    requiresSelection: true,
    comingSoon: true,
  },
  {
    id: "sendToBack",
    labelKey: "action.sendToBack",
    requiresSelection: true,
    comingSoon: true,
    dividerAfter: true,
  },
  { id: "copyAsImage", labelKey: "action.copyAsImage", requiresSelection: true, comingSoon: true },
];

/** آیا این آیتم در وضعیتِ فعلی فعال است؟ */
export function isMenuItemEnabled(item: MenuItemMeta, hasSelection: boolean): boolean {
  if (item.comingSoon) return false;
  if (item.requiresSelection && !hasSelection) return false;
  return true;
}
