import {
  CANVAS_CORE_NAME,
  ENGINE_STAGE,
  HB_STICKY_PALETTE,
  HamboomCanvas,
  applyStickyPalette,
  createStickyTool,
  fromExcalidraw,
  getKind,
  toExcalidraw,
  type StickyTool,
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

export function App() {
  const [elementCount, setElementCount] = useState(0);
  const [stickyCount, setStickyCount] = useState(0);
  const [palette, setPalette] = useState<HbStickyColor>("yellow");
  const [toolActive, setToolActive] = useState(false);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const toolRef = useRef<StickyTool | null>(null);
  const refreshCountsRef = useRef<(() => void) | null>(null);
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
      const live = api.getSceneElements().filter((el) => !el.isDeleted);
      setElementCount(live.length);
      setStickyCount(live.filter((el) => getKind(el) === "sticky").length);
    };
    api.onChange(refreshCounts);
    refreshCountsRef.current = refreshCounts;

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
      </main>
    </div>
  );
}
