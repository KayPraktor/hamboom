/**
 * کنترل مسیر دارایی‌های Excalidraw — نگهبان اصل P2.
 *
 * Excalidraw اگر `window.EXCALIDRAW_ASSET_PATH` ست نشده باشد، فونت‌هایش را از
 * `https://esm.sh/@excalidraw/excalidraw@<version>/dist/prod/` می‌گیرد. این
 * برای هم‌بوم دو مشکل جدی دارد:
 *
 * 1. **نقض اصل P2** — هیچ سرویس خارجی در runtime.
 * 2. **غیرقابل‌اتکا از داخل ایران** — کاربر بومی با فونت fallback می‌بیند،
 *    و بدتر: اندازه‌گیری متن با فونت اشتباه انجام می‌شود و چیدمان می‌پرد.
 *
 * چون این نقص **بی‌صدا** است (چیزی خطا نمی‌دهد، فقط از اینترنت دانلود می‌کند)،
 * `assertAssetPathConfigured()` آن را به یک خطای صریح تبدیل می‌کند.
 */

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

/**
 * تنظیم مسیر پایه‌ی دارایی‌ها. باید **قبل از** اولین رندر بوم صدا زده شود.
 *
 * @param basePath مسیری که پوشه‌ی `fonts/` زیر آن سرو می‌شود — مثلاً
 *                 `"/excalidraw-assets/"` وقتی فایل‌ها در
 *                 `public/excalidraw-assets/fonts/` هستند.
 */
export function configureExcalidrawAssetPath(basePath: string): void {
  window.EXCALIDRAW_ASSET_PATH = basePath;
}

/** آیا مسیر دارایی‌ها ست شده است؟ */
export function isAssetPathConfigured(): boolean {
  const value = window.EXCALIDRAW_ASSET_PATH;
  if (typeof value === "string") return value.length > 0;
  return Array.isArray(value) && value.length > 0;
}

/**
 * اگر مسیر ست نشده باشد خطا می‌دهد. `HamboomCanvas` این را قبل از رندر
 * صدا می‌زند تا هرگز به‌صورت تصادفی به CDN خارجی برنگردیم.
 */
export function assertAssetPathConfigured(): void {
  if (isAssetPathConfigured()) return;

  throw new Error(
    "‏[hamboom] مسیر دارایی‌های Excalidraw تنظیم نشده است.\n" +
      "بدون این تنظیم، فونت‌ها از esm.sh دانلود می‌شوند که هم اصل P2 را نقض می‌کند " +
      "و هم از داخل ایران قابل اتکا نیست.\n" +
      'راه حل: قبل از رندر بوم، configureExcalidrawAssetPath("/excalidraw-assets/") ' +
      "را صدا بزن (یا همان مقدار را به‌صورت window.EXCALIDRAW_ASSET_PATH در index.html بگذار)، " +
      "و مطمئن شو اسکریپت copy-excalidraw-fonts.mjs اجرا شده است.",
  );
}
