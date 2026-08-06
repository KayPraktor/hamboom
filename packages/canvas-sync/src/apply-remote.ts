import {
  commitSystemUpdate,
  createFontString,
  measureLineWidth,
  toExcalidraw,
  wrapTextGreedy,
  type HamboomCanvasProps,
} from "@hamboom/canvas-core";
import type { CanvasDocument, ElementChangeSet } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";

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
 * ★★ بازمحاسبه‌ی `text` از `originalText` — نیمه‌ی دومِ
 * [ADR-034](../../../ARCHITECTURE_DECISIONS.md#adr-034).
 *
 * فقط `originalText` در سند CRDT است؛ `text` نسخه‌ی **wrap‌شده**ی مشتق از آن.
 * گام ۱٫۳ سنجید که `text`ِ emit‌شده‌ی **هر دو** کلاینت بعد از ادغام غلط است، پس
 * ADR گفت باید بازمحاسبه شود — و این تنها جایی است که می‌شود: بعد از ادغام،
 * روی کلاینتی که قرار است نشانش بدهد.
 *
 * ⚠️ در گام ۳٫۳ معلوم شد بدونِ این، **تغییرِ متنِ همتا اصلاً روی بوم دیده
 * نمی‌شود**: سند درست ادغام می‌شد ولی صحنه همان `text`ِ قدیمی را نگه می‌داشت.
 * تستِ [`e2e/text-latency.spec.ts`](../e2e/text-latency.spec.ts) دقیقاً همین را
 * گرفت.
 *
 * از `wrapTextGreedy` و `measureLineWidth`ِ **خودِ M1** استفاده می‌کند، نه یک
 * الگوریتمِ دوم (ADR-024).
 */
function withRecomputedText(element: HbElement): HbElement {
  if (element.type !== "text") return element;
  const { originalText, fontSize, fontFamily, width } = element;
  if (typeof originalText !== "string" || width <= 0) return element;

  const fontString = createFontString(fontSize, String(fontFamily));
  const measure = (line: string, size: number): number =>
    measureLineWidth(line, createFontString(size, String(fontFamily)));
  // اگر canvas در دسترس نباشد `NaN` برمی‌گردد (عمدیِ M1) — آن‌وقت wrap بی‌معنی
  // است و بهتر است `text` دست‌نخورده بماند تا اینکه با عرضِ غلط شکسته شود.
  if (Number.isNaN(measureLineWidth("م", fontString))) return element;

  return { ...element, text: wrapTextGreedy(originalText, width, fontSize, measure).join("\n") };
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
    merged.set(element.id, toExcalidraw(withRecomputedText(element)) as unknown as SceneElement);
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
    (element) => toExcalidraw(withRecomputedText(element)) as unknown as SceneElement,
  );
  commitSystemUpdate(api, [...elements].sort(byIndex));
}
