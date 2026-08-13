import {
  commitGesture,
  createSticky,
  HamboomCanvas,
  toExcalidraw,
  type HamboomCanvasProps,
} from "@hamboom/canvas-core";
import type { CanvasPermissions, ConnectionState, SaveState } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import {
  createBoardDoc,
  getSchemaVersion,
  readDocument,
  SCHEMA_VERSION,
} from "@hamboom/ydoc-schema";
import { useEffect, useRef, useState } from "react";

import { YjsSyncAdapter } from "../src/adapter";
import { createCanvasBinding } from "../src/canvas-binding";
import { createIndexeddbDocStore } from "../src/local-store";
import { createWebSocketTransport } from "../src/websocket-transport";

/**
 * دموی **یک بوم روی سرورِ واقعی** — گام‌های ۵٫۲ و ۵٫۳.
 *
 * بومِ واقعی، ترابریِ WebSocketِ واقعی، پایداریِ محلیِ واقعی. تنها صفحه‌ای که
 * این دو ادعا را می‌شود رویش آزمود:
 *
 * - **۵٫۲** «کار از بستنِ تب هم جان به در می‌برد» — IndexedDB فقط در مرورگر
 *   وجود دارد، پس نه تستِ واحد به آن می‌رسد و نه سنجه‌ی Nodeی.
 * - **۵٫۳** «تنزلِ نقش بوم را فقط-خواندنی می‌کند» — `viewModeEnabled` را باید
 *   خودِ موتور اعمال کند؛ در jsdom چیزی برای دیدن نیست.
 *
 * پارامترها در هش می‌آیند تا E2E بتواند چند نقش بسازد:
 * `#offline?board=<id>&client=<name>&local=0|1&ws=<port>&token=<port>&schema=<n>`
 *
 * ★ `local=0` یعنی **بدونِ** انبارِ محلی. تستِ پذیرشِ ۵٫۲ به آن نیاز دارد: کلاینتِ
 * دوم باید چیزی را ببیند که از **سرور** آمده، نه از IndexedDBِ مشترکِ همان مرورگر.
 * ★ `schema=<n>` یک کلاینتِ **عقب‌تر** می‌سازد — ورودیِ تستِ پذیرشِ ۵٫۳.
 */

type CanvasApi = Parameters<NonNullable<HamboomCanvasProps["onReady"]>>[0];

declare global {
  interface Window {
    __hbOffline?: {
      addSticky: (text: string) => void;
      /** شناسه‌ی عناصرِ **سند** (نه صحنه) — منبعِ حقیقتِ همگام‌سازی. */
      docIds: () => string[];
      schemaVersion: () => number | undefined;
      connection: () => ConnectionState | null;
      save: () => SaveState | null;
      /** مجوزهای **اعلام‌شده‌ی** رابط (گام ۵٫۳). */
      permissions: () => CanvasPermissions | null;
      /** ★ حالتِ واقعیِ **موتور**، نه فقط ادعای ما. */
      viewMode: () => boolean;
      /** آخرین `HB_ERROR`ِ غیرمرگبار — مثلاً ردِ نوشتنِ یک `viewer`. */
      lastError: () => { code: string; message: string } | null;
    };
  }
}

function params(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split("?")[1] ?? "");
}

export function OfflineDemo() {
  const [api, setApi] = useState<CanvasApi | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [save, setSave] = useState<SaveState | null>(null);
  const [permissions, setPermissions] = useState<CanvasPermissions | null>(null);
  const [ready, setReady] = useState(false);
  const errorRef = useRef<{ code: string; message: string } | null>(null);
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  // ★ `window.__hbOffline` یک‌بار در افکت ساخته می‌شود، پس closureـش مقدارِ
  //   کهنه می‌گرفت. مثلِ `viewportRef` در دموی جفتی، مقدارِ زنده از ref می‌آید.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!api) return;

    const query = params();
    const board = query.get("board") ?? "board-dev";
    const client = query.get("client") ?? "a";
    const wsPort = query.get("ws") ?? "15300";
    const tokenPort = query.get("token") ?? "15301";
    const useLocal = query.get("local") !== "0";

    // ⚠️ `createBoardDoc` مثلِ هر کلاینتِ محصولی صدا زده می‌شود (نسخه‌ی schema را
    //    مهر می‌زند). سرور این کار را **نمی‌کند** — یافته‌ی F-1 در گام ۴٫۶.
    const doc = createBoardDoc();
    const localStore = useLocal
      ? // ★ نامِ پایگاه‌داده **شاملِ شناسه‌ی بورد** — وگرنه دو بورد در یک مرورگر
        //   روی هم می‌نویسند.
        createIndexeddbDocStore({ doc, name: `hamboom-${board}` })
      : undefined;

    const transport = createWebSocketTransport({
      url: `ws://127.0.0.1:${wsPort}/rt?board=${encodeURIComponent(board)}`,
      // ★★ توکن برای **هر تلاش** تازه گرفته می‌شود — همان قیدِ ADR-039، این‌بار
      //    از یک نقطه‌ی HTTPِ واقعی (شکلی که M3 باید بسازد).
      token: async () => {
        const response = await fetch(
          `http://127.0.0.1:${tokenPort}/dev-token?board=${encodeURIComponent(board)}&sub=usr_${client}`,
        );
        if (!response.ok) throw new Error(`توکن گرفته نشد: ${String(response.status)}`);
        return response.text();
      },
    });

    const adapter = new YjsSyncAdapter({
      doc,
      transport,
      localStore,
      // ★ گام ۵٫۳: با `&schema=<n>` می‌شود یک کلاینتِ **عقب‌تر** را شبیه‌سازی کرد.
      supportedSchemaVersion: query.get("schema") ? Number(query.get("schema")) : SCHEMA_VERSION,
      // ⚠️ بدونِ این، ردِ نوشتنِ یک `viewer` بی‌صدا دور ریخته می‌شود.
      onProtocolError: (error) => (errorRef.current = error),
      user: {
        id: `usr_${client}`,
        displayName: `کاربر ${client}`,
        color: client === "a" ? "#5B8DEF" : "#D0C6F5",
        avatarUrl: null,
      },
    });

    let cancelled = false;
    let counter = 0;

    void adapter
      .connect(
        createCanvasBinding({
          api,
          ui: {
            setConnectionState: setConnection,
            setSaveState: setSave,
            setPermissions,
          },
        }),
      )
      .then((outbound) => {
        if (cancelled) return;

        window.__hbOffline = {
          addSticky: (text) => {
            const sticky = createSticky({
              x: 60 + counter * 40,
              y: 60 + counter * 40,
              authorId: `usr_${client}`,
              text,
            });
            counter += 1;
            const elements: HbElement[] = [sticky.container, sticky.text];
            commitGesture(api, [
              ...api.getSceneElementsIncludingDeleted(),
              ...elements.map((element) => toExcalidraw(element)),
            ] as never);
            outbound.emitElementChanges({
              upserted: elements,
              deleted: [],
              origin: "local-user",
              gestureId: `g_${String(counter)}`,
            });
          },
          docIds: () => readDocument(adapter.document).elements.map((element) => element.id),
          schemaVersion: () => getSchemaVersion(adapter.document),
          connection: () => connectionRef.current,
          save: () => saveRef.current,
          permissions: () => permissionsRef.current,
          // ★ از خودِ موتور خوانده می‌شود، نه از stateِ ما — وگرنه فقط ادعایمان
          //   را با ادعایمان می‌سنجیدیم.
          viewMode: () => api.getAppState().viewModeEnabled === true,
          lastError: () => errorRef.current,
        };
        setReady(true);
      })
      .catch(() => {
        // `ConnectionCancelledError` زیر StrictMode طبیعی است.
      });

    return () => {
      cancelled = true;
      adapter.disconnect();
      // ⚠️ انبارِ محلی **بسته نمی‌شود**: چرخه‌ی عمرش مالِ صفحه است نه اتصال، و
      //    زیر StrictMode هر mount یک بار باز و بسته‌اش می‌کرد.
      setReady(false);
      window.__hbOffline = undefined;
    };
  }, [api]);

  return (
    <main className="pane" data-role="offline-pane">
      <header className="pane-header">
        <span>دموی آفلاین</span>
        <span data-role="connection">{connection?.status ?? "—"}</span>
        <span data-role="save">{save?.status ?? "—"}</span>
        <span data-role="ready">{ready ? "ready" : "…"}</span>
        <span data-role="can-edit">{permissions?.canEdit === false ? "readonly" : "edit"}</span>
      </header>
      <div className="pane-canvas">
        {/* ★★ گام ۵٫۳: فقط-خواندنی از **مجوز** می‌آید، نه از یک پرچمِ محلی.
            `HamboomCanvas` این prop را از M1 دارد و کامنتش هم همین را
            پیش‌بینی کرده بود: «به `CanvasPermissions.canEdit` وصل می‌شود». */}
        <HamboomCanvas onReady={setApi} viewModeEnabled={permissions?.canEdit === false} />
      </div>
    </main>
  );
}
