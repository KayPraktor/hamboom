/**
 * نقطه‌ی ورود لایه‌ی قرارداد sync — `@hamboom/canvas-core/sync`.
 *
 * قرارداد کامل (`CanvasSyncAdapter`, `CanvasInbound`, `CanvasOutbound`,
 * `ElementChangeSet`, `PeerState`, ...) در **گام ۲٫۲** از TODO.md اینجا
 * تعریف می‌شود. ماژول M2 (`realtime-sync`) دقیقاً همین interface را
 * پیاده می‌کند و هیچ‌چیز دیگری از canvas-core را نمی‌بیند.
 *
 * تا آن موقع این ماژول فقط وجود دارد تا نگاشت `exports` و مرز پکیج
 * از همین ابتدا آزموده شده باشد.
 */

/**
 * نسخه‌ی قرارداد sync.
 *
 * `0` یعنی «هنوز تعریف نشده». با تثبیت قرارداد در گام ۲٫۲ به `1` می‌رود.
 * از آن به بعد، هر تغییر ناسازگار این عدد را جلو می‌برد و سرور realtime
 * می‌تواند کلاینت قدیمی را با `HB_ERROR{ code: "CLIENT_TOO_OLD" }` رد کند.
 */
export const SYNC_CONTRACT_VERSION = 0;
