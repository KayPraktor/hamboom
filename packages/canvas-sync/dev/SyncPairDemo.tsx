import {
  bumpVersion,
  commitGesture,
  createImageTool,
  createSticky,
  HamboomCanvas,
  toExcalidraw,
  type HamboomCanvasProps,
  type ImageTool,
} from "@hamboom/canvas-core";
import type { CanvasOutbound, PeerState } from "@hamboom/canvas-core/sync";
import type { HbAsset, HbElement } from "@hamboom/shared-types";
import { readDocument } from "@hamboom/ydoc-schema";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";

import { createLocalAssetTransport, LocalAssetStore } from "../src/assets";
import { createCanvasBinding } from "../src/canvas-binding";
import { LocalTransport, LocalTransportHub } from "../src/transport";
import { bindUndoShortcuts } from "../src/undo";
import { YjsSyncAdapter } from "../src/adapter";

/**
 * دموی **دو-نمونه‌ای** — دو بومِ واقعی روی یک hub، بدونِ سرور.
 *
 * ── چرا این صفحه لازم است ─────────────────────────────────────────────
 *
 * ادعای گام ۳٫۲ («`Ctrl+Z` کارِ همتا را برنمی‌گرداند») **در jsdom قابلِ آزمودن
 * نیست** — تاریخچه‌ی undo مالِ خودِ موتور است و در jsdom اصلاً وجود ندارد. پس
 * یک مرورگرِ واقعی لازم است، و برای مرورگر یک صفحه.
 *
 * ★ **زیرِ `<StrictMode>` اجرا می‌شود** (از `main.tsx`) — عمداً: الگوی
 * [ADR-032](../../../ARCHITECTURE_DECISIONS.md#adr-032) اینجا برای اولین بار با
 * آداپتورِ واقعی به کار می‌رود. اشتراک در `useEffect([api])` با cleanup، **نه**
 * در callbackِ `onReady`.
 *
 * گام ۳٫۷ همین صفحه را با حضور (مکان‌نما/انتخاب/follow) کامل می‌کند — G-1الف.
 */

type CanvasApi = Parameters<NonNullable<HamboomCanvasProps["onReady"]>>[0];

declare global {
  interface Window {
    /** برای تستِ E2E — بدونِ این باید با پیکسل کار می‌کردیم. */
    __hbPair?: Record<
      string,
      | {
          api: CanvasApi;
          outbound: CanvasOutbound;
          doc: Y.Doc;
          /** یک ژستِ محلی: هم روی صحنه‌ی خودش، هم emit — همان کاری که ابزار می‌کند. */
          commitLocal: (elements: HbElement[]) => void;
          /** آخرین چیزی که از `applyPeers` رسیده — گام ۳٫۵. */
          peers: () => PeerState[];
          /** اندازه‌ی سند — ادعای «ephemeral سند را بزرگ نمی‌کند». */
          docBytes: () => number;
          /** درجِ یک تصویر از راهِ ابزارِ **واقعیِ** M1 — گام ۳٫۶. */
          ingestImage: (file: File) => Promise<HbElement | null>;
          /** متادیتای داراییِ سند — برای ادعای «باینری اینجا نیست». */
          assets: () => HbAsset[];
          /** فایل‌هایی که موتور می‌شناسد — بدونشان تصویر یک قابِ خالی است. */
          engineFiles: () => string[];
        }
      | undefined
    >;
  }
}

/** یک hub برای کلِ صفحه — جای سرور. */
const hub = new LocalTransportHub();

/**
 * ★ یک انبارِ **مشترک** — جای Object Storage.
 *
 * ⚠️ اشتراکش لازم است، نه تشریفاتی: بدونِ آن پنلِ ب یک `fileId` می‌گیرد که هیچ
 * جا سراغش را ندارد و تصویر یک قابِ خالی می‌مانَد. در تولید، سرور این نقش را
 * دارد ([`assets.ts`](../src/assets.ts)).
 */
const assetStore = new LocalAssetStore();

let nextAuthor = 0;
let nextGesture = 0;

/** هر ژست شناسه‌ی یکتای خودش را می‌گیرد — همان کاری که ابزارِ محصولی می‌کند. */
const newGestureId = (): string => `g_${++nextGesture}`;

interface PaneProps {
  name: string;
  label: string;
}

function Pane({ name, label }: PaneProps) {
  const [api, setApi] = useState<CanvasApi | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("—");
  const [peerCount, setPeerCount] = useState(0);
  const paneRef = useRef<HTMLElement | null>(null);
  /**
   * ★ آخرین `PeerState[]` — عمداً در `ref` و نه `state`.
   *
   * `applyPeers` روی هر تکانِ مکان‌نما (۴۰ms) می‌آید؛ گذاشتنش در stateِ ری‌اکت
   * یعنی ۲۵ رندر در ثانیه برای صفحه‌ای که فقط دارد آن را ثبت می‌کند. **رندرِ**
   * حضور کارِ گام ۳٫۷ است، نه اینجا.
   */
  const peersRef = useRef<PeerState[]>([]);

  useEffect(() => {
    if (!api) return;

    // ★★ الگوی ADR-032: آداپتور و اشتراکش **داخلِ افکت** ساخته می‌شوند و
    //    cleanup برمی‌گردد. زیر StrictMode این چرخه‌ی mount→cleanup→mount را
    //    می‌سازد که آداپتور باید تاب بیاورد (نگهبانِ نسل در `connect`).
    const assets = createLocalAssetTransport(assetStore, { uploadedBy: `u_${name}` });
    const adapter = new YjsSyncAdapter({
      transport: new LocalTransport(hub),
      assets,
      user: {
        id: `u_${name}`,
        displayName: label,
        color: name === "a" ? "#5B8DEF" : "#D0C6F5",
        avatarUrl: null,
      },
    });
    let cancelled = false;
    let unbindUndo: (() => void) | null = null;
    let imageTool: ImageTool | null = null;

    void adapter
      .connect(
        createCanvasBinding({
          api,
          // ★ همان پورت، این‌بار برای مسیرِ **ورودی**: بدونِ آن عنصرِ تصویرِ همتا
          //   روی صحنه می‌نشیند ولی موتور فایلی به آن `fileId` نمی‌شناسد.
          assets,
          onAssetError: (asset) =>
            api.setToast({ message: `دارایی بارگذاری نشد: ${asset.fileId}`, duration: 4000 }),
          ui: {
            setConnectionState: (state) => setStatus(state.status),
            applyPeers: (peers) => {
              peersRef.current = peers;
              setPeerCount(peers.length);
            },
          },
        }),
      )
      .then((outbound) => {
        if (cancelled) return;
        // ★★ `Ctrl+Z` باید به `UndoManager` برسد، نه به تاریخچه‌ی موتور
        //    ([ADR-035](../../../ARCHITECTURE_DECISIONS.md#adr-035)). در فازِ
        //    capture روی خودِ پنل بسته می‌شود تا قبل از listenerهای موتور اجرا شود.
        if (paneRef.current && adapter.undo) {
          unbindUndo = bindUndoShortcuts(paneRef.current, adapter.undo);
        }
        const commitLocal = (elements: HbElement[]): void => {
          // ⚠️ `bumpVersion` لازم است، نه تشریفاتی: بدونش موتور عنصر را
          //    «بدونِ تغییر» می‌بیند و **ورودیِ undo نمی‌سازد** — تله‌ی ثبت‌شده‌ی M1.
          //    یک بار در گام ۳٫۴ نزدیک بود همین را به‌عنوان «undoِ موتور خراب است»
          //    گزارش کنم.
          const bumped = elements.map((element) => bumpVersion(element));
          const merged = new Map(
            api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]),
          );
          for (const element of bumped) merged.set(element.id, toExcalidraw(element) as never);
          commitGesture(api, [...merged.values()]);
          outbound.emitElementChanges({
            upserted: bumped,
            deleted: [],
            origin: "local-user",
            gestureId: newGestureId(),
          });
        };
        // ★★ ابزارِ **واقعیِ** تصویرِ M1 — گام ۳٫۶.
        //
        // ⚠️ `root` روی خودِ پنل است نه `document`: با پیش‌فرضِ `document`، یک
        //    drop یا paste به **هر دو** ابزار می‌رسید و تصویر دوبار درج می‌شد.
        //
        // ★ فقط **یک** emit، آن هم در انتها: `onInserted` بعد از رسیدنِ عنصر به
        //   «saved» صدا زده می‌شود، پس Yjs یک ورودیِ undo می‌گیرد و یک `Ctrl+Z`
        //   کلِ تصویر را برمی‌دارد — نه اینکه فقط به «pending» برگرداندش.
        imageTool = createImageTool({
          api,
          outbound,
          authorId: `u_${name}`,
          root: paneRef.current ?? undefined,
          onError: (message) => api.setToast({ message, duration: 4000 }),
          onInserted: (element) => {
            outbound.emitElementChanges({
              upserted: [element],
              deleted: [],
              origin: "local-user",
              gestureId: newGestureId(),
            });
          },
        });

        window.__hbPair = {
          ...window.__hbPair,
          [name]: {
            api,
            outbound,
            doc: adapter.document,
            commitLocal,
            peers: () => peersRef.current,
            docBytes: () => Y.encodeStateAsUpdate(adapter.document).byteLength,
            ingestImage: (file) => imageTool!.ingestFile(file),
            assets: () => readDocument(adapter.document).assets,
            engineFiles: () => Object.keys(api.getFiles() ?? {}),
          },
        };
        setReady(true);
      })
      .catch(() => {
        // `ConnectionCancelledError` زیر StrictMode طبیعی است — همین که
        // cleanup زودتر رسیده یعنی این اتصال دیگر مالِ ما نیست.
      });

    return () => {
      cancelled = true;
      unbindUndo?.();
      imageTool?.destroy();
      // ⚠️ `assetStore.dispose()` اینجا **نیست**: انبار مشترک است و آزادکردنش
      //    تصویر را روی پنلِ همتا هم سفید می‌کرد.
      adapter.disconnect();
      setReady(false);
      window.__hbPair = { ...window.__hbPair, [name]: undefined };
    };
  }, [api, name, label]);

  /**
   * ساختِ استیکی — دقیقاً کاری که ابزارِ محصولی می‌کند: **هم** روی صحنه‌ی خودش
   * می‌نویسد (`commitGesture` → یک ورودی undo) **و هم** emit می‌کند.
   */
  const addSticky = () => {
    const pair = window.__hbPair?.[name];
    if (!api || !pair) return;

    const author = `u_${name}`;
    const sticky = createSticky({
      x: 60 + nextAuthor * 30,
      y: 60 + nextAuthor * 30,
      authorId: author,
      text: `${label} #${++nextAuthor}`,
    });
    const elements = [sticky.container, sticky.text];

    commitGesture(api, [
      ...api.getSceneElementsIncludingDeleted(),
      ...elements.map((element) => toExcalidraw(element)),
    ]);
    pair.outbound.emitElementChanges({
      upserted: elements,
      deleted: [],
      origin: "local-user",
      gestureId: newGestureId(),
    });
  };

  return (
    <section className="pane" data-pane={name} ref={paneRef}>
      <header>
        <strong>{label}</strong>
        <button type="button" data-action="add" onClick={addSticky} disabled={!ready}>
          افزودن استیکی
        </button>
        <span data-role="status">{status}</span>
        <span data-role="count">{api ? api.getSceneElements().length : 0}</span>
        <span data-role="peers">{peerCount}</span>
      </header>
      <div className="canvas">
        <HamboomCanvas onReady={setApi} />
      </div>
    </section>
  );
}

export function SyncPairDemo() {
  return (
    <main className="pair">
      <Pane name="a" label="کاربر الف" />
      <Pane name="b" label="کاربر ب" />
    </main>
  );
}
