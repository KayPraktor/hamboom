import {
  commitGesture,
  createSticky,
  HamboomCanvas,
  toExcalidraw,
  type HamboomCanvasProps,
} from "@hamboom/canvas-core";
import type { ConnectionState, SaveState } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import { createBoardDoc, getSchemaVersion, readDocument } from "@hamboom/ydoc-schema";
import { useEffect, useRef, useState } from "react";

import { YjsSyncAdapter } from "../src/adapter";
import { createCanvasBinding } from "../src/canvas-binding";
import { createIndexeddbDocStore } from "../src/local-store";
import { createWebSocketTransport } from "../src/websocket-transport";

/**
 * دموی **آفلاین** — گام ۵٫۲.
 *
 * یک بومِ واقعی، ترابریِ WebSocketِ واقعی، و پایداریِ محلیِ واقعی. تنها صفحه‌ای
 * که ادعای «کار از بستنِ تب هم جان به در می‌برد» را می‌شود رویش آزمود: IndexedDB
 * **فقط** در مرورگر وجود دارد، پس نه تستِ واحد به آن می‌رسد و نه سنجه‌ی Nodeی.
 *
 * پارامترها در هش می‌آیند تا E2E بتواند چند نقش بسازد:
 * `#offline?board=<id>&client=<name>&local=0|1&ws=<port>&token=<port>`
 *
 * ★ `local=0` یعنی **بدونِ** انبارِ محلی. تستِ پذیرش به آن نیاز دارد: کلاینتِ دوم
 * باید چیزی را ببیند که از **سرور** آمده، نه از IndexedDBِ مشترکِ همان مرورگر.
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
  const [ready, setReady] = useState(false);
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
      </header>
      <div className="pane-canvas">
        <HamboomCanvas onReady={setApi} />
      </div>
    </main>
  );
}
