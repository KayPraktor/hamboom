import type { CanvasInbound, ConnectionState, ElementChangeSet } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import { boardRoots, encodeMessage, MSG_TYPES, writeElement } from "@hamboom/ydoc-schema";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { YjsSyncAdapter } from "./adapter.ts";
import { createPresenceScope } from "./awareness.ts";
import { LocalOrigin } from "./emit-local.ts";
import type { SyncTransport, TransportStatus } from "./transport.ts";

/**
 * تست‌های گام ۵٫۱ — **نگاشتِ وضعیتِ ترابری به `ConnectionState`** و از سر
 * گرفتنِ نشست.
 *
 * ⚠️ ترابری اینجا ساختگی است و عمداً: چیزی که آزموده می‌شود **آداپتور** است، نه
 * ماشینِ حالتِ سوکت (آن در `websocket-transport.test.ts` است). قاطی‌کردنشان یعنی
 * هر تستِ شکست‌خورده دو مظنون دارد.
 */

function element(id: string): HbElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
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
      hb: { schema: 1, kind: "sticky", createdBy: "u", lastEditedBy: "u", createdAt: 0 },
    },
  } as HbElement;
}

function fakeCanvas() {
  const connectionStates: ConnectionState[] = [];
  const inbound: CanvasInbound = {
    applyRemoteChanges: (_changes: ElementChangeSet) => undefined,
    applyPeers: vi.fn(),
    setConnectionState: (state) => connectionStates.push(state),
    setSaveState: vi.fn(),
    setPermissions: vi.fn(),
    replaceDocument: vi.fn(),
    focusOn: vi.fn(),
  };
  return {
    inbound,
    connectionStates,
    last: (): ConnectionState | undefined => connectionStates.at(-1),
  };
}

/** ترابریِ ساختگیِ **دارای کانالِ وضعیت** — یعنی ترابریِ فاز ۵، نه فاز ۳. */
function fakeLink() {
  const sent: Uint8Array[] = [];
  let onStatus: ((status: TransportStatus) => void) | null = null;
  let onMessage: ((message: Uint8Array) => void) | null = null;

  const transport: SyncTransport = {
    send: (message) => sent.push(message),
    onMessage: (handler) => {
      onMessage = handler;
      return () => {
        onMessage = null;
      };
    },
    onStatus: (handler) => {
      onStatus = handler;
      return () => {
        onStatus = null;
      };
    },
    connect: () => Promise.resolve(),
    disconnect: () => undefined,
  };

  return {
    transport,
    sent,
    emit: (status: TransportStatus): void => onStatus?.(status),
    deliver: (message: Uint8Array): void => onMessage?.(message),
    syncCount: (): number => sent.filter((message) => message[0] === MSG_TYPES.SYNC).length,
    awarenessCount: (): number =>
      sent.filter((message) => message[0] === MSG_TYPES.AWARENESS).length,
  };
}

/** پیامِ «رسیدم» و «رفتم»ِ یک همتای واقعیِ awareness. */
function peerTraffic() {
  const awareness = new awarenessProtocol.Awareness(new Y.Doc());
  awareness.setLocalState({
    user: { id: "u2", displayName: "همتا", color: "#ff0000", avatarUrl: null },
    pointer: null,
    selectedIds: [],
    viewport: null,
    activeTool: null,
  });
  const join = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);
  awareness.setLocalState(null);
  const leave = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);
  return {
    join: encodeMessage({ type: MSG_TYPES.AWARENESS, payload: join }),
    leave: encodeMessage({ type: MSG_TYPES.AWARENESS, payload: leave }),
  };
}

async function connected() {
  const canvas = fakeCanvas();
  const link = fakeLink();
  const adapter = new YjsSyncAdapter({ transport: link.transport });
  await adapter.connect(canvas.inbound);
  return { canvas, link, adapter };
}

describe("★★ تا سوکت باز نشده، «وصل شدم» ادعا نمی‌شود", () => {
  it("بعد از `connect` فقط `connecting` گفته شده", async () => {
    const { canvas } = await connected();

    expect(canvas.connectionStates).toEqual([{ status: "connecting" }]);
  });

  it("ترابریِ بدونِ کانالِ وضعیت (فاز ۳) مثلِ قبل `connected` می‌گوید", async () => {
    // نگهبانِ سازگاری: `LocalTransport` هرگز قطع نمی‌شود، پس منتظر ماندنش یعنی
    // همه‌ی تست‌های فاز ۳ روی یک بومِ برای‌همیشه-در-حالِ-اتصال بنشینند.
    const canvas = fakeCanvas();
    const adapter = new YjsSyncAdapter();
    await adapter.connect(canvas.inbound);

    expect(canvas.last()).toEqual({ status: "connected", peers: 0 });
  });

  it("`open` وضعیت را به `connected` می‌بَرد", async () => {
    const { canvas, link } = await connected();

    link.emit({ phase: "open", resumed: false });

    expect(canvas.last()).toEqual({ status: "connected", peers: 0 });
  });
});

describe("★★ دست‌دادن روی هر بار باز شدن تکرار می‌شود", () => {
  it("باز شدنِ دوباره step1/step2 و معرفیِ حضور را از نو می‌فرستد", async () => {
    const { link } = await connected();
    link.emit({ phase: "open", resumed: false });

    const syncBefore = link.syncCount();
    const awarenessBefore = link.awarenessCount();

    link.emit({ phase: "retrying", attempt: 1, nextRetryMs: 500 });
    link.emit({ phase: "open", resumed: true });

    // step1 + step2
    expect(link.syncCount() - syncBefore).toBe(2);
    // ★ و حضور — وگرنه برگشتنِ ما برای همتاها نامرئی است.
    expect(link.awarenessCount()).toBeGreaterThan(awarenessBefore);
  });
});

describe("★ نگاشتِ پنج حالت", () => {
  it("`retrying` → `reconnecting` با شماره‌ی تلاش و فاصله", async () => {
    const { canvas, link } = await connected();

    link.emit({ phase: "retrying", attempt: 3, nextRetryMs: 2_150 });

    expect(canvas.last()).toEqual({ status: "reconnecting", attempt: 3, nextRetryMs: 2_150 });
  });

  it("تلاشِ دومِ `connecting` وضعیت را پاک نمی‌کند", async () => {
    const { canvas, link } = await connected();
    link.emit({ phase: "retrying", attempt: 2, nextRetryMs: 1_000 });

    link.emit({ phase: "connecting", attempt: 3 });

    // اگر اینجا `connecting` می‌گفتیم، شماره‌ی تلاش و زمان‌سنجِ روی صفحه
    // وسطِ همان سری پاک می‌شد.
    expect(canvas.last()).toEqual({ status: "reconnecting", attempt: 2, nextRetryMs: 1_000 });
  });

  it("`stopped{fatal}` → `error` با همان کد و پیام", async () => {
    const { canvas, link } = await connected();

    link.emit({
      phase: "stopped",
      reason: "fatal",
      code: "FORBIDDEN",
      message: "دسترسی نداری.",
    });

    expect(canvas.last()).toEqual({
      status: "error",
      code: "FORBIDDEN",
      message: "دسترسی نداری.",
    });
  });
});

describe("★★ `pendingChanges` حقیقت را می‌گوید", () => {
  it("تغییرِ محلی در حالتِ قطع شمرده می‌شود و در `offline` دیده می‌شود", async () => {
    const { canvas, link, adapter } = await connected();
    link.emit({ phase: "open", resumed: false });
    link.emit({ phase: "retrying", attempt: 1, nextRetryMs: 500 });

    for (const id of ["a", "b", "c"]) {
      adapter.document.transact(() => {
        writeElement(boardRoots(adapter.document).elements, element(id));
      }, new LocalOrigin());
    }

    link.emit({ phase: "stopped", reason: "offline", code: "NETWORK_OFFLINE", message: "" });

    expect(canvas.last()).toEqual({ status: "offline", pendingChanges: 3 });
  });

  it("با باز شدنِ دوباره صفر می‌شود — دست‌دادن همه‌شان را برده", async () => {
    const { canvas, link, adapter } = await connected();
    link.emit({ phase: "open", resumed: false });
    link.emit({ phase: "retrying", attempt: 1, nextRetryMs: 500 });
    adapter.document.transact(() => {
      writeElement(boardRoots(adapter.document).elements, element("a"));
    }, new LocalOrigin());

    link.emit({ phase: "open", resumed: true });
    link.emit({ phase: "stopped", reason: "offline", code: "NETWORK_OFFLINE", message: "" });

    expect(canvas.last()).toEqual({ status: "offline", pendingChanges: 0 });
  });

  it("★ تغییرِ **قبل از** اولین باز شدن هم شمرده می‌شود", async () => {
    // سناریو: کاربر بورد را باز می‌کند در حالی که سرور بالا نیست، و شروع به
    // کار می‌کند. اگر این صفر گزارش شود، به او می‌گوییم «چیزی از دست نرفته».
    const { canvas, link, adapter } = await connected();
    adapter.document.transact(() => {
      writeElement(boardRoots(adapter.document).elements, element("a"));
    }, new LocalOrigin());

    link.emit({ phase: "stopped", reason: "offline", code: "NETWORK_OFFLINE", message: "" });

    expect(canvas.last()).toEqual({ status: "offline", pendingChanges: 1 });
  });
});

describe("★★ معرفیِ دوباره — بدونِ آن، برگشتنمان برای همتاها نامرئی است", () => {
  /** آنچه یک همتا (یا سرور) در سرِ خودش نگه می‌دارد. */
  function view() {
    const awareness = new awarenessProtocol.Awareness(new Y.Doc());
    return {
      awareness,
      apply: (payload: Uint8Array): void =>
        awarenessProtocol.applyAwarenessUpdate(awareness, payload, "test"),
      sees: (clientId: number): boolean => awareness.getStates().has(clientId),
    };
  }

  function localScope() {
    const sent: Uint8Array[] = [];
    const scope = createPresenceScope({
      doc: new Y.Doc(),
      user: { id: "u1", displayName: "من", color: "#0000ff", avatarUrl: null },
      sink: {
        sendAwareness: (payload) => sent.push(payload),
        sendEphemeral: () => undefined,
        onPeersChanged: () => undefined,
      },
    });
    return { scope, sent };
  }

  it("همتا دوباره ما را می‌بیند — و **فرستادنِ همان پیام کافی نیست**", () => {
    const { scope, sent } = localScope();
    const peer = view();
    const server = view();

    scope.announce();
    for (const payload of sent) {
      peer.apply(payload);
      server.apply(payload);
    }
    expect(peer.sees(scope.clientId)).toBe(true);

    // سرور با بسته‌شدنِ سوکت حذفِ ما را پخش می‌کند (گام ۴٫۶).
    awarenessProtocol.removeAwarenessStates(server.awareness, [scope.clientId], "socket-closed");
    peer.apply(awarenessProtocol.encodeAwarenessUpdate(server.awareness, [scope.clientId]));
    expect(peer.sees(scope.clientId)).toBe(false);

    // ★★ **کنترلِ منفی** — همان پیامِ قبلی را دوباره بفرست: هیچ اتفاقی
    //    نمی‌افتد، چون clock بزرگ‌تر نشده و `applyAwarenessUpdate` بی‌صدا
    //    دورش می‌ریزد. اگر این ادعا نبود، تستِ بعدی هم چیزی ثابت نمی‌کرد.
    const previous = sent.at(-1);
    expect(previous).toBeDefined();
    if (previous) peer.apply(previous);
    expect(peer.sees(scope.clientId)).toBe(false);

    sent.length = 0;
    scope.reannounce();
    for (const payload of sent) peer.apply(payload);
    expect(peer.sees(scope.clientId)).toBe(true);
  });

  it("★ حالتِ فعلی را پاک نمی‌کند — برخلافِ `announce`", () => {
    const { scope, sent } = localScope();
    const peer = view();

    scope.announce();
    scope.setSelection(["e1", "e2"]);
    sent.length = 0;

    scope.reannounce();
    for (const payload of sent) peer.apply(payload);

    const state = peer.awareness.getStates().get(scope.clientId) as { selectedIds?: string[] };
    expect(state?.selectedIds).toEqual(["e1", "e2"]);
  });
});

describe("★ وضعیتِ قطع با تغییرِ تعدادِ همتا بازنویسی نمی‌شود", () => {
  it("پاک‌شدنِ همتا وسطِ `reconnecting` یک `connected`ِ دروغین نمی‌سازد", async () => {
    // ⚠️ محرکِ **واقعی** در تولید جاروی ۳۰ثانیه‌ایِ خودِ `Awareness` است (همتایی
    //    که در قطعیِ طولانی کهنه می‌شود). آن ساعت با زمان‌بندِ ساختگی قابلِ
    //    جلو بردن نیست — درسِ گام ۳٫۵ — ولی مسیرِ کد **همان** است: هر تغییرِ
    //    فهرستِ همتاها از `publishPeers` رد می‌شود.
    const { canvas, link } = await connected();
    const peer = peerTraffic();

    link.emit({ phase: "open", resumed: false });
    link.deliver(peer.join);
    expect(canvas.last()).toEqual({ status: "connected", peers: 1 });

    link.emit({ phase: "retrying", attempt: 2, nextRetryMs: 1_000 });
    link.deliver(peer.leave);

    expect(canvas.last()).toEqual({ status: "reconnecting", attempt: 2, nextRetryMs: 1_000 });
  });
});
