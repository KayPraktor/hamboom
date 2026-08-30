import { fromExcalidraw, HamboomCanvas, type HamboomCanvasProps } from "@hamboom/canvas-core";
import type { CanvasPermissions, ConnectionState, SaveState } from "@hamboom/canvas-core/sync";
import {
  bindUndoShortcuts,
  createCanvasBinding,
  createIndexeddbDocStore,
  createWebSocketTransport,
  YjsSyncAdapter,
} from "@hamboom/canvas-sync";
import type { HbElement } from "@hamboom/shared-types";
import { createBoardDoc } from "@hamboom/ydoc-schema";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { api } from "../api/client.ts";
import { errorMessage } from "../api/error-message.ts";
import { useSession } from "../auth/session-context.ts";
import { colorForId } from "./presence-color.ts";

/** نوعِ apiِ موتور — از خودِ propِ `onReady` مشتق می‌شود (نه تعریفِ موازی). */
type CanvasApi = Parameters<NonNullable<HamboomCanvasProps["onReady"]>>[0];
type SceneElement = ReturnType<CanvasApi["getSceneElementsIncludingDeleted"]>[number];

/** نشانیِ سرورِ realtime؛ در dev پیش‌فرض ۳۰۰۱ (RT_PORT)، در production از env. */
const RT_URL = (import.meta.env.VITE_RT_URL as string | undefined) ?? "ws://127.0.0.1:3001";

/** فاصله‌ی آرام‌گرفتنِ یک ژست پیش از emit — یک درگ را به **یک** ورودیِ undo/سیم جمع می‌کند. */
const GESTURE_SETTLE_MS = 150;

export function BoardPage() {
  const { boardId } = useParams({ from: "/b/$boardId" });
  const { user } = useSession();

  // عنوان + بررسیِ دسترسی (۴۰۳/۴۰۴ اینجا معلوم می‌شود، پیش از mountِ بوم).
  const board = useQuery({ queryKey: ["board", boardId], queryFn: () => api.boards.get(boardId) });

  const [canvasApi, setCanvasApi] = useState<CanvasApi | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [save, setSave] = useState<SaveState | null>(null);
  const [permissions, setPermissions] = useState<CanvasPermissions | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);

  const readOnly = permissions?.canEdit === false;

  useEffect(() => {
    // ★ الگوی StrictMode-safe (ADR-032/ADR-028): api از onReady در **state** است و
    //   همه‌ی اشتراک‌ها اینجا در `useEffect([api])` با cleanup بسته می‌شوند.
    if (!canvasApi || !user) return;

    // ⚠️ `createBoardDoc` (نه `new Y.Doc`) — نسخه‌ی schema را مهر می‌زند مثلِ هر
    //    کلاینتِ محصولی؛ سرور این کار را نمی‌کند (F-1، گام ۴٫۶).
    const doc = createBoardDoc();
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
      onProtocolError: (error) => console.warn(`HB_ERROR ${error.code}: ${error.message}`),
      user: {
        id: user.id,
        displayName: user.displayName,
        color: colorForId(user.id),
        avatarUrl: user.avatarUrl,
      },
    });

    // ── سمتِ **محلی**: onChange → دیف → emit ────────────────────────────────
    //
    // ⚠️ چرا اینجا و نه در binder: `createCanvasBinding` فقط remote→بوم است؛
    //    گرفتنِ ویرایشِ **محلیِ** موتور و فرستادنش کارِ اپ است.
    // ★ نکته‌ی کلیدی (تله‌ی M1): `onChange` برای updateSceneِ **برنامه‌ای** (اعمالِ
    //   remote) صدا زده **نمی‌شود** — فقط برای ویرایشِ واقعیِ کاربر. پس onChange
    //   یعنی «تغییرِ محلی»، و اکو ممکن نیست. برای اطمینان، `known` روی هر اعمالِ
    //   remote هم به‌روز می‌شود (بسته‌بندیِ binding پایین) تا دیف عنصرِ همتا را
    //   دوباره emit نکند.
    const known = new Map<string, number>(); // id → excalidraw version
    let outbound: Awaited<ReturnType<typeof adapter.connect>> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let gestureSeq = 0;

    const snapshotKnown = (): void => {
      known.clear();
      for (const element of canvasApi.getSceneElementsIncludingDeleted()) {
        known.set(element.id, (element as SceneElement & { version: number }).version);
      }
    };

    const flushLocal = (): void => {
      settleTimer = null;
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
        gestureSeq += 1;
        outbound.emitElementChanges({
          upserted,
          deleted,
          origin: "local-user",
          gestureId: `g_${user.id}_${String(gestureSeq)}`,
        });
      }
    };

    const offChange = canvasApi.onChange(() => {
      // آرام‌شدنِ ژست: یک درگ چند بار onChange می‌زند؛ ۱۵۰ms بعد از آخری یک‌بار emit.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(flushLocal, GESTURE_SETTLE_MS);
    });

    // binding را می‌پیچیم تا هر اعمالِ remote، `known` را هم‌روز نگه دارد (ضدِ اکو).
    const binding = createCanvasBinding({
      api: canvasApi,
      ui: { setConnectionState: setConnection, setSaveState: setSave, setPermissions },
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

    let cancelled = false;
    let unbindUndo: (() => void) | undefined;

    void adapter
      .connect(wrappedBinding)
      .then((ob) => {
        if (cancelled) return;
        outbound = ob;
        // ★★ Ctrl+Z باید به UndoManager برسد، نه تاریخچه‌ی موتور (ADR-035، اجباری).
        if (paneRef.current && adapter.undo) {
          unbindUndo = bindUndoShortcuts(paneRef.current, adapter.undo);
        }
      })
      .catch(() => {
        // ConnectionCancelledError زیر StrictMode طبیعی است.
      });

    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      offChange();
      unbindUndo?.();
      adapter.disconnect();
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
      <div className="board-canvas" ref={paneRef}>
        <HamboomCanvas onReady={setCanvasApi} viewModeEnabled={readOnly} />
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
