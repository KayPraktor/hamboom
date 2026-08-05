import type { HbAppState, HbAsset, HbElement } from "@hamboom/shared-types";
import * as Y from "yjs";

import { readElement } from "./element-codec.ts";

/**
 * ساختارِ سندِ یک بورد — [PLAN بخش ۷٫۱](../../../PLAN.md).
 *
 * یک سازنده‌ی واحد، نه پنج جای پراکنده که هرکدام `doc.getMap("elemnts")` را
 * با یک تایپو صدا بزنند ([ADR-024](../../../ARCHITECTURE_DECISIONS.md#adr-024)).
 * `Y.Doc.getMap` ریشه‌ی ناموجود را **بی‌صدا می‌سازد**، پس یک نامِ غلط خطا نمی‌دهد؛
 * فقط یک سندِ خالیِ موازی می‌سازد که هیچ‌وقت sync نمی‌شود.
 */

/**
 * نسخه‌ی ساختارِ سند — در `meta.schemaVersion` هر بورد ذخیره می‌شود.
 *
 * migration در **سرور هنگام بارگذاری اتاق** اجرا می‌شود، نه در کلاینت، تا همه‌ی
 * کلاینت‌ها یک نسخه ببینند ([PLAN بخش ۷٫۵](../../../PLAN.md)). کلاینتی که نسخه‌اش
 * از سرور جلوتر باشد، `HB_ERROR{ code: "CLIENT_TOO_OLD" }` می‌گیرد.
 *
 * ⚠️ این با `customData.hb.schema` (نسخه‌ی ساختارِ customDataِ یک عنصر، در
 * `shared-types`) **یکی نیست** و مستقل از آن بالا می‌رود.
 */
export const SCHEMA_VERSION = 1;

/** نام‌های ریشه‌ی سند — [PLAN بخش ۷٫۱](../../../PLAN.md). */
export const DOC_ROOTS = {
  meta: "meta",
  elements: "elements",
  assets: "assets",
  appState: "appState",
  commentPins: "commentPins",
} as const;

export type DocRootName = (typeof DOC_ROOTS)[keyof typeof DOC_ROOTS];

/** کلیدهای ریشه‌ی `meta`. */
export const META_KEYS = {
  schemaVersion: "schemaVersion",
} as const;

/**
 * originِ تراکنشِ **ساختِ** سند.
 *
 * چرا نام‌دار و نه `null`: پیش‌فرضِ `Y.UndoManager` فقط originِ `null` را ردیابی
 * می‌کند (سنجیده‌شده در گام ۱٫۴). اگر مقداردهیِ اولیه با `null` انجام شود، اولین
 * `Ctrl+Z`ِ کاربر می‌تواند **خودِ ساختارِ سند** را برگرداند.
 */
export const DOC_INIT_ORIGIN = "ydoc-schema:init";

/** پنج ریشه‌ی سند، تایپ‌شده. */
export interface BoardRoots {
  meta: Y.Map<unknown>;
  /** هر عنصر **خودش** یک `Y.Map` است — قلبِ [ADR-007](../../../ARCHITECTURE_DECISIONS.md#adr-007). */
  elements: Y.Map<Y.Map<unknown>>;
  /** فقط متادیتای `HbAsset`؛ **باینری هرگز اینجا نمی‌آید** (گام ۲٫۲ نگهبانش را می‌سازد). */
  assets: Y.Map<unknown>;
  /** زیرمجموعه‌ی **مشترکِ بورد**، نه viewport یا انتخابِ شخصی (گام ۲٫۲). */
  appState: Y.Map<unknown>;
  commentPins: Y.Map<unknown>;
}

/**
 * وضعیتِ مشترکِ پیش‌فرضِ بورد.
 *
 * عمداً برابرِ `DEFAULT_APP_STATE`ِ [`local-adapter`](../../canvas-core/src/sync/local-adapter.ts)ِ
 * M1 است تا بومِ متصل و بومِ آفلاین یک‌جور شروع شوند. اگر واگرا شوند، «بازکردنِ
 * بورد» و «کار بدونِ سرور» دو ظاهرِ متفاوت پیدا می‌کنند.
 */
export const DEFAULT_APP_STATE: HbAppState = {
  viewBackgroundColor: "#ffffff",
  gridSize: 20,
  gridEnabled: false,
  snapToObjects: true,
  frameRendering: { enabled: true, name: true, outline: true, clip: true },
};

/** ریشه‌های یک سندِ موجود. ریشه‌ی ناموجود همین‌جا ساخته می‌شود (رفتارِ خودِ Yjs). */
export function boardRoots(doc: Y.Doc): BoardRoots {
  return {
    meta: doc.getMap(DOC_ROOTS.meta),
    elements: doc.getMap<Y.Map<unknown>>(DOC_ROOTS.elements),
    assets: doc.getMap(DOC_ROOTS.assets),
    appState: doc.getMap(DOC_ROOTS.appState),
    commentPins: doc.getMap(DOC_ROOTS.commentPins),
  };
}

/**
 * سندِ خالیِ یک بوردِ نو — هر پنج ریشه ساخته و `meta.schemaVersion` نوشته می‌شود.
 *
 * ⚠️ فقط برای بوردِ **تازه**. سندی که از دیتابیس بارگذاری می‌شود از راهِ
 * `Y.applyUpdate` پر می‌شود و نسخه‌اش را از خودِ داده می‌گیرد، نه از اینجا.
 */
export function createBoardDoc(options: { schemaVersion?: number } = {}): Y.Doc {
  const doc = new Y.Doc();
  const roots = boardRoots(doc);
  doc.transact(() => {
    roots.meta.set(META_KEYS.schemaVersion, options.schemaVersion ?? SCHEMA_VERSION);
  }, DOC_INIT_ORIGIN);
  return doc;
}

/**
 * نسخه‌ی schemaِ یک سند، یا `undefined` اگر ننوشته باشد.
 *
 * `undefined` یعنی سندی که پیش از نسخه‌بندی ساخته شده — گام ۲٫۳ تصمیم می‌گیرد
 * با آن چه کند. اینجا عمداً پیش‌فرض جا نمی‌افتد تا آن تصمیم پنهان نشود.
 */
export function getSchemaVersion(doc: Y.Doc): number | undefined {
  const value = boardRoots(doc).meta.get(META_KEYS.schemaVersion);
  return typeof value === "number" ? value : undefined;
}

/**
 * سندِ کاملِ materialize‌شده — ورودیِ `replaceDocument`ِ قرارداد M1.
 *
 * ساختارش عمداً برابرِ `CanvasDocument`ِ
 * [`canvas-core/src/sync/contract.ts`](../../canvas-core/src/sync/contract.ts) است، ولی
 * از آن **ارث نمی‌برد**: این پکیج حق ندارد `canvas-core` را ببیند
 * ([ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029)). نگهبانِ واگرایی یک ادعای
 * تایپی در `canvas-sync` است — تنها پکیجی که هر دو را می‌بیند.
 */
export interface BoardDocument {
  elements: HbElement[];
  assets: HbAsset[];
  appState: HbAppState;
}

/**
 * خواندنِ کلِ سند برای بارگذاریِ اولیه.
 *
 * ── دو تصمیمِ ریز که پیامدِ بزرگ دارند ────────────────────────────────
 *
 * **۱. مرتب‌سازی با `index`.** ترتیبِ پیمایشِ `Y.Map` بعد از ادغامِ چند کلاینت
 * هیچ معنایی ندارد. اگر همین‌طور تحویل شود، z-orderِ بورد در هر بار بازکردن
 * عوض می‌شود. `index` یک fractional indexِ **رشته‌ای** است و مقایسه‌ی رشته‌ای
 * درست است — همان قراردادی که `canvas-core/src/elements/frame.ts` هم به کار
 * می‌برد. `id` فقط برای قطعی‌کردنِ حالتِ تساوی است.
 *
 * **۲. عناصرِ حذفِ نرم‌شده هم می‌آیند.** `isDeleted` عنصر را نگه می‌دارد تا undo
 * و CRDT درست کار کنند؛ حذفشان از اینجا یعنی undoِ حذفِ همتا چیزی برای
 * برگرداندن ندارد. همان کاری که `LocalSyncHub.snapshot()`ِ M1 می‌کند.
 *
 * اعتبارسنجی اینجا انجام **نمی‌شود** — نه سکوت است و نه فراموشی: مرزِ اعتماد
 * جایی است که سند از دیتابیس بارگذاری می‌شود (فاز ۴)، نه هر بار خواندن.
 */
export function readDocument(doc: Y.Doc): BoardDocument {
  const roots = boardRoots(doc);

  const elements: HbElement[] = [];
  for (const value of roots.elements.values()) {
    if (value instanceof Y.Map) elements.push(readElement(value));
  }
  elements.sort((a, b) => {
    if (a.index !== b.index) return a.index < b.index ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const assets: HbAsset[] = [];
  for (const value of roots.assets.values()) {
    assets.push((value instanceof Y.Map ? value.toJSON() : value) as HbAsset);
  }

  return {
    elements,
    assets,
    // ریشه‌ی خالی یعنی «هنوز کسی چیزی عوض نکرده»، نه «بورد بدونِ appState».
    appState: { ...DEFAULT_APP_STATE, ...(roots.appState.toJSON() as Partial<HbAppState>) },
  };
}
