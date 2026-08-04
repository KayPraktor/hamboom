/**
 * `@hamboom/ydoc-schema` — مدلِ سندِ Yjs برای یک بورد.
 *
 * پایین‌ترین لایه‌ی ماژول M2. **هم کلاینت و هم سرور** مصرفش می‌کنند، به همین
 * دلیل نه UI می‌بیند (React/Excalidraw/canvas-core) و نه وابستگیِ سرور
 * (ws/pg/ioredis) — [ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029).
 * قاعده‌ی ESLintِ `ydocSchemaBoundaries` این را اعمال می‌کند.
 *
 * محتوای واقعی در فاز ۲ ساخته می‌شود (گام‌های ۲٫۱ تا ۲٫۴):
 * ساختارِ سند، codecِ per-property عنصر، migration، و کدهای پروتکل.
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
