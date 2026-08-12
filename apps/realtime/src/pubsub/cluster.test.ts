import type { HbElement } from "@hamboom/shared-types";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  MSG_TYPES,
  writeElement,
  type BoardRole,
} from "@hamboom/ydoc-schema";
import * as encoding from "lib0/encoding";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../log.ts";
import { MemoryUpdateLog, type UpdateLog } from "../persistence/update-log.ts";
import { createRoomManager, type RoomManager } from "../room.ts";
import type { RtSession } from "../server.ts";
import { MemoryBoardStore } from "../store/board-store.ts";
import {
  BUS_KINDS,
  decodeEnvelope,
  encodeEnvelope,
  MemoryBoardBus,
  type BusEnvelope,
} from "./board-bus.ts";
import { MemoryOwnerLock } from "./owner-lock.ts";

/**
 * تست‌های گام ۴٫۷ — **چندنودی**، [ADR-006](../../../../ARCHITECTURE_DECISIONS.md#adr-006) فاز ۲.
 *
 * ★ «نود» اینجا یعنی یک `createRoomManager`ِ جدا با `nodeId`ِ خودش، که یک
 * `MemoryBoardBus` را با بقیه شریک است. همان envelopeها، همان ضدِ حلقه، همان
 * قفل — فقط بدونِ شبکه.
 *
 * ⚠️ و همین حدِ ادعای این فایل است: **انحصارِ واقعی** و تاخیرِ شبکه فقط با دو
 * پروسه و Redisِ واقعی دیده می‌شوند
 * ([`scripts/rt-cluster.ts`](../../../../scripts/rt-cluster.ts)).
 */

const BOARD = "brd_cluster";

function element(id: string): HbElement {
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
      hb: { schema: 1, kind: "sticky", createdBy: "u", lastEditedBy: "u", createdAt: 0 },
    },
  } as HbElement;
}

function recordingSocket() {
  const sent: Uint8Array[] = [];
  const handlers = new Map<string, ((data: unknown) => void)[]>();
  const socket = {
    send: (data: Uint8Array) => sent.push(data),
    on: (event: string, cb: (data: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    },
    once: (event: string, cb: (data: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    },
  };
  return {
    socket,
    sent,
    receive: (data: Uint8Array) => {
      for (const cb of handlers.get("message") ?? []) cb(data);
    },
    disconnect: () => {
      for (const cb of handlers.get("close") ?? []) cb(undefined);
    },
    decoded: () => sent.map((bytes) => decodeMessage(bytes)),
    /** سندی که این کلاینت از پیام‌های SYNC ساخته. */
    document(): Y.Doc {
      const doc = new Y.Doc();
      for (const message of this.decoded()) {
        if (message?.type !== MSG_TYPES.SYNC) continue;
        syncProtocol.readSyncMessage(
          { arr: message.payload, pos: 0 } as never,
          encoding.createEncoder(),
          doc,
          null,
          () => {},
        );
      }
      return doc;
    },
    lastSave(): { save: string; seq: number } | null {
      const infos = this.decoded().filter((m) => m?.type === MSG_TYPES.HB_ROOM_INFO);
      const last = infos.at(-1);
      return last?.type === MSG_TYPES.HB_ROOM_INFO ? { save: last.save, seq: last.seq } : null;
    },
  };
}

function session(socket: unknown, sub = "usr_1", role: BoardRole = "editor"): RtSession {
  return {
    socket: socket as RtSession["socket"],
    boardId: BOARD,
    sub,
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

/**
 * یک خوشه‌ی ساختگی: گذرگاهِ مشترک، لاگِ مشترک، و **یک دفترِ قفلِ مشترک** — جای
 * همان یک Redis که در واقعیت بینِ نودها داوری می‌کند.
 */
function cluster() {
  const bus = new MemoryBoardBus();
  const log = new MemoryUpdateLog();
  const holders = new Map<string, string>();
  return {
    bus,
    log,
    holders,
    node: (id: string) => node(id, bus, log, new MemoryOwnerLock(id, holders)),
  };
}

/** یک «نود» — مدیرِ اتاقِ جدا با `nodeId`ِ خودش، روی گذرگاه و لاگِ مشترک. */
function node(
  id: string,
  bus: MemoryBoardBus,
  log: UpdateLog,
  lock?: MemoryOwnerLock,
): { rooms: RoomManager; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    rooms: createRoomManager({
      // ⚠️ **انبارِ مشترک** — همان دیتابیس برای هر دو نود، مثلِ واقعیت.
      store: new MemoryBoardStore(),
      log,
      bus,
      ownerLock: lock,
      nodeId: id,
      limits: { maxRoomsPerNode: 10, maxDocBytes: 5_000_000, idleTimeoutMs: 60_000 },
      logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
    }),
  };
}

/** سندی با یک عنصر — برای ساختنِ بایت‌های خام. */
function docFor(id: string): Y.Doc {
  const doc = createBoardDoc();
  doc.transact(() => {
    writeElement(boardRoots(doc).elements, element(id));
  });
  return doc;
}

function docUpdate(id: string): Uint8Array {
  const doc = createBoardDoc();
  doc.transact(() => {
    writeElement(boardRoots(doc).elements, element(id));
  });
  const inner = encoding.createEncoder();
  syncProtocol.writeUpdate(inner, Y.encodeStateAsUpdate(doc));
  return encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(inner) });
}

describe("قالبِ روی سیمِ گذرگاه", () => {
  it("رفت و برگشت سالم است", () => {
    const envelope: BusEnvelope = {
      node: "node-a",
      kind: BUS_KINDS.UPDATE,
      payload: new Uint8Array([1, 2, 3, 250]),
      seq: 42,
    };
    expect(decodeEnvelope(encodeEnvelope(envelope))).toEqual(envelope);
  });

  it("★ بایتِ نامفهوم `null` می‌دهد، نه پرتابِ خطا", () => {
    // ⚠️ در استقرارِ چندنودی، نسخه‌های مختلف **همزمان** بالا هستند؛ پیامی که
    //    نمی‌فهمیم نباید نود را بیندازد.
    expect(decodeEnvelope(new Uint8Array([250, 250, 250]))).toBeNull();
    expect(decodeEnvelope(new Uint8Array([]))).toBeNull();
  });
});

describe("★★ معیارِ پذیرش — تغییرِ نودِ ۱ در نودِ ۲ دیده می‌شود", () => {
  it("★★ کلاینتِ نودِ ۲ عنصرِ ساخته‌شده روی نودِ ۱ را می‌گیرد", async () => {
    const { node: spawn } = cluster();
    const one = spawn("node-1");
    const two = spawn("node-2");

    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await one.rooms.join(session(aWire.socket, "usr_a"));
    const roomTwo = await two.rooms.join(session(bWire.socket, "usr_b"));
    bWire.sent.length = 0;

    aWire.receive(docUpdate("stk_from_node1"));

    // ★ روی سندِ **نودِ دوم** نشست…
    expect(boardRoots(roomTwo.doc).elements.has("stk_from_node1")).toBe(true);
    // …و به کلاینتش هم رسید.
    expect(boardRoots(bWire.document()).elements.has("stk_from_node1")).toBe(true);
  });

  it("و برعکس هم کار می‌کند — از نودِ غیرِ صاحب به صاحب", async () => {
    const { node: spawn } = cluster();
    const one = spawn("node-1");
    const two = spawn("node-2");

    const aWire = recordingSocket();
    const bWire = recordingSocket();
    const roomOne = await one.rooms.join(session(aWire.socket, "usr_a"));
    await two.rooms.join(session(bWire.socket, "usr_b"));

    bWire.receive(docUpdate("stk_from_node2"));

    expect(boardRoots(roomOne.doc).elements.has("stk_from_node2")).toBe(true);
  });
});

describe("★★ معیارِ پذیرش — پیامِ خودی دوباره پردازش نمی‌شود", () => {
  it("★★ نودی که منتشر می‌کند، پیامِ خودش را نادیده می‌گیرد", async () => {
    // ⚠️ بدونِ برچسبِ `nodeId`، هر update بی‌پایان بینِ دو نود رفت‌وبرگشت می‌کند.
    //    و چون Yjs idempotent است **هیچ‌وقت خراب نمی‌شود** — فقط شبکه و CPU را
    //    می‌خورد. بدترین نوعِ باگ: کار می‌کند و آرام‌آرام سرور را می‌کشد.
    const { bus, node: spawn } = cluster();
    const one = spawn("node-1");

    const wire = recordingSocket();
    await one.rooms.join(session(wire.socket, "usr_a"));
    const before = bus.published;

    wire.receive(docUpdate("stk_1"));
    // ⚠️ `SAVED` **بعد از** نوشتن منتشر می‌شود، پس صبر لازم است — نه اینکه
    //    همان لحظه بشمریم.
    await vi.waitFor(() => expect(bus.published - before).toBe(2));

    // ★ دقیقاً **دو** انتشار: خودِ update و «تا اینجا ذخیره شد».
    //   اگر پیامِ خودی دوباره پردازش می‌شد، این عدد بی‌کران بالا می‌رفت.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bus.published - before).toBe(2);
  });

  it("★ و با یک نودِ دوم هم عدد ثابت می‌مانَد", async () => {
    const { bus, node: spawn } = cluster();
    const one = spawn("node-1");
    const two = spawn("node-2");

    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await one.rooms.join(session(aWire.socket, "usr_a"));
    await two.rooms.join(session(bWire.socket, "usr_b"));
    const before = bus.published;

    aWire.receive(docUpdate("stk_1"));
    await vi.waitFor(() => expect(bus.published - before).toBe(2));

    // update (نودِ ۱) + saved (نودِ ۱). نودِ ۲ **هیچ‌چیز** منتشر نمی‌کند، چون
    // آنچه گرفته با originِ گذرگاه اعمال شده.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bus.published - before).toBe(2);
  });
});

describe("★★ ضدِ حلقه، مستقیم روی مسیرِ دریافت", () => {
  /**
   * ⚠️ **تستِ شمارشِ انتشار بالا این را نمی‌گرفت** — و خودآزمونِ گیت نشانش داد:
   * با برداشتنِ `if (envelope.node === nodeId)` هر ۱۳۲ تست سبز ماندند.
   *
   * علتش ظریف است: وقتی نود updateِ **خودش** را پس می‌گیرد، Yjs می‌بیند چیزی
   * عوض نشده، پس رویدادِ `update` نمی‌دهد و انتشارِ دومی هم رخ نمی‌دهد. یعنی
   * حلقه‌ی *تشدیدشونده* نمی‌سازد و شمارنده ساکت می‌مانَد.
   *
   * ★ ولی بی‌اثر هم نیست: `EPHEMERAL` بی‌قید و شرط به **همه‌ی** نشست‌های محلی
   * پخش می‌شود، پس بدونِ این گیت فرستنده استروکِ خودش را پس می‌گیرد. پس ادعا را
   * باید همان‌جا سنجید که اثر دارد — نه با شمردنِ انتشار.
   */
  it("★★ envelopeی با `nodeId`ِ خودمان **اصلاً پردازش نمی‌شود**", async () => {
    const bus = new MemoryBoardBus();
    const log = new MemoryUpdateLog();
    const one = node("node-1", bus, log, new MemoryOwnerLock("node-1"));

    const wire = recordingSocket();
    const room = await one.rooms.join(session(wire.socket, "usr_a"));
    wire.sent.length = 0;

    // پیامی که **انگار** از خودمان آمده: نه پخش شود، نه اعمال.
    bus.publish(BOARD, {
      node: "node-1",
      kind: BUS_KINDS.EPHEMERAL,
      payload: encodeMessage({
        type: MSG_TYPES.HB_EPHEMERAL,
        clientId: 5,
        payload: '{"kind":"laser"}',
      }),
      seq: 0,
    });
    bus.publish(BOARD, {
      node: "node-1",
      kind: BUS_KINDS.UPDATE,
      payload: Y.encodeStateAsUpdate(docFor("stk_echo")),
      seq: 0,
    });

    expect(wire.sent).toHaveLength(0);
    expect(boardRoots(room.doc).elements.has("stk_echo")).toBe(false);
  });

  it("★ و همان دو پیام از نودِ **دیگر** پردازش می‌شوند — ضدِ ادعا", async () => {
    // ⚠️ بدونِ این، یک `return`ِ بی‌قید و شرط هم تستِ بالا را پاس می‌کرد.
    const bus = new MemoryBoardBus();
    const log = new MemoryUpdateLog();
    const one = node("node-1", bus, log, new MemoryOwnerLock("node-1"));

    const wire = recordingSocket();
    const room = await one.rooms.join(session(wire.socket, "usr_a"));
    wire.sent.length = 0;

    bus.publish(BOARD, {
      node: "node-2",
      kind: BUS_KINDS.EPHEMERAL,
      payload: encodeMessage({
        type: MSG_TYPES.HB_EPHEMERAL,
        clientId: 5,
        payload: '{"kind":"laser"}',
      }),
      seq: 0,
    });
    bus.publish(BOARD, {
      node: "node-2",
      kind: BUS_KINDS.UPDATE,
      payload: Y.encodeStateAsUpdate(docFor("stk_echo")),
      seq: 0,
    });

    expect(wire.decoded().some((m) => m?.type === MSG_TYPES.HB_EPHEMERAL)).toBe(true);
    expect(boardRoots(room.doc).elements.has("stk_echo")).toBe(true);
  });
});

describe("★★ فقط صاحب می‌نویسد", () => {
  it("★★ update از نودِ غیرِ صاحب **یک بار** نوشته می‌شود، نه دو بار", async () => {
    let appends = 0;
    const inner = new MemoryUpdateLog();
    const log: UpdateLog = {
      append: (board, payload, origin) => {
        appends++;
        return inner.append(board, payload, origin);
      },
      since: (board, after, upto) => inner.since(board, after, upto),
      latestSeq: (board) => inner.latestSeq(board),
      prune: (board, upto) => inner.prune(board, upto),
    };

    const bus = new MemoryBoardBus();
    // ⚠️ **یک دفترِ مشترک** — نودِ دوم باید ببازد، همان کاری که Redis می‌کند.
    const holders = new Map<string, string>();
    const shared = new MemoryOwnerLock("node-1", holders);
    const one = node("node-1", bus, log, shared);
    const two = node("node-2", bus, log, new MemoryOwnerLock("node-2", holders));

    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await one.rooms.join(session(aWire.socket, "usr_a"));
    await two.rooms.join(session(bWire.socket, "usr_b"));
    appends = 0;

    // کلاینتِ نودِ **غیرِ صاحب** می‌نویسد.
    bWire.receive(docUpdate("stk_1"));
    await vi.waitFor(() => expect(appends).toBeGreaterThan(0));

    expect(appends).toBe(1);
    await expect(shared.renew(BOARD)).resolves.toBe(true);
  });

  it("★★ نودِ غیرِ صاحب «ذخیره شد» **نمی‌گوید** تا صاحب واقعاً بنویسد", async () => {
    // ⚠️ این ADR-009 در دنیای چندنودی است: نودی که نمی‌نویسد حق ندارد ادعای
    //    دوام کند. حقیقتش با `BUS_KINDS.SAVED` از صاحب می‌آید.
    const bus = new MemoryBoardBus();
    const log = new MemoryUpdateLog();
    const holders = new Map<string, string>();
    const one = node("node-1", bus, log, new MemoryOwnerLock("node-1", holders));
    const two = node("node-2", bus, log, new MemoryOwnerLock("node-2", holders));

    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await one.rooms.join(session(aWire.socket, "usr_a"));
    await two.rooms.join(session(bWire.socket, "usr_b"));
    bWire.sent.length = 0;

    bWire.receive(docUpdate("stk_1"));

    // ★ و در پایان `saved` با `seq`ِ واقعیِ صاحب می‌رسد.
    await vi.waitFor(() => expect(bWire.lastSave()?.save).toBe("saved"));
    expect(bWire.lastSave()?.seq).toBe(1);
    expect(await log.latestSeq(BOARD)).toBe(1);
  });

  it("★ نودِ غیرِ صاحب فشرده هم نمی‌کند", async () => {
    // فشرده‌سازی می‌نویسد **و حذف می‌کند**؛ دو نود همزمان یعنی همان چیزی که
    // ترتیبِ امنِ گام ۴٫۴ فرض کرده هرگز رخ نمی‌دهد.
    const bus = new MemoryBoardBus();
    const log = new MemoryUpdateLog();
    const compact = vi.fn().mockResolvedValue(null);
    const followerLock = new MemoryOwnerLock("node-2");
    followerLock.giveTo(BOARD, "node-1");

    const rooms = createRoomManager({
      store: new MemoryBoardStore(),
      log,
      bus,
      ownerLock: followerLock,
      nodeId: "node-2",
      compactor: { shouldCompact: () => true, compact },
      limits: { maxRoomsPerNode: 10, maxDocBytes: 5_000_000, idleTimeoutMs: 60_000 },
      logger: createLogger({ level: "fatal" }),
    });

    const wire = recordingSocket();
    await rooms.join(session(wire.socket, "usr_b"));
    wire.receive(docUpdate("stk_1"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(compact).not.toHaveBeenCalled();
  });
});

describe("حضور بینِ نودها", () => {
  it("مکان‌نمای نودِ ۱ روی کلاینتِ نودِ ۲ دیده می‌شود", async () => {
    const { node: spawn } = cluster();
    const one = spawn("node-1");
    const two = spawn("node-2");

    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await one.rooms.join(session(aWire.socket, "usr_a"));
    await two.rooms.join(session(bWire.socket, "usr_b"));
    bWire.sent.length = 0;

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState({ user: { name: "الف" } });
    aWire.receive(
      encodeMessage({
        type: MSG_TYPES.AWARENESS,
        payload: encodeAwarenessUpdate(awareness, [doc.clientID]),
      }),
    );

    expect(bWire.decoded().some((m) => m?.type === MSG_TYPES.AWARENESS)).toBe(true);
    doc.destroy();
  });

  it("ephemeral هم رد می‌شود و **هیچ ردیفی** نمی‌سازد", async () => {
    const { log, node: spawn } = cluster();
    const one = spawn("node-1");
    const two = spawn("node-2");

    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await one.rooms.join(session(aWire.socket, "usr_a"));
    await two.rooms.join(session(bWire.socket, "usr_b"));
    bWire.sent.length = 0;

    aWire.receive(
      encodeMessage({ type: MSG_TYPES.HB_EPHEMERAL, clientId: 9, payload: '{"kind":"laser"}' }),
    );

    expect(
      bWire.decoded().some((m) => m?.type === MSG_TYPES.HB_EPHEMERAL && m.clientId === 9),
    ).toBe(true);
    expect(await log.latestSeq(BOARD)).toBe(0);
  });

  it("★ قطعِ کلاینت روی نودِ ۱، مکان‌نمایش را از کلاینتِ نودِ ۲ هم پاک می‌کند", async () => {
    const { node: spawn } = cluster();
    const one = spawn("node-1");
    const two = spawn("node-2");

    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await one.rooms.join(session(aWire.socket, "usr_a"));
    await two.rooms.join(session(bWire.socket, "usr_b"));

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState({ user: { name: "الف" } });
    aWire.receive(
      encodeMessage({
        type: MSG_TYPES.AWARENESS,
        payload: encodeAwarenessUpdate(awareness, [doc.clientID]),
      }),
    );

    // دفترِ نودِ ۲ باید او را داشته باشد.
    const peer = new Y.Doc();
    const peerAwareness = new Awareness(peer);
    for (const message of bWire.decoded()) {
      if (message?.type !== MSG_TYPES.AWARENESS) continue;
      applyRemote(peerAwareness, message.payload);
    }
    expect([...peerAwareness.getStates().keys()]).toContain(doc.clientID);

    bWire.sent.length = 0;
    aWire.disconnect();

    for (const message of bWire.decoded()) {
      if (message?.type !== MSG_TYPES.AWARENESS) continue;
      applyRemote(peerAwareness, message.payload);
    }
    expect([...peerAwareness.getStates().keys()]).not.toContain(doc.clientID);
    doc.destroy();
    peer.destroy();
  });
});

describe("بدونِ گذرگاه، همه‌چیز مثلِ قبل است", () => {
  it("سرورِ تک‌نودی صاحبِ خودش است و می‌نویسد", async () => {
    // ⚠️ فاز ۱ در ADR-006 هنوز یک استقرارِ معتبر است؛ نبودِ Redis نباید یعنی
    //    «هیچ‌کس نمی‌نویسد».
    const log = new MemoryUpdateLog();
    const rooms = createRoomManager({
      store: new MemoryBoardStore(),
      log,
      limits: { maxRoomsPerNode: 10, maxDocBytes: 5_000_000, idleTimeoutMs: 60_000 },
      logger: createLogger({ level: "fatal" }),
    });

    const wire = recordingSocket();
    await rooms.join(session(wire.socket));
    wire.receive(docUpdate("stk_1"));

    await vi.waitFor(async () => {
      expect(await log.latestSeq(BOARD)).toBe(1);
    });
  });
});

function applyRemote(awareness: Awareness, payload: Uint8Array): void {
  applyAwarenessUpdate(awareness, payload, "test");
}
