import {
  CANVAS_CORE_NAME,
  ENGINE_STAGE,
  HB_STICKY_PALETTE,
  HamboomCanvas,
  StylePanel,
  alignElements,
  applyStickyPalette,
  applyStyle,
  commitGesture,
  commitSystemUpdate,
  ContextMenu,
  createConnector,
  createContextMenuTool,
  createDrawTool,
  createFrame,
  createImageTool,
  createShape,
  createSticky,
  createStickyTool,
  createText,
  deleteElements,
  distributeElements,
  duplicateElements,
  fromExcalidraw,
  getKind,
  moveFrame,
  PeerAvatars,
  PeerCursors,
  PeerSelections,
  recomputeFrameMembership,
  reorderElements,
  rerouteConnector,
  sceneToOverlayPixel,
  StatusBar,
  toExcalidraw,
  toggleLock,
  toolForShortcut,
  Toolbar,
  withBoundElements,
  ZoomControl,
  zoomAroundCenter,
  zoomStep,
  type AlignEdge,
  type DistributeAxis,
  type DrawStrokeOutbound,
  type DrawTool,
  type HbShapeKind,
  type ImageAssetOutbound,
  type ImageTool,
  type ContextMenuTool,
  type MenuActionId,
  type ReorderOp,
  type StickyTool,
  type StrokePoint,
  type StylePatch,
  type ToolId,
} from "@hamboom/canvas-core";
import { sceneCoordsToViewportCoords, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { SYNC_CONTRACT_VERSION } from "@hamboom/canvas-core/sync";
import type { HbStickyColor } from "@hamboom/shared-types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import { usePresence } from "./usePresence";

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

/** یک PNG نمونه می‌سازد تا بدون فایل واقعی هم بشود درج تصویر را آزمود. */
async function makeSampleImageFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 320, 200);
    grad.addColorStop(0, "#5B8DEF");
    grad.addColorStop(1, "#8E5BEF");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("تصویر نمونه", 160, 100);
  }
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  return new File([blob ?? new Blob()], "نمونه.png", { type: "image/png" });
}

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

  const [drawActive, setDrawActive] = useState(false);
  const [activeToolId, setActiveToolId] = useState<ToolId>("select");
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
  /**
   * ★ نما (viewport) منبعِ **واحد** برای zoom **و** pan است. عمداً از
   * `api.getAppState()` جدا نگه داشته می‌شود: درست بعد از یک جابه‌جاییِ نما،
   * `getAppState()` یک فریم کهنه است (تله‌ی ثبت‌شده). `onScrollChange` مقادیرِ
   * معتبرِ scrollX/scrollY/zoom را می‌دهد؛ لایه‌ی حضور از همین state پروجکت می‌کند
   * تا با هر pan **خالص** هم دوباره جای درست بنشیند (گام ۴٫۴، Q1).
   */
  const [viewport, setViewport] = useState({ scrollX: 0, scrollY: 0, zoom: 1 });
  const [readOnly, setReadOnly] = useState(false);
  const [gridOn, setGridOn] = useState(false);
  const { peers, emitPointer } = usePresence();

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const toolRef = useRef<StickyTool | null>(null);
  const imageToolRef = useRef<ImageTool | null>(null);
  const drawToolRef = useRef<DrawTool | null>(null);
  const contextMenuToolRef = useRef<ContextMenuTool | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  /** آخرین وضعیتِ فقط‌خواندنی — تا guardهای پایدار بدونِ re-subscribe بخوانند. */
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** `selectTool` پایدار است ولی از داخلِ listenerِ keydown با ref خوانده می‌شود. */
  const selectToolRef = useRef<((id: ToolId) => void) | null>(null);
  const refreshCountsRef = useRef<(() => void) | null>(null);
  const rerouteConnectorsRef = useRef<(() => void) | null>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  /** فایل‌های محلی — `URL.createObjectURL` جای Object Storage را می‌گیرد (مثل local-adapter). */
  const objectUrlsRef = useRef(new Map<string, string>());

  const onReady = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    // برای اشکال‌زدایی از کنسول — فقط در محیط دمو.
    (window as unknown as { __hbApi: ExcalidrawImperativeAPI }).__hbApi = api;

    // ⚠️ `onChange` برای `updateScene` برنامه‌ای صدا زده نمی‌شود — فقط برای
    //   تغییرات کاربر. اگر شمارنده‌ها فقط به آن وصل باشند، استیکی ساخته می‌شود
    //   ولی نمایشگر صفر می‌ماند و آدم فکر می‌کند فیچر خراب است. در مرورگر
    //   گرفته شد: صحنه دو عنصر داشت و نمایشگر صفر نشان می‌داد.
    const refreshCounts = (appState: ReturnType<typeof api.getAppState> = api.getAppState()) => {
      const scene = api.getSceneElements();
      const live = scene.filter((el) => !el.isDeleted);
      setElementCount(live.length);
      setStickyCount(live.filter((el) => getKind(el) === "sticky").length);

      const selected = appState.selectedElementIds;
      setSnapshot({
        elements: scene.map((el) => fromExcalidraw(el as never)),
        selectedIds: new Set(scene.filter((el) => selected[el.id]).map((el) => el.id)),
      });
    };
    // ★ انتخاب را از appStateِ **آرگومانِ** onChange بخوان، نه `api.getAppState()`.
    //   وقتی انتخاب از خودِ موتور عوض می‌شود (کلیک، Ctrl+A، کادر)، getAppState داخلِ
    //   همان onChange یک فریمْ کهنه است — پس پنل استایل یک انتخاب عقب می‌ماند و بخشِ
    //   هم‌ترازی (۲+ عنصر) هرگز ظاهر نمی‌شود. appStateِ callback مقدارِ معتبر است
    //   (همان درسِ Q1: از مقدارِ معتبرِ callbackِ موتور استفاده کن، نه getAppState).
    api.onChange((_elements, next) => refreshCounts(next));
    // ★ reroute کانکتورها هنگام حرکت عنصر متصل — مسیر حالت مشتق‌شده است
    //   (ADR-008). این نسخه‌ی ساده‌ی دمو کاری را می‌کند که binder واقعی M2
    //   خواهد کرد: هر کانکتور را با جعبه‌ی فعلی دو سرش دوباره route می‌کند.
    api.onChange(() => rerouteConnectorsRef.current?.());
    // ★ چرخِ ماوس/pinch هم zoom را عوض می‌کند هم **pan** می‌دهد. مقادیرِ معتبرِ
    //   نما را از خودِ callback بگیر (نه از getAppState که یک فریم عقب است) و در
    //   state بگذار — تا لایه‌ی حضور با pan خالص هم دوباره پروجکت شود (Q1، گام ۴٫۴).
    api.onScrollChange((scrollX, scrollY, nextZoom) =>
      setViewport({ scrollX, scrollY, zoom: nextZoom.value }),
    );
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

    // ابزار تصویر — drag&drop و paste را روی document می‌گیرد. outbound اینجا
    // همان شبیه‌سازی local-adapter است (URL.createObjectURL جای Object Storage).
    const objectUrls = objectUrlsRef.current;
    const imageOutbound: ImageAssetOutbound = {
      requestAssetUpload: async (file) => {
        const fileId = `f_local_${Math.random().toString(36).slice(2, 10)}`;
        objectUrls.set(fileId, URL.createObjectURL(file));
        return {
          fileId,
          bucket: "local",
          key: `local/${fileId}`,
          mime: file.type,
          width: 0,
          height: 0,
          sizeBytes: file.size,
          sha256: null,
          uploadedBy: "u_demo",
          createdAt: Date.now(),
        };
      },
      resolveAssetUrl: async (fileId) => objectUrls.get(fileId) ?? "",
    };

    imageToolRef.current?.destroy();
    imageToolRef.current = createImageTool({
      api,
      outbound: imageOutbound,
      authorId: "u_demo",
      onError: (message) => api.setToast({ message, duration: 4000 }),
      onInserted: () => refreshCountsRef.current?.(),
    });

    // ابزار قلم — استروکِ در حال کشیدن روی overlay رندر می‌شود و ephemeral پخش
    // می‌گردد؛ نتیجه‌ی نهایی یک عنصر و یک emitElementChanges (ADR-022).
    const renderStroke = (points: StrokePoint[] | null) => {
      const overlay = overlayRef.current;
      const ctx = overlay?.getContext("2d");
      if (!overlay || !ctx) return;
      if (overlay.width !== overlay.clientWidth || overlay.height !== overlay.clientHeight) {
        overlay.width = overlay.clientWidth;
        overlay.height = overlay.clientHeight;
      }
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (!points || points.length < 2) return;
      const rect = overlay.getBoundingClientRect();
      const appState = api.getAppState();
      ctx.beginPath();
      points.forEach((p, i) => {
        const v = sceneCoordsToViewportCoords({ sceneX: p[0], sceneY: p[1] }, appState);
        const x = v.x - rect.left;
        const y = v.y - rect.top;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#1A1A1A";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    };

    // outbound نمایشی: فقط emitElementChanges را می‌شمارد تا ناوردای «یک ژست =
    // یک تغییرِ ماندگار» در مرورگر هم قابل بازرسی باشد.
    const win = window as unknown as { __hbDrawEmits: number };
    win.__hbDrawEmits = 0;
    const drawOutbound: DrawStrokeOutbound = {
      emitEphemeral: () => {},
      emitElementChanges: () => {
        win.__hbDrawEmits += 1;
      },
    };

    drawToolRef.current?.destroy();
    drawToolRef.current = createDrawTool({
      api,
      outbound: drawOutbound,
      authorId: "u_demo",
      onLocalStroke: renderStroke,
      onCommitted: () => refreshCountsRef.current?.(),
    });

    // منوی راست‌کلیک — منوی موتور را در فاز capture preempt می‌کند (تایید مرورگر).
    contextMenuToolRef.current?.destroy();
    contextMenuToolRef.current = createContextMenuTool({
      onOpen: ({ x, y }) => {
        const selected = api.getAppState().selectedElementIds;
        setMenu({ x, y, hasSelection: Object.keys(selected).length > 0 });
      },
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // وقتی کاربر در حال تایپ داخل استیکی است، میانبرها نباید بپرند وسط.
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return; // Ctrl+Z و … دست موتور

      // Tab = استیکیِ بعدی در امتداد آخری (رفتار خاصِ ابزار استیکی).
      if (event.key === "Tab") {
        event.preventDefault();
        toolRef.current?.createNext();
        refreshCountsRef.current?.();
        return;
      }
      // بقیه‌ی میانبرها از همان جدولِ نوار ابزار می‌آیند (یک منبع).
      const toolId = toolForShortcut(event.key);
      if (toolId) {
        event.preventDefault();
        selectToolRef.current?.(toolId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const urls = objectUrlsRef.current;
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      toolRef.current?.destroy();
      toolRef.current = null;
      imageToolRef.current?.destroy();
      imageToolRef.current = null;
      drawToolRef.current?.destroy();
      drawToolRef.current = null;
      contextMenuToolRef.current?.destroy();
      contextMenuToolRef.current = null;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /**
   * تغییرِ لایه (z-order) — منبعِ واحدِ منو (جلوترین/عقب‌ترین) و پنل (جلو/عقب).
   * `reorderElements` فقط ترتیبِ آرایه را می‌چیند؛ موتور ایندکسِ کسری را بازتولید
   * می‌کند (ADR-007). ژستِ کاربر = یک `commitGesture` (IMMEDIATELY، یک undo).
   */
  const applyReorder = useCallback((op: ReorderOp) => {
    const api = apiRef.current;
    if (!api) return;
    const hb = api.getSceneElements().map((el) => fromExcalidraw(el as never));
    const ids = new Set(Object.keys(api.getAppState().selectedElementIds));
    const next = reorderElements(hb, ids, op);
    if (next === hb) return; // بدون تغییر
    commitGesture(api, next.map(toExcalidraw));
    refreshCountsRef.current?.();
  }, []);

  /**
   * کنش‌های منوی راست‌کلیک. کاری‌ها: حذف، تکثیر، قفل، لایه — همه از توابعِ **مشترکِ**
   * `elements/*` (نه inline)، تا پنل استایل هم از همان منبع بیاید. بقیه coming-soon.
   */
  const onMenuAction = useCallback(
    (id: MenuActionId) => {
      const api = apiRef.current;
      if (!api) return;
      if (id === "bringToFront") return applyReorder("front");
      if (id === "sendToBack") return applyReorder("back");

      const hb = api.getSceneElements().map((el) => fromExcalidraw(el as never));
      const ids = new Set(Object.keys(api.getAppState().selectedElementIds));

      if (id === "delete") {
        commitGesture(api, deleteElements(hb, ids).map(toExcalidraw));
      } else if (id === "duplicate") {
        const { elements, newIds } = duplicateElements(hb, ids);
        commitGesture(api, elements.map(toExcalidraw), { select: newIds });
      } else if (id === "lock") {
        commitGesture(api, toggleLock(hb, ids).map(toExcalidraw));
      }
      refreshCountsRef.current?.();
    },
    [applyReorder],
  );

  /**
   * بزرگ/کوچک‌نمایی حول مرکز — منطق در `zoom.ts`. appState-only، بدون ورودی undo.
   * ★ گامِ بعدی از **zoomِ فعلیِ موتور** حساب می‌شود، نه از state (که async است و
   *   کلیک‌های پشت‌سرهم را با مقدارِ کهنه می‌بندد).
   */
  const applyZoom = useCallback((direction: 1 | -1) => {
    const api = apiRef.current;
    if (!api) return;
    const s = api.getAppState();
    const next = zoomAroundCenter(
      {
        zoom: s.zoom.value,
        scrollX: s.scrollX,
        scrollY: s.scrollY,
        width: s.width,
        height: s.height,
      },
      zoomStep(s.zoom.value, direction),
    );
    api.updateScene({
      appState: {
        zoom: { value: next.zoom },
        scrollX: next.scrollX,
        scrollY: next.scrollY,
      } as never,
      captureUpdate: "NEVER",
    });
    // مقادیرِ محاسبه‌شده معتبرترین‌اند (updateScene برنامه‌ای onScrollChange نمی‌دهد).
    setViewport({ scrollX: next.scrollX, scrollY: next.scrollY, zoom: next.zoom });
  }, []);

  /** برازش با صفحه — `scrollToContent`ِ موتور؛ صحنه‌ی خالی = بازنشانی به ۱۰۰٪. */
  const fitToScreen = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const live = api.getSceneElements().filter((el) => !el.isDeleted);
    if (live.length === 0) {
      api.updateScene({
        appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 } as never,
        captureUpdate: "NEVER",
      });
      setViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
      return;
    }
    api.scrollToContent(live, { fitToContent: true });
    // یک تیک صبر تا نما بنشیند، بعد نمای معتبر را کامل بخوان (scroll + zoom).
    setTimeout(() => {
      const s = apiRef.current?.getAppState();
      if (s) setViewport({ scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value });
    }, 0);
  }, []);

  // حضور — مکان‌نمای محلی را پخش کن (throttle ۴۰ms) و هنگام خروج نامرئی کن.
  useEffect(() => {
    let last = 0;
    const onMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - last < 40) return;
      last = now;
      const api = apiRef.current;
      const target = event.target as Element | null;
      if (!api || !target?.closest?.(".excalidraw")) return;
      const { x, y } = viewportCoordsToSceneCoords(
        { clientX: event.clientX, clientY: event.clientY },
        api.getAppState(),
      );
      // انتخابِ محلی را هم پیوست کن تا هاله‌ی انتخابِ همتاها کار کند.
      emitPointer({ x, y, visible: true }, Object.keys(api.getAppState().selectedElementIds));
    };
    const onLeave = () => emitPointer({ x: 0, y: 0, visible: false });
    document.addEventListener("pointermove", onMove);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onLeave);
    };
  }, [emitPointer]);

  /**
   * نقطه‌ی صحنه → پیکسلِ محلیِ لایه‌ی مکان‌نماها (نسبت به هاست).
   *
   * ★ scroll/zoom را از state (`viewport` — معتبر، از onScrollChange) می‌گیرد نه
   *   از `getAppState()` که درست بعد از pan/zoom یک فریم کهنه است. فقط
   *   offsetLeft/offsetTop از getAppState خوانده می‌شوند؛ آن‌ها با pan/zoom عوض
   *   نمی‌شوند (فقط با resize). وابستگیِ `[viewport]` باعث می‌شود لایه‌ی حضور با
   *   هر جابه‌جاییِ نما — از جمله pan خالص — دوباره رندر و پروجکت شود (Q1).
   */
  const projectPeer = useCallback(
    (sceneX: number, sceneY: number) => {
      const api = apiRef.current;
      const host = hostRef.current;
      if (!api || !host) return { x: sceneX, y: sceneY };
      const st = api.getAppState();
      const rect = host.getBoundingClientRect();
      // ★ ریاضیِ پروجکشن در canvas-core است (`sceneToOverlayPixel`) — منبعِ واحد
      //   که M2 هم می‌زند. `viewport` از state (معتبر، از onScrollChange)، نه از
      //   getAppState که یک فریمْ کهنه است (باگِ Q1). offsetLeft/Top با pan/zoom
      //   عوض نمی‌شوند، پس از appState خواندنشان بی‌خطر است.
      return sceneToOverlayPixel(
        { x: sceneX, y: sceneY },
        viewport,
        { offsetLeft: st.offsetLeft, offsetTop: st.offsetTop },
        { left: rect.left, top: rect.top },
      );
    },
    [viewport],
  );

  /** دنبال‌کردنِ یک همتا — نما را روی مکان‌نمای او وسط می‌کند (focusOnِ نمایشی). */
  const followPeer = useCallback(
    (clientId: number) => {
      const api = apiRef.current;
      const peer = peers.find((p) => p.clientId === clientId);
      if (!api || !peer?.pointer) return;
      const s = api.getAppState();
      const scrollX = s.width / 2 / s.zoom.value - peer.pointer.x;
      const scrollY = s.height / 2 / s.zoom.value - peer.pointer.y;
      api.updateScene({
        appState: { scrollX, scrollY } as never,
        captureUpdate: "NEVER",
      });
      setViewport({ scrollX, scrollY, zoom: s.zoom.value });
    },
    [peers],
  );

  /** روشن/خاموش کردن قلم. قلم و استیکی هم‌زمان فعال نمی‌شوند. */
  const toggleDraw = useCallback(() => {
    const next = !(drawToolRef.current?.isActive() ?? false);
    if (next) {
      toolRef.current?.deactivate();
      setToolActive(false);
      drawToolRef.current?.activate();
    } else {
      drawToolRef.current?.deactivate();
    }
    setDrawActive(next);
  }, []);

  /** فقط‌خواندنی (permissions.canEdit === false نمایشی) — ویرایش خاموش. */
  const toggleReadOnly = useCallback(() => {
    setReadOnly((prev) => {
      const next = !prev;
      if (next) {
        toolRef.current?.deactivate();
        drawToolRef.current?.deactivate();
        setToolActive(false);
        setDrawActive(false);
        setActiveToolId("select");
      }
      return next;
    });
  }, []);

  /** toggleِ گرید — snap به شبکه با `gridModeEnabled` است (snap به عناصر جداست و
   *  همیشه روشن). appState-only، بدون ورودی undo. */
  const toggleGrid = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    setGridOn((prev) => {
      const next = !prev;
      api.updateScene({ appState: { gridModeEnabled: next } as never, captureUpdate: "NEVER" });
      return next;
    });
  }, []);

  /**
   * انتخابِ ابزار از نوار (یا میانبر). این لایه‌ی سیم‌کشی است: ابزارهای موتور با
   * `setActiveTool`، ابزارهای سفارشی (استیکی/قلم) با activate، تصویر با انتخابگرِ
   * فایل، و کامنت فعلاً stub است (محتوایش کار M3).
   */
  const selectTool = useCallback((id: ToolId) => {
    const api = apiRef.current;
    if (!api) return;
    // فقط‌خواندنی: ابزارهای ویرایش کار نمی‌کنند (select/hand برای ناوبری مجازند).
    if (readOnlyRef.current && id !== "select" && id !== "hand") return;

    // ابزارهای سفارشی را خاموش کن مگر خودشان انتخاب شده باشند.
    if (id !== "sticky") toolRef.current?.deactivate();
    if (id !== "pen") drawToolRef.current?.deactivate();
    setToolActive(id === "sticky");
    setDrawActive(id === "pen");
    setActiveToolId(id);

    switch (id) {
      case "select":
        api.setActiveTool({ type: "selection" });
        break;
      case "hand":
        api.setActiveTool({ type: "hand" });
        break;
      case "text":
        api.setActiveTool({ type: "text" });
        break;
      case "shape":
        api.setActiveTool({ type: "rectangle" });
        break;
      case "connector":
        api.setActiveTool({ type: "arrow" });
        break;
      case "frame":
        api.setActiveTool({ type: "frame" });
        break;
      case "eraser":
        api.setActiveTool({ type: "eraser" });
        break;
      case "sticky":
        api.setActiveTool({ type: "selection" });
        toolRef.current?.activate();
        break;
      case "pen":
        api.setActiveTool({ type: "selection" });
        drawToolRef.current?.activate();
        break;
      case "image":
        fileInputRef.current?.click();
        break;
      case "comment":
        api.setToast({ message: "کامنت‌ها در M3 می‌آیند", duration: 2500 });
        break;
    }
  }, []);
  selectToolRef.current = selectTool;

  /** انتخابِ فایلِ تصویر از نوار → درج، سپس برگشت به ابزارِ انتخاب. */
  const onImageFilePicked = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // اجازه‌ی انتخابِ دوباره‌ی همان فایل
    if (!file) return;
    await imageToolRef.current?.ingestFile(file);
    selectToolRef.current?.("select");
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

  /** نوشتن عناصر هم‌بوم به صحنه — تغییرِ استایل یک ژست است. */
  const writeScene = useCallback((api: ExcalidrawImperativeAPI, next: HbElementList) => {
    commitGesture(api, next.map(toExcalidraw));
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
    commitGesture(api, [...api.getSceneElements(), ...result.elements.map(toExcalidraw)], {
      select: [result.shape.id],
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
    commitGesture(api, [...api.getSceneElements(), toExcalidraw(element)], {
      select: [element.id],
    });
    refreshCountsRef.current?.();
  }, []);

  /** درج یک تصویر نمونه — همان مسیری که drag&drop و paste هم می‌روند. */
  const addSampleImage = useCallback(async () => {
    const file = await makeSampleImageFile();
    await imageToolRef.current?.ingestFile(file);
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

    // مسیرِ کانکتور حالتِ مشتق‌شده است (ADR-008)، نه ژستِ کاربر → NEVER؛ در undo
    // ظاهر نمی‌شود و با برگشتِ حرکت، onChange دوباره reroute می‌کند.
    if (changed) commitSystemUpdate(api, next);
  }, []);
  rerouteConnectorsRef.current = rerouteConnectors;
  // برای اشکال‌زدایی از کنسول — فقط محیط دمو.
  (window as unknown as { __hbReroute: () => void }).__hbReroute = rerouteConnectors;

  /** یک فریم با دو استیکی داخلش — عضویت خودکار حساب می‌شود. */
  const addFrameWithChildren = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const frame = createFrame({
      x: -260,
      y: -160,
      width: 560,
      height: 320,
      name: "فریم من",
      authorId: "u_demo",
    });
    const a = createSticky({
      x: -240,
      y: -140,
      palette: "yellow",
      text: "الف",
      authorId: "u_demo",
    });
    const b = createSticky({ x: 20, y: -140, palette: "mint", text: "ب", authorId: "u_demo" });

    const fresh = [frame, ...a.elements, ...b.elements].map((el) =>
      fromExcalidraw(toExcalidraw(el)),
    );
    const withMembership = recomputeFrameMembership([
      ...api.getSceneElements().map((el) => fromExcalidraw(el as never)),
      ...fresh,
    ]);

    commitGesture(api, withMembership.map(toExcalidraw), { select: [frame.id] });
    refreshCountsRef.current?.();
  }, []);

  /**
   * ★ حرکت فریمِ انتخاب‌شده با فرزندانش — در **یک** updateScene با IMMEDIATELY،
   * تا کل ژست یک ورودی undo شود (ADR-026).
   */
  const moveSelectedFrame = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const scene = api.getSceneElements().map((el) => fromExcalidraw(el as never));
    const selected = api.getAppState().selectedElementIds;
    const frame =
      scene.find((el) => getKind(el) === "frame" && selected[el.id]) ??
      scene.find((el) => getKind(el) === "frame");
    if (!frame) return;

    const moved = moveFrame(scene, frame.id, 120, 80);
    commitGesture(api, moved.map(toExcalidraw));
    refreshCountsRef.current?.();
  }, []);

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
    commitGesture(api, [
      ...api.getSceneElements(),
      ...[...a.elements, ...b.elements, connector].map(toExcalidraw),
    ]);
    refreshCountsRef.current?.();
  }, []);

  /** هم‌ترازیِ انتخاب (۲+ عنصر) — `alignElements`، یک ژست undo. */
  const onAlign = useCallback(
    (edge: AlignEdge) => {
      const read = readScene();
      if (!read || read.selectedIds.size < 2) return;
      writeScene(read.api, alignElements(read.elements, read.selectedIds, edge));
    },
    [readScene, writeScene],
  );

  /** توزیعِ یکنواختِ انتخاب (۳+ عنصر) — `distributeElements`. */
  const onDistribute = useCallback(
    (axis: DistributeAxis) => {
      const read = readScene();
      if (!read || read.selectedIds.size < 3) return;
      writeScene(read.api, distributeElements(read.elements, read.selectedIds, axis));
    },
    [readScene, writeScene],
  );

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

    // ★ یک ژست = یک ورودی undo (ADR-026). `commitGesture` همان IMMEDIATELY را
    //   تضمین می‌کند؛ بدونش اولین Ctrl+Z به‌جای برگرداندن رنگ، ژست قبلی را
    //   پاک می‌کرد — در مرورگر تایید و با قاعده‌ی lint حالا غیرممکن شد.
    commitGesture(
      api,
      hb.map((el) => toExcalidraw(byId.get(el.id) ?? el)),
    );
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
          <button type="button" className="hb-style-chip" onClick={addFrameWithChildren}>
            فریم + دو استیکی
          </button>
          <button type="button" className="hb-style-chip" onClick={moveSelectedFrame}>
            حرکت فریم
          </button>
          <button type="button" className="hb-style-chip" onClick={() => void addSampleImage()}>
            تصویر نمونه
          </button>
          <button
            type="button"
            className={`hb-style-chip${drawActive ? " is-selected" : ""}`}
            onClick={toggleDraw}
            aria-pressed={drawActive}
          >
            قلم{drawActive ? " (فعال)" : ""}
          </button>
          <button
            type="button"
            className={`hb-style-chip${readOnly ? " is-selected" : ""}`}
            onClick={toggleReadOnly}
            aria-pressed={readOnly}
          >
            فقط‌خواندنی{readOnly ? " (روشن)" : ""}
          </button>
          <button
            type="button"
            className={`hb-style-chip${gridOn ? " is-selected" : ""}`}
            onClick={toggleGrid}
            aria-pressed={gridOn}
          >
            شبکه{gridOn ? " (روشن)" : ""}
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

      <main className="hb-canvas-host" ref={hostRef}>
        <HamboomCanvas onReady={onReady} viewModeEnabled={readOnly} />
        <canvas ref={overlayRef} className="hb-draw-overlay" />
        <PeerSelections peers={peers} elements={snapshot.elements} project={projectPeer} />
        <PeerCursors peers={peers} project={projectPeer} />
        <PeerAvatars peers={peers} onFollow={followPeer} />
        {/* حالت‌های نمونه — منبعِ واقعیِ ConnectionState/SaveState آداپتورِ M2 است. */}
        <StatusBar
          connection={{ status: "connected", peers: 2 }}
          save={{ status: "saved", at: Date.now() }}
        />
        <Toolbar activeTool={activeToolId} onSelectTool={selectTool} />
        <ZoomControl
          zoom={viewport.zoom}
          onZoomIn={() => applyZoom(1)}
          onZoomOut={() => applyZoom(-1)}
          onFit={fitToScreen}
        />
        {menu ? (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            hasSelection={menu.hasSelection}
            onAction={onMenuAction}
            onDismiss={() => setMenu(null)}
          />
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          hidden
          onChange={(event) => void onImageFilePicked(event)}
        />
        {/* StylePanel خودش موقعیت می‌گیرد (اسلاتِ top-start از overlay-layout) —
            دیگر wrapperِ موقعیت‌دهِ دمو لازم نیست (ADR-027). */}
        {snapshot.selectedIds.size > 0 ? (
          <StylePanel
            elements={snapshot.elements}
            selectedIds={snapshot.selectedIds}
            onChange={onStyleChange}
            onToggleLock={() => {
              const read = readScene();
              if (!read || read.selectedIds.size === 0) return;
              // همان `toggleLock`ِ منوی راست‌کلیک — منبعِ واحد.
              writeScene(read.api, toggleLock(read.elements, read.selectedIds));
            }}
            // همان `reorderElements`ِ منو (جلوترین/عقب‌ترین) — پنل یک‌پله (جلو/عقب).
            onReorder={applyReorder}
            onAlign={onAlign}
            onDistribute={onDistribute}
          />
        ) : null}
      </main>
    </div>
  );
}
