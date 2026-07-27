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
export {
  installCanvasTextDirection,
  uninstallCanvasTextDirection,
  isCanvasTextDirectionInstalled,
  getCanvasTextDirectionInvocations,
  resetCanvasTextDirectionInvocations,
} from "./engine/canvas-direction";
export { guardEditorDirection } from "./engine/editor-direction";
export { commitGesture, commitSystemUpdate } from "./engine/scene-commit";
export type { CommitOptions } from "./engine/scene-commit";

export { getKind, isSticky, getDirection, toExcalidraw, fromExcalidraw } from "./elements/mapping";

export * from "./theme/index";

export {
  createSticky,
  fitStickyFontSize,
  wrapTextGreedy,
  stickyInnerBox,
  applyStickyPalette,
  nextStickyPosition,
} from "./elements/sticky";
export type { CreateStickyOptions, StickyPair, MeasureLine } from "./elements/sticky";

export { createShape } from "./elements/shape";
export type { CreateShapeOptions, ShapeResult, HbShapeKind } from "./elements/shape";

export { createText, realignTextForContent } from "./elements/text";
export type { CreateTextOptions } from "./elements/text";

export { applyStyle, commonStyle, withBoundElements } from "./elements/style";
export type { StylePatch } from "./elements/style";

export { createConnector, rerouteConnector } from "./elements/connector";
export type { CreateConnectorOptions, ConnectorEnd } from "./elements/connector";

export {
  createFrame,
  recomputeFrameMembership,
  frameChildren,
  moveFrame,
  deleteFrameKeepChildren,
} from "./elements/frame";
export type { CreateFrameOptions } from "./elements/frame";

export {
  createImage,
  validateImageFile,
  fitImageBox,
  HB_IMAGE_MAX_MB,
  HB_IMAGE_MAX_BYTES,
  HB_IMAGE_MIME_ALLOW,
  HB_IMAGE_MAX_DISPLAY,
} from "./elements/image";
export type { CreateImageOptions, ImageValidation, HbImageMime } from "./elements/image";

export { createDraw, simplifyStroke } from "./elements/draw";
export type { CreateDrawOptions, StrokePoint } from "./elements/draw";

export { bumpVersion } from "./elements/factory";
export {
  routeConnector,
  edgePoint,
  boxCenter,
  roundTo2,
  toRelativePoints,
} from "./elements/connector-routing";
export type { Point, Box, RouteInput } from "./elements/connector-routing";

export * from "./ui/index";

export { createStickyTool } from "./tools/sticky-tool";
export type { StickyTool, StickyToolOptions } from "./tools/sticky-tool";

export { createImageTool } from "./tools/image-tool";
export type { ImageTool, ImageToolOptions, ImageAssetOutbound } from "./tools/image-tool";

export { createDrawTool } from "./tools/draw-tool";
export type { DrawTool, DrawToolOptions, DrawStrokeOutbound } from "./tools/draw-tool";

export { createContextMenuTool } from "./tools/context-menu-tool";
export type { ContextMenuTool, ContextMenuToolOptions } from "./tools/context-menu-tool";

export { duplicateElements } from "./elements/duplicate";
export type { DuplicateOptions } from "./elements/duplicate";

export { deleteElements, toggleLock, areAllLocked } from "./elements/operations";

export { createFontString, measureLineWidth, clearMeasureCache } from "./text/measure";

export {
  detectBaseDirection,
  resolveDirection,
  defaultTextAlignFor,
  countStrongChars,
  isRTLChar,
  isLTRChar,
} from "./text/bidi";
export type { TextDirection } from "./text/bidi";
/*
 * `normalizePersian` عمداً از اینجا صادر نمی‌شود.
 *
 * در گام ۲٫۱ به `@hamboom/shared-types` منتقل شد چون مسئله‌اش مرز ماژول‌هاست،
 * نه بوم: متن از چند مسیر وارد سیستم می‌شود (بوم، API، قالب، seed) و اگر هر
 * کدام قاعده‌ی خودش را داشته باشد، جستجو در M3 مچ نمی‌شود.
 *
 * مصرف‌کننده‌ها مستقیماً از منبع بخوانند تا دو مسیر import برای یک تابع نداشته
 * باشیم:  import { normalizePersian } from "@hamboom/shared-types";
 */

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
