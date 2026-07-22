/**
 * `@hamboom/canvas-core` — موتور بوم هم‌بوم.
 *
 * این پکیج **هیچ وابستگی به شبکه، Yjs یا احراز هویت ندارد** و باید کاملاً
 * آفلاین قابل اجرا و تست باشد. تنها راه ارتباط با دنیای بیرون، قرارداد
 * `CanvasSyncAdapter` در زیرمسیر `@hamboom/canvas-core/sync` است.
 * این محدودیت با ESLint اعمال می‌شود (`canvasCoreBoundaries`).
 *
 * نقشه‌ی پوشه‌ها — هر کدام در گام مشخصی از TODO.md پر می‌شود:
 *
 * | پوشه       | مسئولیت                                   | گام   |
 * |------------|-------------------------------------------|-------|
 * | `engine/`  | wrapper روی موتور رندر + patch ها          | ۱٫۱   |
 * | `text/`    | bidi، shaping، اندازه‌گیری متن فارسی       | ۱٫۲–۱٫۴ |
 * | `sync/`    | قرارداد canvas ↔ sync + آداپتور لوکال      | ۲٫۲   |
 * | `elements/`| سازنده و نگاشت انواع عنصر                  | ۲٫۳، ۳٫۲–۳٫۶ |
 * | `theme/`   | پالت استیکی و توکن‌های ظاهری میرو-استایل    | ۳٫۱   |
 * | `tools/`   | ابزارهای بوم (استیکی، کانکتور، قلم، ...)   | ۳٫۲–۳٫۷ |
 * | `ui/`      | نوار ابزار، پنل‌ها، منوی راست‌کلیک (RTL)    | ۴٫۲–۴٫۴ |
 *
 * @see ../../../TODO.md
 * @see ../../../ARCHITECTURE_DECISIONS.md
 */

/*
 * بازصادرات کنترل‌شده از موتور بالادست.
 *
 * قاعده: هیچ کد هم‌بومی نباید مستقیماً از `@excalidraw/excalidraw` import کند
 * (به‌جز `engine/` و `elements/mapping.ts`). هرچه از موتور لازم است، از همین‌جا
 * عبور می‌کند — تا اگر روزی به پله‌ی fork رفتیم، سطح تماس یک فایل باشد.
 */
export { FONT_FAMILY, convertToExcalidrawElements } from "@excalidraw/excalidraw";

export { HamboomCanvas } from "./engine/HamboomCanvas";
export type { HamboomCanvasProps } from "./engine/HamboomCanvas";
export {
  configureExcalidrawAssetPath,
  isAssetPathConfigured,
  assertAssetPathConfigured,
} from "./engine/asset-path";

/** شناسه‌ی پکیج — برای تشخیص در لاگ و ابزار توسعه. */
export const CANVAS_CORE_NAME = "@hamboom/canvas-core";

/**
 * پله‌ی فعلی [ADR-003](../../../ARCHITECTURE_DECISIONS.md#adr-003).
 *
 * - `"npm"`  — مصرف بسته‌ی رسمی، بدون تغییر
 * - `"patch"`— بسته‌ی رسمی + اصلاحات جراحی در `patches/`
 * - `"fork"` — فورک کامل در `vendor/excalidraw`
 *
 * هر session که این را تغییر می‌دهد، باید دلیلش را در `PROGRESS.md` ثبت کند
 * و برای عبور به `"fork"` تایید مالک بگیرد.
 */
export const ENGINE_STAGE: "npm" | "patch" | "fork" = "npm";
