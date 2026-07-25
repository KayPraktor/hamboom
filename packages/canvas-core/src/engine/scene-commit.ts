import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * چوک‌پوینتِ نوشتن به صحنه — [ADR-026](../../../../ARCHITECTURE_DECISIONS.md#adr-026).
 *
 * هر نوشتنی به صحنه دقیقاً یکی از این دو است:
 *
 * - **`commitGesture`** → یک **ژستِ کاربر**؛ یک ورودی undo
 *   (`captureUpdate: "IMMEDIATELY"`). ساخت/حرکت/تغییرِ رنگ/استایل، درج تصویر و استروک.
 * - **`commitSystemUpdate`** → تغییرِ **سیستمی/غیرِکاربر** که نباید ورودی undo بسازد
 *   (`captureUpdate: "NEVER"`): اعمالِ تغییرِ remote در M2، flip وضعیتِ asset از
 *   pending به saved، مهاجرت‌ها.
 *
 * ── چرا چوک‌پوینت ─────────────────────────────────────────────────────
 *
 * انتخابِ `captureUpdate` سه‌بار به‌صورت باگ ظاهر شد (تغییرِ رنگ که یک undo کل
 * ژست قبلی را پاک می‌کرد؛ ترتیبِ اشتباهِ pending/saved در تصویر). با عبورِ همه‌ی
 * نوشتن‌ها از این دو تابع، انتخاب در **یک نقطه** ثابت می‌شود و نامِ تابع خودش
 * intent را می‌گوید. قاعده‌ی ESLint `require-capture-update` نوشتنِ خامِ بدونِ
 * انتخاب را می‌گیرد؛ این دو تابع پاسخِ درست به آن قاعده‌اند.
 *
 * ── ترتیب در جریانِ چندمرحله‌ای ─────────────────────────────────────────
 *
 * برای ساختی که چند نوشتن دارد (تصویرِ pending→saved)، **creation همیشه
 * `commitGesture`** است (اولین نوشتن، تاریخچه را می‌سازد) و به‌روزرسانی‌های
 * بعدیِ همان ژست `commitSystemUpdate`. چون `NEVER`/`EVENTUALLY` خطِ پایه‌ی
 * تاریخچه را جلو می‌برند، ترتیبِ معکوس باعث می‌شود یک undo فقط مرحله‌ی آخر را
 * برگرداند نه کل ساخت را.
 */

export interface CommitOptions {
  /** عناصری که پس از نوشتن انتخاب شوند. */
  select?: readonly string[];
}

function selectionAppState(select?: readonly string[]): unknown {
  if (!select) return undefined;
  const selectedElementIds: Record<string, boolean> = {};
  for (const id of select) selectedElementIds[id] = true;
  return { selectedElementIds };
}

/**
 * نوشتنِ یک ژستِ کاربر — یک ورودی undo.
 *
 * `elements` آرایه‌ی **آماده‌ی موتور** است (خروجی `toExcalidraw` هرجا لازم بوده)،
 * چون صحنه معمولاً ترکیبِ عناصرِ دست‌نخورده‌ی موتور و عناصرِ نگاشته است.
 */
export function commitGesture(
  api: ExcalidrawImperativeAPI,
  elements: readonly unknown[],
  options: CommitOptions = {},
): void {
  api.updateScene({
    elements: elements as never,
    appState: selectionAppState(options.select) as never,
    captureUpdate: "IMMEDIATELY",
  });
}

/** نوشتنِ یک تغییرِ سیستمی/غیرقابل‌undo. */
export function commitSystemUpdate(
  api: ExcalidrawImperativeAPI,
  elements: readonly unknown[],
  options: CommitOptions = {},
): void {
  api.updateScene({
    elements: elements as never,
    appState: selectionAppState(options.select) as never,
    captureUpdate: "NEVER",
  });
}
