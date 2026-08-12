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
import { describe, expect, it } from "vitest";

import { createLogger } from "./log.ts";
import { MemoryUpdateLog, type AppendedUpdate, type UpdateLog } from "./persistence/update-log.ts";
import { createRoomManager, type RoomManager } from "./room.ts";
import type { RtSession } from "./server.ts";
import { MemoryBoardStore } from "./store/board-store.ts";

/**
 * تست‌های گام ۴٫۶ — **حضور و داده‌ی موقتِ سمتِ سرور**
 * ([ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022)).
 *
 * دو ادعای معیارِ پذیرش: هزار پیامِ ephemeral **هیچ ردیفی** نمی‌سازد، و قطعِ
 * ناگهانیِ کلاینت مکان‌نمایش را از بقیه **پاک می‌کند**.
 */

const BOARD = "brd_aware";

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
    /** قطعِ اتصال — همان چیزی که `ws` روی بستنِ سوکت می‌دهد. */
    disconnect: () => {
      for (const cb of handlers.get("close") ?? []) cb(undefined);
    },
    decoded: () => sent.map((bytes) => decodeMessage(bytes)),
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

function managerWith(log: UpdateLog = new MemoryUpdateLog()): {
  rooms: RoomManager;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    rooms: createRoomManager({
      store: new MemoryBoardStore(),
      log,
      limits: { maxRoomsPerNode: 10, maxDocBytes: 5_000_000, idleTimeoutMs: 60_000 },
      logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
    }),
  };
}

/**
 * یک کلاینتِ **واقعی**ِ awareness: `Awareness` خودش را دارد و بایت‌های واقعی
 * تولید و مصرف می‌کند.
 *
 * ⚠️ ساختنِ بایت‌ها با دست وسوسه‌انگیز بود و غلط: کلِ ادعای این گام «clockها درست
 * جلو می‌روند» است، و آن را فقط خودِ `y-protocols` می‌داند.
 */
function presenceClient(name: string) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalState({ user: { name } });
  return {
    awareness,
    clientId: doc.clientID,
    /** بایت‌های اعلامِ حضور — همان چیزی که binder می‌فرستد. */
    announce: (): Uint8Array =>
      encodeMessage({
        type: MSG_TYPES.AWARENESS,
        payload: encodeAwarenessUpdate(awareness, [doc.clientID]),
      }),
    /** هرچه سرور فرستاد را روی دفترِ محلی اعمال کن. */
    ingest(messages: ReturnType<typeof decodeMessage>[]) {
      for (const message of messages) {
        if (message?.type !== MSG_TYPES.AWARENESS) continue;
        applyAwarenessUpdate(awareness, message.payload, "server");
      }
    },
    /** چه کسانی از دیدِ این کلاینت **حاضر**اند (به‌جز خودش). */
    peers(): number[] {
      return [...awareness.getStates().keys()].filter((id) => id !== doc.clientID);
    },
    destroy: () => doc.destroy(),
  };
}

function ephemeral(clientId: number, payload: string): Uint8Array {
  return encodeMessage({ type: MSG_TYPES.HB_EPHEMERAL, clientId, payload });
}

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

function docUpdate(id: string): Uint8Array {
  const doc = createBoardDoc();
  doc.transact(() => {
    writeElement(boardRoots(doc).elements, element(id));
  });
  const inner = encoding.createEncoder();
  syncProtocol.writeUpdate(inner, Y.encodeStateAsUpdate(doc));
  return encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(inner) });
}

describe("★★ معیارِ پذیرش — ephemeral هیچ‌وقت پایدار نمی‌شود", () => {
  it("★★ بعد از **هزار** پیامِ ephemeral، لاگ صفر ردیفِ جدید دارد", async () => {
    let appends = 0;
    const inner = new MemoryUpdateLog();
    const counting: UpdateLog = {
      append: (board, payload, origin): Promise<AppendedUpdate> => {
        appends++;
        return inner.append(board, payload, origin);
      },
      since: (board, after, upto) => inner.since(board, after, upto),
      latestSeq: (board) => inner.latestSeq(board),
      prune: (board, upto) => inner.prune(board, upto),
    };

    const { rooms } = managerWith(counting);
    const wire = recordingSocket();
    await rooms.join(session(wire.socket));

    for (let i = 0; i < 1000; i++) {
      wire.receive(ephemeral(1, `{"kind":"laser","i":${String(i)}}`));
    }

    expect(appends).toBe(0);
    expect(await counting.latestSeq(BOARD)).toBe(0);
  });

  it("★ و awareness هم پایدار نمی‌شود", async () => {
    const log = new MemoryUpdateLog();
    const { rooms } = managerWith(log);
    const wire = recordingSocket();
    await rooms.join(session(wire.socket));
    const client = presenceClient("الف");

    for (let i = 0; i < 50; i++) {
      client.awareness.setLocalStateField("cursor", { x: i, y: i });
      wire.receive(client.announce());
    }

    expect(await log.latestSeq(BOARD)).toBe(0);
    client.destroy();
  });

  it("★ ضدِ ادعا: یک updateِ **سندی** حتماً پایدار می‌شود", async () => {
    // ⚠️ بدونِ این، یک اتاقِ کاملاً خراب (که هیچ‌چیز را نمی‌نویسد) هم دو تستِ
    //    بالا را پاس می‌کرد.
    const log = new MemoryUpdateLog();
    const { rooms } = managerWith(log);
    const wire = recordingSocket();
    await rooms.join(session(wire.socket));

    wire.receive(docUpdate("stk_1"));

    await expect(log.latestSeq(BOARD)).resolves.toBe(1);
  });
});

describe("★★ معیارِ پذیرش — قطعِ ناگهانی مکان‌نما را پاک می‌کند", () => {
  it("★★ همتا بعد از قطعِ اتصال دیگر دیده نمی‌شود", async () => {
    const { rooms } = managerWith();
    const aWire = recordingSocket();
    const bWire = recordingSocket();
    const a = presenceClient("الف");
    const b = presenceClient("ب");

    await rooms.join(session(aWire.socket, "usr_a"));
    await rooms.join(session(bWire.socket, "usr_b"));

    aWire.receive(a.announce());
    bWire.receive(b.announce());

    // الف باید ب را ببیند.
    a.ingest(aWire.decoded());
    expect(a.peers()).toContain(b.clientId);

    // ★★ ب ناگهان می‌رود — بدونِ خداحافظی.
    aWire.sent.length = 0;
    bWire.disconnect();
    a.ingest(aWire.decoded());

    // ⚠️ این همان چیزی است که گام ۳٫۵ نتوانست بیازماید: بدونِ سرور، تنها راهِ
    //    پاک‌شدن جاروی ۳۰ثانیه‌ای بود که با زمان‌بندِ ساختگی دست‌نیافتنی است.
    expect(a.peers()).not.toContain(b.clientId);
    a.destroy();
    b.destroy();
  });

  it("★ کلاینتِ تازه، حاضرانِ **قبلی** را می‌بیند", async () => {
    // ⚠️ حضور در پیامِ **تغییر** می‌آید؛ بدونِ تحویلِ وضعیتِ فعلی، تازه‌وارد تا
    //    اولین تکانِ هر همتا او را نمی‌دید — و همتای ساکن ممکن است تکان نخورد.
    const { rooms } = managerWith();
    const aWire = recordingSocket();
    const a = presenceClient("الف");
    await rooms.join(session(aWire.socket, "usr_a"));
    aWire.receive(a.announce());

    const bWire = recordingSocket();
    const b = presenceClient("ب");
    await rooms.join(session(bWire.socket, "usr_b"));

    b.ingest(bWire.decoded());
    expect(b.peers()).toContain(a.clientId);
    a.destroy();
    b.destroy();
  });
});

describe("پخشِ حضور", () => {
  it("به همتا می‌رسد ولی به خودِ فرستنده برنمی‌گردد", async () => {
    const { rooms } = managerWith();
    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await rooms.join(session(aWire.socket, "usr_a"));
    await rooms.join(session(bWire.socket, "usr_b"));
    const a = presenceClient("الف");

    aWire.sent.length = 0;
    bWire.sent.length = 0;
    aWire.receive(a.announce());

    expect(aWire.decoded().some((m) => m?.type === MSG_TYPES.AWARENESS)).toBe(false);
    expect(bWire.decoded().some((m) => m?.type === MSG_TYPES.AWARENESS)).toBe(true);
    a.destroy();
  });

  it("`viewer` هم حضور می‌فرستد", async () => {
    // تماشاگری که مکان‌نمایش دیده نمی‌شود، از نظرِ بقیه در اتاق نیست (گام ۴٫۵).
    const { rooms } = managerWith();
    const viewerWire = recordingSocket();
    const peerWire = recordingSocket();
    await rooms.join(session(viewerWire.socket, "usr_v", "viewer"));
    await rooms.join(session(peerWire.socket, "usr_p"));
    const viewer = presenceClient("تماشاگر");

    peerWire.sent.length = 0;
    viewerWire.receive(viewer.announce());

    expect(peerWire.decoded().some((m) => m?.type === MSG_TYPES.AWARENESS)).toBe(true);
    viewer.destroy();
  });

  it("بایتِ خرابِ حضور اتاق را نمی‌اندازد", async () => {
    const { rooms, lines } = managerWith();
    const wire = recordingSocket();
    await rooms.join(session(wire.socket));

    expect(() => {
      wire.receive(
        encodeMessage({ type: MSG_TYPES.AWARENESS, payload: new Uint8Array([9, 9, 9]) }),
      );
    }).not.toThrow();
    expect(lines.join("\n")).toContain("به‌روزرسانیِ حضور خوانده نشد");
  });
});

describe("پخشِ ephemeral", () => {
  it("عیناً به همتا می‌رسد و به فرستنده برنمی‌گردد", async () => {
    const { rooms } = managerWith();
    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await rooms.join(session(aWire.socket, "usr_a"));
    await rooms.join(session(bWire.socket, "usr_b"));

    aWire.sent.length = 0;
    bWire.sent.length = 0;
    aWire.receive(ephemeral(7, '{"kind":"laser"}'));

    const received = bWire.decoded().find((m) => m?.type === MSG_TYPES.HB_EPHEMERAL);
    expect(received).toMatchObject({ clientId: 7, payload: '{"kind":"laser"}' });
    expect(aWire.decoded().some((m) => m?.type === MSG_TYPES.HB_EPHEMERAL)).toBe(false);
  });

  it("★ `clientId`ِ جعلی رد می‌شود", async () => {
    // ⚠️ بدونِ این، یک همتا می‌تواند استروک یا لیزر را به نامِ **کاربرِ دیگری**
    //    بکشد. مالکیت از دفترِ حضور می‌آید.
    const { rooms } = managerWith();
    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await rooms.join(session(aWire.socket, "usr_a"));
    await rooms.join(session(bWire.socket, "usr_b"));
    const a = presenceClient("الف");
    const b = presenceClient("ب");
    aWire.receive(a.announce());
    bWire.receive(b.announce());

    aWire.sent.length = 0;
    // الف وانمود می‌کند ب است.
    bWire.receive(ephemeral(a.clientId, '{"kind":"laser","fake":true}'));

    expect(aWire.decoded().some((m) => m?.type === MSG_TYPES.HB_EPHEMERAL)).toBe(false);
    a.destroy();
    b.destroy();
  });

  it("قبل از اعلامِ حضور، سخت‌گیری نمی‌شود (fail-open و عمدی)", async () => {
    // ⚠️ ephemeral می‌تواند زودتر از awarenessِ همان کلاینت برسد؛ ردِ آن یعنی
    //    انداختنِ اولین استروکِ یک کلاینتِ کاملاً سالم.
    const { rooms } = managerWith();
    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await rooms.join(session(aWire.socket, "usr_a"));
    await rooms.join(session(bWire.socket, "usr_b"));

    aWire.sent.length = 0;
    bWire.receive(ephemeral(12_345, '{"kind":"stroke"}'));

    expect(aWire.decoded().some((m) => m?.type === MSG_TYPES.HB_EPHEMERAL)).toBe(true);
  });
});

describe("`HB_ROOM_INFO.users` با آمد و رفت هم‌گام می‌مانَد", () => {
  function lastUsers(wire: ReturnType<typeof recordingSocket>): number | undefined {
    const infos = wire.decoded().filter((m) => m?.type === MSG_TYPES.HB_ROOM_INFO);
    const last = infos.at(-1);
    return last?.type === MSG_TYPES.HB_ROOM_INFO ? last.users : undefined;
  }

  it("ورودِ نفرِ دوم به نفرِ اول اعلام می‌شود", async () => {
    const { rooms } = managerWith();
    const aWire = recordingSocket();
    await rooms.join(session(aWire.socket, "usr_a"));
    expect(lastUsers(aWire)).toBe(1);

    const bWire = recordingSocket();
    await rooms.join(session(bWire.socket, "usr_b"));

    expect(lastUsers(aWire)).toBe(2);
  });

  it("خروج هم اعلام می‌شود", async () => {
    const { rooms } = managerWith();
    const aWire = recordingSocket();
    const bWire = recordingSocket();
    await rooms.join(session(aWire.socket, "usr_a"));
    await rooms.join(session(bWire.socket, "usr_b"));

    bWire.disconnect();

    expect(lastUsers(aWire)).toBe(1);
  });
});
