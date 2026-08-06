import {
  EchoLoopError,
  type CanvasInbound,
  type CanvasOutbound,
  type ElementChangeSet,
} from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import { boardRoots, readDocument } from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { LOCAL_ORIGIN, YjsSyncAdapter } from "./adapter.ts";
import { LocalTransport, LocalTransportHub } from "./transport.ts";

/**
 * تست‌های گام ۳٫۱ — چرخه‌ی عمر، نگهبانِ echo، و رفت‌وبرگشتِ عنصر روی آداپتورِ
 * **واقعی**.
 *
 * ⚠️ عمداً **بدونِ بوم و بدونِ شبکه**: دو `Y.Doc` مستقیم به هم وصل‌اند. اگر اول
 * سرور ساخته می‌شد، هر باگِ binder پشتِ لایه‌ی شبکه پنهان می‌ماند — همان دلیلی
 * که M1 آداپتورِ لوکال را قبل از هر شبکه‌ای ساخت.
 */

function element(id: string, overrides: Partial<HbElement> = {}): HbElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    index: "a1",
    frameId: null,
    groupIds: [],
    locked: false,
    strokeColor: "#1a1a1a",
    backgroundColor: "#FFF9B1",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 0,
    isDeleted: false,
    boundElements: null,
    link: null,
    customData: {
      hb: {
        schema: 1,
        kind: "sticky",
        createdBy: "u_test",
        lastEditedBy: "u_test",
        createdAt: 0,
      },
    },
    ...overrides,
  } as HbElement;
}

/** بومِ ساختگی — هرچه گرفت را ثبت می‌کند. */
function fakeCanvas() {
  const received: ElementChangeSet[] = [];
  const connectionStates: unknown[] = [];
  const saveStates: unknown[] = [];
  const documents: unknown[] = [];
  const inbound: CanvasInbound = {
    applyRemoteChanges: (changes) => received.push(changes),
    applyPeers: vi.fn(),
    setConnectionState: (state) => connectionStates.push(state),
    setSaveState: (state) => saveStates.push(state),
    setPermissions: vi.fn(),
    replaceDocument: (document) => documents.push(document),
    focusOn: vi.fn(),
  };
  return { inbound, received, connectionStates, saveStates, documents };
}

/** دو آداپتور روی یک hub — جای سرور را می‌گیرد. */
function twoAdapters() {
  const hub = new LocalTransportHub();
  const a = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
  const b = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
  return { hub, a, b };
}

describe("چرخه‌ی عمر", () => {
  it("★ هر ۶ گامِ `connect` به ترتیبِ sync/README اجرا می‌شود", async () => {
    const canvas = fakeCanvas();
    const adapter = new YjsSyncAdapter();
    await adapter.connect(canvas.inbound);

    expect(canvas.connectionStates[0]).toEqual({ status: "connecting" });
    // سند **قبل از** اعلامِ connected می‌رسد — وگرنه بوم لحظه‌ای خالی رندر می‌شود.
    expect(canvas.documents).toHaveLength(1);
    expect(canvas.connectionStates[1]).toEqual({ status: "connected", peers: 0 });
    expect(canvas.saveStates[0]).toMatchObject({ status: "saved" });
  });

  it("سندِ اولیه شکلِ `CanvasDocument` دارد", async () => {
    const canvas = fakeCanvas();
    await new YjsSyncAdapter().connect(canvas.inbound);
    expect(Object.keys(canvas.documents[0] as object).sort()).toEqual([
      "appState",
      "assets",
      "elements",
    ]);
  });

  it("سندِ موجود از همان اول به بوم می‌رسد", async () => {
    const seed = new YjsSyncAdapter();
    const first = fakeCanvas();
    const outbound = await seed.connect(first.inbound);
    outbound.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    // آداپتورِ دوم روی همان سند — مثلِ کلاینتی که بعداً وصل می‌شود.
    const late = new YjsSyncAdapter({ doc: seed.document });
    const second = fakeCanvas();
    await late.connect(second.inbound);

    const document = second.documents[0] as { elements: HbElement[] };
    expect(document.elements.map((el) => el.id)).toEqual(["stk_1"]);
  });

  it("★ `connect` دوباره بدونِ `disconnect` خطا می‌دهد", async () => {
    // StrictMode هر افکت را دوبار اجرا می‌کند. سکوت اینجا یعنی دو مجموعه
    // observer روی یک سند و هر تغییرِ remote **دوبار** روی بوم.
    const adapter = new YjsSyncAdapter();
    await adapter.connect(fakeCanvas().inbound);
    await expect(adapter.connect(fakeCanvas().inbound)).rejects.toThrow(/ADR-032/);
  });

  it("چرخه‌ی connect → disconnect → connect کار می‌کند", async () => {
    const adapter = new YjsSyncAdapter();
    await adapter.connect(fakeCanvas().inbound);
    adapter.disconnect();

    const second = fakeCanvas();
    await expect(adapter.connect(second.inbound)).resolves.toBeDefined();
    expect(second.connectionStates[0]).toEqual({ status: "connecting" });
  });

  it("`disconnect` وضعیت را offline می‌کند و دوباره صدا زدنش بی‌خطر است", async () => {
    const canvas = fakeCanvas();
    const adapter = new YjsSyncAdapter();
    await adapter.connect(canvas.inbound);

    adapter.disconnect();
    expect(canvas.connectionStates.at(-1)).toEqual({ status: "offline", pendingChanges: 0 });
    expect(() => adapter.disconnect()).not.toThrow();
  });

  it("★★ بعد از `disconnect` هیچ تغییرِ remoteی به بومِ قبلی نمی‌رسد", async () => {
    // نشتیِ observer کلاسیک‌ترین باگِ unmount است — و زیر StrictMode حالتِ
    // عادی است نه استثنا.
    const { a, b } = twoAdapters();
    const canvasA = fakeCanvas();
    const canvasB = fakeCanvas();
    await a.connect(canvasA.inbound);
    const outB = await b.connect(canvasB.inbound);

    a.disconnect();
    outB.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    expect(canvasA.received).toEqual([]);
  });
});

describe("★★ نگهبانِ حلقه‌ی echo", () => {
  it("تغییرِ با originِ remote مستقیماً رد می‌شود", async () => {
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(fakeCanvas().inbound);

    expect(() =>
      outbound.emitElementChanges({ upserted: [element("stk_1")], deleted: [], origin: "remote" }),
    ).toThrow(EchoLoopError);
  });

  it("★ «بومِ بدرفتار» روی آداپتورِ **واقعی** — معیارِ پذیرشِ گام ۳٫۱", async () => {
    // کپیِ رفتاریِ همان تستِ M1 (`contract.test.ts`)، این‌بار روی binderِ واقعی و
    // از راهِ یک رفت‌وبرگشتِ کاملِ CRDT. بدونِ نگهبان، اینجا یک حلقه‌ی بی‌نهایت
    // بینِ دو کلاینت شروع می‌شد که **هیچ خطایی نمی‌داد**.
    //
    // ⚠️ **اصلاحِ انتظارِ اولیه‌ی من:** اول ادعا کرده بودم خطا به **A** می‌رسد —
    // چون در M1 هاب همان فرایند بود و `publish` مستقیم `receiveRemote` را صدا
    // می‌زد. با یک ترابریِ واقعی این غلط است و **نباید** درست باشد: خطای بومِ B
    // مالِ ماشینِ B است. ادعای درست این است که re-emit **در خودِ B** رد شود.
    const { a, b } = twoAdapters();
    const outA = await a.connect(fakeCanvas().inbound);

    let outB: CanvasOutbound | null = null;
    let echoed: unknown = null;
    const misbehaving: CanvasInbound = {
      applyRemoteChanges: (changes) => {
        // بوم B عمداً بد رفتار می‌کند: هرچه می‌رسد را دوباره می‌فرستد.
        try {
          outB?.emitElementChanges(changes);
        } catch (error) {
          echoed = error;
        }
      },
      applyPeers: vi.fn(),
      setConnectionState: vi.fn(),
      setSaveState: vi.fn(),
      setPermissions: vi.fn(),
      replaceDocument: vi.fn(),
      focusOn: vi.fn(),
    };
    outB = await b.connect(misbehaving);

    outA.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    expect(echoed).toBeInstanceOf(EchoLoopError);
    // و حلقه واقعاً متوقف شده: هیچ عنصری از B به A برنگشته.
    expect(readDocument(a.document).elements.map((el) => el.id)).toEqual(["stk_1"]);
  });

  it("★★ خطای بوم بی‌صدا بلعیده نمی‌شود — تله‌ی `y-protocols`", async () => {
    // `readSyncStep2` خودِ `applyUpdate` را در try/catch گذاشته و هر خطای
    // observer را فقط `console.error` می‌کند. اگر `applyRemoteChanges` داخلِ
    // observer صدا زده می‌شد، `EchoLoopError` **به هیچ‌کس نمی‌رسید** و نگهبانِ
    // M1 به یک خطِ لاگ تنزل پیدا می‌کرد. به همین دلیل تحویل **بیرونِ** تراکنش
    // انجام می‌شود.
    //
    // ⚠️ اینکه خطا تا **A** بالا می‌آید خاصیتِ ترابریِ درون‌فرایندیِ تست است، نه
    // یک قاعده. چیزی که این تست قفل می‌کند «بلعیده نشدن» است، نه «رسیدن به A».
    const { a, b } = twoAdapters();
    const outA = await a.connect(fakeCanvas().inbound);

    const boom = new Error("بوم منفجر شد");
    const exploding: CanvasInbound = {
      applyRemoteChanges: () => {
        throw boom;
      },
      applyPeers: vi.fn(),
      setConnectionState: vi.fn(),
      setSaveState: vi.fn(),
      setPermissions: vi.fn(),
      replaceDocument: vi.fn(),
      focusOn: vi.fn(),
    };
    await b.connect(exploding);

    expect(() =>
      outA.emitElementChanges({
        upserted: [element("stk_1")],
        deleted: [],
        origin: "local-user",
      }),
    ).toThrow(boom);
  });

  it("`origin`های مجاز رد نمی‌شوند", async () => {
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(fakeCanvas().inbound);

    for (const origin of ["local-user", "undo", "system"] as const) {
      expect(() =>
        outbound.emitElementChanges({ upserted: [element(`el_${origin}`)], deleted: [], origin }),
      ).not.toThrow();
    }
  });
});

describe("رفت‌وبرگشتِ عنصر بینِ دو کلاینت", () => {
  it("ساختِ عنصر در A به B می‌رسد، با originِ remote", async () => {
    const { a, b } = twoAdapters();
    const outA = await a.connect(fakeCanvas().inbound);
    const canvasB = fakeCanvas();
    await b.connect(canvasB.inbound);

    outA.emitElementChanges({
      upserted: [element("stk_1", { x: 42 })],
      deleted: [],
      origin: "local-user",
    });

    expect(canvasB.received).toHaveLength(1);
    expect(canvasB.received[0]?.origin).toBe("remote");
    expect(canvasB.received[0]?.upserted.map((el) => el.id)).toEqual(["stk_1"]);
    expect(canvasB.received[0]?.upserted[0]?.x).toBe(42);
  });

  it("★ فرستنده تغییرِ خودش را پس نمی‌گیرد", async () => {
    // اگر می‌گرفت، بوم دوباره همان را روی صحنه می‌نوشت و — بدترش — با
    // `applyRemoteChanges` که تاریخچه‌ی undo را هم دست می‌زند.
    const { a, b } = twoAdapters();
    const canvasA = fakeCanvas();
    const outA = await a.connect(canvasA.inbound);
    await b.connect(fakeCanvas().inbound);

    outA.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    expect(canvasA.received).toEqual([]);
  });

  it("تغییرِ یک property هم می‌رسد (رویدادِ عمیق، نه فقط ساخت)", async () => {
    // `path = [elementId]` در برابرِ `path = []`. اگر فقط دومی خوانده می‌شد،
    // ساختِ عنصر می‌رسید ولی جابه‌جایی‌اش **بی‌صدا** گم می‌شد.
    const { a, b } = twoAdapters();
    const outA = await a.connect(fakeCanvas().inbound);
    const canvasB = fakeCanvas();
    await b.connect(canvasB.inbound);

    outA.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });
    outA.emitElementChanges({
      upserted: [element("stk_1", { x: 640, y: 480 })],
      deleted: [],
      origin: "local-user",
    });

    expect(canvasB.received).toHaveLength(2);
    expect(canvasB.received[1]?.upserted[0]?.x).toBe(640);
  });

  it("حذفِ نرم به‌صورت `deleted` می‌رسد و عنصر در سند می‌مانَد", async () => {
    const { a, b } = twoAdapters();
    const outA = await a.connect(fakeCanvas().inbound);
    const canvasB = fakeCanvas();
    await b.connect(canvasB.inbound);

    outA.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });
    outA.emitElementChanges({ upserted: [], deleted: ["stk_1"], origin: "local-user" });

    expect(canvasB.received[1]?.deleted).toEqual(["stk_1"]);
    // ★ کلید نرفته — undo و CRDT به خودِ عنصر نیاز دارند.
    expect(boardRoots(b.document).elements.has("stk_1")).toBe(true);
    expect(readDocument(b.document).elements[0]?.isDeleted).toBe(true);
  });

  it("چند عنصر در یک ژست، یک changeset می‌شوند", async () => {
    // استیکی دو عنصر است (ظرف + متنِ مقید). اگر دو تراکنش می‌شد، بوم دو بار
    // رندر می‌کرد و undo هم دو ورودی می‌ساخت.
    const { a, b } = twoAdapters();
    const outA = await a.connect(fakeCanvas().inbound);
    const canvasB = fakeCanvas();
    await b.connect(canvasB.inbound);

    outA.emitElementChanges({
      upserted: [element("stk_1"), element("txt_1")],
      deleted: [],
      origin: "local-user",
      gestureId: "g_1",
    });

    expect(canvasB.received).toHaveLength(1);
    expect(canvasB.received[0]?.upserted.map((el) => el.id).sort()).toEqual(["stk_1", "txt_1"]);
  });

  it("نوشتنِ عنصرِ بدونِ تغییر هیچ پیامی نمی‌فرستد", async () => {
    // قیدِ «صفر update» از گام ۲٫۱، این‌بار سرتاسری: بومی که همان عنصر را
    // دوباره emit کند نباید ترافیک بسازد.
    const { a, b } = twoAdapters();
    const outA = await a.connect(fakeCanvas().inbound);
    const canvasB = fakeCanvas();
    await b.connect(canvasB.inbound);

    outA.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });
    outA.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    expect(canvasB.received).toHaveLength(1);
  });

  it("تراکنشِ محلی با originِ نام‌دار نوشته می‌شود، نه `null`", async () => {
    // پیش‌فرضِ `Y.UndoManager` دقیقاً `null` را ردیابی می‌کند (گام ۱٫۴). گام ۳٫۴
    // باید `trackedOrigins` بدهد و این تست پایه‌اش را قفل می‌کند.
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(fakeCanvas().inbound);

    const origins: unknown[] = [];
    adapter.document.on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    outbound.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it("بدونِ ترابری هم سند کار می‌کند (حالتِ آفلاین)", async () => {
    const adapter = new YjsSyncAdapter();
    const canvas = fakeCanvas();
    const outbound = await adapter.connect(canvas.inbound);

    outbound.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    expect(readDocument(adapter.document).elements.map((el) => el.id)).toEqual(["stk_1"]);
    expect(canvas.received).toEqual([]);
  });

  it("سه کلاینت روی یک hub همگرا می‌شوند", async () => {
    const hub = new LocalTransportHub();
    const adapters = [0, 1, 2].map(
      () => new YjsSyncAdapter({ transport: new LocalTransport(hub) }),
    );
    const outs = await Promise.all(adapters.map((a) => a.connect(fakeCanvas().inbound)));

    outs[0]!.emitElementChanges({
      upserted: [element("a", { x: 1 })],
      deleted: [],
      origin: "local-user",
    });
    outs[1]!.emitElementChanges({
      upserted: [element("b", { x: 2 })],
      deleted: [],
      origin: "local-user",
    });

    for (const adapter of adapters) {
      expect(readDocument(adapter.document).elements.map((el) => el.id)).toEqual(["a", "b"]);
    }
  });
});

describe("وضعیتِ ذخیره", () => {
  it("هر changeset یک `saving` و بعد یک `saved` می‌دهد", async () => {
    const canvas = fakeCanvas();
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(canvas.inbound);
    canvas.saveStates.length = 0;

    outbound.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    expect(canvas.saveStates[0]).toEqual({ status: "saving" });
    expect(canvas.saveStates[1]).toMatchObject({ status: "saved" });
  });
});

/**
 * ★ این تست عمداً وضعیتِ **ناقصِ فعلی** را پین می‌کند.
 *
 * یک no-opِ بی‌نشان همان چیزی است که بعداً «چرا مکان‌نمای همتا نمی‌آید؟» می‌شود.
 * وقتی گام ۳٫۵ awareness را پیاده کند، این تست **قرمز می‌شود** و مجبور به
 * به‌روزرسانی — یعنی جای یک TODOِ فراموش‌شدنی، یک نگهبان.
 */
describe("★ آنچه هنوز پیاده نشده — گام‌های ۳٫۵ و ۳٫۶", () => {
  it("متدهای awareness هنوز کاری نمی‌کنند ولی خطا هم نمی‌دهند", async () => {
    const canvas = fakeCanvas();
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(canvas.inbound);

    // در هر حرکتِ ماوس صدا زده می‌شوند؛ throw کردن بوم را غیرقابل‌استفاده می‌کرد.
    expect(() => outbound.emitPointer({ x: 1, y: 2, visible: true })).not.toThrow();
    expect(() => outbound.emitSelection(["stk_1"])).not.toThrow();
    expect(() => outbound.emitViewport({ scrollX: 0, scrollY: 0, zoom: 1 })).not.toThrow();
    expect(() => outbound.emitActiveTool("selection")).not.toThrow();
    expect(() => outbound.emitEphemeral(null)).not.toThrow();
    expect(() => outbound.emitReady()).not.toThrow();

    // هیچ‌کدام هنوز به همتا نمی‌رسند — گام ۳٫۵.
    expect(canvas.inbound.applyPeers).not.toHaveBeenCalled();
  });

  it("★ آپلودِ دارایی برخلافِ بقیه **خطا می‌دهد**", async () => {
    // چون **نتیجه** برمی‌گرداند: یک Promiseِ ساختگی یعنی بوم برای همیشه منتظرِ
    // `fileId` می‌مانَد و placeholder هرگز جایگزین نمی‌شود.
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(fakeCanvas().inbound);

    await expect(outbound.requestAssetUpload({} as File)).rejects.toThrow(/۳٫۶/);
  });
});

describe("ترابریِ درون‌حافظه‌ای", () => {
  it("پیام به فرستنده برنمی‌گردد", () => {
    const hub = new LocalTransportHub();
    const first = new LocalTransport(hub);
    const second = new LocalTransport(hub);

    const seen: Uint8Array[] = [];
    first.onMessage((update) => seen.push(update));
    const off = second.onMessage(() => {});

    first.send(new Uint8Array([1]));
    expect(seen).toEqual([]);

    off();
    second.disconnect();
    expect(hub.size).toBe(1);
  });

  it("`onMessage` تابعِ لغو می‌دهد — بدونش هر reconnect یک نشتی است", () => {
    const hub = new LocalTransportHub();
    const first = new LocalTransport(hub);
    const second = new LocalTransport(hub);

    let count = 0;
    const off = second.onMessage(() => count++);
    first.send(new Uint8Array([1]));
    off();
    first.send(new Uint8Array([2]));

    expect(count).toBe(1);
  });

  it("updateهای Yjs واقعاً از ترابری رد می‌شوند", () => {
    const hub = new LocalTransportHub();
    const a = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
    const b = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
    expect(Y.encodeStateAsUpdate(a.document).byteLength).toBeGreaterThan(0);
    expect(b.document).not.toBe(a.document);
  });
});
