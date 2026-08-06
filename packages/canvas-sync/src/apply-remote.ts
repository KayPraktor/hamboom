import { commitSystemUpdate, toExcalidraw, type HamboomCanvasProps } from "@hamboom/canvas-core";
import type { CanvasDocument, ElementChangeSet } from "@hamboom/canvas-core/sync";

/**
 * نوشتنِ تغییرِ **remote** روی صحنه — ★ همیشه با `captureUpdate: "NEVER"`.
 *
 * ── چرا این فایل جدا است ──────────────────────────────────────────────
 *
 * یک قاعده‌ی ESLintِ **باریک** فقط روی همین فایل اعمال می‌شود
 * (`hamboom/remote-writes-never`): `commitGesture` و هر `captureUpdate`ی جز
 * `"NEVER"` اینجا خطای لینت‌اند. جداکردنِ فایل تنها راهی است که آن قاعده بدونِ
 * مثبتِ کاذب روی مسیرِ **محلی** (که `IMMEDIATELY` می‌خواهد) قابلِ اعمال است.
 *
 * ── چرا `NEVER` ───────────────────────────────────────────────────────
 *
 * [ADR-026](../../../ARCHITECTURE_DECISIONS.md#adr-026): تغییری که از کاربرِ دیگر
 * می‌رسد نباید ورودیِ undo بسازد. با `IMMEDIATELY` کارِ آن کاربر در undo stackِ
 * **محلی** می‌نشیند و `Ctrl+Z` این کاربر کارِ او را برمی‌گرداند — همان چیزی که
 * [ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012) منع کرده. باگ **بی‌صدا**
 * است: نه خطا می‌دهد، نه در تستِ واحد دیده می‌شود.
 *
 * ⚠️ این **سدِ دوم** است، نه تنها سد. `trackedOrigins` (گام ۳٫۴) تاریخچه‌ی
 * **Yjs** را محافظت می‌کند و این یکی تاریخچه‌ی **موتورِ رندر** را. سنجیده شد در
 * گام ۱٫۴ که هیچ‌کدام جایگزینِ دیگری نیست.
 */

/** دسته‌ی امریِ موتور — از قراردادِ خودِ `HamboomCanvas` گرفته می‌شود، نه از Excalidraw. */
export type CanvasApi = Parameters<NonNullable<HamboomCanvasProps["onReady"]>>[0];

type SceneElement = ReturnType<CanvasApi["getSceneElementsIncludingDeleted"]>[number];

/**
 * ترتیبِ آرایه با `index` هم‌راستا نگه داشته می‌شود.
 *
 * `index` یک fractional indexِ **رشته‌ای** است و z-order را تعیین می‌کند، ولی
 * موتور هم به ترتیبِ خودِ آرایه نگاه می‌کند. اگر این دو با هم نخوانند، عنصرِ
 * تازه‌رسیده‌ی همتا تا اولین بازچینش روی همه‌چیز می‌نشیند. مرتب‌سازی همان
 * قراردادی است که `readDocument` هم دارد.
 */
function byIndex(a: SceneElement, b: SceneElement): number {
  const left = String(a.index ?? "");
  const right = String(b.index ?? "");
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * ادغامِ یک `ElementChangeSet`ِ remote در صحنه‌ی فعلی.
 *
 * ⚠️ **از عناصرِ شاملِ حذف‌شده شروع می‌کند.** `getSceneElements()` حذف‌شده‌ها را
 * فیلتر می‌کند؛ اگر مبنا آن بود، هر تغییرِ remote عناصرِ حذفِ نرم‌شده را از صحنه
 * می‌انداخت و undoِ حذفِ همتا چیزی برای برگرداندن نداشت.
 */
export function applyRemoteChangesToScene(api: CanvasApi, changes: ElementChangeSet): void {
  const merged = new Map<string, SceneElement>();
  for (const element of api.getSceneElementsIncludingDeleted()) merged.set(element.id, element);

  for (const element of changes.upserted) {
    merged.set(element.id, toExcalidraw(element) as unknown as SceneElement);
  }
  for (const id of changes.deleted) {
    const existing = merged.get(id);
    // حذفِ **نرم** — عنصر می‌مانَد تا undo و CRDT چیزی برای برگرداندن داشته باشند.
    if (existing) merged.set(id, { ...existing, isDeleted: true });
  }

  commitSystemUpdate(api, [...merged.values()].sort(byIndex));
}

/**
 * جایگزینیِ کاملِ صحنه — بارگذاریِ اولیه یا بازگردانیِ نسخه.
 *
 * ★ این هم `NEVER` است و نه `IMMEDIATELY`: بارگذاریِ بورد کارِ کاربر نیست. اگر
 * ورودیِ undo می‌ساخت، اولین `Ctrl+Z`ِ کاربر **کلِ بورد را پاک می‌کرد**.
 *
 * ⚠️ `appState` و `assets` عمداً هنوز اعمال نمی‌شوند: اولی به نوشتنِ appStateِ
 * موتور نیاز دارد (کارِ گام ۳٫۷) و دومی به مسیرِ فایل (گام ۳٫۶).
 */
export function replaceSceneDocument(api: CanvasApi, document: CanvasDocument): void {
  const elements = document.elements.map(
    (element) => toExcalidraw(element) as unknown as SceneElement,
  );
  commitSystemUpdate(api, [...elements].sort(byIndex));
}
