import {
  CANVAS_CORE_NAME,
  ENGINE_STAGE,
  HB_STICKY_PALETTE,
  HamboomCanvas,
  StylePanel,
  applyStickyPalette,
  applyStyle,
  createConnector,
  createShape,
  createSticky,
  createStickyTool,
  createText,
  fromExcalidraw,
  getKind,
  rerouteConnector,
  toExcalidraw,
  withBoundElements,
  type HbShapeKind,
  type StickyTool,
  type StylePatch,
} from "@hamboom/canvas-core";
import { SYNC_CONTRACT_VERSION } from "@hamboom/canvas-core/sync";
import type { HbStickyColor } from "@hamboom/shared-types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * دموی canvas-core — از گام ۳٫۲ ابزار استیکی هم دارد.
 *
 * میانبرها: `N` ابزار استیکی، `Tab` استیکی بعدی در امتداد آخری.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="hb-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type HbElementList = ReturnType<typeof fromExcalidraw>[];

export function App() {
  const [elementCount, setElementCount] = useState(0);
  const [stickyCount, setStickyCount] = useState(0);
  const [palette, setPalette] = useState<HbStickyColor>("yellow");
  const [toolActive, setToolActive] = useState(false);
  /** عکس فوری از صحنه برای پنل استایل — با هر تغییر به‌روز می‌شود. */
  const [snapshot, setSnapshot] = useState<{
    elements: HbElementList;
    selectedIds: Set<string>;
  }>({ elements: [], selectedIds: new Set() });

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const toolRef = useRef<StickyTool | null>(null);
  const refreshCountsRef = useRef<(() => void) | null>(null);
  const rerouteConnectorsRef = useRef<(() => void) | null>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  const onReady = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    // برای اشکال‌زدایی از کنسول — فقط در محیط دمو.
    (window as unknown as { __hbApi: ExcalidrawImperativeAPI }).__hbApi = api;

    // ⚠️ `onChange` برای `updateScene` برنامه‌ای صدا زده نمی‌شود — فقط برای
    //   تغییرات کاربر. اگر شمارنده‌ها فقط به آن وصل باشند، استیکی ساخته می‌شود
    //   ولی نمایشگر صفر می‌ماند و آدم فکر می‌کند فیچر خراب است. در مرورگر
    //   گرفته شد: صحنه دو عنصر داشت و نمایشگر صفر نشان می‌داد.
    const refreshCounts = () => {
      const scene = api.getSceneElements();
      const live = scene.filter((el) => !el.isDeleted);
      setElementCount(live.length);
      setStickyCount(live.filter((el) => getKind(el) === "sticky").length);

      const selected = api.getAppState().selectedElementIds;
      setSnapshot({
        elements: scene.map((el) => fromExcalidraw(el as never)),
        selectedIds: new Set(scene.filter((el) => selected[el.id]).map((el) => el.id)),
      });
    };
    api.onChange(refreshCounts);
    // ★ reroute کانکتورها هنگام حرکت عنصر متصل — مسیر حالت مشتق‌شده است
    //   (ADR-008). این نسخه‌ی ساده‌ی دمو کاری را می‌کند که binder واقعی M2
    //   خواهد کرد: هر کانکتور را با جعبه‌ی فعلی دو سرش دوباره route می‌کند.
    api.onChange(() => rerouteConnectorsRef.current?.());
    // ⚠️ بعد از `updateScene` برنامه‌ای، state موتور هنوز اعمال نشده — خواندن
    //   فوری `selectedElementIds` مقدار قبلی را می‌دهد و پنل استایل ظاهر
    //   نمی‌شود. یک تیک صبر می‌کنیم.
    //
    //   ★ عمداً `setTimeout` نه `requestAnimationFrame`: rAF وقتی صفحه فریم
    //   نمی‌سازد (تب پس‌زمینه، پنجره‌ی پنهان) اصلاً اجرا نمی‌شود و به‌روزرسانی
    //   تا لحظه‌ی برگشت کاربر معلق می‌ماند. اولین نسخه با rAF بود و دقیقاً
    //   همین اتفاق افتاد.
    refreshCountsRef.current = () => setTimeout(refreshCounts, 0);

    // ★ ابزار قبلی باید نابود شود. زیر StrictMode این callback دوبار صدا زده
    //   می‌شود و بدون پاک‌سازی، ابزار کهنه با یک API مرده روی `document`
    //   listener نگه می‌دارد — کلیک بعدی روی نمونه‌ی مرده اعمال می‌شود و
    //   هیچ عنصری ساخته نمی‌شود. در مرورگر گرفته شد، نه در تست.
    toolRef.current?.destroy();
    toolRef.current = createStickyTool({
      api,
      authorId: "u_demo",
      getPalette: () => paletteRef.current,
      onCreated: () => {
        setToolActive(false);
        refreshCountsRef.current?.();
      },
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // وقتی کاربر در حال تایپ داخل استیکی است، میانبرها نباید بپرند وسط.
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;

      if (event.key === "n" || event.key === "N") {
        toolRef.current?.toggle();
        setToolActive(toolRef.current?.isActive() ?? false);
      } else if (event.key === "Tab") {
        event.preventDefault();
        toolRef.current?.createNext();
        refreshCountsRef.current?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      toolRef.current?.destroy();
      toolRef.current = null;
    };
  }, []);

  /** خواندن صحنه به‌صورت عناصر هم‌بوم + شناسه‌های انتخاب‌شده. */
  const readScene = useCallback(() => {
    const api = apiRef.current;
    if (!api) return null;
    const selected = api.getAppState().selectedElementIds;
    const scene = api.getSceneElements();
    return {
      api,
      elements: scene.map((el) => fromExcalidraw(el as never)),
      selectedIds: new Set(scene.filter((el) => selected[el.id]).map((el) => el.id)),
    };
  }, []);

  /** نوشتن عناصر هم‌بوم به صحنه. */
  const writeScene = useCallback((api: ExcalidrawImperativeAPI, next: HbElementList) => {
    api.updateScene({ elements: next.map(toExcalidraw) as never });
    refreshCountsRef.current?.();
  }, []);

  const addShape = useCallback((shape: HbShapeKind, text?: string) => {
    const api = apiRef.current;
    if (!api) return;
    const { width, height } = { width: 200, height: 120 };
    const result = createShape({
      shape,
      x: -width / 2 + Math.round(Math.random() * 200),
      y: -height / 2 + Math.round(Math.random() * 200),
      authorId: "u_demo",
      text,
    });
    api.updateScene({
      elements: [...api.getSceneElements(), ...result.elements.map(toExcalidraw)] as never,
      appState: { selectedElementIds: { [result.shape.id]: true } } as never,
    });
    refreshCountsRef.current?.();
  }, []);

  const addText = useCallback((text: string) => {
    const api = apiRef.current;
    if (!api) return;
    const element = createText({
      x: Math.round(Math.random() * 200),
      y: Math.round(Math.random() * 200),
      text,
      authorId: "u_demo",
    });
    api.updateScene({
      elements: [...api.getSceneElements(), toExcalidraw(element)] as never,
      appState: { selectedElementIds: { [element.id]: true } } as never,
    });
    refreshCountsRef.current?.();
  }, []);

  /**
   * هر کانکتور را با موقعیت فعلی دو سرش دوباره route می‌کند.
   *
   * حلقه نمی‌سازد چون `updateScene` برنامه‌ای `onChange` را صدا نمی‌زند — پس
   * reroute که در پاسخ به درگ کاربر اجرا می‌شود، خودش onChange بعدی تولید نمی‌کند.
   */
  const rerouteConnectors = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const scene = api.getSceneElements();
    const byId = new Map(scene.map((el) => [el.id, el]));
    const boxOf = (el: (typeof scene)[number]) => ({
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    });

    let changed = false;
    const next = scene.map((el) => {
      if (getKind(el) !== "connector") return el;
      const hb = fromExcalidraw(el as never);
      const startId = (hb as { startBinding?: { elementId: string } }).startBinding?.elementId;
      const endId = (hb as { endBinding?: { elementId: string } }).endBinding?.elementId;
      const startEl = startId ? byId.get(startId) : undefined;
      const endEl = endId ? byId.get(endId) : undefined;
      if (!startEl || !endEl) return el;

      const routed = rerouteConnector(hb, boxOf(startEl), boxOf(endEl));
      const current = el as unknown as { x: number; y: number; points: [number, number][] };
      if (
        current.x === routed.x &&
        current.y === routed.y &&
        JSON.stringify(current.points) === JSON.stringify(routed.points)
      ) {
        return el;
      }
      changed = true;
      return toExcalidraw({ ...hb, ...routed } as never);
    });

    if (changed) api.updateScene({ elements: next as never });
  }, []);
  rerouteConnectorsRef.current = rerouteConnectors;
  // برای اشکال‌زدایی از کنسول — فقط محیط دمو.
  (window as unknown as { __hbReroute: () => void }).__hbReroute = rerouteConnectors;

  /** دو استیکی + یک کانکتور بینشان — برای آزمودن reroute هنگام حرکت. */
  const addConnectedPair = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const a = createSticky({ x: -320, y: 0, palette: "yellow", text: "شروع", authorId: "u_demo" });
    const b = createSticky({ x: 200, y: 200, palette: "blue", text: "پایان", authorId: "u_demo" });
    const box = (s: typeof a.container) => ({ x: s.x, y: s.y, width: s.width, height: s.height });
    const connector = createConnector({
      start: { elementId: a.container.id, box: box(a.container) },
      end: { elementId: b.container.id, box: box(b.container) },
      style: "elbow",
      authorId: "u_demo",
    });
    api.updateScene({
      elements: [
        ...api.getSceneElements(),
        ...[...a.elements, ...b.elements, connector].map(toExcalidraw),
      ] as never,
    });
    refreshCountsRef.current?.();
  }, []);

  /** پنل استایل — همان عملیات از منوی راست‌کلیک هم می‌آید (گام ۴٫۳). */
  const onStyleChange = useCallback(
    (patch: StylePatch) => {
      const read = readScene();
      if (!read || read.selectedIds.size === 0) return;
      // شکل و متن مقیدش با هم عوض می‌شوند — از دید کاربر یک چیزند.
      const selection = withBoundElements(read.elements, read.selectedIds);
      writeScene(read.api, applyStyle(read.elements, selection, patch));
    },
    [readScene, writeScene],
  );

  /** تغییر رنگ انتخاب فعلی — همان عملیاتی که پنل استایل در گام ۴٫۳ صدا می‌زند. */
  const recolorSelection = useCallback((next: HbStickyColor) => {
    setPalette(next);
    const api = apiRef.current;
    if (!api) return;

    const selected = api.getAppState().selectedElementIds;
    const scene = api.getSceneElements();
    const selectedIds = new Set(
      scene
        .filter((el) => selected[el.id])
        .flatMap((el) => [el.id, ...(el.boundElements ?? []).map((b) => b.id)]),
    );
    if (selectedIds.size === 0) return;

    const hb = scene.map((el) => fromExcalidraw(el as never));
    const recolored = applyStickyPalette(
      hb.filter((el) => selectedIds.has(el.id)),
      next,
    );
    const byId = new Map(recolored.map((el) => [el.id, el]));

    api.updateScene({
      elements: hb.map((el) => toExcalidraw(byId.get(el.id) ?? el)) as never,
    });
  }, []);

  return (
    <div className="hb-page">
      <header className="hb-header">
        <div className="hb-header-main">
          <h1 className="hb-title">هم‌بوم</h1>
          <p className="hb-subtitle">
            <kbd>N</kbd> ابزار استیکی · <kbd>Tab</kbd> استیکی بعدی
          </p>
        </div>

        <div className="hb-palette-picker" role="group" aria-label="رنگ استیکی">
          {HB_STICKY_PALETTE.map((swatch) => (
            <button
              key={swatch.key}
              type="button"
              className={`hb-chip${palette === swatch.key ? " is-selected" : ""}`}
              style={{ background: swatch.bg, borderColor: swatch.accent }}
              title={swatch.nameFa}
              aria-label={swatch.nameFa}
              aria-pressed={palette === swatch.key}
              onClick={() => recolorSelection(swatch.key)}
            />
          ))}
        </div>

        <div className="hb-style-group" role="group" aria-label="افزودن عنصر">
          <button type="button" className="hb-style-chip" onClick={() => addShape("rectangle")}>
            مستطیل
          </button>
          <button type="button" className="hb-style-chip" onClick={() => addShape("ellipse")}>
            بیضی
          </button>
          <button type="button" className="hb-style-chip" onClick={() => addShape("diamond")}>
            لوزی
          </button>
          <button
            type="button"
            className="hb-style-chip"
            onClick={() => addShape("rectangle", "متن داخل شکل")}
          >
            شکل + متن
          </button>
          <button
            type="button"
            className="hb-style-chip"
            onClick={() => addText("متن آزاد فارسی روی بوم")}
          >
            متن آزاد
          </button>
          <button type="button" className="hb-style-chip" onClick={addConnectedPair}>
            دو استیکی + کانکتور
          </button>
        </div>

        <dl className="hb-rows">
          <Row label="ابزار استیکی" value={toolActive ? "فعال" : "خاموش"} />
          <Row label="استیکی" value={String(stickyCount)} />
          <Row label="عنصر" value={String(elementCount)} />
          <Row label="پکیج" value={CANVAS_CORE_NAME} />
          <Row label="قرارداد sync" value={String(SYNC_CONTRACT_VERSION)} />
          <Row label="پله‌ی ADR-003" value={ENGINE_STAGE} />
        </dl>
      </header>

      <main className="hb-canvas-host">
        <HamboomCanvas onReady={onReady} />
        {snapshot.selectedIds.size > 0 ? (
          <div className="hb-style-dock">
            <StylePanel
              elements={snapshot.elements}
              selectedIds={snapshot.selectedIds}
              onChange={onStyleChange}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
