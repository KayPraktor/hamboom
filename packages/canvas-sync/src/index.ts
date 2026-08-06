/**
 * `@hamboom/canvas-sync` — binder سمتِ کلاینت.
 *
 * پیاده‌سازیِ `CanvasSyncAdapter` (قراردادِ M1) روی `Y.Doc` (مدلِ M2). این تنها
 * پکیجی است که **هر دو طرف** را می‌بیند — [ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029).
 *
 * ── چرا این پکیج جدا از `ydoc-schema` است ──────────────────────────────
 *
 * [PLAN بخش ۸](../../../PLAN.md) binder را داخلِ `ydoc-schema` گذاشته بود، ولی
 * [PLAN بخش ۲](../../../PLAN.md) صریحاً `ydoc-schema → canvas-core` را ممنوع
 * می‌کند. ناسازگاری به نفعِ قاعده‌ی لایه‌بندی حل شد: `ydoc-schema` تنها چیزی
 * است که **سرور** هم مصرفش می‌کند، پس نباید گرافِ تایپِ موتورِ رندر را بکِشد.
 *
 * محتوای واقعی در فاز ۳ ساخته می‌شود (گام‌های ۳٫۱ تا ۳٫۷).
 */

import { SCHEMA_VERSION } from "@hamboom/ydoc-schema";

/**
 * نسخه‌ی سندی که این binder می‌فهمد.
 *
 * سرور هنگام بارگذاریِ اتاق migration را اجرا می‌کند
 * ([PLAN بخش ۷٫۵](../../../PLAN.md))؛ اگر سند از این جلوتر بود، کلاینت
 * `HB_ERROR{ code: "CLIENT_TOO_OLD" }` می‌گیرد و باید رفرش کند.
 */
export const SUPPORTED_SCHEMA_VERSION = SCHEMA_VERSION;

/**
 * ★ نگهبانِ حلقه‌ی echo — **از `canvas-core` می‌آید، از نو نوشته نمی‌شود.**
 *
 * [ADR-024](../../../ARCHITECTURE_DECISIONS.md#adr-024): یک منطق، یک منبع.
 * M1 این نگهبان را با تستِ «بومِ بدرفتار» ساخت و آزمود؛ نسخه‌ی دومِ آن در
 * اینجا یعنی دو رفتار که می‌توانند واگرا شوند. گام ۳٫۱ همین را در اولین خطِ
 * `emitElementChanges` صدا می‌زند.
 */
export { assertEmittable, EchoLoopError, isEmittableOrigin } from "@hamboom/canvas-core/sync";

export {
  LOCAL_ORIGIN,
  REMOTE_ORIGIN,
  YjsSyncAdapter,
  type YjsSyncAdapterOptions,
} from "./adapter.ts";

export { LocalTransport, LocalTransportHub, type SyncTransport } from "./transport.ts";
