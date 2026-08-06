import {
  commitGesture,
  createSticky,
  HamboomCanvas,
  toExcalidraw,
  type HamboomCanvasProps,
} from "@hamboom/canvas-core";
import type { CanvasOutbound } from "@hamboom/canvas-core/sync";
import { useEffect, useState } from "react";

import { createCanvasBinding } from "../src/canvas-binding";
import { LocalTransport, LocalTransportHub } from "../src/transport";
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
    __hbPair?: Record<string, { api: CanvasApi; outbound: CanvasOutbound } | undefined>;
  }
}

/** یک hub برای کلِ صفحه — جای سرور. */
const hub = new LocalTransportHub();

let nextAuthor = 0;

interface PaneProps {
  name: string;
  label: string;
}

function Pane({ name, label }: PaneProps) {
  const [api, setApi] = useState<CanvasApi | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("—");

  useEffect(() => {
    if (!api) return;

    // ★★ الگوی ADR-032: آداپتور و اشتراکش **داخلِ افکت** ساخته می‌شوند و
    //    cleanup برمی‌گردد. زیر StrictMode این چرخه‌ی mount→cleanup→mount را
    //    می‌سازد که آداپتور باید تاب بیاورد (نگهبانِ نسل در `connect`).
    const adapter = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
    let cancelled = false;

    void adapter
      .connect(
        createCanvasBinding({
          api,
          ui: { setConnectionState: (state) => setStatus(state.status) },
        }),
      )
      .then((outbound) => {
        if (cancelled) return;
        window.__hbPair = { ...window.__hbPair, [name]: { api, outbound } };
        setReady(true);
      })
      .catch(() => {
        // `ConnectionCancelledError` زیر StrictMode طبیعی است — همین که
        // cleanup زودتر رسیده یعنی این اتصال دیگر مالِ ما نیست.
      });

    return () => {
      cancelled = true;
      adapter.disconnect();
      setReady(false);
      window.__hbPair = { ...window.__hbPair, [name]: undefined };
    };
  }, [api, name]);

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
    pair.outbound.emitElementChanges({ upserted: elements, deleted: [], origin: "local-user" });
  };

  return (
    <section className="pane" data-pane={name}>
      <header>
        <strong>{label}</strong>
        <button type="button" data-action="add" onClick={addSticky} disabled={!ready}>
          افزودن استیکی
        </button>
        <span data-role="status">{status}</span>
        <span data-role="count">{api ? api.getSceneElements().length : 0}</span>
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
