import {
  EchoLoopError,
  type CanvasInbound,
  type CanvasOutbound,
  type ElementChangeSet,
} from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import {
  boardRoots,
  createBoardDoc,
  encodeMessage,
  getSchemaVersion,
  META_KEYS,
  MSG_TYPES,
  readDocument,
  SCHEMA_VERSION,
  writeElement,
} from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { ConnectionCancelledError, YjsSyncAdapter } from "./adapter.ts";
import { createLocalAssetTransport, LocalAssetStore } from "./assets.ts";
import { LocalOrigin } from "./emit-local.ts";
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
    // ★ **`unsaved`، نه `saved`** (گام ۴٫۳): در لحظه‌ی اتصال هنوز هیچ سروری
    //   چیزی تایید نکرده. با سرورِ واقعی، `HB_ROOM_INFO` بلافاصله اصلاحش می‌کند.
    expect(canvas.saveStates[0]).toMatchObject({ status: "unsaved" });
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

  it("★★ `disconnect` وسطِ `connect` — الگوی دقیقِ StrictMode", async () => {
    // افکت اجرا می‌شود → `connect` روی اولین await معلق می‌مانَد → cleanup فوراً
    // `disconnect` می‌زند → افکت دوباره اجرا می‌شود. بدونِ نگهبانِ نسل، ادامه‌ی
    // `connect`ِ اول observerهایش را روی سند سوار می‌کرد که هیچ `disconnect`ی
    // سراغشان نمی‌آمد.
    const { a, b } = twoAdapters();
    const abandoned = fakeCanvas();
    const live = fakeCanvas();

    const cancelled = a.connect(abandoned.inbound); // منتظرش نمی‌مانیم
    a.disconnect();
    await expect(cancelled).rejects.toThrow(ConnectionCancelledError);

    await a.connect(live.inbound);
    const outB = await b.connect(fakeCanvas().inbound);
    outB.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    // بومِ رهاشده هیچ‌وقت چیزی نمی‌گیرد؛ بومِ زنده دقیقاً **یک بار** می‌گیرد.
    expect(abandoned.received).toEqual([]);
    expect(live.received).toHaveLength(1);
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

    expect(origins).toHaveLength(1);
    expect(origins[0]).toBeInstanceOf(LocalOrigin);
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

describe("★★ وضعیتِ ذخیره — حقیقت، نه خوش‌بینی", () => {
  /**
   * ⚠️ **این تست تا گام ۴٫۳ ادعای وارونه‌اش را می‌کرد** («هر changeset یک
   * `saving` و بعد یک `saved` می‌دهد») و همان‌جا عمداً قرمز شد.
   *
   * آن `saved` **دروغ** بود: سند فقط در حافظه‌ی مرورگر نشسته بود و هیچ سروری
   * چیزی ننوشته بود. قراردادِ M1 صریح است که اگر «ذخیره شد» نشان دهیم و کاربر
   * تب را ببندد، کارش نباید برود. حالا تنها منبعِ `saved` پیامِ `HB_ROOM_INFO`ِ
   * سرور است که **بعد از** نوشتنِ واقعیِ دیتابیس می‌آید (ADR-009).
   */
  it("بدونِ سرور، `saving` می‌گوید و بعد `unsaved` — هرگز `saved`", async () => {
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
    expect(canvas.saveStates[1]).toMatchObject({ status: "unsaved" });
    // `saveStates` عمداً `unknown[]` است (بومِ ساختگی هرچه گرفت را خام ثبت می‌کند).
    expect(canvas.saveStates.map((state) => (state as { status: string }).status)).not.toContain(
      "saved",
    );
  });

  it("★ `saved` فقط با `HB_ROOM_INFO`ِ سرور می‌آید", async () => {
    const hub = new LocalTransportHub();
    const canvas = fakeCanvas();
    const adapter = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
    await adapter.connect(canvas.inbound);
    canvas.saveStates.length = 0;

    // همان بایت‌هایی که سرور بعد از نوشتنِ دیتابیس می‌فرستد.
    const line = new LocalTransport(hub);
    line.send(encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, users: 1, seq: 7, save: "saved" }));

    expect(canvas.saveStates.at(-1)).toMatchObject({ status: "saved" });
  });

  it("★★ و اگر سرور بگوید ننوشته، `unsaved` می‌مانَد", async () => {
    // ⚠️ ضدِ ادعا: بدونِ این، یک پیاده‌سازی که همیشه `saved` می‌گوید هم پاس می‌شد.
    const hub = new LocalTransportHub();
    const canvas = fakeCanvas();
    const adapter = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
    await adapter.connect(canvas.inbound);
    canvas.saveStates.length = 0;

    const line = new LocalTransport(hub);
    line.send(encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, users: 1, seq: 0, save: "unsaved" }));

    expect(canvas.saveStates.at(-1)).toMatchObject({ status: "unsaved" });
  });
});

/**
 * ★★ این بلوک تا گام ۳٫۴ **وضعیتِ ناقص** را پین می‌کرد و دو بار عمداً قرمز شد.
 *
 * تاریخچه‌اش ارزشِ نگه‌داشتن دارد، چون الگویش کار کرد: به‌جای یک TODOِ
 * فراموش‌شدنی، یک ادعای اجراشدنی که **گیت** نمی‌گذارد نادیده بماند.
 *
 * | ادعای پین‌شده | کِی قرمز شد |
 * |---|---|
 * | «`applyPeers` هرگز صدا زده نمی‌شود» | گام ۳٫۵ (کانالِ حضور) |
 * | «آپلودِ دارایی خطا می‌دهد — گام ۳٫۶» | گام ۳٫۶ (پورتِ `AssetTransport`) |
 *
 * حالا هر دو مسیر زنده‌اند و جزئیاتشان تستِ خودشان را دارد
 * ([`awareness.test.ts`](./awareness.test.ts) و [`assets.test.ts`](./assets.test.ts)).
 * آنچه اینجا می‌مانَد فقط **سیم‌کشیِ outbound** است: هیچ متدی نباید بی‌صدا
 * گم شده باشد.
 */
describe("★ سیم‌کشیِ کاملِ outbound", () => {
  it("هیچ متدِ قرارداد no-op یا گم‌شده نیست", async () => {
    const hub = new LocalTransportHub();
    const store = new LocalAssetStore({ createUrl: () => "blob:test" });
    const canvas = fakeCanvas();
    const peer = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
    const adapter = new YjsSyncAdapter({
      transport: new LocalTransport(hub),
      assets: createLocalAssetTransport(store, { uploadedBy: "u_test" }),
    });
    await peer.connect(fakeCanvas().inbound);
    const outbound = await adapter.connect(canvas.inbound);

    // حضور — گام ۳٫۵
    expect(canvas.inbound.applyPeers).toHaveBeenCalled();
    expect(() => outbound.emitPointer({ x: 1, y: 2, visible: true })).not.toThrow();
    expect(() => outbound.emitSelection(["stk_1"])).not.toThrow();
    expect(() => outbound.emitViewport({ scrollX: 0, scrollY: 0, zoom: 1 })).not.toThrow();
    expect(() => outbound.emitActiveTool("selection")).not.toThrow();
    expect(() => outbound.emitEphemeral(null)).not.toThrow();
    expect(() => outbound.emitReady()).not.toThrow();

    // دارایی — گام ۳٫۶
    const file = new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" });
    const asset = await outbound.requestAssetUpload(file);
    expect(asset.fileId).toMatch(/^f_local_/);
    await expect(outbound.resolveAssetUrl(asset.fileId)).resolves.toBe("blob:test");

    peer.disconnect();
    adapter.disconnect();
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

/**
 * ★★ یافته‌ی ۲ (M2، تاییدِ مالک ۱۴۰۵/۰۶/۱۰): مهرِ `schemaVersion` **تنبل**.
 *
 * پیش‌تر اپ روی هر باز شدنِ تب `createBoardDoc()` می‌ساخت که یک opِ `meta.schemaVersion`
 * با یک `clientID`ِ نو می‌نوشت؛ برای بوردِ **موجود** این یک کلاینتِ فانتوم به state vector
 * اضافه می‌کرد — حتی برای بازکردنِ فقط‌خواندنی. حالا اپ `Y.Doc`ِ ساده می‌دهد و آداپتور فقط
 * روی اولین نوشتنِ **واقعی** و **فقط اگر بی‌نسخه باشد** مهر می‌زند.
 */
function countClients(doc: Y.Doc): number {
  return Y.decodeStateVector(Y.encodeStateVector(doc)).size;
}

describe("یافته‌ی ۲ — مهرِ schemaVersion تنبل", () => {
  it("★ بوردِ نو (Y.Doc ساده): اولین نوشتن نسخه را مهر می‌زند", async () => {
    const doc = new Y.Doc();
    const adapter = new YjsSyncAdapter({ doc });
    const outbound = await adapter.connect(fakeCanvas().inbound);
    expect(getSchemaVersion(doc)).toBeUndefined(); // پیش از نوشتن، بی‌نسخه

    let metaWritten = false;
    boardRoots(doc).meta.observe(() => {
      metaWritten = true;
    });
    outbound.emitElementChanges({ upserted: [element("stk_1")], deleted: [], origin: "local-user" });

    expect(getSchemaVersion(doc)).toBe(SCHEMA_VERSION);
    expect(metaWritten).toBe(true);
  });

  it("★ بوردِ موجود (از قبل نسخه‌دار): نوشتن نسخه را دوباره مهر نمی‌زند", async () => {
    const doc = new Y.Doc();
    doc.transact(() => boardRoots(doc).meta.set(META_KEYS.schemaVersion, SCHEMA_VERSION));
    const adapter = new YjsSyncAdapter({ doc });
    const outbound = await adapter.connect(fakeCanvas().inbound);

    let metaWritten = false;
    boardRoots(doc).meta.observe(() => {
      metaWritten = true;
    });
    outbound.emitElementChanges({ upserted: [element("stk_2")], deleted: [], origin: "local-user" });

    expect(metaWritten).toBe(false); // نسخه از قبل هست → مهرِ اضافی نه
    expect(getSchemaVersion(doc)).toBe(SCHEMA_VERSION);
  });

  it("★ چرا مهم است: createBoardDoc یک کلاینتِ اضافی به بوردِ موجود می‌دهد، Y.Doc ساده نه", () => {
    const existing = new Y.Doc();
    existing.transact(() => {
      boardRoots(existing).meta.set(META_KEYS.schemaVersion, SCHEMA_VERSION);
      writeElement(boardRoots(existing).elements, element("stk_1"));
    });
    const state = Y.encodeStateAsUpdate(existing);
    const base = countClients(existing);

    // بازکردنِ همان بورد، دو جور:
    const plain = new Y.Doc();
    Y.applyUpdate(plain, state); // راهِ نو
    const stamped = createBoardDoc();
    Y.applyUpdate(stamped, state); // راهِ کهنه

    expect(getSchemaVersion(plain)).toBe(SCHEMA_VERSION); // هر دو نسخه دارند (از sync)
    expect(getSchemaVersion(stamped)).toBe(SCHEMA_VERSION);
    expect(countClients(plain)).toBe(base); // بدونِ کلاینتِ اضافی
    expect(countClients(stamped)).toBe(base + 1); // ★ opِ اضافیِ createBoardDoc
  });
});
