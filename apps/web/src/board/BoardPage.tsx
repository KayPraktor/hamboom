import {
  createDrawTool,
  createImageTool,
  createStickyTool,
  type DrawStrokeOutbound,
  type DrawTool,
  fromExcalidraw,
  HamboomCanvas,
  type HamboomCanvasProps,
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
import { Link, useParams } from "@tanstack/react-router";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";

import { api } from "../api/client.ts";
import { errorMessage } from "../api/error-message.ts";
import { useSession } from "../auth/session-context.ts";
import { createGestureTracker } from "./gesture-tracker.ts";
import { colorForId } from "./presence-color.ts";

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

  // مکان‌نمای محلی → همتاها. موتور `onPointerUpdate` را در مختصاتِ **صحنه** می‌دهد
  // (بی‌تبدیل، یافته‌ی ۳)؛ throttleِ ۴۰ms را خودِ آداپتور می‌زند (`HB_THROTTLE`).
  const handlePointerUpdate = useCallback((pointer: { x: number; y: number }) => {
    outboundRef.current?.emitPointer({ x: pointer.x, y: pointer.y, visible: true });
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
        engine.setActiveTool({ type: "rectangle" });
        break;
      case "connector":
        engine.setActiveTool({ type: "arrow" });
        break;
      case "frame":
        engine.setActiveTool({ type: "frame" });
        break;
      case "eraser":
        engine.setActiveTool({ type: "eraser" });
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

  // نما را از `onScrollChange` نگه می‌داریم (مقدارِ اولیه از getAppState، بعد زنده).
  useEffect(() => {
    if (!canvasApi) return;
    const initial = canvasApi.getAppState();
    setViewport({ scrollX: initial.scrollX, scrollY: initial.scrollY, zoom: initial.zoom.value });
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

    // رندرِ استروکِ قلمِ در حالِ کشیدن روی لایه‌ی روکش (ADR-022: هیچ‌چیزِ در حالِ
    // شکل‌گیری وارد سند نمی‌شود). پروجکشنِ **مشترکِ** `sceneToOverlayPixel` — صفر
    // تکرارِ فرمولِ صحنه→پیکسل (ADR-024). `viewportRef` تا نمای معتبر (نه کهنه) بخوانَد.
    const renderStroke = (points: StrokePoint[] | null): void => {
      const overlay = overlayRef.current;
      const host = paneRef.current;
      const ctx = overlay?.getContext("2d");
      if (!overlay || !host || !ctx) return;
      if (overlay.width !== overlay.clientWidth || overlay.height !== overlay.clientHeight) {
        overlay.width = overlay.clientWidth;
        overlay.height = overlay.clientHeight;
      }
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (!points || points.length < 2) return;
      const state = canvasApi.getAppState();
      const rect = host.getBoundingClientRect();
      ctx.beginPath();
      points.forEach((point, index) => {
        const px = sceneToOverlayPixel(
          { x: point[0], y: point[1] },
          viewportRef.current,
          { offsetLeft: state.offsetLeft, offsetTop: state.offsetTop },
          { left: rect.left, top: rect.top },
        );
        if (index === 0) ctx.moveTo(px.x, px.y);
        else ctx.lineTo(px.x, px.y);
      });
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    };

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
        if (paneRef.current && adapter.undo) {
          unbindUndo = bindUndoShortcuts(paneRef.current, adapter.undo);
        }

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
          onLocalStroke: renderStroke,
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
      offChange();
      unbindUndo?.();
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

  return (
    <div className="board-shell">
      <div className="board-topbar">
        <Link to="/dashboard" className="back-link">
          ← داشبورد
        </Link>
        <span className="board-title">{board.data?.title ?? "بوم"}</span>
        <div className="board-status">
          {readOnly && <span className="role-badge">فقط‌خواندنی</span>}
          <span className="board-status__save">{saveLabel(save)}</span>
          <span className="board-status__conn">{connectionLabel(connection)}</span>
        </div>
      </div>
      {notice !== null && (
        <div className="board-notice" role="status">
          {notice}
        </div>
      )}
      <div className="board-canvas" ref={paneRef}>
        <HamboomCanvas
          onReady={setCanvasApi}
          viewModeEnabled={readOnly}
          onPointerUpdate={handlePointerUpdate}
        />
        {/* روکشِ استروکِ قلمِ محلی — pointer-events:none، پس کلیک به بوم می‌رسد. */}
        <canvas ref={overlayRef} className="board-draw-overlay" />
        {/* لایه‌ی روکشِ مکان‌نمای همتاها — pointer-events:none. */}
        <PeerCursors peers={peers} project={projectPeer} />
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
