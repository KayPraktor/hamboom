import type { CanvasInbound, CanvasOutbound, ElementChangeSet } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import { boardRoots, readDocument } from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { YjsSyncAdapter } from "./adapter.ts";
import { LocalOrigin } from "./emit-local.ts";
import { LocalTransport, LocalTransportHub } from "./transport.ts";
import { createUndoScope } from "./undo.ts";

/**
 * تست‌های گام ۳٫۴ — **انزوای undo**.
 *
 * دو یافته‌ی پین‌شده‌ی گام ۱٫۴ اینجا به نگهبانِ دائمی تبدیل می‌شوند:
 *
 * ۱. پیش‌فرضِ `Y.UndoManager` فقط originِ `null` را ردیابی می‌کند — جاافتادنِ
 *    `trackedOrigins` یعنی **undo بی‌صدا هیچ کاری نمی‌کند**.
 * ۲. undoِ یک **ساخت** کلیدِ عنصر را کامل برمی‌دارد؛ ادعا باید **همگرایی** باشد،
 *    نه «کلید می‌مانَد».
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
      hb: { schema: 1, kind: "sticky", createdBy: "u", lastEditedBy: "u", createdAt: 0 },
    },
    ...overrides,
  } as HbElement;
}

function fakeCanvas() {
  const received: ElementChangeSet[] = [];
  const inbound: CanvasInbound = {
    applyRemoteChanges: (changes) => received.push(changes),
    applyPeers: vi.fn(),
    setConnectionState: vi.fn(),
    setSaveState: vi.fn(),
    setPermissions: vi.fn(),
    replaceDocument: vi.fn(),
    focusOn: vi.fn(),
  };
  return { inbound, received };
}

/** دو آداپتورِ متصل، هر کدام با بومِ ساختگیِ خودش. */
async function twoClients() {
  const hub = new LocalTransportHub();
  const a = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
  const b = new YjsSyncAdapter({ transport: new LocalTransport(hub) });
  const canvasA = fakeCanvas();
  const canvasB = fakeCanvas();
  const outA = await a.connect(canvasA.inbound);
  const outB = await b.connect(canvasB.inbound);
  return { a, b, outA, outB, canvasA, canvasB };
}

/** یک ژستِ کامل: emit با `gestureId`ِ یکتا و بستنِ فوریِ مرز. */
function gesture(outbound: CanvasOutbound, id: string, elements: HbElement[]): void {
  outbound.emitElementChanges({
    upserted: elements,
    deleted: [],
    origin: "local-user",
    gestureId: id,
  });
  // ژستِ بعدی مرز را می‌بندد؛ اینجا با یک تغییرِ بی‌ژست همان کار را می‌کنیم.
  outbound.emitElementChanges({ upserted: [], deleted: [], origin: "local-user" });
}

const boxOf = (adapter: YjsSyncAdapter, id: string) =>
  boardRoots(adapter.document).elements.get(id) as Y.Map<unknown> | undefined;

describe("★★ پیش‌فرضِ `UndoManager` وارونه است — پینِ گام ۱٫۴", () => {
  it("بدونِ `trackedOrigins` هیچ کاری نمی‌کند", () => {
    // این تستِ **ضدِ ادعا** است: نشان می‌دهد اگر `createUndoScope` روزی
    // `trackedOrigins` را جا بیندازد، undo بی‌صدا از کار می‌افتد — نه خطا، نه
    // هشدار. بدونِ این تست، آن رگرسیون هیچ‌جا دیده نمی‌شد.
    const doc = new Y.Doc();
    const naive = new Y.UndoManager(doc.getMap("elements"));

    doc.transact(() => doc.getMap("elements").set("stk_1", 1), new LocalOrigin("g_1"));
    expect(naive.canUndo()).toBe(false);

    naive.undo();
    expect(doc.getMap("elements").get("stk_1")).toBe(1);
  });

  it("★ با `trackedOrigins` درست کار می‌کند", () => {
    const doc = new Y.Doc();
    const scope = createUndoScope(doc);

    doc.transact(() => doc.getMap("elements").set("stk_1", 1), new LocalOrigin("g_1"));
    expect(scope.canUndo()).toBe(true);

    scope.undo();
    expect(doc.getMap("elements").has("stk_1")).toBe(false);
  });

  it("originِ remote اصلاً وارد تاریخچه نمی‌شود", () => {
    const doc = new Y.Doc();
    const scope = createUndoScope(doc);
    doc.transact(() => doc.getMap("elements").set("stk_1", 1), "hamboom:remote");
    expect(scope.canUndo()).toBe(false);
  });
});

describe("★★ معیارِ پذیرش — دو کلاینت، دو ژست هرکدام", () => {
  it("`Ctrl+Z`ِ الف فقط ژست‌های الف را به ترتیبِ معکوس برمی‌گرداند", async () => {
    const { a, b, outA, outB } = await twoClients();

    gesture(outA, "a1", [element("a_1", { x: 10 })]);
    gesture(outB, "b1", [element("b_1", { x: 20 })]);
    gesture(outA, "a2", [element("a_2", { x: 30 })]);
    gesture(outB, "b2", [element("b_2", { x: 40 })]);

    const ids = () =>
      readDocument(a.document)
        .elements.map((el) => el.id)
        .sort();
    expect(ids()).toEqual(["a_1", "a_2", "b_1", "b_2"]);

    a.undo!.undo();
    expect(ids()).toEqual(["a_1", "b_1", "b_2"]); // ژستِ دومِ الف

    a.undo!.undo();
    expect(ids()).toEqual(["b_1", "b_2"]); // ژستِ اولِ الف

    // ★ سومین undo هیچ کارِ بی‌ربطی نمی‌کند — به ژست‌های ب **نمی‌رسد**.
    a.undo!.undo();
    expect(ids()).toEqual(["b_1", "b_2"]);
    expect(a.undo!.canUndo()).toBe(false);

    // و همتا هم همان را می‌بیند: undo از مسیرِ عادیِ sync رفته.
    expect(
      readDocument(b.document)
        .elements.map((el) => el.id)
        .sort(),
    ).toEqual(["b_1", "b_2"]);
  });

  it("★★ حتی وقتی هر دو ژست روی **یک عنصر** باشند", async () => {
    // سخت‌ترین حالتِ معیارِ پذیرش: undoِ الف باید فقط propertyهای **خودش** را
    // برگرداند و رنگِ ب دست‌نخورده بماند. این دقیقاً همان چیزی است که
    // per-propertyِ ADR-007 ممکنش می‌کند.
    const { a, b, outA, outB } = await twoClients();

    gesture(outA, "seed", [element("stk_1", { x: 0 })]);
    gesture(outA, "a_move", [element("stk_1", { x: 500 })]);
    gesture(outB, "b_color", [element("stk_1", { x: 500, backgroundColor: "#D0C6F5" })]);

    a.undo!.undo(); // فقط جابه‌جاییِ الف

    for (const adapter of [a, b]) {
      const box = boxOf(adapter, "stk_1")!;
      expect(box.get("x")).toBe(0);
      expect(box.get("backgroundColor")).toBe("#D0C6F5");
    }
  });
});

describe("★ undoِ ساخت — پینِ دومِ گام ۱٫۴", () => {
  it("کلیدِ عنصر را کامل برمی‌دارد و دو سند **همگرا** می‌مانند", async () => {
    // ادعا عمداً «کلید می‌مانَد» نیست: حذفِ نرم قاعده‌ی ما برای حذفِ **کاربر**
    // است، نه این مسیر. چیزی که اهمیت دارد همگرایی است.
    const { a, b, outA } = await twoClients();
    gesture(outA, "g_create", [element("stk_1")]);
    expect(boxOf(b, "stk_1")).toBeInstanceOf(Y.Map);

    a.undo!.undo();

    expect(boardRoots(a.document).elements.has("stk_1")).toBe(false);
    expect(boardRoots(b.document).elements.has("stk_1")).toBe(false);
  });

  it("redo دوباره برش می‌گرداند", async () => {
    const { a, b, outA } = await twoClients();
    gesture(outA, "g_create", [element("stk_1")]);

    a.undo!.undo();
    expect(a.undo!.canRedo()).toBe(true);
    a.undo!.redo();

    expect(readDocument(a.document).elements.map((el) => el.id)).toEqual(["stk_1"]);
    expect(readDocument(b.document).elements.map((el) => el.id)).toEqual(["stk_1"]);
  });
});

describe("گروه‌بندیِ ژست", () => {
  it("★ یک درگ = یک ورودیِ undo، نه چهل‌تا", async () => {
    // تیک‌های درونِ یک ژست ادغام می‌شوند (`captureTimeout`)، ولی مرزِ ژست با
    // `stopCapturing` بسته می‌شود. بدونِ آن، ۴۰ بار `Ctrl+Z` لازم بود.
    const { a, outA } = await twoClients();
    gesture(outA, "seed", [element("stk_1", { x: 0 })]);

    for (let i = 1; i <= 10; i++) {
      outA.emitElementChanges({
        upserted: [element("stk_1", { x: i * 10 })],
        deleted: [],
        origin: "local-user",
        gestureId: "g_drag",
      });
    }
    // پایانِ ژست
    outA.emitElementChanges({ upserted: [], deleted: [], origin: "local-user" });

    a.undo!.undo();
    expect(boxOf(a, "stk_1")!.get("x")).toBe(0);
  });

  it("دو ژستِ جدا، دو ورودیِ جدا", async () => {
    const { a, outA } = await twoClients();
    gesture(outA, "seed", [element("stk_1", { x: 0 })]);
    gesture(outA, "g_1", [element("stk_1", { x: 100 })]);
    gesture(outA, "g_2", [element("stk_1", { x: 200 })]);

    a.undo!.undo();
    expect(boxOf(a, "stk_1")!.get("x")).toBe(100);
    a.undo!.undo();
    expect(boxOf(a, "stk_1")!.get("x")).toBe(0);
  });
});

describe("چرخه‌ی عمر", () => {
  it("قبل از `connect` و بعد از `disconnect` دامنه‌ای وجود ندارد", async () => {
    const adapter = new YjsSyncAdapter();
    expect(adapter.undo).toBeNull();

    await adapter.connect(fakeCanvas().inbound);
    expect(adapter.undo).not.toBeNull();

    adapter.disconnect();
    expect(adapter.undo).toBeNull();
  });

  it("★ تاریخچه بعد از قطع و وصلِ دوباره تازه است", async () => {
    // زیر StrictMode این چرخه در هر mount رخ می‌دهد. تاریخچه‌ی جامانده یعنی
    // `Ctrl+Z` چیزی را برمی‌گرداند که کاربر در «session» قبلی انجام داده.
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(fakeCanvas().inbound);
    gesture(outbound, "g_1", [element("stk_1")]);
    expect(adapter.undo!.canUndo()).toBe(true);

    adapter.disconnect();
    await adapter.connect(fakeCanvas().inbound);
    expect(adapter.undo!.canUndo()).toBe(false);
  });
});
