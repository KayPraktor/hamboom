import {
  bumpVersion,
  commitGesture,
  createImageTool,
  createSticky,
  HamboomCanvas,
  PeerAvatars,
  PeerCursors,
  PeerSelections,
  sceneToOverlayPixel,
  toExcalidraw,
  type HamboomCanvasProps,
  type ImageTool,
} from "@hamboom/canvas-core";
import type { CanvasOutbound, PeerState, Viewport } from "@hamboom/canvas-core/sync";
import type { HbAsset, HbElement } from "@hamboom/shared-types";
import { readDocument } from "@hamboom/ydoc-schema";
import { useCallback, useEffect, useRef, useState } from "react";
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
          /**
           * ورودی‌های پروجکشن — گام ۳٫۷.
           *
           * ★ تست با همین‌ها پروجکشن را **دست‌محاسبه** می‌کند و با پیکسلِ
           * واقعیِ رندرشده می‌سنجد؛ نه با خروجیِ خودِ `sceneToOverlayPixel`.
           * (همان روشی که در M1 باگِ panِ خالص را بیرون کشید.)
           */
          projection: () => {
            viewport: Viewport;
            offsetLeft: number;
            offsetTop: number;
            overlay: { left: number; top: number };
          };
          /** دنبال‌کردنِ یک همتا — همان کاری که کلیک روی آواتار می‌کند. */
          follow: (clientId: number) => void;
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
  const paneRef = useRef<HTMLElement | null>(null);
  /** هاستِ لایه‌های حضور — مبدأ پروجکشن از `getBoundingClientRect`ِ همین است. */
  const hostRef = useRef<HTMLDivElement | null>(null);
  /**
   * ★ همتاها حالا در **state** اند، نه فقط `ref`.
   *
   * ⚠️ تا گام ۳٫۶ عمداً در `ref` بودند تا ۲۵ رندر در ثانیه نسازند. حالا که
   * **رندر** می‌شوند، این استدلال دیگر برقرار نیست: کاری که کاربر می‌بیند
   * باید از state بیاید. `ref` هم می‌مانَد چون `window.__hbPair` یک‌بار در
   * افکت ساخته می‌شود و closureـش مقدارِ کهنه می‌گرفت.
   */
  const peersRef = useRef<PeerState[]>([]);
  const [peers, setPeers] = useState<PeerState[]>([]);
  const peerCount = peers.length;
  /** عناصرِ صحنه — `PeerSelections` مرزِ هر عنصر را از صحنه‌ی **محلی** می‌گیرد. */
  const [sceneElements, setSceneElements] = useState<HbElement[]>([]);
  /**
   * ★★ نمای بوم — **از `onScrollChange`، نه `getAppState()`**.
   *
   * خط قرمزِ ۴ این پکیج و درسِ Q1 در M1: `getAppState()` درست بعد از pan/zoom
   * یک فریمْ **کهنه** است، و لایه‌ای که از آن پروجکت کند روی **panِ خالص** جا
   * می‌مانَد. مقدارِ معتبر همان است که خودِ callback می‌دهد.
   */
  const [viewport, setViewport] = useState<Viewport>({ scrollX: 0, scrollY: 0, zoom: 1 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // ★ نما و صحنه — اشتراک‌ها طبق ADR-032 داخلِ افکت با cleanup.
  useEffect(() => {
    if (!api) return;
    const offScroll = api.onScrollChange((scrollX, scrollY, zoom) =>
      setViewport({ scrollX, scrollY, zoom: zoom.value }),
    );
    const offChange = api.onChange((elements) => {
      // فقط هندسه و شناسه خوانده می‌شود، پس همین شکل کافی است.
      setSceneElements(elements as unknown as HbElement[]);
    });
    return () => {
      offScroll();
      offChange();
    };
  }, [api]);

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
            applyPeers: (next) => {
              peersRef.current = next;
              setPeers(next);
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
            projection: () => {
              const state = api.getAppState();
              const rect = hostRef.current!.getBoundingClientRect();
              return {
                viewport: viewportRef.current,
                // ★ `offsetLeft/Top` با pan/zoom عوض **نمی‌شوند** (فقط با resize)،
                //   پس خواندنشان از `getAppState` بی‌خطر است — برخلافِ scroll/zoom.
                offsetLeft: state.offsetLeft,
                offsetTop: state.offsetTop,
                overlay: { left: rect.left, top: rect.top },
              };
            },
            follow: (clientId) => followRef.current?.(clientId),
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
   * ★★ نقطه‌ی صحنه → پیکسلِ لایه‌ی روکش — با تابعِ **مشترکِ** `sceneToOverlayPixel`
   * و نه یک نسخه‌ی دوم ([ADR-024](../../../ARCHITECTURE_DECISIONS.md#adr-024)).
   *
   * وابستگی به `[viewport]` است، پس با **هر** جابه‌جاییِ نما — از جمله panِ
   * خالص — لایه‌ی حضور دوباره پروجکت می‌شود (باگِ Q1 در M1).
   */
  const projectPeer = useCallback(
    (sceneX: number, sceneY: number) => {
      const host = hostRef.current;
      if (!api || !host) return { x: sceneX, y: sceneY };
      const state = api.getAppState();
      const rect = host.getBoundingClientRect();
      return sceneToOverlayPixel(
        { x: sceneX, y: sceneY },
        viewport,
        { offsetLeft: state.offsetLeft, offsetTop: state.offsetTop },
        { left: rect.left, top: rect.top },
      );
    },
    [api, viewport],
  );

  /**
   * مکان‌نمای محلی → همتاها. throttleِ ۴۰ms را خودِ آداپتور می‌زند (`HB_THROTTLE`).
   *
   * ⚠️ **گپِ ثبت‌شده‌ی سطحِ M1:** تبدیلِ پیکسل → صحنه از `@hamboom/canvas-core`
   * صادر نشده (`viewportCoordsToSceneCoords` فقط داخلِ خودِ پکیج است) و
   * `HamboomCanvas` هم `onPointerUpdate`ِ موتور را — که مختصاتِ **صحنه** می‌دهد —
   * پاس نمی‌دهد. پس اینجا فرمولِ معکوس دستی نوشته شده. **این تنها جای دمو است
   * که چنین کاری می‌کند** و ثبت شد تا M3 قبل از تکرارش تکلیفش را روشن کند.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!api || !host || !ready) return;

    const onMove = (event: PointerEvent) => {
      const state = api.getAppState();
      const zoom = viewportRef.current.zoom;
      window.__hbPair?.[name]?.outbound.emitPointer({
        x: (event.clientX - state.offsetLeft) / zoom - viewportRef.current.scrollX,
        y: (event.clientY - state.offsetTop) / zoom - viewportRef.current.scrollY,
        visible: true,
      });
    };
    const onLeave = () => {
      window.__hbPair?.[name]?.outbound.emitPointer(null);
    };

    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [api, name, ready]);

  /** انتخابِ محلی → همتاها (هاله‌ی انتخاب). */
  useEffect(() => {
    if (!api || !ready) return;
    return api.onChange((_elements, state) => {
      window.__hbPair?.[name]?.outbound.emitSelection(Object.keys(state.selectedElementIds ?? {}));
    });
  }, [api, name, ready]);

  /**
   * دنبال‌کردنِ همتا — نما را روی مکان‌نمای او وسط می‌کند.
   *
   * ⚠️ `updateScene`ِ برنامه‌ای **`onScrollChange` نمی‌دهد** (تله‌ی ثبت‌شده‌ی M1)،
   * پس `viewport` را خودمان با همان مقادیرِ محاسبه‌شده به‌روز می‌کنیم — وگرنه
   * لایه‌ی حضور با نمای قدیمی پروجکت می‌مانْد و مکان‌نمای همان کسی که دنبالش
   * می‌کنیم جا می‌مانْد.
   */
  const followPeer = useCallback(
    (clientId: number) => {
      const peer = peersRef.current.find((item) => item.clientId === clientId);
      if (!api || !peer?.pointer) return;
      const state = api.getAppState();
      const zoom = viewportRef.current.zoom;
      const scrollX = state.width / 2 / zoom - peer.pointer.x;
      const scrollY = state.height / 2 / zoom - peer.pointer.y;
      api.updateScene({ appState: { scrollX, scrollY } as never, captureUpdate: "NEVER" });
      setViewport({ scrollX, scrollY, zoom });
    },
    [api],
  );
  const followRef = useRef(followPeer);
  followRef.current = followPeer;

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
      {/* ★ هاستِ لایه‌های حضور — `position: relative` تا مبدأ پروجکشن همین باشد. */}
      <div className="canvas" ref={hostRef}>
        <HamboomCanvas onReady={setApi} />
        <PeerSelections peers={peers} elements={sceneElements} project={projectPeer} />
        <PeerCursors peers={peers} project={projectPeer} />
        <PeerAvatars peers={peers} onFollow={followPeer} />
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
