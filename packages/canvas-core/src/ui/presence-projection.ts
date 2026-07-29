import { sceneCoordsToViewportCoords } from "../engine/coords";

/**
 * پروجکشنِ صحنه → پیکسلِ لایه‌ی روکشِ حضور — منبعِ واحد برای `PeerCursors`/
 * `PeerSelections` (و binderِ واقعیِ M2).
 *
 * ── چرا اینجا، نه در دمو (درسِ Q1 گام ۴٫۴ + [ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024)) ──
 *
 * مکان‌نما و هاله‌ی همتا در همین `ui/` رندر می‌شوند، ولی ریاضیِ پروجکشن قبلاً فقط
 * در `dev/App.tsx` بود. یعنی وقتی M2 حضورِ واقعی را می‌ساخت، مجبور بود از نو
 * بنویسدش — و همان باگِ Q1 (جا-ماندنِ مکان‌نما روی panِ محلی) را دوباره تولید کند.
 * حالا یک تابعِ مشترک است؛ هر دو مصرف‌کننده همین را صدا می‌زنند.
 */

/**
 * نمای بوم برای پروجکشنِ حضور. ساختارْ همتای `Viewport`ِ قراردادِ sync است —
 * عمداً اینجا محلی تعریف شده تا `ui/` به `sync/` گره نخورد؛ typing ساختاری هر دو
 * را سازگار نگه می‌دارد.
 */
export interface OverlayViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/**
 * نقطه‌ی صحنه → پیکسل، نسبت به گوشه‌ی بالا-شروعِ لایه‌ی روکش.
 *
 * ★ **ضدِ باگِ Q1:** `viewport` **ورودیِ صریح** است و باید مقدارِ معتبر از
 *   `onScrollChange` باشد، نه `api.getAppState()` که درست بعد از pan/zoom یک
 *   فریمْ کهنه است. با گرفتنِ viewport به‌عنوان پارامتر، این تابع نمی‌گذارد
 *   مصرف‌کننده (دمو یا M2) دوباره از یک خواندنِ کهنه پروجکت کند.
 *
 * ★ `offsetLeft/offsetTop` (offsetِ canvas در پنجره) با pan/zoom عوض **نمی‌شوند**
 *   (فقط با resize) — پس خواندنشان از `appState` هنگام پروجکت بی‌خطر است.
 *   `overlayOrigin` = گوشه‌ی لایه‌ی روکش از `getBoundingClientRect`.
 *
 * ترنسفورم به خودِ موتور (`sceneCoordsToViewportCoords`) سپرده می‌شود — بدونِ
 * تکرارِ فرمول. مختصاتْ **فیزیکی** است و آینه نمی‌شود (استثنای بوم، ADR-016/P6).
 */
export function sceneToOverlayPixel(
  scene: { x: number; y: number },
  viewport: OverlayViewport,
  canvasOffset: { offsetLeft: number; offsetTop: number },
  overlayOrigin: { left: number; top: number },
): { x: number; y: number } {
  const p = sceneCoordsToViewportCoords({ sceneX: scene.x, sceneY: scene.y }, {
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    zoom: { value: viewport.zoom },
    offsetLeft: canvasOffset.offsetLeft,
    offsetTop: canvasOffset.offsetTop,
  } as Parameters<typeof sceneCoordsToViewportCoords>[1]);
  return { x: p.x - overlayOrigin.left, y: p.y - overlayOrigin.top };
}
