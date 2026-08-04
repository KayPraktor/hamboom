import { HamboomCanvas, type HamboomCanvasProps } from "@hamboom/canvas-core";
import { useCallback, useEffect, useState } from "react";

/**
 * دسته‌ی امریِ موتور — **از قراردادِ خودِ `HamboomCanvas` مشتق می‌شود**، نه با
 * import از `@excalidraw/excalidraw`.
 *
 * دلیل: `canvas-sync` نباید به موتورِ رندر وابسته شود؛ کارش وصل‌کردنِ Yjs به
 * **قراردادِ M1** است. اگر روزی نوعِ آن دسته عوض شود، اینجا خودکار دنبالش می‌آید
 * به‌جای اینکه بی‌صدا واگرا شود. (قاعده‌ی ESLint هم `@excalidraw/*` را در `src/`
 * می‌بندد.)
 */
type CanvasApi = Parameters<NonNullable<HamboomCanvasProps["onReady"]>>[0];

declare global {
  interface Window {
    /**
     * ★ **شاهدِ مستقل از ری‌اکت** — فقط برای این صفحه‌ی probe.
     *
     * بدونِ این، probe یک نقصِ طراحی دارد: اگر readout صفر بماند، دو تفسیرِ کاملاً
     * متفاوت دارد — «اشتراک مرده است» یا «اصلاً چیزی کشیده نشد». تست باید بتواند
     * حالتِ **خودِ موتور** را بدونِ عبور از state ری‌اکت بخواند تا این دو از هم جدا
     * شوند. اگر موتور یک عنصر دارد ولی readout صفر است → اشتراک مرده. اگر موتور هم
     * صفر است → تعاملِ تست ایراد دارد، نه الگو.
     */
    __hbProbeApi?: CanvasApi;
  }
}

/**
 * ★ probe گام ۱٫۱ — [ADR-028](../../../ARCHITECTURE_DECISIONS.md#adr-028).
 *
 * ── چرا این probe دروازه‌ی کلِ فاز ۳ است ───────────────────────────────
 *
 * binderِ M2 دقیقاً همان کاری را می‌کند که در M1 زیر StrictMode شکست: به
 * `onChange` مشترک می‌شود تا تغییرِ محلی را بگیرد و به لایه‌ی sync بدهد. اگر آن
 * اشتراک مرده بمانَد، binder **بی‌صدا هیچ تغییری emit نمی‌کند** — بدترین نوعِ
 * باگ، چون هیچ خطایی نمی‌دهد و فقط «همکاری کار نمی‌کند».
 *
 * ── دو الگو، یک ادعا ──────────────────────────────────────────────────
 *
 * `#onready` — الگوی M1: اشتراک **داخلِ** callbackِ `excalidrawAPI`.
 * `#effect`  — نامزدِ ADR-028: api در state، اشتراک در `useEffect([api])` با cleanup.
 *
 * هر دو زیر `<StrictMode>` اجرا می‌شوند و **همان** ادعا رویشان زده می‌شود، تا
 * نتیجه یک مقایسه باشد نه یک حدس. اگر الگوی اول اینجا **پاس شود**، یعنی فرضِ
 * ADR-028 در این ساختارِ کمینه بازتولید نمی‌شود و علتِ واقعیِ M1 جای دیگری است —
 * آن هم یک یافته است و باید صادقانه ثبت شود، نه دور زده شود.
 *
 * این صفحه عمداً **کمینه** است: نه نوار ابزارِ خودمان، نه پنل، نه ابزارِ سفارشی.
 * فقط موتور + یک شمارنده. هرچه کمتر، جای کمتری برای «شاید تقصیرِ آن یکی بود».
 */

/** فقط بخشی از appState که probe لازم دارد. */
interface ProbeAppState {
  selectedElementIds?: Record<string, unknown>;
}

interface ReadoutProps {
  pattern: string;
  changes: number;
  selected: number;
  elements: number;
  apiReady: boolean;
}

/**
 * تنها خروجیِ probe. هر عدد اینجا از **state ری‌اکت** می‌آید، نه از موتور —
 * یعنی اگر مسیرِ `onChange → setState` مرده باشد، این اعداد حرکت نمی‌کنند
 * حتی وقتی خودِ موتور کاملاً درست کار می‌کند. دقیقاً همان چیزی که باید بسنجیم.
 */
function Readout({ pattern, changes, selected, elements, apiReady }: ReadoutProps) {
  return (
    <div
      data-testid="readout"
      data-pattern={pattern}
      data-changes={changes}
      data-selected={selected}
      data-elements={elements}
      data-api-ready={apiReady ? "yes" : "no"}
      style={{
        position: "fixed",
        insetBlockStart: 8,
        insetInlineStart: 8,
        zIndex: 100,
        background: "#111",
        color: "#fff",
        padding: "8px 12px",
        borderRadius: 8,
        font: "13px/1.6 monospace",
        direction: "ltr",
      }}
    >
      pattern={pattern} api={apiReady ? "ready" : "—"} onChange={changes} selected={selected}{" "}
      elements={elements}
    </div>
  );
}

/** الگوی M1 — اشتراک داخلِ callbackِ `excalidrawAPI`. */
function PatternOnReady() {
  const [changes, setChanges] = useState(0);
  const [selected, setSelected] = useState(0);
  const [elements, setElements] = useState(0);
  const [apiReady, setApiReady] = useState(false);

  const handleReady = useCallback((api: CanvasApi) => {
    // شاهدِ مستقل — هر بار که موتور آماده می‌شود، **آخرین** نمونه اینجا می‌نشیند.
    window.__hbProbeApi = api;
    setApiReady(true);
    api.onChange((elements: readonly unknown[], appState: ProbeAppState) => {
      setChanges((n) => n + 1);
      setSelected(Object.keys(appState.selectedElementIds ?? {}).length);
      setElements(elements.length);
    });
  }, []);

  return (
    <>
      <Readout
        pattern="onready"
        changes={changes}
        selected={selected}
        elements={elements}
        apiReady={apiReady}
      />
      <HamboomCanvas onReady={handleReady} />
    </>
  );
}

/** نامزدِ ADR-028 — api در state، اشتراک در effect با cleanup. */
function PatternEffect() {
  const [api, setApi] = useState<CanvasApi | null>(null);
  const [changes, setChanges] = useState(0);
  const [selected, setSelected] = useState(0);
  const [elements, setElements] = useState(0);

  // هویتِ پایدار: اگر هر رندر یک تابعِ تازه بدهیم، ممکن است موتور دوباره صدایش بزند.
  const handleReady = useCallback((next: CanvasApi) => {
    window.__hbProbeApi = next;
    setApi(next);
  }, []);

  useEffect(() => {
    if (!api) return;
    const unsubscribe = api.onChange((elements: readonly unknown[], appState: ProbeAppState) => {
      setChanges((n) => n + 1);
      setSelected(Object.keys(appState.selectedElementIds ?? {}).length);
      setElements(elements.length);
    });
    return unsubscribe;
  }, [api]);

  return (
    <>
      <Readout
        pattern="effect"
        changes={changes}
        selected={selected}
        elements={elements}
        apiReady={api !== null}
      />
      <HamboomCanvas onReady={handleReady} />
    </>
  );
}

export function StrictModeProbe() {
  return window.location.hash === "#onready" ? <PatternOnReady /> : <PatternEffect />;
}
