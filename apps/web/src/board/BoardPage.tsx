import {
  fromExcalidraw,
  HamboomCanvas,
  type HamboomCanvasProps,
  PeerCursors,
  sceneToOverlayPixel,
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
import type { HbElement } from "@hamboom/shared-types";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const paneRef = useRef<HTMLDivElement | null>(null);
  // outbound را در ref نگه می‌داریم تا هندلرِ مکان‌نما (سطحِ render) به آن برسد.
  const outboundRef = useRef<CanvasOutbound | null>(null);

  const readOnly = permissions?.canEdit === false;

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

  // نما را از `onScrollChange` نگه می‌داریم (مقدارِ اولیه از getAppState، بعد زنده).
  useEffect(() => {
    if (!canvasApi) return;
    const initial = canvasApi.getAppState();
    setViewport({ scrollX: initial.scrollX, scrollY: initial.scrollY, zoom: initial.zoom.value });
    return canvasApi.onScrollChange((scrollX, scrollY, zoom) =>
      setViewport({ scrollX, scrollY, zoom: zoom.value }),
    );
  }, [canvasApi]);

  useEffect(() => {
    // ★ الگوی StrictMode-safe (ADR-032/ADR-028): api از onReady در **state** است و
    //   همه‌ی اشتراک‌ها اینجا در `useEffect([api])` با cleanup بسته می‌شوند.
    if (!canvasApi || !user) return;

    // ★ §۲ handoff (ADR-047): پیام‌های پروتکلِ **کلاینت** در `canvas-sync` می‌مانند (لایه‌ی
    //   سنکِ خودشان، سرور هم فارسی می‌دهد)؛ اپ فقط **نمایششان** می‌دهد — نه console-only.
    //   `error.message` از قبل فارسیِ آماده است (سرور/`TOO_OLD_MESSAGE`).
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    const showNotice = (message: string): void => {
      setNotice(message);
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => setNotice(null), 4000);
    };

    // ★★ `Y.Doc`ِ ساده، نه `createBoardDoc` (یافته‌ی ۲ M2): مهرِ `schemaVersion` روی هر
    //    باز شدنِ تب یک opِ اضافی می‌ساخت. حالا adapter آن را **تنبل** روی اولین نوشتنِ
    //    واقعی می‌زند (فقط اگر سند بی‌نسخه باشد) — بوردِ موجود از sync نسخه دارد.
    const doc = new Y.Doc();
    const localStore = createIndexeddbDocStore({ doc, name: `hamboom-${boardId}` });

    const transport = createWebSocketTransport({
      url: `${RT_URL}/rt?board=${encodeURIComponent(boardId)}`,
      // ★★ توکن برای **هر تلاش** تازه از api (ADR-039) — با کَش، بازگشت بعد از
      //    قطعیِ طولانی TOKEN_EXPIRED می‌گیرد.
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

    // ── سمتِ **محلی**: onChange → دیف → emitِ زنده ──────────────────────────
    //
    // ⚠️ چرا اینجا و نه در binder: `createCanvasBinding` فقط remote→بوم است؛
    //    گرفتنِ ویرایشِ **محلیِ** موتور و فرستادنش کارِ اپ است.
    // ★ نکته‌ی کلیدی (تله‌ی M1): `onChange` برای updateSceneِ **برنامه‌ای** (اعمالِ
    //   remote) صدا زده **نمی‌شود** — فقط برای ویرایشِ واقعیِ کاربر. پس onChange
    //   یعنی «تغییرِ محلی»، و اکو ممکن نیست. برای اطمینان، `known` روی هر اعمالِ
    //   remote هم به‌روز می‌شود (بسته‌بندیِ binding پایین) تا دیف عنصرِ همتا را
    //   دوباره emit نکند.
    //
    // ★★ **emitِ زنده (نه پس از settle):** هر onChangeِ محلی روی یک microtask دیف و emit
    //    می‌شود — throttleِ واقعی کارِ `createEmitScheduler`ِ canvas-sync است (۵۰ms
    //    درگ / فوریِ ساخت‌وحذف / ۱۵۰ms متن). اگر اپ اینجا هم debounce کند، scheduler
    //    حالت‌های میان‌درگ را **هرگز نمی‌بیند** و همتا فقط پس از drop تکان را می‌بیند.
    //    ⚠️ **`queueMicrotask` نه `requestAnimationFrame`:** rAF در تبِ **پس‌زمینه**
    //    متوقف می‌شود، پس ویرایشِ یک تبِ پنهان تا نمایان‌شدن emit نمی‌شد (سنجیده شد:
    //    درگ در تبِ پس‌زمینه فقط ۱ update می‌ساخت، نه ~۲۰). microtask همیشه اجرا می‌شود و
    //    باز هم رگبارِ یک تسک را به یک دیف جمع می‌کند؛ `gestureId` از `gestures` می‌آید تا
    //    کلِ یک درگ **یک** ورودیِ undo بماند (scheduler با همان id گروه می‌کند).
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

    const offChange = canvasApi.onChange(() => {
      // coalesceِ یک‌تسکی: چند onChange در یک تسک → یک دیف. scheduler خودش throttle می‌کند.
      if (flushScheduled) return;
      flushScheduled = true;
      queueMicrotask(() => {
        flushScheduled = false;
        if (!cancelled) flushLocal();
      });
    });

    // binding را می‌پیچیم تا هر اعمالِ remote، `known` را هم‌روز نگه دارد (ضدِ اکو).
    const binding = createCanvasBinding({
      api: canvasApi,
      // ★ `applyPeers` (یافته‌ی ۳): حضورِ همتاها → state تا `PeerCursors` رندرشان کند.
      ui: { setConnectionState: setConnection, setSaveState: setSave, setPermissions, applyPeers: setPeers },
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
        outboundRef.current = ob; // هندلرِ مکان‌نما (سطحِ render) از این می‌خوانَد.
        // ★★ Ctrl+Z باید به UndoManager برسد، نه تاریخچه‌ی موتور (ADR-035، اجباری).
        if (paneRef.current && adapter.undo) {
          unbindUndo = bindUndoShortcuts(paneRef.current, adapter.undo);
        }
      })
      .catch(() => {
        // ConnectionCancelledError زیر StrictMode طبیعی است.
      });

    return () => {
      cancelled = true; // microtaskِ در صف اگر بعد از این اجرا شود، flushLocal را رد می‌کند
      if (noticeTimer) clearTimeout(noticeTimer);
      offChange();
      unbindUndo?.();
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
        {/* لایه‌ی روکشِ مکان‌نمای همتاها — pointer-events:none، پس کلیک به بوم می‌رسد. */}
        <PeerCursors peers={peers} project={projectPeer} />
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
