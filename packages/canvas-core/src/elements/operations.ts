import type { HbElement } from "@hamboom/shared-types";

import { bumpVersion } from "./factory";

/**
 * عملیاتِ عنصر که از **چند سطحِ رابط** فراخوانی می‌شوند — گام ۴٫۳.
 *
 * ★ **منبعِ واحد** (درسِ [ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024)):
 * قفل هم در منوی راست‌کلیک است هم در پنل استایل. اگر هر کدام پیاده‌سازیِ خودش را
 * داشت، دیر یا زود واگرا می‌شدند (یکی متنِ مقید را قفل می‌کرد، دیگری نه). پس
 * منطق **اینجا** یک‌بار است و هر دو سطح همین را صدا می‌زنند. همین برای حذف.
 *
 * خالص‌اند و اگر تغییری نباشد همان آرایه را برمی‌گردانند. هر جهش از `bumpVersion`
 * رد می‌شود تا موتور تغییر را برای undo ثبت کند ([ADR-026](../../../../ARCHITECTURE_DECISIONS.md#adr-026)).
 */

function liveSelected(elements: HbElement[], selectedIds: ReadonlySet<string>): HbElement[] {
  return elements.filter((el) => selectedIds.has(el.id) && !el.isDeleted);
}

/** حذفِ نرمِ عناصرِ انتخاب‌شده (`isDeleted = true`). */
export function deleteElements(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
): HbElement[] {
  let changed = false;
  const next = elements.map((el) => {
    if (!selectedIds.has(el.id) || el.isDeleted) return el;
    changed = true;
    return bumpVersion({ ...el, isDeleted: true });
  });
  return changed ? next : elements;
}

/** آیا همه‌ی عناصرِ انتخاب‌شده قفل‌اند؟ — برای نمایشِ وضعیتِ دکمه‌ی قفل. */
export function areAllLocked(elements: HbElement[], selectedIds: ReadonlySet<string>): boolean {
  const selected = liveSelected(elements, selectedIds);
  return selected.length > 0 && selected.every((el) => el.locked);
}

/**
 * toggle قفلِ عناصرِ انتخاب‌شده. اگر **هر** عنصری باز باشد، همه قفل می‌شوند؛
 * وگرنه همه باز. این تصمیمِ toggle هم اینجاست تا هر دو سطح یک رفتار داشته باشند.
 */
export function toggleLock(elements: HbElement[], selectedIds: ReadonlySet<string>): HbElement[] {
  const selected = liveSelected(elements, selectedIds);
  if (selected.length === 0) return elements;
  const nextLocked = selected.some((el) => !el.locked);
  let changed = false;
  const next = elements.map((el) => {
    if (!selectedIds.has(el.id) || el.isDeleted || el.locked === nextLocked) return el;
    changed = true;
    return bumpVersion({ ...el, locked: nextLocked });
  });
  return changed ? next : elements;
}
