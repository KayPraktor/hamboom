import type { HbElement } from "@hamboom/shared-types";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  MSG_TYPES,
  writeElement,
} from "@hamboom/ydoc-schema";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../log.ts";
import { createRoomManager } from "../room.ts";
import type { RtSession } from "../server.ts";
import { createPersistedBoardStore } from "../store/persisted-board-store.ts";
import { auditableUserId } from "./postgres-update-log.ts";
import { MemoryUpdateLog, type AppendedUpdate, type UpdateLog } from "./update-log.ts";

/**
 * تست‌های گام ۴٫۳ — **ترتیبِ دوام و ack**.
 *
 * ⚠️ این فایل ادعای **دوام** نمی‌کند و نمی‌تواند بکند: با یک لاگِ حافظه‌ای، هر
 * ادعایی درباره‌ی «بعد از SIGKILL هنوز هست» توخالی است. آنچه اینجا آزموده
 * می‌شود **ترتیب** است — که نوشتن *قبل از* ack اتفاق بیفتد. خودِ دوام فقط با
 * Postgresِ واقعی و [`scripts/rt-durability.ts`](../../../../scripts/rt-durability.ts)
 * سنجیده می‌شود.
 */

const BOARD = "brd_1";

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

/** سوکتِ ساختگی که هر بایتِ فرستاده‌شده را با ترتیب ثبت می‌کند. */
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
    /** رسیدنِ یک پیام از کلاینت. */
    receive: (data: Uint8Array) => {
      for (const cb of handlers.get("message") ?? []) cb(data);
    },
    decoded: () => sent.map((bytes) => decodeMessage(bytes)),
  };
}

function session(socket: unknown, sub = "usr_1"): RtSession {
  return {
    socket: socket as RtSession["socket"],
    boardId: BOARD,
    sub,
    role: "editor",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

/**
 * بایت‌های یک `update`ِ Yjs، همان‌طور که کلاینت می‌فرستد.
 *
 * ⚠️ **حالتِ کامل، نه دیفِ افزایشی** — و این سومین باری است که همین تله در این
 * ماژول ظاهر می‌شود (گام ۳٫۱، بعد ۴٫۲، حالا اینجا): یک دیف که opهای قبلیِ همان
 * کلاینت را نداشته باشد، در `pendingStructs` می‌نشیند، رویدادِ `update` نمی‌دهد،
 * و **هیچ خطایی هم نمی‌دهد** — یعنی تست بی‌صدا هیچ‌چیز را نمی‌آزماید.
 * `encodeStateAsUpdate` بدونِ بردارِ وضعیت، همان چیزی است که step2ِ واقعی
 * می‌فرستد و علّیاً کامل است.
 */
function clientUpdate(build: (doc: Y.Doc) => void): Uint8Array {
  const doc = createBoardDoc();
  build(doc);
  const encoder = encoding.createEncoder();
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
  return encoding.toUint8Array(encoder);
}

function managerWith(log: UpdateLog) {
  const lines: string[] = [];
  return {
    lines,
    rooms: createRoomManager({
      store: createPersistedBoardStore(log),
      log,
      limits: { maxRoomsPerNode: 10, maxDocBytes: 5_000_000, idleTimeoutMs: 60_000 },
      logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
    }),
  };
}

describe("★★ دوام قبل از ack", () => {
  it("`saved` **بعد از** نوشتن می‌آید، نه قبلش", async () => {
    /** لاگی که ترتیبِ واقعیِ رویدادها را ثبت می‌کند. */
    const order: string[] = [];
    const inner = new MemoryUpdateLog();
    const log: UpdateLog = {
      since: (board, after) => inner.since(board, after),
      latestSeq: (board) => inner.latestSeq(board),
      async append(board, payload, origin): Promise<AppendedUpdate> {
        order.push("append:start");
        // یک تیک تاخیر تا اگر کسی زودتر ack بفرستد، اینجا دیده شود.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const result = await inner.append(board, payload, origin);
        order.push("append:done");
        return result;
      },
    };

    const { rooms } = managerWith(log);
    const wire = recordingSocket();
    await rooms.join(session(wire.socket));
    wire.sent.length = 0;

    wire.receive(
      encodeSync(clientUpdate((doc) => writeElement(boardRoots(doc).elements, element("stk_1")))),
    );
    await vi.waitFor(() => expect(order).toContain("append:done"));

    const saved = wire
      .decoded()
      .findIndex((message) => message?.type === MSG_TYPES.HB_ROOM_INFO && message.save === "saved");
    expect(saved).toBeGreaterThanOrEqual(0);
    // ★★ ادعای مرکزی: نوشتن تمام شده **بود** که ack رفت.
    expect(order).toEqual(["append:start", "append:done"]);
  });

  it("★ اگر نوشتن شکست بخورد، `saved` **گفته نمی‌شود**", async () => {
    // ⚠️ این ضدِ ادعاست: یک پیاده‌سازی که همیشه ack می‌فرستد، تستِ بالا را هم
    //    پاس می‌کرد. اینجا دیتابیس می‌ترکد و کلاینت باید `unsaved` ببیند.
    const log: UpdateLog = {
      append: () => Promise.reject(new Error("دیتابیس در دسترس نیست")),
      since: () => Promise.resolve([]),
      latestSeq: () => Promise.resolve(0),
    };

    const { rooms, lines } = managerWith(log);
    const wire = recordingSocket();
    await rooms.join(session(wire.socket));
    wire.sent.length = 0;

    wire.receive(
      encodeSync(clientUpdate((doc) => writeElement(boardRoots(doc).elements, element("stk_1")))),
    );
    await vi.waitFor(() =>
      expect(
        wire.decoded().some((m) => m?.type === MSG_TYPES.HB_ROOM_INFO && m.save === "unsaved"),
      ).toBe(true),
    );

    expect(
      wire.decoded().some((m) => m?.type === MSG_TYPES.HB_ROOM_INFO && m.save === "saved"),
    ).toBe(false);
    expect(lines.join("\n")).toContain("نوشتنِ update شکست خورد");
  });

  it("★ همتا هم **بعد از** نوشتن پیام را می‌گیرد", async () => {
    // اگر پخش قبل از نوشتن بود، همتا می‌توانست چیزی ببیند که سرور از دستش داده.
    const log = new MemoryUpdateLog(5);
    const { rooms } = managerWith(log);

    const author = recordingSocket();
    const peer = recordingSocket();
    await rooms.join(session(author.socket, "usr_1"));
    await rooms.join(session(peer.socket, "usr_2"));
    peer.sent.length = 0;

    author.receive(
      encodeSync(clientUpdate((doc) => writeElement(boardRoots(doc).elements, element("stk_1")))),
    );

    await vi.waitFor(() =>
      expect(peer.decoded().some((m) => m?.type === MSG_TYPES.SYNC)).toBe(true),
    );
    // در همان لحظه، لاگ از قبل نوشته شده.
    await expect(log.latestSeq(BOARD)).resolves.toBe(1);
  });
});

describe("★★ ستونِ ممیزی نباید دوام را بشکند", () => {
  // ⚠️ این را **تستِ SIGKILL** پیدا کرد، نه بازبینی و نه تستِ واحد: ستونِ
  // `origin_user_id` از نوعِ `uuid` است ولی `sub`ِ توکن لزوماً uuid نیست، و
  // نتیجه‌اش این بود که **هر** append با `invalid input syntax for type uuid`
  // می‌افتاد — یعنی پایداری کاملاً خراب بود در حالی که همه‌ی تست‌های واحد سبز
  // بودند (لاگِ حافظه‌ای uuid نمی‌فهمد).
  it("subِ غیرuuid به `null` تبدیل می‌شود، نه اینکه نوشتن را بیندازد", () => {
    expect(auditableUserId("usr_durability")).toBeNull();
    expect(auditableUserId("")).toBeNull();
    expect(auditableUserId(null)).toBeNull();
  });

  it("★ uuidِ واقعی دست‌نخورده می‌مانَد — وگرنه ممیزی همیشه خالی می‌شد", () => {
    const id = "137fed43-91b0-45e5-841f-09edab2ff262";
    expect(auditableUserId(id)).toBe(id);
    expect(auditableUserId(id.toUpperCase())).toBe(id.toUpperCase());
  });
});

describe("لاگ و بارگذاریِ دوباره", () => {
  it("update پایدار می‌شود و اتاقِ تازه همان سند را می‌سازد", async () => {
    const log = new MemoryUpdateLog();
    const first = managerWith(log);
    const wire = recordingSocket();
    await first.rooms.join(session(wire.socket));

    wire.receive(
      encodeSync(clientUpdate((doc) => writeElement(boardRoots(doc).elements, element("stk_1")))),
    );
    await vi.waitFor(async () => expect(await log.latestSeq(BOARD)).toBe(1));
    await first.rooms.close();

    // ★ اتاقِ کاملاً تازه، فقط از روی لاگ.
    const second = managerWith(log);
    const room = await second.rooms.join(session(recordingSocket().socket));
    expect(boardRoots(room.doc).elements.has("stk_1")).toBe(true);
  });

  it("`seq` درونِ بورد ترتیبی بالا می‌رود", async () => {
    const log = new MemoryUpdateLog();
    const { rooms } = managerWith(log);
    const wire = recordingSocket();
    await rooms.join(session(wire.socket));

    for (const id of ["stk_1", "stk_2", "stk_3"]) {
      wire.receive(
        encodeSync(clientUpdate((doc) => writeElement(boardRoots(doc).elements, element(id)))),
      );
    }

    await vi.waitFor(async () => expect(await log.latestSeq(BOARD)).toBe(3));
  });

  it("★ قرنطینه پایدار **نمی‌شود** — لاگ حقیقتِ خام را نگه می‌دارد", async () => {
    // اگر حذفِ قرنطینه هم لاگ می‌شد، پاک‌سازی دائمی می‌شد و اصلِ داده می‌رفت.
    const doc = createBoardDoc();
    doc.transact(() => boardRoots(doc).elements.set("stk_bad", 42 as never));

    const log = new MemoryUpdateLog();
    await log.append(BOARD, Y.encodeStateAsUpdate(doc), null);
    const seqBefore = await log.latestSeq(BOARD);

    const { rooms } = managerWith(log);
    const room = await rooms.join(session(recordingSocket().socket));

    expect(room.report.quarantined).toEqual(["stk_bad"]);
    await expect(log.latestSeq(BOARD)).resolves.toBe(seqBefore);
  });
});

// ── کمکی ─────────────────────────────────────────────────────

function encodeSync(payload: Uint8Array): Uint8Array {
  return encodeMessage({ type: MSG_TYPES.SYNC, payload });
}
