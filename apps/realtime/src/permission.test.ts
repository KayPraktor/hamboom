import type { HbElement } from "@hamboom/shared-types";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  HB_ERROR_CODES,
  MSG_TYPES,
  writeElement,
  type BoardRole,
} from "@hamboom/ydoc-schema";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "./log.ts";
import { mayBroadcastPresence, mayWriteDocument } from "./permission.ts";
import { MemoryUpdateLog } from "./persistence/update-log.ts";
import { createRoomManager, type RoomManager } from "./room.ts";
import type { RtSession } from "./server.ts";
import { MemoryBoardStore } from "./store/board-store.ts";

/**
 * تست‌های گام ۴٫۵ — **اعمالِ مجوز روی هر update**
 * ([ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012)).
 *
 * ★ ادعای مرکزی همان چیزی است که ADR-012 اسمش را برده و معیارِ پذیرشِ TODO
 * می‌خواهد: **کلاینتی که UI را دور می‌زند و مستقیماً updateِ باینریِ معتبرِ Yjs
 * می‌فرستد، نباید بتواند سند را عوض کند.**
 */

const BOARD = "brd_perm";

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
    decoded: () => sent.map((bytes) => decodeMessage(bytes)),
  };
}

function session(socket: unknown, role: BoardRole, sub = "usr_1"): RtSession {
  return {
    socket: socket as RtSession["socket"],
    boardId: BOARD,
    sub,
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function managerWith(): { rooms: RoomManager; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    rooms: createRoomManager({
      store: new MemoryBoardStore(),
      log: new MemoryUpdateLog(),
      limits: { maxRoomsPerNode: 10, maxDocBytes: 5_000_000, idleTimeoutMs: 60_000 },
      logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
    }),
  };
}

/**
 * ★★ **حمله:** بایت‌های یک updateِ کاملاً معتبرِ Yjs، ساخته‌شده بیرونِ هر UI.
 *
 * ⚠️ حالتِ **کامل** و نه دیفِ افزایشی — وگرنه Yjs آن را در `pendingStructs`
 * بایگانی می‌کند و تست بی‌صدا هیچ‌چیز را نمی‌آزماید (تله‌ی تکرارشونده‌ی این ماژول).
 * یعنی این پیام اگر رد **نشود**، قطعاً سند را عوض می‌کند.
 */
function attackerUpdate(id: string): Uint8Array {
  const doc = createBoardDoc();
  doc.transact(() => {
    writeElement(boardRoots(doc).elements, element(id));
  });
  const inner = encoding.createEncoder();
  syncProtocol.writeUpdate(inner, Y.encodeStateAsUpdate(doc));
  return encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(inner) });
}

/** پیامِ `step1` — «چه چیزی کم دارم؟». نوشتن نیست و باید برای همه مجاز باشد. */
function readRequest(): Uint8Array {
  const inner = encoding.createEncoder();
  syncProtocol.writeSyncStep1(inner, new Y.Doc());
  return encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(inner) });
}

describe("سیاستِ مجوز", () => {
  it.each<[BoardRole, boolean]>([
    ["owner", true],
    ["editor", true],
    ["commenter", false],
    ["viewer", false],
  ])("نقشِ %s → نوشتن در سند: %s", (role, allowed) => {
    expect(mayWriteDocument(role)).toBe(allowed);
  });

  it("★ نقشِ ناشناخته **نمی‌نویسد** — fail closed", () => {
    // ⚠️ نقش می‌تواند از یک نودِ دیگر یا از پیاده‌سازیِ M3 بیاید. اگر مقدارِ
    //    ناشناخته «مجاز» شمرده شود، اولین ناسازگاریِ نسخه یک حفره‌ی مجوز است.
    for (const bogus of ["admin", "", null, undefined, 0, {}]) {
      expect(mayWriteDocument(bogus)).toBe(false);
    }
  });

  it("همه‌ی نقش‌های شناخته‌شده حضور می‌فرستند، حتی viewer", () => {
    // تماشاگری که مکان‌نمایش دیده نمی‌شود، از نظرِ بقیه در اتاق **نیست**.
    expect(mayBroadcastPresence("viewer")).toBe(true);
    expect(mayBroadcastPresence("nope")).toBe(false);
  });
});

describe("★★ معیارِ پذیرش — تستِ مهاجم", () => {
  it("★★ `viewer` که مستقیماً updateِ باینریِ معتبر می‌فرستد، سند را عوض **نمی‌کند**", async () => {
    const { rooms } = managerWith();
    const wire = recordingSocket();
    const room = await rooms.join(session(wire.socket, "viewer"));
    wire.sent.length = 0;

    wire.receive(attackerUpdate("stk_attack"));

    // ★ ادعای مرکزی: سند دست‌نخورده.
    expect(boardRoots(room.doc).elements.has("stk_attack")).toBe(false);
    expect(boardRoots(room.doc).elements.size).toBe(0);
  });

  it("همان بایت‌ها از یک `editor` **قبول** می‌شوند — ضدِ ادعا", async () => {
    // ⚠️ بدونِ این، یک پیاده‌سازیِ خرابِ decode هم تستِ بالا را پاس می‌کرد:
    //    «هیچ‌وقت هیچ‌چیز اعمال نمی‌شود» هم سند را دست‌نخورده نگه می‌دارد.
    const { rooms } = managerWith();
    const wire = recordingSocket();
    const room = await rooms.join(session(wire.socket, "editor"));

    wire.receive(attackerUpdate("stk_ok"));

    expect(boardRoots(room.doc).elements.has("stk_ok")).toBe(true);
  });

  it("`viewer` پاسخِ `HB_ERROR{FORBIDDEN}` و نقشش را می‌گیرد", async () => {
    const { rooms } = managerWith();
    const wire = recordingSocket();
    await rooms.join(session(wire.socket, "viewer"));
    wire.sent.length = 0;

    wire.receive(attackerUpdate("stk_attack"));

    const messages = wire.decoded();
    expect(
      messages.some((m) => m?.type === MSG_TYPES.HB_ERROR && m.code === HB_ERROR_CODES.FORBIDDEN),
    ).toBe(true);
    // ★ و **چرایش** هم می‌رود: کلاینت باید UI را فقط-خواندنی کند (گام ۵٫۳).
    expect(messages.some((m) => m?.type === MSG_TYPES.HB_PERMISSION && m.role === "viewer")).toBe(
      true,
    );
  });

  it("★ ولی اتصال **بسته نمی‌شود** — تنزلِ نقش حمله نیست", async () => {
    // ⚠️ بستن هم بی‌فایده است (با همان توکن برمی‌گردد) و هم غلط: کسی که همین
    //    الان `viewer` شده باید بورد را ببیند. ADR-038.
    const { rooms } = managerWith();
    const closed = vi.fn();
    const wire = recordingSocket();
    (wire.socket as unknown as { close: unknown }).close = closed;
    await rooms.join(session(wire.socket, "viewer"));

    wire.receive(attackerUpdate("stk_attack"));

    expect(closed).not.toHaveBeenCalled();
  });

  it("★ رد **لاگ** می‌شود، با شناسه‌ی ماسک‌شده", async () => {
    const { rooms, lines } = managerWith();
    const wire = recordingSocket();
    await rooms.join(session(wire.socket, "viewer", "usr_secret_person"));

    wire.receive(attackerUpdate("stk_attack"));

    const log = lines.join("\n");
    expect(log).toContain("نوشتنِ بی‌مجوز رد شد");
    // P7 — شناسه هرگز خام.
    expect(log).not.toContain("usr_secret_person");
  });

  it("★★ `viewer` هنوز **می‌خوانَد** — `step1` رد نمی‌شود", async () => {
    // ⚠️ اگر این هم بسته می‌شد، نقشِ تماشاگر بی‌معنا بود: وصل می‌شد و بوردِ
    //    خالی می‌دید. تستِ جهتِ منفیِ کلِ این گام همین است.
    const { rooms } = managerWith();
    const author = recordingSocket();
    const viewer = recordingSocket();
    await rooms.join(session(author.socket, "editor", "usr_author"));
    author.receive(attackerUpdate("stk_visible"));

    await rooms.join(session(viewer.socket, "viewer", "usr_viewer"));
    viewer.sent.length = 0;
    viewer.receive(readRequest());

    const replies = viewer.decoded().filter((m) => m?.type === MSG_TYPES.SYNC);
    expect(replies.length).toBeGreaterThan(0);

    // و آنچه رسید واقعاً سند است، نه یک پاسخِ خالی.
    const mine = new Y.Doc();
    for (const message of replies) {
      if (message?.type !== MSG_TYPES.SYNC) continue;
      syncProtocol.readSyncMessage(
        { arr: message.payload, pos: 0 } as never,
        encoding.createEncoder(),
        mine,
        null,
        () => {},
      );
    }
    expect(boardRoots(mine).elements.has("stk_visible")).toBe(true);
  });
});

describe("★★ تغییرِ نقش وسطِ session", () => {
  it("`editor` که `viewer` می‌شود، `HB_PERMISSION` می‌گیرد و updateِ بعدی‌اش رد می‌شود", async () => {
    const { rooms } = managerWith();
    const wire = recordingSocket();
    const room = await rooms.join(session(wire.socket, "editor", "usr_demoted"));

    // قبل از تنزل: می‌نویسد.
    wire.receive(attackerUpdate("stk_before"));
    expect(boardRoots(room.doc).elements.has("stk_before")).toBe(true);

    wire.sent.length = 0;
    expect(rooms.applyRoleChange(BOARD, "usr_demoted", "viewer")).toBe(1);

    expect(
      wire.decoded().some((m) => m?.type === MSG_TYPES.HB_PERMISSION && m.role === "viewer"),
    ).toBe(true);

    // ★★ و **بلافاصله** اثر دارد — نه بعد از اتصالِ مجدد.
    wire.receive(attackerUpdate("stk_after"));
    expect(boardRoots(room.doc).elements.has("stk_after")).toBe(false);
  });

  it("ارتقا هم همان‌طور کار می‌کند", async () => {
    const { rooms } = managerWith();
    const wire = recordingSocket();
    const room = await rooms.join(session(wire.socket, "viewer", "usr_promoted"));

    wire.receive(attackerUpdate("stk_denied"));
    expect(boardRoots(room.doc).elements.has("stk_denied")).toBe(false);

    rooms.applyRoleChange(BOARD, "usr_promoted", "editor");
    wire.receive(attackerUpdate("stk_allowed"));
    expect(boardRoots(room.doc).elements.has("stk_allowed")).toBe(true);
  });

  it("فقط نشست‌های **همان کاربر** را دست می‌زند", async () => {
    const { rooms } = managerWith();
    const mine = recordingSocket();
    const other = recordingSocket();
    const room = await rooms.join(session(mine.socket, "editor", "usr_a"));
    await rooms.join(session(other.socket, "editor", "usr_b"));

    rooms.applyRoleChange(BOARD, "usr_a", "viewer");

    other.receive(attackerUpdate("stk_from_b"));
    expect(boardRoots(room.doc).elements.has("stk_from_b")).toBe(true);
  });

  it("نقشِ تکراری هیچ پیامی نمی‌فرستد", async () => {
    // ⚠️ وگرنه هر بازخوانیِ نقش یک `HB_PERMISSION`ِ بی‌دلیل می‌شد و کلاینت هر بار
    //    UI را از نو می‌ساخت.
    const { rooms } = managerWith();
    const wire = recordingSocket();
    await rooms.join(session(wire.socket, "editor", "usr_same"));
    wire.sent.length = 0;

    expect(rooms.applyRoleChange(BOARD, "usr_same", "editor")).toBe(0);
    expect(wire.sent).toHaveLength(0);
  });

  it("بوردِ بی‌اتاق یا کاربرِ غایب، بی‌صدا صفر برمی‌گرداند", () => {
    const { rooms } = managerWith();
    expect(rooms.applyRoleChange("brd_ghost", "usr_x", "viewer")).toBe(0);
  });
});

describe("نقش در لحظه‌ی اتصال هم اعلام می‌شود", () => {
  it("★ `HB_PERMISSION` **قبل از** سند می‌رسد", async () => {
    // ⚠️ ترتیب مهم است: کلاینتی که اول سند را بگیرد و بعد نقشش را، ممکن است در
    //    آن فاصله step2ِ خودش را بفرستد و بی‌دلیل `FORBIDDEN` بگیرد.
    const { rooms } = managerWith();
    const wire = recordingSocket();
    await rooms.join(session(wire.socket, "viewer"));

    const kinds = wire.decoded().map((m) => m?.type);
    expect(kinds[0]).toBe(MSG_TYPES.HB_PERMISSION);
    expect(kinds).toContain(MSG_TYPES.SYNC);
  });
});

/**
 * ★★ updateِ **تهی** نوشتن نیست — کشفِ سنجه‌ی زنده‌ی `rt-permission`.
 *
 * پروتکلِ sync ایجاب می‌کند کلاینت به step1ِ سرور با step2 جواب بدهد. برای یک
 * تماشاگرِ تازه آن step2 **صفر op** دارد، ولی از نظرِ نوعِ پیام «نوشتن» است — پس
 * هر اتصالِ کاملاً سالمِ `viewer` یک `FORBIDDEN` می‌گرفت. هشداری که با هر اتصال
 * می‌آید، همان هشداری است که کسی جدی نمی‌گیرد.
 */
describe("★★ updateِ تهی از یک viewer، خطا نمی‌سازد", () => {
  function emptyStep2(): Uint8Array {
    const inner = encoding.createEncoder();
    const doc = new Y.Doc();
    // همان چیزی که `readSyncMessage` در پاسخ به step1 تولید می‌کند.
    syncProtocol.writeSyncStep2(inner, doc, Y.encodeStateVector(doc));
    return encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(inner) });
  }

  it("نه `HB_ERROR` می‌آید و نه لاگِ هشدار", async () => {
    const { rooms, lines } = managerWith();
    const wire = recordingSocket();
    await rooms.join(session(wire.socket, "viewer"));
    wire.sent.length = 0;
    lines.length = 0;

    wire.receive(emptyStep2());

    expect(wire.decoded().some((m) => m?.type === MSG_TYPES.HB_ERROR)).toBe(false);
    expect(lines.join("\n")).not.toContain("نوشتنِ بی‌مجوز رد شد");
  });

  it("★ ولی updateِ **پرمحتوا** همچنان رد می‌شود — سهل‌گیری نشد", async () => {
    const { rooms } = managerWith();
    const wire = recordingSocket();
    const room = await rooms.join(session(wire.socket, "viewer"));

    wire.receive(attackerUpdate("stk_not_empty"));

    expect(boardRoots(room.doc).elements.has("stk_not_empty")).toBe(false);
    expect(wire.decoded().some((m) => m?.type === MSG_TYPES.HB_ERROR)).toBe(true);
  });
});
