import type { CanvasInbound, EphemeralPayload, PeerState } from "@hamboom/canvas-core/sync";
import { decodeMessage, encodeMessage, MSG_TYPES, type HbMessage } from "@hamboom/ydoc-schema";
import * as time from "lib0/time";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { YjsSyncAdapter } from "./adapter.ts";
import { LocalTransport, LocalTransportHub } from "./transport.ts";

/**
 * تست‌های گام ۳٫۵ — **کانالِ حضور**.
 *
 * ادعای مرکزیِ گام (معیارِ پذیرش): یک استروکِ ۲۰۰نقطه‌ای از الف به ب می‌رسد در
 * حالی که **اندازه‌ی سند صفر تغییر می‌کند** ([ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022)).
 *
 * ⚠️ آنچه اینجا آزموده **نمی‌شود**: رندرِ مکان‌نما و هاله روی بوم و re-project با
 * تغییرِ viewport — آن‌ها گام ۳٫۷ اند (G-1الف). اینجا فقط ثابت می‌شود `PeerState`ِ
 * **درست** به `applyPeers` می‌رسد.
 */

const USER_A = { id: "u_a", displayName: "کاربر الف", color: "#5B8DEF", avatarUrl: null };
const USER_B = { id: "u_b", displayName: "کاربر ب", color: "#D0C6F5", avatarUrl: null };

/** یک استروکِ واقعی — همان اندازه‌ای که PLAN بخش ۷٫۳ هشدارش را می‌دهد. */
function stroke(points = 200): EphemeralPayload {
  return {
    kind: "draw-stroke",
    points: Array.from(
      { length: points },
      (_, i) => [i * 1.5, Math.sin(i) * 40] as [number, number],
    ),
    color: "#1a1a1a",
    width: 2,
  };
}

interface FakeCanvas {
  inbound: CanvasInbound;
  /** آخرین چیزی که به `applyPeers` رسید. */
  peers(): PeerState[];
  /** همه‌ی فراخوانی‌ها — برای شمردنِ رندرهای اضافه. */
  readonly calls: PeerState[][];
  readonly connectionStates: unknown[];
}

function fakeCanvas(): FakeCanvas {
  const calls: PeerState[][] = [];
  const connectionStates: unknown[] = [];
  const inbound: CanvasInbound = {
    applyRemoteChanges: vi.fn(),
    applyPeers: (peers) => calls.push(peers),
    setConnectionState: (state) => connectionStates.push(state),
    setSaveState: vi.fn(),
    setPermissions: vi.fn(),
    replaceDocument: vi.fn(),
    focusOn: vi.fn(),
  };
  return {
    inbound,
    calls,
    connectionStates,
    peers: () => calls.at(-1) ?? [],
  };
}

/** شنودِ خطِ ترابری — برای شمردنِ پیام‌ها بدونِ دست‌زدن به آداپتور. */
function wiretap(hub: LocalTransportHub): { seen: HbMessage[]; transport: LocalTransport } {
  const seen: HbMessage[] = [];
  const transport = new LocalTransport(hub);
  transport.onMessage((data) => {
    const message = decodeMessage(data);
    if (message) seen.push(message);
  });
  return { seen, transport };
}

interface Pair {
  hub: LocalTransportHub;
  a: YjsSyncAdapter;
  b: YjsSyncAdapter;
  outA: Awaited<ReturnType<YjsSyncAdapter["connect"]>>;
  outB: Awaited<ReturnType<YjsSyncAdapter["connect"]>>;
  canvasA: FakeCanvas;
  canvasB: FakeCanvas;
}

async function twoClients(throttle = { pointerMs: 40, viewportMs: 100 }): Promise<Pair> {
  const hub = new LocalTransportHub();
  const a = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_A, throttle });
  const b = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_B, throttle });
  const canvasA = fakeCanvas();
  const canvasB = fakeCanvas();
  const outA = await a.connect(canvasA.inbound);
  const outB = await b.connect(canvasB.inbound);
  return { hub, a, b, outA, outB, canvasA, canvasB };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("★★ معیارِ پذیرش — استروکِ ۲۰۰نقطه‌ای بدونِ یک بایت رشدِ سند", () => {
  it("به همتا می‌رسد و `encodeStateAsUpdate` **صفر تغییر** می‌کند", async () => {
    const { a, b, outA, canvasB } = await twoClients();

    const before = {
      a: Y.encodeStateAsUpdate(a.document).byteLength,
      b: Y.encodeStateAsUpdate(b.document).byteLength,
    };

    // کلِ عمرِ یک استروک: ۲۰۰ فریمِ کشیدن، بعد رها شدن.
    for (let i = 1; i <= 200; i++) outA.emitEphemeral(stroke(i));

    expect(canvasB.peers()).toHaveLength(1);
    expect(canvasB.peers()[0]!.ephemeral).toEqual(stroke(200));

    // ★★ ادعای مرکزی — **هر دو** سند، نه فقط گیرنده.
    expect(Y.encodeStateAsUpdate(a.document).byteLength).toBe(before.a);
    expect(Y.encodeStateAsUpdate(b.document).byteLength).toBe(before.b);
  });

  it("`null` یعنی پایان — ephemeralِ همتا پاک می‌شود", async () => {
    const { outA, canvasB } = await twoClients();

    outA.emitEphemeral(stroke(50));
    expect(canvasB.peers()[0]!.ephemeral).not.toBeNull();

    outA.emitEphemeral(null);
    expect(canvasB.peers()[0]!.ephemeral).toBeNull();
  });

  it("ephemeral روی کانالِ `HB_EPHEMERAL` می‌رود، نه `AWARENESS`", async () => {
    const hub = new LocalTransportHub();
    const tap = wiretap(hub);
    const a = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_A });
    const outA = await a.connect(fakeCanvas().inbound);

    tap.seen.length = 0;
    outA.emitEphemeral(stroke(10));

    expect(tap.seen.map((message) => message.type)).toEqual([MSG_TYPES.HB_EPHEMERAL]);
    a.disconnect();
  });
});

describe("★★ چرا ephemeral کانالِ خودش را دارد — سنجیده، نه سلیقه", () => {
  it("استروک داخلِ stateِ awareness با **هر تکانِ مکان‌نما** دوباره کامل می‌رود", () => {
    // ★ این تستِ **ضدِ ادعا** است: گزینه‌ی ردشده را می‌سازد و هزینه‌اش را نشان
    //   می‌دهد. اگر روزی کسی «ساده‌سازی» کند و ephemeral را به state ببرد، عددها
    //   همین‌جا هستند — [ADR-036](../../../ARCHITECTURE_DECISIONS.md#adr-036).
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const size = (): number =>
      awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]).byteLength;

    awareness.setLocalState({ user: USER_A, pointer: { x: 10, y: 20, visible: true } });
    const plain = size();

    awareness.setLocalStateField("ephemeral", stroke(200));
    // فقط مکان‌نما تکان می‌خورد — استروک **عوض نشده**.
    awareness.setLocalStateField("pointer", { x: 11, y: 21, visible: true });
    const withStroke = size();

    // `encodeAwarenessUpdate` هر بار کلِ state را `JSON.stringify` می‌کند.
    expect(plain).toBeLessThan(300);
    expect(withStroke).toBeGreaterThan(5000);
    expect(withStroke / plain).toBeGreaterThan(20);

    awareness.destroy();
    doc.destroy();
  });
});

describe("نگاشتِ awareness ↔ `PeerState`", () => {
  it("هر پنج فیلد از الف به ب می‌رسد", async () => {
    vi.useFakeTimers();
    const { outA, canvasB } = await twoClients();

    outA.emitSelection(["stk_1", "stk_2"]);
    outA.emitActiveTool("freedraw");
    outA.emitPointer({ x: 120, y: 240, visible: true });
    outA.emitViewport({ scrollX: -50, scrollY: 30, zoom: 1.5 });
    vi.advanceTimersByTime(100);

    expect(canvasB.peers()).toEqual([
      {
        clientId: expect.any(Number),
        user: USER_A,
        pointer: { x: 120, y: 240, visible: true },
        selectedIds: ["stk_1", "stk_2"],
        viewport: { scrollX: -50, scrollY: 30, zoom: 1.5 },
        activeTool: "freedraw",
        ephemeral: null,
      },
    ]);
  });

  it("★ فهرست **خودمان** را ندارد", async () => {
    const { a, canvasA, canvasB } = await twoClients();

    expect(canvasA.peers().map((peer) => peer.user.id)).toEqual(["u_b"]);
    expect(canvasB.peers().map((peer) => peer.user.id)).toEqual(["u_a"]);
    expect(canvasA.peers()[0]!.clientId).not.toBe(a.document.clientID);
  });

  it("★★ همتای دیرتر رسیده هم بدونِ هیچ تکانی دیده می‌شود", async () => {
    // awareness پیامِ «چه کسانی هستید؟» ندارد. بدونِ پاسخ‌دادنِ خودکار، ب تا
    // اولین حرکتِ ماوسِ الف او را **نمی‌دید** — و اگر الف بی‌حرکت بود، هرگز.
    const hub = new LocalTransportHub();
    const a = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_A });
    await a.connect(fakeCanvas().inbound);

    const b = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_B });
    const canvasB = fakeCanvas();
    await b.connect(canvasB.inbound);

    expect(canvasB.peers().map((peer) => peer.user.displayName)).toEqual(["کاربر الف"]);
    a.disconnect();
    b.disconnect();
  });

  it("ترتیبِ فهرست روی هر دو کلاینت یکسان است", async () => {
    const hub = new LocalTransportHub();
    const canvases = [fakeCanvas(), fakeCanvas(), fakeCanvas()];
    const adapters = canvases.map(
      (_, index) =>
        new YjsSyncAdapter({
          transport: new LocalTransport(hub),
          user: { ...USER_A, id: `u_${index}` },
        }),
    );
    for (const [index, adapter] of adapters.entries())
      await adapter.connect(canvases[index]!.inbound);

    const ids = canvases.map((canvas) => canvas.peers().map((peer) => peer.clientId));
    for (const list of ids) expect(list).toEqual([...list].sort((x, y) => x - y));

    for (const adapter of adapters) adapter.disconnect();
  });
});

describe("★★ خروجِ همتا — مکان‌نما و هاله باید پاک شوند", () => {
  it("`disconnect` همتا را فوراً از فهرست برمی‌دارد", async () => {
    vi.useFakeTimers();
    const { a, outA, canvasB } = await twoClients();

    outA.emitPointer({ x: 5, y: 5, visible: true });
    outA.emitSelection(["stk_1"]);
    vi.advanceTimersByTime(40);
    expect(canvasB.peers()).toHaveLength(1);

    a.disconnect();

    expect(canvasB.peers()).toEqual([]);
    expect(canvasB.connectionStates.at(-1)).toEqual({ status: "connected", peers: 0 });
  });

  it("★ استروکِ نیمه‌کاره‌ی همتا با خروجش پاک می‌شود", async () => {
    // اگر ephemeral جدا از فهرستِ همتاها نگه داشته شود، این حالت یک استروکِ
    // یخ‌زده تا ابد روی بومِ همه می‌گذارد — و صاحبش دیگر آنجا نیست که پاکش کند.
    const { a, outA, canvasB } = await twoClients();

    outA.emitEphemeral(stroke(120));
    expect(canvasB.peers()[0]!.ephemeral).not.toBeNull();

    a.disconnect();
    expect(canvasB.peers()).toEqual([]);
  });

  it("★ حذفِ اعلام‌شده از بیرون (کارِ سرور در فاز ۴) همتا و استروکش را می‌برد", async () => {
    // در معماریِ واقعی، همتایی که بی‌خداحافظی می‌رود (بستنِ تب، قطعِ برق) را
    // **سرور** تشخیص می‌دهد و حذفش را پخش می‌کند — دقیقاً همین بایت‌ها: یک
    // stateِ `null` با clockِ بزرگ‌تر.
    const hub = new LocalTransportHub();
    const canvasB = fakeCanvas();
    const b = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_B });
    await b.connect(canvasB.inbound);

    const ghostDoc = new Y.Doc();
    const ghost = new awarenessProtocol.Awareness(ghostDoc);
    ghost.setLocalState({ user: USER_A, pointer: { x: 7, y: 7, visible: true } });
    const line = new LocalTransport(hub);
    const announce = (): void => {
      line.send(
        encodeMessage({
          type: MSG_TYPES.AWARENESS,
          payload: awarenessProtocol.encodeAwarenessUpdate(ghost, [ghost.clientID]),
        }),
      );
    };
    announce();
    line.send(
      encodeMessage({
        type: MSG_TYPES.HB_EPHEMERAL,
        clientId: ghost.clientID,
        payload: JSON.stringify(stroke(80)),
      }),
    );
    expect(canvasB.peers()[0]!.ephemeral).not.toBeNull();

    // «این کلاینت دیگر نیست» — همان چیزی که `removeAwarenessStates` می‌سازد.
    awarenessProtocol.removeAwarenessStates(ghost, [ghost.clientID], "gone");
    announce();

    expect(canvasB.peers()).toEqual([]);

    ghost.destroy();
    ghostDoc.destroy();
    b.disconnect();
  });

  it("⚠️ جاروی ۳۰ثانیه‌ایِ خودِ y-protocols اینجا **آزموده نمی‌شود** — و دلیلش این است", () => {
    // این تست یک ادعای محصولی نیست، یک **توضیحِ اجراشدنی** است.
    //
    // `Awareness` هر ۳ ثانیه همتاهای کهنه‌تر از ۳۰ ثانیه را خودش پاک می‌کند، ولی
    // زمانش را از `lib0/time` می‌گیرد که **`Date.now` را در لحظه‌ی بارگذاریِ ماژول
    // گرفته و نگه داشته** (`export const getUnixTime = Date.now`). زمان‌بندِ
    // ساختگیِ vitest کلاسِ `Date` را جایگزین می‌کند، نه آن ارجاعِ گرفته‌شده — پس
    // ساعتِ y-protocols زیر `advanceTimersByTime` **تکان نمی‌خورد** و آن جارو
    // هرگز اجرا نمی‌شود.
    //
    // پس تستِ بالا مسیرِ **واقعیِ** فاز ۴ را می‌آزماید (حذفِ اعلام‌شده)، و این
    // یکی جلوی برگرداندنِ همان تستِ بی‌اثر را می‌گیرد.
    // ⚠️ **دو ساعت، دو مبدأ.** نسخه‌ی اول یک مبدأ برای هر دو ادعا گرفته بود و
    //    ۱ در چند اجرا می‌افتاد (`expected 59999 to be 60000`): ساعتِ ساختگی در
    //    لحظه‌ی `useFakeTimers` یخ می‌زند، ولی مبدأ از ساعتِ **واقعی** خوانده شده
    //    بود که تا آن لحظه یک میلی‌ثانیه جلوتر رفته بود. مقایسه‌ی دو ساعتِ متفاوت
    //    در یک ادعا، همان اشتباهی است که این تست قرار بود درباره‌اش هشدار بدهد.
    vi.useFakeTimers();
    const fakeBefore = Date.now();
    const realBefore = time.getUnixTime();
    vi.advanceTimersByTime(60_000);

    // ساعتِ ساختگی دقیقاً جلو رفت…
    expect(Date.now() - fakeBefore).toBe(60_000);
    // …و ساعتِ y-protocols اصلاً تکان نخورد.
    expect(time.getUnixTime() - realBefore).toBeLessThan(1_000);
  });
});

describe("جدولِ فرکانسِ PLAN ۷٫۴ روی کانالِ حضور", () => {
  it("مکان‌نما throttle ۴۰ms است — trailing", async () => {
    vi.useFakeTimers();
    const { outA, canvasB } = await twoClients();
    const before = canvasB.calls.length;

    // ۱۰ حرکت در یک پنجره — باید **یک** به‌روزرسانی بدهد، با آخرین مقدار.
    for (let i = 1; i <= 10; i++) outA.emitPointer({ x: i, y: i, visible: true });
    expect(canvasB.calls.length).toBe(before);

    vi.advanceTimersByTime(40);
    expect(canvasB.calls.length).toBe(before + 1);
    expect(canvasB.peers()[0]!.pointer).toEqual({ x: 10, y: 10, visible: true });
  });

  it("نما throttle ۱۰۰ms است", async () => {
    vi.useFakeTimers();
    const { outA, canvasB } = await twoClients();

    outA.emitViewport({ scrollX: 1, scrollY: 1, zoom: 1 });
    vi.advanceTimersByTime(99);
    expect(canvasB.peers()[0]!.viewport).toBeNull();

    vi.advanceTimersByTime(1);
    expect(canvasB.peers()[0]!.viewport).toEqual({ scrollX: 1, scrollY: 1, zoom: 1 });
  });

  it("انتخاب **فوری** است", async () => {
    vi.useFakeTimers();
    const { outA, canvasB } = await twoClients();

    outA.emitSelection(["stk_9"]);
    expect(canvasB.peers()[0]!.selectedIds).toEqual(["stk_9"]);
  });

  it("★ خروجِ مکان‌نما از بوم فوری است، نه ۴۰ms بعد", async () => {
    // با throttle، مکان‌نمای همتا بعد از خروجش هنوز روی بوم می‌مانْد. خروج یک
    // رویدادِ **گسسته** است، مثلِ حذف در مسیرِ عنصر.
    vi.useFakeTimers();
    const { outA, canvasB } = await twoClients();

    outA.emitPointer({ x: 3, y: 3, visible: true });
    vi.advanceTimersByTime(40);
    expect(canvasB.peers()[0]!.pointer).not.toBeNull();

    outA.emitPointer(null);
    expect(canvasB.peers()[0]!.pointer).toBeNull();
  });

  it("پس از `disconnect` هیچ مقدارِ در صفی نمی‌نشیند", async () => {
    // برخلافِ `dispose`ِ مسیرِ عنصر که flush می‌کند: آخرین مکان‌نما داده‌ی کاربر
    // نیست، و نوشتنش بعد از «رفتم» یعنی یک مکان‌نمای زامبی.
    vi.useFakeTimers();
    const { a, outA, canvasB } = await twoClients();

    outA.emitPointer({ x: 99, y: 99, visible: true });
    a.disconnect();
    vi.advanceTimersByTime(500);

    expect(canvasB.peers()).toEqual([]);
  });
});

describe("مقاومت در برابرِ همتای بدرفتار", () => {
  it("stateِ ناقص همتا را حذف نمی‌کند — با نامِ جایگزین می‌آید", async () => {
    // مکان‌نمای گم‌شده تشخیصش از «کاربر ناشناس» سخت‌تر است.
    const hub = new LocalTransportHub();
    const canvasA = fakeCanvas();
    const a = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_A });
    await a.connect(canvasA.inbound);

    const rogueDoc = new Y.Doc();
    const rogue = new awarenessProtocol.Awareness(rogueDoc);
    const line = new LocalTransport(hub);
    rogue.setLocalState({ user: "نه یک شیء", pointer: { x: "الف" }, selectedIds: 7 });
    line.send(
      encodeMessage({
        type: MSG_TYPES.AWARENESS,
        payload: awarenessProtocol.encodeAwarenessUpdate(rogue, [rogue.clientID]),
      }),
    );

    expect(canvasA.peers()).toEqual([
      {
        clientId: rogue.clientID,
        user: {
          id: `c_${rogue.clientID}`,
          displayName: "کاربر ناشناس",
          color: "#8A8A8A",
          avatarUrl: null,
        },
        pointer: null,
        selectedIds: [],
        viewport: null,
        activeTool: null,
        ephemeral: null,
      },
    ]);

    rogue.destroy();
    rogueDoc.destroy();
    a.disconnect();
  });

  it("★ ephemeralِ نامفهوم **پاک می‌کند**، نه اینکه قبلی را نگه دارد", async () => {
    const { a, outA, canvasB } = await twoClients();

    outA.emitEphemeral(stroke(30));
    expect(canvasB.peers()[0]!.ephemeral).not.toBeNull();

    // یک `kind`ی که این نسخه نمی‌شناسد — کلاینتِ **جدیدتر**.
    outA.emitEphemeral({ kind: "confetti" } as unknown as EphemeralPayload);
    expect(canvasB.peers()[0]!.ephemeral).toBeNull();

    a.disconnect();
  });

  it("payloadِ خرابِ ephemeral هیچ‌کس را نمی‌شکند", async () => {
    const hub = new LocalTransportHub();
    const canvasA = fakeCanvas();
    const a = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_A });
    await a.connect(canvasA.inbound);

    const line = new LocalTransport(hub);
    expect(() =>
      line.send(encodeMessage({ type: MSG_TYPES.HB_EPHEMERAL, clientId: 42, payload: "{{{" })),
    ).not.toThrow();

    a.disconnect();
  });
});

describe("چرخه‌ی عمر", () => {
  it("★ `setConnectionState` فقط وقتی **عدد** عوض شود صدا زده می‌شود", async () => {
    vi.useFakeTimers();
    const { outA, canvasB } = await twoClients();
    const before = canvasB.connectionStates.length;

    for (let i = 1; i <= 5; i++) {
      outA.emitPointer({ x: i, y: i, visible: true });
      vi.advanceTimersByTime(40);
    }

    expect(canvasB.calls.length).toBeGreaterThan(before);
    expect(canvasB.connectionStates.length).toBe(before);
  });

  it("★ چرخه‌ی connect/disconnect/connect همتای تکراری یا مرده جا نمی‌گذارد", async () => {
    // زیر StrictMode این چرخه در هر mount رخ می‌دهد.
    const hub = new LocalTransportHub();
    const canvasB = fakeCanvas();
    const b = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_B });
    await b.connect(canvasB.inbound);

    const a = new YjsSyncAdapter({ transport: new LocalTransport(hub), user: USER_A });
    for (let i = 0; i < 3; i++) {
      await a.connect(fakeCanvas().inbound);
      expect(canvasB.peers()).toHaveLength(1);
      a.disconnect();
      expect(canvasB.peers()).toHaveLength(0);
    }

    b.disconnect();
  });

  it("بدونِ ترابری هم کار می‌کند (حالتِ آفلاین)", async () => {
    const adapter = new YjsSyncAdapter({ user: USER_A });
    const canvas = fakeCanvas();
    const outbound = await adapter.connect(canvas.inbound);

    expect(() => outbound.emitPointer({ x: 1, y: 1, visible: true })).not.toThrow();
    expect(() => outbound.emitEphemeral(stroke(5))).not.toThrow();
    expect(canvas.peers()).toEqual([]);

    adapter.disconnect();
  });
});
