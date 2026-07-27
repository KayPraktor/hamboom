import { toPersianDigits } from "@hamboom/i18n";

/**
 * محاسباتِ zoom — گام ۴٫۳. خالص و تست‌پذیر، جدا از رابط.
 *
 * ── چرا حول مرکز ──────────────────────────────────────────────────────
 *
 * ست‌کردنِ خامِ `zoom.value` حول مبدأِ صحنه (۰،۰) zoom می‌کند، نه وسطِ نما — پس
 * محتوا زیرِ دستِ کاربر می‌پرد. فرمولِ زیر `scroll` را جوری تنظیم می‌کند که
 * نقطه‌ی **وسطِ نما** ثابت بماند. مبنا: `sceneX = (clientX - offset)/zoom - scrollX`
 * (همان `viewportCoordsToSceneCoords`ِ موتور)، پس برای ثابت‌ماندنِ نقطه‌ی وسط:
 * `scrollX' = scrollX + (width/2)·(1/zoom' − 1/zoom)`.
 */

export interface ViewState {
  zoom: number;
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** zoom بعدی با گامِ ×۱٫۲ (بزرگ‌نمایی) یا ÷۱٫۲ (کوچک‌نمایی). */
export function zoomStep(current: number, direction: 1 | -1): number {
  return clampZoom(direction > 0 ? current * 1.2 : current / 1.2);
}

/** zoom و scroll جدید که نقطه‌ی **وسطِ نما** ثابت بماند. */
export function zoomAroundCenter(
  view: ViewState,
  nextZoom: number,
): { zoom: number; scrollX: number; scrollY: number } {
  const zoom = clampZoom(nextZoom);
  const halfW = view.width / 2;
  const halfH = view.height / 2;
  return {
    zoom,
    scrollX: view.scrollX + halfW * (1 / zoom - 1 / view.zoom),
    scrollY: view.scrollY + halfH * (1 / zoom - 1 / view.zoom),
  };
}

/** درصدِ بزرگ‌نمایی با ارقامِ فارسی — «۱۰۰٪». */
export function formatZoomPercent(zoom: number): string {
  return `${toPersianDigits(Math.round(zoom * 100))}٪`;
}
