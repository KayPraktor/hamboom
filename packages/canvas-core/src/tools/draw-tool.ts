import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { HbElement } from "@hamboom/shared-types";

import { createDraw, simplifyStroke, type StrokePoint } from "../elements/draw";
import { toExcalidraw } from "../elements/mapping";
import { viewportCoordsToSceneCoords } from "../engine/coords";
import { HB_UI_COLORS } from "../theme/tokens";
import type { ElementChangeSet, EphemeralPayload } from "../sync/contract";

/**
 * ابزار قلم آزاد — گام ۳٫۷ / [ADR-022](../../../../ARCHITECTURE_DECISIONS.md#adr-022).
 *
 * ── دو کانال ──────────────────────────────────────────────────────────
 *
 * - **حین کشیدن:** هر نقطه فقط از `emitEphemeral({ kind: "draw-stroke", … })`
 *   پخش می‌شود و استروکِ محلی در یک لایه‌ی مجزا رندر می‌شود (`onLocalStroke`).
 *   **هیچ‌چیز وارد سند نمی‌شود** — نه صحنه، نه تاریخچه، نه CRDT.
 * - **در `pointerup`:** مسیر ساده می‌شود (RDP)، یک عنصر freedraw ساخته و در
 *   **یک** `updateScene(IMMEDIATELY)` روی صحنه‌ی محلی نوشته می‌شود (یک undo)، و
 *   دقیقاً **یک** `emitElementChanges` برای لایه‌ی sync فرستاده می‌شود.
 *
 * پس یک استروکِ ۳۰۰ نقطه‌ای صدها `emitEphemeral` می‌سازد ولی فقط **یک**
 * `emitElementChanges` — همان چیزی که تست معیارِ پذیرش می‌سنجد.
 *
 * ⚠️ رویدادها در فاز capture گرفته و `stopPropagation` می‌شوند تا ابزار قلمِ
 * خود موتور فعال نشود (مثل `sticky-tool`).
 */

const CANVAS_ROOT = ".excalidraw";

/** زیرمجموعه‌ای از `CanvasOutbound` که این ابزار لازم دارد. */
export interface DrawStrokeOutbound {
  emitEphemeral(payload: EphemeralPayload | null): void;
  emitElementChanges(changes: ElementChangeSet): void;
}

export interface DrawToolOptions {
  api: ExcalidrawImperativeAPI;
  outbound: DrawStrokeOutbound;
  authorId: string;
  root?: Document | HTMLElement;
  color?: string;
  width?: number;
  /** آستانه‌ی ساده‌سازی RDP بر حسب پیکسلِ صحنه. پیش‌فرض ۱. */
  simplifyEpsilon?: number;
  /**
   * throttle پخش ephemeral (ms). نقاط **همیشه** ثبت می‌شوند؛ فقط نرخِ
   * `emitEphemeral` محدود می‌شود. پیش‌فرض ۱۶ (~۶۰fps).
   */
  ephemeralThrottleMs?: number;
  /** رندر استروکِ محلیِ در حال کشیدن (مختصات صحنه). `null` یعنی پایان/پاک. */
  onLocalStroke?: (points: StrokePoint[] | null) => void;
  onCommitted?: (element: HbElement) => void;
  now?: () => number;
}

export interface DrawTool {
  activate(): void;
  deactivate(): void;
  toggle(): void;
  isActive(): boolean;
  destroy(): void;
}

export function createDrawTool(options: DrawToolOptions): DrawTool {
  const {
    api,
    outbound,
    authorId,
    root = typeof document === "undefined" ? undefined : document,
    color = HB_UI_COLORS.text,
    width = 3,
    simplifyEpsilon = 1,
    ephemeralThrottleMs = 16,
    onLocalStroke,
    onCommitted,
    now = () => Date.now(),
  } = options;

  let active = false;
  let drawing = false;
  let points: StrokePoint[] = [];
  let lastEmit = 0;

  const scenePoint = (event: { clientX: number; clientY: number }): StrokePoint => {
    const { x, y } = viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      api.getAppState(),
    );
    return [x, y];
  };

  const emitStroke = () => {
    outbound.emitEphemeral({
      kind: "draw-stroke",
      points: points.map((p) => [p[0], p[1]]),
      color,
      width,
    });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!active || event.button !== 0) return;
    const target = event.target as Element | null;
    if (!target?.closest?.(CANVAS_ROOT)) return;

    event.preventDefault();
    event.stopPropagation();

    drawing = true;
    points = [scenePoint(event)];
    lastEmit = now();
    emitStroke();
    onLocalStroke?.(points);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drawing) return;
    event.preventDefault();
    event.stopPropagation();

    points.push(scenePoint(event)); // هر نقطه ثبت می‌شود
    onLocalStroke?.(points);

    const t = now();
    if (t - lastEmit >= ephemeralThrottleMs) {
      lastEmit = t;
      emitStroke(); // پخش throttle‌شده
    }
  };

  const finish = (event?: PointerEvent) => {
    if (!drawing) return;
    drawing = false;
    event?.preventDefault();
    event?.stopPropagation();

    const raw = points;
    points = [];
    outbound.emitEphemeral(null); // پایان استروکِ ephemeral
    onLocalStroke?.(null);

    // یک نقطه/کلیک استروک نیست.
    if (raw.length < 2) return;

    const simplified = simplifyStroke(raw, simplifyEpsilon);
    const element = createDraw({
      points: simplified,
      authorId,
      strokeColor: color,
      strokeWidth: width,
    });

    // نتیجه‌ی نهایی: صحنه‌ی محلی (یک undo) + دقیقاً یک تغییرِ ماندگار برای sync.
    api.updateScene({
      elements: [...api.getSceneElements(), toExcalidraw(element)] as never,
      captureUpdate: "IMMEDIATELY",
    });
    outbound.emitElementChanges({
      upserted: [element],
      deleted: [],
      origin: "local-user",
      gestureId: element.id,
    });
    onCommitted?.(element);
  };

  const onPointerUp = (event: PointerEvent) => finish(event);
  const onPointerCancel = () => {
    // لغو: استروک را دور بریز، بدون commit.
    if (!drawing) return;
    drawing = false;
    points = [];
    outbound.emitEphemeral(null);
    onLocalStroke?.(null);
  };

  const activate = () => {
    active = true;
    api.setActiveTool({ type: "selection" });
    api.setCursor("crosshair");
  };
  const deactivate = () => {
    active = false;
    if (drawing) onPointerCancel();
    api.resetCursor();
  };

  root?.addEventListener("pointerdown", onPointerDown as EventListener, { capture: true });
  root?.addEventListener("pointermove", onPointerMove as EventListener, { capture: true });
  root?.addEventListener("pointerup", onPointerUp as EventListener, { capture: true });
  root?.addEventListener("pointercancel", onPointerCancel as EventListener, { capture: true });

  return {
    activate,
    deactivate,
    toggle: () => (active ? deactivate() : activate()),
    isActive: () => active,
    destroy: () => {
      deactivate();
      root?.removeEventListener("pointerdown", onPointerDown as EventListener, { capture: true });
      root?.removeEventListener("pointermove", onPointerMove as EventListener, { capture: true });
      root?.removeEventListener("pointerup", onPointerUp as EventListener, { capture: true });
      root?.removeEventListener("pointercancel", onPointerCancel as EventListener, {
        capture: true,
      });
    },
  };
}
