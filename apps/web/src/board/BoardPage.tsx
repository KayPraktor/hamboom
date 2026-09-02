import {
  createDrawTool,
  createImageTool,
  createStickyTool,
  type DrawStrokeOutbound,
  type DrawTool,
  fromExcalidraw,
  HamboomCanvas,
  type HamboomCanvasProps,
  type HbShapeKind,
  HB_STICKY_PALETTE,
  HB_TOOLS,
  type ImageAssetOutbound,
  type ImageTool,
  PeerCursors,
  sceneToOverlayPixel,
  type StickyTool,
  type StrokePoint,
  Toolbar,
  toolForShortcut,
  type ToolId,
  ZoomControl,
  zoomAroundCenter,
  zoomStep,
} from "@hamboom/canvas-core";
import type {
  CanvasOutbound,
  CanvasPermissions,
  ConnectionState,
  PeerState,
  SaveState,
  Viewport,
} from "@hamboom/canvas-core/sync";
import {
  bindUndoShortcuts,
  createCanvasBinding,
  createIndexeddbDocStore,
  createWebSocketTransport,
  YjsSyncAdapter,
} from "@hamboom/canvas-sync";
import { t } from "@hamboom/i18n";
import type { HbElement, HbStickyColor } from "@hamboom/shared-types";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";

import { api } from "../api/client.ts";
import { errorMessage } from "../api/error-message.ts";
import { useSession } from "../auth/session-context.ts";
import { useRenameBoard, useTrashBoard } from "../dashboard/boards-queries.ts";
import { BoardMenu } from "./BoardMenu.tsx";
import { createGestureTracker } from "./gesture-tracker.ts";
import { colorForId } from "./presence-color.ts";

/** دسته‌ی undoِ Yjs (از getterِ `adapter.undo`) — بدونِ importِ تایپِ جدا، از خودِ adapter مشتق می‌شود. */
type UndoScope = NonNullable<YjsSyncAdapter["undo"]>;

/** نوعِ apiِ موتور — از خودِ propِ `onReady` مشتق می‌شود (نه تعریفِ موازی). */
type CanvasApi = Parameters<NonNullable<HamboomCanvasProps["onReady"]>>[0];
type SceneElement = ReturnType<CanvasApi["getSceneElementsIncludingDeleted"]>[number];

/** نشانیِ سرورِ realtime؛ در dev پیش‌فرض ۳۰۰۱ (RT_PORT)، در production از env. */
const RT_URL = (import.meta.env.VITE_RT_URL as string | undefined) ?? "ws://127.0.0.1:3001";

/**
 * مرزِ ژست برای گروه‌بندیِ undo: onChangeهای ظرفِ این فاصله یک ژست‌اند (یک درگ)، پس
 * یک ورودیِ undo. **دیگر تاخیرِ emit نیست** — emit زنده روی هر فریم می‌رود؛ این فقط
 * می‌گوید کِی `gestureId` عوض شود.
 */
const GESTURE_IDLE_MS = 140;

/**
 * برچسبِ فارسیِ ابزارِ فعالِ همتا — از همان مدلِ i18nِ نوار ابزار می‌آید (منبعِ
 * واحد، ADR-024): `activeTool` روی سیم یک `ToolId` است، برچسبش از `HB_TOOLS`.
 */
function peerToolLabel(activeTool: string | null): string | null {
  if (!activeTool) return null;
  const meta = HB_TOOLS.find((tool) => tool.id === activeTool);
  return meta ? t(meta.labelKey) : null;
}

/** واریانتِ کانکتور — پیکان (arrow) یا خطِ ساده (line). هر دو نوعِ نیتیوِ موتورند. */
type ConnectorKind = "arrow" | "line";

// ثابت‌های لیزر — بافرِ کوتاهِ دنباله، throttleِ emit، و مهلتِ پاک‌شدن پس از توقف.
const LASER_TRAIL_MAX = 16;
const LASER_EMIT_MS = 40;
const LASER_IDLE_MS = 320;

/** یک دنباله‌ی نقطه‌ای را روی لایه‌ی روکش می‌کشد (قلمِ محلی یا لیزرِ همتا). */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  pts: readonly { x: number; y: number }[],
  color: string,
  width: number,
): void {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

// آیکونِ کوچکِ واریانت‌ها — SVGِ خطی، `currentColor` (با تمِ روشن/تیره هماهنگ).
const shapeIcon: Readonly<Record<HbShapeKind, ReactNode>> = {
  rectangle: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="5" width="14" height="10" rx="1.5" />
    </svg>
  ),
  ellipse: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <ellipse cx="10" cy="10" rx="7" ry="5" />
    </svg>
  ),
  diamond: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3 L17 10 L10 17 L3 10 Z" />
    </svg>
  ),
};

const connectorIcon: Readonly<Record<ConnectorKind, ReactNode>> = {
  arrow: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10 H15 M11 6 L15 10 L11 14" />
    </svg>
  ),
  line: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M4 16 L16 4" />
    </svg>
  ),
};

const SHAPE_VARIANTS: readonly { kind: HbShapeKind; label: string; icon: ReactNode }[] = [
  { kind: "rectangle", label: "مستطیل", icon: shapeIcon.rectangle },
  { kind: "ellipse", label: "بیضی", icon: shapeIcon.ellipse },
  { kind: "diamond", label: "لوزی", icon: shapeIcon.diamond },
];

const CONNECTOR_VARIANTS: readonly { kind: ConnectorKind; label: string; icon: ReactNode }[] = [
  { kind: "arrow", label: "پیکان", icon: connectorIcon.arrow },
  { kind: "line", label: "خط", icon: connectorIcon.line },
];

/**
 * فلای‌اوتِ واریانت — کنارِ نوارِ عمودی وقتی «شکل»/«کانکتور» فعال است (مثلِ پالتِ
 * استیکی). فقط انتخابِ **نوع** است؛ ساخت/سینک از خودِ موتور و مسیرِ 8.4 می‌آید.
 */
function VariantFlyout<T extends string>({
  label,
  variants,
  current,
  onPick,
}: {
  label: string;
  variants: readonly { kind: T; label: string; icon: ReactNode }[];
  current: T;
  onPick: (kind: T) => void;
}) {
  return (
    <div className="board-flyout" role="group" aria-label={label}>
      {variants.map((variant) => (
        <button
          key={variant.kind}
          type="button"
          className={`board-flyout__btn${current === variant.kind ? " is-selected" : ""}`}
          title={variant.label}
          aria-label={variant.label}
          aria-pressed={current === variant.kind}
          onClick={() => onPick(variant.kind)}
        >
          {variant.icon}
        </button>
      ))}
    </div>
  );
}

export function BoardPage() {
  const { boardId } = useParams({ from: "/b/$boardId" });
  const { user } = useSession();

  // عنوان + بررسیِ دسترسی (۴۰۳/۴۰۴ اینجا معلوم می‌شود، پیش از mountِ بوم).
  const board = useQuery({ queryKey: ["board", boardId], queryFn: () => api.boards.get(boardId) });

  const [canvasApi, setCanvasApi] = useState<CanvasApi | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [save, setSave] = useState<SaveState | null>(null);
  const [permissions, setPermissions] = useState<CanvasPermissions | null>(null);
  // پیامِ کوتاهِ خطای پروتکل (مثلِ ردِ نوشتنِ viewer) — فارسیِ آماده از سرور/adapter.
  const [notice, setNotice] = useState<string | null>(null);
  // ★ حضورِ همتاها (یافته‌ی ۳): مکان‌نمای زنده. `applyPeers` این را می‌دهد.
  const [peers, setPeers] = useState<PeerState[]>([]);
  // ★★ نما از `onScrollChange`، نه `getAppState()` (یک فریمْ کهنه بعد از pan — درسِ Q1/M1).
  const [viewport, setViewport] = useState<Viewport>({ scrollX: 0, scrollY: 0, zoom: 1 });
  // ★ نوار ابزار (گام ۹٫۱): ابزارِ فعال + رنگِ استیکیِ بعدی.
  const [activeToolId, setActiveToolId] = useState<ToolId>("select");
  const [palette, setPalette] = useState<HbStickyColor>("yellow");
  // ★ واریانتِ شکل/کانکتور (پوششِ بیضی/لوزی/خطِ نوارِ نیتیو) — فلای‌اوت انتخابشان می‌کند.
  const [shapeKind, setShapeKind] = useState<HbShapeKind>("rectangle");
  const [connectorKind, setConnectorKind] = useState<ConnectorKind>("arrow");
  // ★ منوی سه‌نقطه + تنظیم‌های نمایشِ **محلی** (با همتاها هم‌گام نمی‌شوند — مثلِ View منوی میرو).
  const [menuOpen, setMenuOpen] = useState(false);
  const [showGrid, setShowGrid] = useState(false); // gridModeEnabled — پیش‌فرضِ موتور خاموش
  const [snapEnabled, setSnapEnabled] = useState(true); // objectsSnapModeEnabled — initialData روشن
  const [showPeerCursors, setShowPeerCursors] = useState(true); // گیتِ رندرِ PeerCursors
  // تغییرِ نامِ درجا (مثلِ «Click to rename» میرو) — از عنوان یا از منو باز می‌شود.
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const navigate = useNavigate();
  const renameBoard = useRenameBoard();
  const trashBoard = useTrashBoard();

  const paneRef = useRef<HTMLDivElement | null>(null);
  // outbound را در ref نگه می‌داریم تا هندلرهای سطحِ render (مکان‌نما/ابزار) به آن برسند.
  const outboundRef = useRef<CanvasOutbound | null>(null);
  // apiِ موتور در ref تا selectTool/میانبرها (پایدار) بی‌وابستگی به state بخوانندش.
  const canvasApiRef = useRef<CanvasApi | null>(null);
  canvasApiRef.current = canvasApi;
  // ابزارهای سفارشیِ canvas-core — reuse، نه بازسازی (ADR-024).
  const stickyToolRef = useRef<StickyTool | null>(null);
  const imageToolRef = useRef<ImageTool | null>(null);
  const drawToolRef = useRef<DrawTool | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  // پل‌های پایدار به توابعِ داخلِ افکتِ اتصال (میانبرها/selectTool از اینها می‌خوانند).
  const selectToolRef = useRef<((id: ToolId) => void) | null>(null);
  const flushLocalRef = useRef<(() => void) | null>(null);
  const showNoticeRef = useRef<((message: string) => void) | null>(null);
  // دسته‌ی undoِ Yjs — بعد از اتصال ست می‌شود؛ منوی سه‌نقطه واگرد/ازنو را از همین می‌زند
  // (همان مسیرِ `Ctrl+Z`، چون `adapter.undo` خودش بعدِ undo/redo روی همتاها flush می‌کند).
  const undoScopeRef = useRef<UndoScope | null>(null);
  // لایه‌ی روکش: قلمِ محلی + دنباله‌ی لیزرِ همتاها. یک redraw برای هر دو (وگرنه با clearRect
  // همدیگر را پاک می‌کنند). refها تا redrawِ سطحِ effect/رویداد آخرین مقدار را ببیند.
  const penPointsRef = useRef<StrokePoint[] | null>(null);
  const peersRef = useRef<PeerState[]>([]);
  const redrawOverlayRef = useRef<(() => void) | null>(null);
  // لیزر: بافرِ دنباله + throttleِ emit + مهلتِ پاک‌شدن پس از توقف.
  const laserTrailRef = useRef<[number, number][]>([]);
  const lastLaserEmitRef = useRef(0);
  const laserIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // رنگِ لیزرِ **خودم** روی روکش (تا مستقل از رندرِ نیتیوِ موتور خودم هم ببینمش) —
  // همان رنگی که همتاها با آن می‌بینندم (colorForId)، برای هماهنگی.
  const myColorRef = useRef("#e5484d");
  myColorRef.current = user ? colorForId(user.id) : "#e5484d";

  const readOnly = permissions?.canEdit === false;
  // آخرین مقادیر در ref تا هندلرهای پایدار (بدونِ re-subscribe) بخوانند.
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const activeToolIdRef = useRef(activeToolId);
  activeToolIdRef.current = activeToolId;
  const shapeKindRef = useRef(shapeKind);
  shapeKindRef.current = shapeKind;
  const connectorKindRef = useRef(connectorKind);
  connectorKindRef.current = connectorKind;

  // مکان‌نمای محلی → همتاها. موتور `onPointerUpdate` را در مختصاتِ **صحنه** می‌دهد
  // (بی‌تبدیل، یافته‌ی ۳)؛ throttleِ ۴۰ms را خودِ آداپتور می‌زند (`HB_THROTTLE`).
  const handlePointerUpdate = useCallback((pointer: { x: number; y: number }) => {
    outboundRef.current?.emitPointer({ x: pointer.x, y: pointer.y, visible: true });
    // ★ لیزر: دنباله‌ی محلی را برای همتاها emit کن (ephemeral، بی‌ذخیره). لیزرِ **محلی**
    //   را خودِ موتور می‌کشد (`setActiveTool "laser"`)؛ اینجا فقط برای همتاهاست.
    if (activeToolIdRef.current !== "laser") return;
    const trail = laserTrailRef.current;
    trail.push([pointer.x, pointer.y]);
    if (trail.length > LASER_TRAIL_MAX) trail.shift();
    redrawOverlayRef.current?.(); // لیزرِ محلیِ خودم را همین‌جا بازکش
    const now = performance.now();
    if (now - lastLaserEmitRef.current >= LASER_EMIT_MS) {
      lastLaserEmitRef.current = now;
      outboundRef.current?.emitEphemeral({ kind: "laser", points: trail.slice() });
    }
    // پس از توقفِ حرکت، دنباله را (محلی و روی همتاها) پاک کن.
    if (laserIdleRef.current) clearTimeout(laserIdleRef.current);
    laserIdleRef.current = setTimeout(() => {
      laserTrailRef.current = [];
      outboundRef.current?.emitEphemeral(null);
      redrawOverlayRef.current?.();
    }, LASER_IDLE_MS);
  }, []);

  // نقطه‌ی صحنه → پیکسلِ لایه‌ی روکش، با تابعِ **مشترکِ** `sceneToOverlayPixel` (ADR-024،
  // صفر تکرارِ فرمول). وابسته به `viewport` تا با هر pan/zoom دوباره پروجکت شود.
  const projectPeer = useCallback(
    (sceneX: number, sceneY: number): { x: number; y: number } => {
      const host = paneRef.current;
      if (!canvasApi || !host) return { x: sceneX, y: sceneY };
      const state = canvasApi.getAppState();
      const rect = host.getBoundingClientRect();
      return sceneToOverlayPixel(
        { x: sceneX, y: sceneY },
        viewport,
        { offsetLeft: state.offsetLeft, offsetTop: state.offsetTop },
        { left: rect.left, top: rect.top },
      );
    },
    [canvasApi, viewport],
  );

  // ★ رندرِ لایه‌ی روکش — قلمِ محلی + دنباله‌ی لیزرِ همتاها **با هم** (یک `clearRect`،
  //   وگرنه یکی دیگری را پاک می‌کند). پروجکشنِ مشترکِ `sceneToOverlayPixel` (ADR-024).
  //   نمای معتبر از `viewportRef` (نه getAppState — درسِ Q1).
  const redrawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const host = paneRef.current;
    const ctx = overlay?.getContext("2d");
    if (!overlay || !host || !canvasApi || !ctx) return;
    if (overlay.width !== overlay.clientWidth || overlay.height !== overlay.clientHeight) {
      overlay.width = overlay.clientWidth;
      overlay.height = overlay.clientHeight;
    }
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const state = canvasApi.getAppState();
    const rect = host.getBoundingClientRect();
    const toPixel = (sceneX: number, sceneY: number) =>
      sceneToOverlayPixel(
        { x: sceneX, y: sceneY },
        viewportRef.current,
        { offsetLeft: state.offsetLeft, offsetTop: state.offsetTop },
        { left: rect.left, top: rect.top },
      );
    // ephemeralِ همتاها روی روکش: **لیزر** (رنگِ همتا) و **استروکِ زنده‌ی قلم** (رنگ/عرضِ
    // خودِ استروک). هر دو از همان کانالِ `peer.ephemeral` می‌آیند (ADR-036).
    for (const peer of peersRef.current) {
      const eph = peer.ephemeral;
      if (!eph) continue;
      if (eph.kind === "laser" && eph.points.length >= 2) {
        drawTrail(
          ctx,
          eph.points.map(([x, y]) => toPixel(x, y)),
          peer.user.color,
          3,
        );
      } else if (eph.kind === "draw-stroke" && eph.points.length >= 2) {
        // عرضِ استروک در واحدِ **صحنه** است؛ برای روکشِ پیکسلی به زوم مقیاس می‌شود.
        drawTrail(
          ctx,
          eph.points.map(([x, y]) => toPixel(x, y)),
          eph.color,
          Math.max(1, eph.width * viewportRef.current.zoom),
        );
      }
    }
    // لیزرِ **خودم** — تا مستقل از رندرِ نیتیوِ موتور (که با هر ابزار/رویداد رفتارش
    // فرق دارد) همیشه بازخوردِ محلی ببینم. همتاها همین را در رنگِ من می‌بینند.
    const myLaser = laserTrailRef.current;
    if (activeToolIdRef.current === "laser" && myLaser.length >= 2) {
      drawTrail(
        ctx,
        myLaser.map(([x, y]) => toPixel(x, y)),
        myColorRef.current,
        3,
      );
    }
    // استروکِ قلمِ محلیِ در حالِ کشیدن.
    const pen = penPointsRef.current;
    if (pen && pen.length >= 2) {
      drawTrail(
        ctx,
        pen.map((p) => toPixel(p[0], p[1])),
        "#1a1a1a",
        3,
      );
    }
  }, [canvasApi]);
  redrawOverlayRef.current = redrawOverlay;

  // روکش را با تغییرِ همتاها (لیزر) یا نما (pan/zoom → دوباره پروجکت) بازرسم کن.
  useEffect(() => {
    peersRef.current = peers;
    redrawOverlayRef.current?.();
  }, [peers, viewport]);

  /**
   * انتخابِ ابزار (از نوار یا میانبر) — لایه‌ی سیم‌کشی. ابزارهای موتور با
   * `setActiveTool` (شکل/کانکتور/فریم/متن/پاک‌کن)، استیکی/قلمِ سفارشی با `activate`،
   * تصویر با انتخابگرِ فایل. ★ P6: نگاشتِ ابزار مختصاتِ بوم را **آینه نمی‌کند** —
   * فقط ابزار عوض می‌شود. ابزارِ فعال در کانالِ حضور بازتاب می‌یابد (`emitActiveTool`).
   */
  const selectTool = useCallback((id: ToolId) => {
    const engine = canvasApiRef.current;
    if (!engine) return;
    // viewer: فقط ناوبری (select/hand)؛ ابزارهای ویرایش بی‌اثر می‌مانند (fail-closed).
    if (readOnlyRef.current && id !== "select" && id !== "hand") return;
    const meta = HB_TOOLS.find((tool) => tool.id === id);
    if (meta?.comingSoon) {
      showNoticeRef.current?.("این ابزار در فاز بعد می‌آید.");
      return;
    }

    // خروج از لیزر → دنباله را روی همتاها پاک کن (وگرنه آخرین دنباله‌ات آنجا می‌ماند).
    if (activeToolIdRef.current === "laser" && id !== "laser") {
      if (laserIdleRef.current) clearTimeout(laserIdleRef.current);
      laserTrailRef.current = [];
      outboundRef.current?.emitEphemeral(null);
      redrawOverlayRef.current?.();
    }

    // ابزارهای سفارشی را خاموش کن مگر خودشان انتخاب شده باشند.
    if (id !== "sticky") stickyToolRef.current?.deactivate();
    if (id !== "pen") drawToolRef.current?.deactivate();
    setActiveToolId(id);

    switch (id) {
      case "select":
        engine.setActiveTool({ type: "selection" });
        break;
      case "hand":
        engine.setActiveTool({ type: "hand" });
        break;
      case "text":
        engine.setActiveTool({ type: "text" });
        break;
      case "shape":
        // واریانتِ فعلی (مستطیل/بیضی/لوزی) — فلای‌اوت عوضش می‌کند.
        engine.setActiveTool({ type: shapeKindRef.current });
        break;
      case "connector":
        // واریانتِ فعلی (پیکان/خط).
        engine.setActiveTool({ type: connectorKindRef.current });
        break;
      case "frame":
        engine.setActiveTool({ type: "frame" });
        break;
      case "eraser":
        engine.setActiveTool({ type: "eraser" });
        break;
      case "laser":
        // لیزرِ نیتیوِ موتور، محلی را می‌کشد؛ دنباله برای همتاها در handlePointerUpdate.
        engine.setActiveTool({ type: "laser" });
        break;
      case "sticky":
        engine.setActiveTool({ type: "selection" });
        stickyToolRef.current?.activate();
        break;
      case "pen":
        engine.setActiveTool({ type: "selection" });
        drawToolRef.current?.activate();
        break;
      case "image":
        fileInputRef.current?.click();
        break;
      case "comment":
        // stub — به اینجا نمی‌رسد (comingSoon بالا برگردانده شد)؛ محتوایش فاز بعد.
        break;
    }
    // ابزارِ فعال را به همتاها بگو — M2 از قبل awareness را relay می‌کند (بی‌تغییرِ قرارداد).
    outboundRef.current?.emitActiveTool(id);
  }, []);
  selectToolRef.current = selectTool;

  // انتخابِ واریانتِ شکل/کانکتور از فلای‌اوت — نوع را نگه می‌دارد (برای دفعه‌ی بعد) و
  // همان لحظه ابزارِ موتور را عوض می‌کند. رسم/سینک از مسیرِ onChange→flushLocalِ 8.4 می‌رود.
  const pickShape = useCallback((kind: HbShapeKind) => {
    setShapeKind(kind);
    canvasApiRef.current?.setActiveTool({ type: kind });
  }, []);
  const pickConnector = useCallback((kind: ConnectorKind) => {
    setConnectorKind(kind);
    canvasApiRef.current?.setActiveTool({ type: kind });
  }, []);

  // انتخابِ فایلِ تصویر از نوار → درج، سپس برگشت به ابزارِ انتخاب.
  // ⚠️ **درجِ تصویر به «حملِ دارایی» نیاز دارد که فاز ۱۱٫۲ (ذخیره‌سازیِ واقعی) سیم
  //    می‌کند**: adapter اینجا بدونِ `assets` است، پس `requestAssetUpload` خطا می‌دهد.
  //    وایرینگ کامل و آماده‌ی ۱۱٫۲ است (فقط `assets:` به adapter اضافه می‌شود)؛ تا آن‌وقت
  //    به‌جای کرشِ بی‌صدا یک نوتیسِ روشن نشان می‌دهیم.
  const onImageFilePicked = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // اجازه‌ی انتخابِ دوباره‌ی همان فایل
    if (!file) return;
    try {
      await imageToolRef.current?.ingestFile(file);
    } catch (error) {
      console.warn("HB_IMAGE", error);
      showNoticeRef.current?.("درجِ تصویر با گامِ ذخیره‌سازی (فاز بعد) فعال می‌شود.");
    }
    selectToolRef.current?.("select");
  }, []);

  // بزرگ/کوچک‌نماییِ حولِ مرکز (`zoom.ts`) و برازش با صفحه — چون chromeِ نیتیوِ زوم را
  // پنهان کردیم، `ZoomControl`ِ خودِ canvas-core جایش را می‌گیرد (reuse، ADR-024).
  // appState-only، بی‌ورودیِ undo. ★ گامِ بعدی از zoomِ فعلیِ **موتور** حساب می‌شود، نه state.
  const applyZoom = useCallback((direction: 1 | -1) => {
    const engine = canvasApiRef.current;
    if (!engine) return;
    const s = engine.getAppState();
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
    engine.updateScene({
      appState: {
        zoom: { value: next.zoom },
        scrollX: next.scrollX,
        scrollY: next.scrollY,
      } as never,
      captureUpdate: "NEVER",
    });
    // updateSceneِ برنامه‌ای `onScrollChange` نمی‌دهد — نمای معتبر را خودمان می‌گذاریم.
    setViewport({ scrollX: next.scrollX, scrollY: next.scrollY, zoom: next.zoom });
  }, []);

  const fitToScreen = useCallback(() => {
    const engine = canvasApiRef.current;
    if (!engine) return;
    const live = engine.getSceneElements().filter((el) => !el.isDeleted);
    if (live.length === 0) {
      engine.updateScene({
        appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 } as never,
        captureUpdate: "NEVER",
      });
      setViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
      return;
    }
    engine.scrollToContent(live, { fitToContent: true });
    // یک تیک صبر تا نما بنشیند، بعد نمای معتبرِ کامل (scroll + zoom) را بخوان.
    setTimeout(() => {
      const s = canvasApiRef.current?.getAppState();
      if (s) setViewport({ scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value });
    }, 0);
  }, []);

  // ── منوی سه‌نقطه ────────────────────────────────────────────────────────
  // شبکه/چسبیدن روی `appState`ِ موتور اند — **محلی** (با همتاها هم‌گام نمی‌شوند) و با
  // `captureUpdate:"NEVER"` تا ورودیِ undo نسازند. مرجعِ حقیقت خودِ getAppState است.
  const toggleGrid = useCallback(() => {
    const engine = canvasApiRef.current;
    if (!engine) return;
    const next = !engine.getAppState().gridModeEnabled;
    engine.updateScene({ appState: { gridModeEnabled: next }, captureUpdate: "NEVER" });
    setShowGrid(next);
  }, []);

  const toggleSnap = useCallback(() => {
    const engine = canvasApiRef.current;
    if (!engine) return;
    const next = !engine.getAppState().objectsSnapModeEnabled;
    engine.updateScene({ appState: { objectsSnapModeEnabled: next }, captureUpdate: "NEVER" });
    setSnapEnabled(next);
  }, []);

  const toggleCursors = useCallback(() => setShowPeerCursors((v) => !v), []);

  // واگرد/ازنو از همان دسته‌ی Yjs که `Ctrl+Z` می‌زند (ADR-035)؛ بعد از اتصال موجود است.
  const doUndo = useCallback(() => undoScopeRef.current?.undo(), []);
  const doRedo = useCallback(() => undoScopeRef.current?.redo(), []);

  // تغییرِ نام — از کلیکِ عنوان یا از منو. mutation کشِ `["board"]`/`["boards"]` را باطل می‌کند.
  const startRename = useCallback(() => {
    setMenuOpen(false);
    setRenameValue(board.data?.title ?? "");
    setRenaming(true);
  }, [board.data?.title]);

  const submitRename = useCallback(() => {
    const title = renameValue.trim();
    setRenaming(false);
    if (title.length === 0 || title === board.data?.title) return;
    renameBoard.mutate({ id: boardId, title });
  }, [renameValue, board.data?.title, boardId, renameBoard]);

  // حذف → سطلِ بازیافت (فقط owner؛ api گیت می‌کند)، سپس بازگشت به داشبورد.
  const deleteBoard = useCallback(() => {
    const title = board.data?.title ?? "این بورد";
    if (!window.confirm(`«${title}» به سطلِ بازیافت منتقل شود؟ از داشبورد قابلِ بازیابی است.`)) return;
    trashBoard.mutate(boardId, { onSuccess: () => void navigate({ to: "/dashboard" }) });
  }, [board.data?.title, boardId, trashBoard, navigate]);

  // نما را از `onScrollChange` نگه می‌داریم (مقدارِ اولیه از getAppState، بعد زنده)؛ و
  // تنظیم‌های نمایشِ منو (شبکه/چسبیدن) را همان‌جا با حالتِ واقعیِ موتور هم‌تراز می‌کنیم.
  useEffect(() => {
    if (!canvasApi) return;
    const initial = canvasApi.getAppState();
    setViewport({ scrollX: initial.scrollX, scrollY: initial.scrollY, zoom: initial.zoom.value });
    setShowGrid(initial.gridModeEnabled);
    setSnapEnabled(initial.objectsSnapModeEnabled);
    return canvasApi.onScrollChange((scrollX, scrollY, zoom) =>
      setViewport({ scrollX, scrollY, zoom: zoom.value }),
    );
  }, [canvasApi]);

  // میانبرهای صفحه‌کلید — از همان جدولِ نوار ابزار (`toolForShortcut`، یک منبع).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // هنگام تایپ داخل استیکی/فیلد، میانبرها نباید بپرند وسط.
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;
      // Ctrl/Cmd/Alt دستِ موتور و UndoManager است (Ctrl+Z، ADR-035) — دست نزن.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Tab هنگام فعال‌بودنِ استیکی → استیکیِ بعدی در امتداد آخری (رفتارِ استیکیِ M1).
      if (event.key === "Tab" && stickyToolRef.current?.isActive()) {
        event.preventDefault();
        stickyToolRef.current.createNext();
        flushLocalRef.current?.(); // نوشتنِ برنامه‌ای onChange نمی‌دهد — دستی flush
        return;
      }
      const toolId = toolForShortcut(event.key);
      if (toolId) {
        event.preventDefault();
        selectToolRef.current?.(toolId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    // ★ الگوی StrictMode-safe (ADR-032/ADR-028): api از onReady در **state** است و
    //   همه‌ی اشتراک‌ها اینجا در `useEffect([api])` با cleanup بسته می‌شوند.
    if (!canvasApi || !user) return;

    // ★ §۲ handoff (ADR-047): پیام‌های پروتکلِ **کلاینت** در `canvas-sync` می‌مانند؛
    //   اپ فقط **نمایششان** می‌دهد. `error.message` از قبل فارسیِ آماده است.
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    const showNotice = (message: string): void => {
      setNotice(message);
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => setNotice(null), 4000);
    };
    showNoticeRef.current = showNotice;

    // ★★ `Y.Doc`ِ ساده، نه `createBoardDoc` (یافته‌ی ۲ M2): مهرِ `schemaVersion` روی هر
    //    باز شدنِ تب یک opِ اضافی می‌ساخت. adapter آن را **تنبل** روی اولین نوشتن می‌زند.
    const doc = new Y.Doc();
    const localStore = createIndexeddbDocStore({ doc, name: `hamboom-${boardId}` });

    const transport = createWebSocketTransport({
      url: `${RT_URL}/rt?board=${encodeURIComponent(boardId)}`,
      // ★★ توکن برای **هر تلاش** تازه از api (ADR-039).
      token: async () => (await api.boards.rtToken(boardId)).token,
    });

    const adapter = new YjsSyncAdapter({
      doc,
      transport,
      localStore,
      onProtocolError: (error) => {
        console.warn(`HB_ERROR ${error.code}: ${error.message}`);
        showNotice(error.message.length > 0 ? error.message : "تغییرِ شما اعمال نشد.");
      },
      user: {
        id: user.id,
        displayName: user.displayName,
        color: colorForId(user.id),
        avatarUrl: user.avatarUrl,
      },
    });

    // ── سمتِ **محلی**: onChange → دیف → emitِ زنده (درسِ 8.4) ──────────────────
    //
    // ★ نکته‌ی کلیدی (تله‌ی M1): `onChange` فقط برای ویرایشِ **واقعیِ کاربر** صدا
    //   زده می‌شود — updateSceneِ **برنامه‌ای** (اعمالِ remote **یا ابزارهای سفارشی**)
    //   آن را fire نمی‌کند. پس ابزارهای استیکی/قلم/تصویر که برنامه‌ای می‌نویسند در
    //   callbackِ پایانشان **دستی** `flushLocal` می‌کنند (پایین). ابزارهای موتور
    //   (شکل/کانکتور/فریم/متن/پاک‌کن) با درگِ واقعیِ کاربر onChange می‌دهند و خودکار
    //   emit می‌شوند.
    const known = new Map<string, number>(); // id → excalidraw version
    let outbound: Awaited<ReturnType<typeof adapter.connect>> | null = null;
    let cancelled = false;
    let flushScheduled = false;
    const gestures = createGestureTracker(user.id, GESTURE_IDLE_MS);

    const snapshotKnown = (): void => {
      known.clear();
      for (const element of canvasApi.getSceneElementsIncludingDeleted()) {
        known.set(element.id, (element as SceneElement & { version: number }).version);
      }
    };

    const flushLocal = (): void => {
      const scene = canvasApi.getSceneElementsIncludingDeleted() as (SceneElement & {
        version: number;
        isDeleted: boolean;
      })[];
      const upserted: HbElement[] = [];
      const deleted: string[] = [];
      const nextKnown = new Map<string, number>();

      for (const element of scene) {
        nextKnown.set(element.id, element.version);
        if (known.get(element.id) === element.version) continue; // بی‌تغییر
        if (element.isDeleted) {
          if (known.has(element.id)) deleted.push(element.id);
        } else {
          try {
            upserted.push(fromExcalidraw(element as never));
          } catch {
            // عنصری که به مدلِ سند نگاشت نمی‌شود (نوعِ پشتیبانی‌نشده) — رد شود.
          }
        }
      }

      known.clear();
      for (const [id, version] of nextKnown) known.set(id, version);

      if (outbound && (upserted.length > 0 || deleted.length > 0)) {
        outbound.emitElementChanges({
          upserted,
          deleted,
          origin: "local-user",
          gestureId: gestures.idFor(performance.now()),
        });
      }
    };
    flushLocalRef.current = flushLocal;

    const offChange = canvasApi.onChange(() => {
      // coalesceِ یک‌تسکی: چند onChange در یک تسک → یک دیف. scheduler خودش throttle می‌کند.
      if (flushScheduled) return;
      flushScheduled = true;
      queueMicrotask(() => {
        flushScheduled = false;
        if (!cancelled) flushLocal();
      });
    });

    // استروکِ قلم و دنباله‌ی لیزرِ همتاها روی **یک** لایه‌ی روکش می‌روند، پس رندرشان
    // یک‌جا در `redrawOverlay`ِ سطحِ کامپوننت است (بالا) — draw-tool فقط بافرِ نقاط را
    // می‌گذارد و redraw می‌کند (وگرنه دو clearRect همدیگر را پاک می‌کنند).

    // binding را می‌پیچیم تا هر اعمالِ remote، `known` را هم‌روز نگه دارد (ضدِ اکو).
    const binding = createCanvasBinding({
      api: canvasApi,
      // ★ `applyPeers` (یافته‌ی ۳): حضورِ همتاها → state تا `PeerCursors` رندرشان کند.
      ui: {
        setConnectionState: setConnection,
        setSaveState: setSave,
        setPermissions,
        applyPeers: setPeers,
      },
    });
    const wrappedBinding: typeof binding = {
      ...binding,
      applyRemoteChanges: (changes) => {
        binding.applyRemoteChanges(changes);
        snapshotKnown();
      },
      replaceDocument: (document) => {
        binding.replaceDocument(document);
        snapshotKnown();
      },
    };

    let unbindUndo: (() => void) | undefined;

    void adapter
      .connect(wrappedBinding)
      .then((ob) => {
        if (cancelled) return;
        outbound = ob;
        outboundRef.current = ob; // هندلرهای سطحِ render از این می‌خوانند.
        // ★★ Ctrl+Z باید به UndoManager برسد، نه تاریخچه‌ی موتور (ADR-035، اجباری).
        //    همان دسته را در ref هم می‌گذاریم تا منوی سه‌نقطه واگرد/ازنو را از آن بزند.
        const undoScope = adapter.undo;
        if (paneRef.current && undoScope) {
          unbindUndo = bindUndoShortcuts(paneRef.current, undoScope);
        }
        undoScopeRef.current = undoScope;

        // ── ابزارهای سفارشی (گام ۹٫۱) — بعد از اتصال، چون image/pen به outbound
        //    نیاز دارند. هر سه برنامه‌ای به صحنه می‌نویسند، پس در callbackِ پایان
        //    `flushLocal` می‌کنند (همان مسیرِ تک‌emitِ 8.4 که `known` را هم درست
        //    نگه می‌دارد). ⚠️ StrictMode: اگر cancelled شده باشد، اصلاً ساخته نمی‌شوند.
        stickyToolRef.current = createStickyTool({
          api: canvasApi,
          authorId: user.id,
          getPalette: () => paletteRef.current,
          onCreated: () => {
            flushLocal();
            // ابزارِ استیکی پس از یک قراردهی خودش deactivate می‌شود (M1) — UI را
            // صادقانه به «انتخاب» برگردان (پالت هم بسته می‌شود). رنگِ بعدی را کاربر
            // پیش از قراردهیِ بعدی می‌چیند.
            setActiveToolId("select");
            ob.emitActiveTool("select");
          },
        });

        const imageOutbound: ImageAssetOutbound = {
          requestAssetUpload: (file) => ob.requestAssetUpload(file),
          resolveAssetUrl: (fileId) => ob.resolveAssetUrl(fileId),
        };
        imageToolRef.current = createImageTool({
          api: canvasApi,
          outbound: imageOutbound,
          authorId: user.id,
          onError: (message) => showNotice(message),
          onInserted: () => flushLocal(),
        });

        const drawOutbound: DrawStrokeOutbound = {
          // استروکِ در حالِ کشیدن → همتاها (ephemeral، بی‌ذخیره).
          emitEphemeral: (payload) => ob.emitEphemeral(payload),
          // ⚠️ ضدِ دو-emit: قلم عنصر را برنامه‌ای می‌نویسد و `onCommitted → flushLocal`
          //   تنها مسیرِ emit است؛ اینجا no-op تا استروکِ نهایی دوبار نرود.
          emitElementChanges: () => {},
        };
        drawToolRef.current = createDrawTool({
          api: canvasApi,
          outbound: drawOutbound,
          authorId: user.id,
          onLocalStroke: (points) => {
            penPointsRef.current = points;
            redrawOverlayRef.current?.();
          },
          onCommitted: () => flushLocal(),
        });

        // ابزارِ اولیه‌ی حضور را اعلام کن (از ref، تا افکت به activeTool وابسته نشود).
        ob.emitActiveTool(activeToolIdRef.current);
      })
      .catch(() => {
        // ConnectionCancelledError زیر StrictMode طبیعی است.
      });

    return () => {
      cancelled = true; // microtaskِ در صف اگر بعد از این اجرا شود، flushLocal را رد می‌کند
      if (noticeTimer) clearTimeout(noticeTimer);
      if (laserIdleRef.current) clearTimeout(laserIdleRef.current);
      offChange();
      unbindUndo?.();
      undoScopeRef.current = null;
      // ابزارها listenerِ document دارند؛ باید نابود شوند (StrictMode: دو نمونه نماند).
      stickyToolRef.current?.destroy();
      stickyToolRef.current = null;
      imageToolRef.current?.destroy();
      imageToolRef.current = null;
      drawToolRef.current?.destroy();
      drawToolRef.current = null;
      flushLocalRef.current = null;
      showNoticeRef.current = null;
      adapter.disconnect();
      outboundRef.current = null;
      setPeers([]); // مکان‌نمای همتاها با قطع پاک شود
      // ⚠️ localStore بسته نمی‌شود — چرخه‌ی عمرش مالِ صفحه است، نه اتصال (StrictMode).
    };
  }, [canvasApi, user, boardId]);

  if (board.isError) {
    return (
      <div className="card">
        <h1>بوم در دسترس نیست</h1>
        <p className="field-error">{errorMessage(board.error)}</p>
        <Link to="/dashboard" className="btn btn--ghost">
          بازگشت به داشبورد
        </Link>
      </div>
    );
  }

  const myRole = board.data?.myRole;
  const canEditBoard = myRole === "owner" || myRole === "editor";
  const isOwner = myRole === "owner";

  return (
    <div className="board-shell">
      <div className="board-canvas" ref={paneRef}>
        <HamboomCanvas
          onReady={setCanvasApi}
          viewModeEnabled={readOnly}
          onPointerUpdate={handlePointerUpdate}
          hideNativeUI
        />
        {/* روکشِ استروکِ قلمِ محلی — pointer-events:none، پس کلیک به بوم می‌رسد. */}
        <canvas ref={overlayRef} className="board-draw-overlay" />
        {/* مکان‌نمای زنده‌ی همتاها — با تنظیمِ منو گیت می‌شود (فقط cursors، نوارِ حضور جداست). */}
        {showPeerCursors && <PeerCursors peers={peers} project={projectPeer} />}
        {/* کنترلِ بزرگ‌نمایی — جای فوترِ نیتیوِ پنهان‌شده (برای viewer هم، ناوبری است). */}
        <ZoomControl
          zoom={viewport.zoom}
          onZoomIn={() => applyZoom(1)}
          onZoomOut={() => applyZoom(-1)}
          onFit={fitToScreen}
        />

        {/* ── خوشه‌ی کنترلِ شناورِ بالا-شروع (مثلِ میرو) — بوم کلِ صفحه، کنترل‌ها روی آن ── */}
        <div className="board-chrome">
          <Link
            to="/dashboard"
            className="board-chrome__back"
            aria-label="بازگشت به داشبورد"
            title="داشبورد"
          >
            ←
          </Link>
          {renaming ? (
            <form
              className="board-chrome__rename"
              onSubmit={(event) => {
                event.preventDefault();
                submitRename();
              }}
            >
              <input
                className="input input--sm"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={submitRename}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setRenaming(false);
                }}
                aria-label="نامِ بورد"
                autoFocus
              />
            </form>
          ) : canEditBoard ? (
            <button
              type="button"
              className="board-chrome__title"
              onClick={startRename}
              title="کلیک برای تغییرِ نام"
            >
              {board.data?.title ?? "بوم"}
            </button>
          ) : (
            <span className="board-chrome__title board-chrome__title--static">
              {board.data?.title ?? "بوم"}
            </span>
          )}
          {readOnly && <span className="role-badge">فقط‌خواندنی</span>}
          <span
            className="board-chrome__status"
            title={`${connectionLabel(connection)} · ${saveLabel(save)}`}
          >
            <span
              className="board-chrome__dot"
              style={{ background: connDotColor(connection) }}
              aria-hidden="true"
            />
            <span className="board-chrome__status-text">{statusText(connection, save)}</span>
          </span>
          <div className="board-chrome__menu-wrap">
            <button
              type="button"
              className="board-chrome__menu-btn"
              aria-label="گزینه‌های بورد"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              ⋯
            </button>
            {menuOpen && (
              <BoardMenu
                canEdit={canEditBoard}
                isOwner={isOwner}
                showGrid={showGrid}
                snapEnabled={snapEnabled}
                showPeerCursors={showPeerCursors}
                onToggleGrid={toggleGrid}
                onToggleSnap={toggleSnap}
                onToggleCursors={toggleCursors}
                onUndo={doUndo}
                onRedo={doRedo}
                onRename={startRename}
                onDelete={deleteBoard}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>
        </div>

        {/* نوتیسِ شناورِ خطای پروتکل — بالا-وسط، روی بوم (نه در جریانِ صفحه). */}
        {notice !== null && (
          <div className="board-notice board-notice--float" role="status">
            {notice}
          </div>
        )}
        {/* ابزارِ فعالِ همتاها (گام ۹٫۱) — بالا-انتها (inline-end)، جدا از نوارِ inline-start. */}
        {peers.length > 0 && (
          <div className="board-peers" aria-label="همکاران">
            {peers.map((peer) => {
              const label = peerToolLabel(peer.activeTool);
              return (
                <span key={peer.clientId} className="board-peer">
                  <span
                    className="board-peer__dot"
                    style={{ background: peer.user.color }}
                    aria-hidden="true"
                  />
                  <span className="board-peer__name">{peer.user.displayName}</span>
                  {label !== null && <span className="board-peer__tool">{label}</span>}
                </span>
              );
            })}
          </div>
        )}
        {/* نوار ابزارِ عمودی — فقط برای ویرایشگر (viewer پوسته‌ی view-mode دارد). */}
        {!readOnly && (
          <>
            <Toolbar orientation="vertical" activeTool={activeToolId} onSelectTool={selectTool} />
            {activeToolId === "sticky" && (
              <div className="board-palette" role="group" aria-label="رنگِ استیکی">
                {HB_STICKY_PALETTE.map((swatch) => (
                  <button
                    key={swatch.key}
                    type="button"
                    className={`board-swatch${palette === swatch.key ? " is-selected" : ""}`}
                    style={{ background: swatch.bg, borderColor: swatch.accent }}
                    title={swatch.nameFa}
                    aria-label={swatch.nameFa}
                    aria-pressed={palette === swatch.key}
                    onClick={() => setPalette(swatch.key)}
                  />
                ))}
              </div>
            )}
            {activeToolId === "shape" && (
              <VariantFlyout
                label="نوعِ شکل"
                variants={SHAPE_VARIANTS}
                current={shapeKind}
                onPick={pickShape}
              />
            )}
            {activeToolId === "connector" && (
              <VariantFlyout
                label="نوعِ کانکتور"
                variants={CONNECTOR_VARIANTS}
                current={connectorKind}
                onPick={pickConnector}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              hidden
              onChange={(event) => void onImageFilePicked(event)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function connectionLabel(state: ConnectionState | null): string {
  if (!state) return "…";
  switch (state.status) {
    case "connecting":
      return "در حال اتصال…";
    case "connected":
      return state.peers > 0 ? `متصل · ${String(state.peers)} همکار` : "متصل";
    case "reconnecting":
      return "اتصالِ مجدد…";
    case "offline":
      return "آفلاین";
    case "error":
      return "خطا در اتصال";
  }
}

function saveLabel(state: SaveState | null): string {
  if (!state) return "";
  switch (state.status) {
    case "saved":
      return "ذخیره شد";
    case "saving":
      return "در حال ذخیره…";
    case "unsaved":
      return "ذخیره‌نشده";
  }
}

/** یک متنِ کوتاهِ وضعیت برای خوشه‌ی جمع‌وجور: مشکلِ اتصال مهم‌تر است، وگرنه وضعیتِ ذخیره. */
function statusText(conn: ConnectionState | null, save: SaveState | null): string {
  if (conn && conn.status !== "connected") return connectionLabel(conn);
  const label = saveLabel(save);
  return label.length > 0 ? label : connectionLabel(conn);
}

/** رنگِ نقطه‌ی وضعیت (سلامتِ اتصال در یک نگاه) — رنگ‌های معناییِ سازگار با روشن/تیره. */
function connDotColor(conn: ConnectionState | null): string {
  if (!conn) return "#9aa1ad";
  switch (conn.status) {
    case "connected":
      return "#3fb950";
    case "connecting":
    case "reconnecting":
      return "#d29922";
    case "offline":
    case "error":
      return "#d14343";
  }
}
