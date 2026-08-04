/**
 * `@hamboom/realtime` — سرورِ همگام‌سازیِ بلادرنگ.
 *
 * سرورِ WebSocket با پروتکلِ y-protocols + پیام‌های سفارشیِ هم‌بوم
 * ([PLAN بخش ۵٫۳](../../../PLAN.md)). چرخه‌ی عمرِ اتاق، پایداری، awareness،
 * و اعمالِ مجوز.
 *
 * ── چه چیزی اینجا **نیست** ─────────────────────────────────────────────
 *
 * موتورِ رندر و React (این سرور هرگز بوم را نمی‌بیند —
 * [ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029)) و SDKِ خامِ Object Storage
 * (فقط از راهِ `packages/storage` — P4). قاعده‌ی `realtimeBoundaries` هر دو را
 * خطا می‌کند.
 *
 * محتوای واقعی در فاز ۴ ساخته می‌شود (گام‌های ۴٫۱ تا ۴٫۸).
 */

import { SCHEMA_VERSION } from "@hamboom/ydoc-schema";

/**
 * نسخه‌ی سندی که این سرور سرو می‌کند.
 *
 * migration هنگام **بارگذاریِ اتاق در سرور** اجرا می‌شود، نه در کلاینت، تا همه‌ی
 * کلاینت‌ها یک نسخه ببینند ([PLAN بخش ۷٫۵](../../../PLAN.md)).
 */
export const SERVED_SCHEMA_VERSION = SCHEMA_VERSION;
