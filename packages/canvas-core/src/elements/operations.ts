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

/** جهتِ تغییرِ لایه (z-order). */
export type ReorderOp = "front" | "back" | "forward" | "backward";

/**
 * تغییرِ لایه‌ی عناصرِ انتخاب‌شده — منبعِ واحد برای منوی راست‌کلیک (جلوترین/عقب‌ترین)
 * و پنل استایل (جلو/عقب یک‌پله).
 *
 * ★ **ترتیبِ آرایه = ترتیبِ z** (اولْ ته، آخرْ رو). فقط ترتیب را می‌چینیم و رشته‌ی
 * `index` را **دست نمی‌زنیم**: بعد از `updateScene`، موتور خودش ایندکسِ کسری را از
 * روی ترتیبِ جدید بازتولید می‌کند ([ADR-007](../../../../ARCHITECTURE_DECISIONS.md#adr-007)).
 * پس الگوریتمِ ایندکسِ کسری اینجا **تکرار نمی‌شود** (درسِ [ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024)).
 * روی هر عنصری که موقعیتش عوض شده `bumpVersion` می‌خورد تا موتور reorder را برای
 * undo ثبت کند ([ADR-026](../../../../ARCHITECTURE_DECISIONS.md#adr-026)).
 *
 * پله‌ای‌ها (`forward`/`backward`) گروهِ انتخاب را یک پله از **همسایه‌ی نامنتخب**
 * رد می‌کنند، بی‌آنکه ترتیبِ درونیِ خودِ انتخاب به‌هم بخورد.
 */
export function reorderElements(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
  op: ReorderOp,
): HbElement[] {
  const isSel = (el: HbElement | undefined): el is HbElement =>
    el !== undefined && selectedIds.has(el.id) && !el.isDeleted;
  if (!elements.some(isSel)) return elements;

  let next: HbElement[];
  if (op === "front") {
    next = [...elements.filter((el) => !isSel(el)), ...elements.filter(isSel)];
  } else if (op === "back") {
    next = [...elements.filter(isSel), ...elements.filter((el) => !isSel(el))];
  } else {
    next = elements.slice();
    if (op === "forward") {
      // از انتها به ابتدا: هر منتخب را یک پله به سمتِ رو (انتها) ببر.
      for (let i = next.length - 2; i >= 0; i--) {
        if (isSel(next[i]) && !isSel(next[i + 1])) {
          [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
        }
      }
    } else {
      // backward — از ابتدا به انتها: یک پله به سمتِ ته (ابتدا).
      for (let i = 1; i < next.length; i++) {
        if (isSel(next[i]) && !isSel(next[i - 1])) {
          [next[i], next[i - 1]] = [next[i - 1]!, next[i]!];
        }
      }
    }
  }

  // اگر ترتیب عوض نشده، همان آرایه (بدون commitِ اضافه).
  const moved = next.some((el, i) => el !== elements[i]);
  if (!moved) return elements;

  // فقط عناصری که جایشان عوض شده version می‌گیرند.
  return next.map((el, i) => (el === elements[i] ? el : bumpVersion(el)));
}
