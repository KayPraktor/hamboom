import type { CanvasInbound, ConnectionState, SaveState } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import { boardRoots, MSG_TYPES, writeElement } from "@hamboom/ydoc-schema";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { YjsSyncAdapter } from "./adapter.ts";
import { LocalOrigin } from "./emit-local.ts";
import type { LocalDocStore } from "./local-store.ts";
import type { SyncTransport, TransportStatus } from "./transport.ts";

/**
 * تست‌های گام ۵٫۲ — **پایداریِ محلی و صداقتِ `SaveState`**.
 *
 * ⚠️ IndexedDB اینجا نیست و نمی‌تواند باشد: محیطِ تست `node` است. پورتِ
 * `LocalDocStore` دقیقاً برای همین وجود دارد — ادعاهای **آداپتور** (ترتیبِ
 * بازیابی، شمارش، بدبینیِ `SaveState`) اینجا آزموده می‌شوند و ادعای «واقعاً روی
 * دیسکِ مرورگر می‌نشیند» در `e2e/offline.spec.ts` با تبِ **بسته و بازشده**.
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
  const saveStates: SaveState[] = [];
  const documents: { elements: HbElement[] }[] = [];
  const inbound: CanvasInbound = {
    applyRemoteChanges: vi.fn(),
    applyPeers: vi.fn(),
    setConnectionState: (state) => connectionStates.push(state),
    setSaveState: (state) => saveStates.push(state),
    setPermissions: vi.fn(),
    replaceDocument: (document) => documents.push(document),
    focusOn: vi.fn(),
  };
  return {
    inbound,
    connectionStates,
    saveStates,
    documents,
    lastSave: (): SaveState | undefined => saveStates.at(-1),
    lastConnection: (): ConnectionState | undefined => connectionStates.at(-1),
  };
}

function fakeLink() {
  const sent: Uint8Array[] = [];
  let onStatus: ((status: TransportStatus) => void) | null = null;

  const transport: SyncTransport = {
    send: (message) => sent.push(message),
    onMessage: () => () => undefined,
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
    emit: (status: TransportStatus): void => onStatus?.(status),
    /** شناسه‌ی عناصری که در `step2`های فرستاده‌شده هست. */
    offeredIds(): string[] {
      const mirror = new Y.Doc();
      for (const message of sent) {
        if (message[0] !== MSG_TYPES.SYNC) continue;
        // بدنه‌ی پیام: `varUint8Array` بعد از بایتِ نوع.
        const payload = decoding.readVarUint8Array(decoding.createDecoder(message.subarray(1)));
        syncProtocol.readSyncMessage(
          decoding.createDecoder(payload),
          // پاسخ به جایی نمی‌رود؛ فقط می‌خواهیم بدانیم چه چیزی پیشنهاد شده.
          encoding.createEncoder(),
          mirror,
          "mirror",
          () => {},
        );
      }
      return [...boardRoots(mirror).elements.keys()];
    },
  };
}

/**
 * انباری که هنگام آماده‌شدن، کارِ «جلسه‌ی قبل» را روی سند می‌نشاند.
 *
 * ⚠️ **عمداً یک macrotask طول می‌کشد، نه یک microtask.** IndexedDB واقعاً کند
 * است، و مهم‌تر: با `Promise.resolve()` این تست حتی بدونِ `await` هم سبز می‌مانْد
 * (چون `await`های دیگرِ `connect` صف را خالی می‌کنند) — یعنی چیزی را که ادعا
 * می‌کند نمی‌سنجید.
 */
function fakeStore(doc: Y.Doc, ids: string[]): LocalDocStore & { restored: boolean } {
  const store = {
    restored: false,
    whenReady: new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      doc.transact(() => {
        for (const id of ids) writeElement(boardRoots(doc).elements, element(id));
      }, "indexeddb");
      store.restored = true;
    }),
    clear: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
  };
  return store;
}

describe("★★ بازیابیِ محلی **قبل از** دست‌دادن انجام می‌شود", () => {
  it("کارِ ذخیره‌شده هم در `replaceDocument` هست و هم در `step2`ی که می‌رود", async () => {
    const doc = new Y.Doc();
    const canvas = fakeCanvas();
    const link = fakeLink();
    const store = fakeStore(doc, ["stk_a", "stk_b", "stk_c"]);
    const adapter = new YjsSyncAdapter({ doc, transport: link.transport, localStore: store });

    await adapter.connect(canvas.inbound);

    expect(store.restored).toBe(true);
    // ۱) بوم بوردِ **کامل** را می‌گیرد، نه خالی و بعد سه تغییرِ remote.
    expect(
      canvas.documents
        .at(-1)
        ?.elements.map((item) => item.id)
        .sort(),
    ).toEqual(["stk_a", "stk_b", "stk_c"]);
    // ۲) ★★ و مهم‌تر: همان سه تا در پیشنهادِ ما به سرور هستند. اگر بازیابی بعد
    //    از دست‌دادن می‌آمد، سرور هرگز خبردار نمی‌شد.
    expect(link.offeredIds().sort()).toEqual(["stk_a", "stk_b", "stk_c"]);
  });

  it("بازیابی **تغییرِ معلق شمرده نمی‌شود** — کارِ ذخیره‌شده تغییرِ تازه نیست", async () => {
    const doc = new Y.Doc();
    const canvas = fakeCanvas();
    const link = fakeLink();
    const adapter = new YjsSyncAdapter({
      doc,
      transport: link.transport,
      localStore: fakeStore(doc, ["stk_a", "stk_b"]),
    });

    await adapter.connect(canvas.inbound);
    link.emit({ phase: "stopped", reason: "offline", code: "NETWORK_OFFLINE", message: "" });

    expect(canvas.lastConnection()).toEqual({ status: "offline", pendingChanges: 0 });
  });

  it("`connect`ِ لغوشده وسطِ بازیابی، `ConnectionCancelledError` می‌دهد", async () => {
    // همان قاعده‌ی هر `await` در `connect` — StrictMode دقیقاً همین‌جا
    // `disconnect` را می‌چپاند.
    const doc = new Y.Doc();
    const canvas = fakeCanvas();
    const adapter = new YjsSyncAdapter({ doc, localStore: fakeStore(doc, ["stk_a"]) });

    const pending = adapter.connect(canvas.inbound);
    adapter.disconnect();

    await expect(pending).rejects.toThrow("اتصال پیش از کامل‌شدن لغو شد");
  });
});

describe("★★ `SaveState` در حالتِ قطع دروغ نمی‌گوید", () => {
  async function connected() {
    const canvas = fakeCanvas();
    const link = fakeLink();
    const adapter = new YjsSyncAdapter({ transport: link.transport });
    await adapter.connect(canvas.inbound);
    link.emit({ phase: "open", resumed: false });
    return { canvas, link, adapter };
  }

  it("باز شدنِ سوکت «در حالِ ذخیره» است، نه «ذخیره شد»", async () => {
    const { canvas } = await connected();

    // ⚠️ تاییدِ واقعی فقط از `HB_ROOM_INFO`ِ سرور می‌آید (گام ۴٫۳).
    expect(canvas.lastSave()).toEqual({ status: "saving" });
  });

  it("★ با قطعِ سیم فوراً `unsaved` می‌شود، حتی بدونِ هیچ تغییری", async () => {
    const { canvas, link } = await connected();

    link.emit({ phase: "retrying", attempt: 1, nextRetryMs: 500 });

    // هیچ ویرایشی در کار نبود، ولی «ذخیره شد» هم دیگر قابلِ ادعا نیست: سرور
    // در دسترس نیست و هیچ‌کس نمی‌تواند تاییدش کند.
    expect(canvas.lastSave()).toEqual({ status: "unsaved", pendingChanges: 0 });
  });

  it("تغییرِ آفلاین شمرده می‌شود و در `unsaved` می‌آید", async () => {
    const { canvas, link, adapter } = await connected();
    link.emit({ phase: "retrying", attempt: 1, nextRetryMs: 500 });

    for (const id of ["stk_a", "stk_b"]) {
      adapter.document.transact(() => {
        writeElement(boardRoots(adapter.document).elements, element(id));
      }, new LocalOrigin());
    }

    expect(canvas.lastSave()).toEqual({ status: "unsaved", pendingChanges: 2 });
  });

  it("★★ یک درگِ طولانی روی **یک** عنصر یک تغییر است، نه دویست تا", async () => {
    // ⚠️ این همان چیزی است که واحدِ شمارش را از «update» به «عنصر» برد:
    //    رشته‌ی فارسیِ `connection.offline` این عدد را به کاربر نشان می‌دهد.
    const { canvas, link, adapter } = await connected();
    link.emit({ phase: "stopped", reason: "offline", code: "NETWORK_OFFLINE", message: "" });

    const elements = boardRoots(adapter.document).elements;
    adapter.document.transact(() => {
      writeElement(elements, element("stk_dragged"));
    }, new LocalOrigin());
    for (let tick = 0; tick < 200; tick++) {
      adapter.document.transact(() => {
        writeElement(elements, { ...element("stk_dragged"), x: tick });
      }, new LocalOrigin());
    }

    expect(canvas.lastSave()).toEqual({ status: "unsaved", pendingChanges: 1 });
    expect(canvas.lastConnection()).toEqual({ status: "offline", pendingChanges: 1 });
  });

  it("عددِ روی صفحه در حالتِ `offline` **زنده** می‌مانَد", async () => {
    const { canvas, link, adapter } = await connected();
    link.emit({ phase: "stopped", reason: "offline", code: "NETWORK_OFFLINE", message: "" });
    expect(canvas.lastConnection()).toEqual({ status: "offline", pendingChanges: 0 });

    adapter.document.transact(() => {
      writeElement(boardRoots(adapter.document).elements, element("stk_a"));
    }, new LocalOrigin());

    // بدونِ گزارشِ دوباره، نوارِ وضعیت تا تغییرِ بعدیِ **حالت** روی صفر می‌مانْد.
    expect(canvas.lastConnection()).toEqual({ status: "offline", pendingChanges: 1 });
  });

  it("با اتصالِ دوباره شمارنده صفر می‌شود", async () => {
    const { canvas, link, adapter } = await connected();
    link.emit({ phase: "retrying", attempt: 1, nextRetryMs: 500 });
    adapter.document.transact(() => {
      writeElement(boardRoots(adapter.document).elements, element("stk_a"));
    }, new LocalOrigin());

    link.emit({ phase: "open", resumed: true });
    link.emit({ phase: "retrying", attempt: 1, nextRetryMs: 500 });

    expect(canvas.lastSave()).toEqual({ status: "unsaved", pendingChanges: 0 });
  });
});
