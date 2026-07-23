import { sceneCoordsToViewportCoords, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";

/**
 * تبدیل مختصات — تنها مسیر مجاز رسیدن `tools/` به این توابع موتور.
 *
 * قاعده‌ی پکیج: فقط `engine/` و `elements/mapping.ts` اجازه‌ی import مستقیم از
 * `@excalidraw/excalidraw` را دارند. این فایل همان قاعده را برای ابزارها
 * برقرار نگه می‌دارد بدون اینکه مجبور شوند از ریشه‌ی پکیج import کنند (که
 * وابستگی چرخه‌ای می‌ساخت).
 *
 * ⚠️ مختصات بوم **هرگز آینه نمی‌شود** — حتی در RTL، `x` به راست افزایش می‌یابد
 * ([ADR-016](../../../../ARCHITECTURE_DECISIONS.md#adr-016)).
 */
export { sceneCoordsToViewportCoords, viewportCoordsToSceneCoords };
