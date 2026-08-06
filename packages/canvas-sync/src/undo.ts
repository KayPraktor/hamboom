import * as Y from "yjs";

import { LocalOrigin } from "./emit-local.ts";

/**
 * انزوای undo — `Y.UndoManager` با `trackedOrigins` ([PLAN بخش ۷٫۴](../../../PLAN.md)).
 *
 * ── ★★ چرا Yjs صاحبِ undo است و نه موتور ──────────────────────────────
 *
 * undoِ خودِ موتور در گام ۳٫۴ **سنجیده شد و درست کار می‌کند**: حتی وقتی همتا روی
 * همان عنصر تغییر داده، `Ctrl+Z` فقط کارِ خودِ کاربر را برمی‌گرداند. مشکل جای
 * دیگری بود —
 *
 * ⚠️ **undoِ موتور به همتا نمی‌رسد.** کاربرِ ب رنگ را برمی‌گرداند، بومِ خودش زرد
 * می‌شود، و بومِ الف **بنفش می‌مانَد**. واگرایی، تا وقتی کسی دوباره آن عنصر را
 * لمس کند. سنجیده شد: `acolor: "#D0C6F5"` در حالی که `bcolor: "#FFF9B1"`.
 *
 * با `Y.UndoManager` این مسئله از ریشه نیست: undo یک تراکنشِ عادیِ Yjs است، پس
 * از همان مسیرِ همیشگی به همتا می‌رسد.
 *
 * ── ★★ تله‌ی پین‌شده از گام ۱٫۴ ────────────────────────────────────────
 *
 * پیش‌فرضِ `new Y.UndoManager(scope)` **وارونه‌ی انتظار** است: فقط تراکنش‌هایی با
 * originِ `null` ردیابی می‌شوند. سنجیده شد: `null` ✔ · `undefined` ✔ ·
 * `"local-user"` ✘ · `"remote"` ✘. چون binder با originِ **نام‌دار** می‌نویسد،
 * جاافتادنِ `trackedOrigins` یعنی **undo بی‌صدا هیچ کاری نمی‌کند** — نه خطا، نه
 * هشدار؛ کاربر `Ctrl+Z` می‌زند و هیچ اتفاقی نمی‌افتد.
 *
 * ★ `LocalOrigin` یک **کلاس** است (گام ۳٫۳) و Yjs originی را که **سازنده‌اش** در
 * `trackedOrigins` باشد هم ردیابی می‌کند — پس یک `Set([LocalOrigin])` هر ژستی را
 * با هر `gestureId` می‌گیرد.
 */

export interface UndoScope {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * مرزِ ژست — ورودیِ undoِ بعدی از اینجا شروع می‌شود.
   *
   * بدونِ این، Yjs هر چیزی را که در پنجره‌ی `captureTimeout` بیفتد **در یک
   * ورودی** ادغام می‌کند: دو ساختِ پشتِ سرِ هم یک `Ctrl+Z` می‌شدند.
   */
  stopCapturing(): void;
  /** پاک‌کردنِ تاریخچه — مثلاً بعد از `replaceDocument`. */
  clear(): void;
  destroy(): void;
}

export interface UndoScopeOptions {
  /**
   * پنجره‌ی ادغامِ Yjs. پیش‌فرضِ خودِ Yjs (۵۰۰ms) نگه داشته شده تا تیک‌های یک
   * درگ (که ۵۰ms از هم فاصله دارند) در **یک** ورودی بنشینند؛ مرزِ دقیقِ ژست را
   * `stopCapturing` می‌سازد، نه این عدد.
   */
  captureTimeoutMs?: number;
}

/**
 * دامنه‌ی undo روی ریشه‌ی `elements`.
 *
 * ⚠️ **فقط `elements`.** `appState` (گرید، رنگِ پس‌زمینه) وضعیتِ **مشترکِ بورد**
 * است و برگرداندنش با `Ctrl+Z`ِ یک نفر، تنظیمِ همه را عوض می‌کند. `commentPins`
 * هم دنبالِ نخِ کامنت در Postgres است، نه ویرایشِ بوم.
 */
export function createUndoScope(doc: Y.Doc, options: UndoScopeOptions = {}): UndoScope {
  const manager = new Y.UndoManager(doc.getMap("elements"), {
    // ★★ بدونِ این خط، undo بی‌صدا هیچ کاری نمی‌کند (گام ۱٫۴).
    trackedOrigins: new Set([LocalOrigin]),
    captureTimeout: options.captureTimeoutMs ?? 500,
  });

  return {
    undo: () => void manager.undo(),
    redo: () => void manager.redo(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    stopCapturing: () => manager.stopCapturing(),
    clear: () => manager.clear(),
    destroy: () => manager.destroy(),
  };
}

/** کلیدهایی که به undo/redo نگاشته می‌شوند. */
function shortcutOf(event: KeyboardEvent): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}

/**
 * ★★ گرفتنِ `Ctrl+Z` **قبل از موتور** و سپردنش به `UndoManager`.
 *
 * ── چرا لازم است ─────────────────────────────────────────────────────
 *
 * موتور تاریخچه‌ی خودش را دارد و آن هم به `Ctrl+Z` جواب می‌دهد. اگر هر دو فعال
 * بمانند **یک `Ctrl+Z` دو کار می‌کند**. چون Yjs صاحبِ undo است (بالا)، مالِ موتور
 * باید ساکت شود.
 *
 * ★ در فازِ **capture** روی یک نیای کانتینر بسته می‌شود، پس قبل از listenerهای
 * خودِ موتور اجرا می‌شود؛ بعد `stopPropagation` جلوی رسیدنش را می‌گیرد.
 *
 * ⚠️ **این تابع مالِ اپ است، نه binder.** `apps/web` (M3) تصمیم می‌گیرد کجا و
 * روی کدام عنصر ببنددش. اینجا صادر می‌شود تا دمو و تستِ E2E همان مسیرِ واقعی را
 * بیازمایند، نه یک میان‌بُر.
 */
export function bindUndoShortcuts(target: HTMLElement, scope: UndoScope): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const action = shortcutOf(event);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "undo") scope.undo();
    else scope.redo();
  };

  target.addEventListener("keydown", onKeyDown, { capture: true });
  return () => target.removeEventListener("keydown", onKeyDown, { capture: true });
}
