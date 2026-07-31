import { hbElement, type HbElement } from "@hamboom/shared-types";
import { LocalSyncAdapter, LocalSyncHub } from "@hamboom/canvas-core/sync";
import type { CanvasDocument } from "@hamboom/canvas-core/sync";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConnector, createSticky } from "@hamboom/canvas-core";

/**
 * تستِ یکپارچه‌ی گام ۶٫۱ — سناریوی «بوم خالی → ساختِ ۵ استیکی و ۲ کانکتور →
 * undo/redo → بازخوانی از آداپتور».
 *
 * ── چه چیزی اینجا آزموده می‌شود و چه چیزی نه ──────────────────────────────
 *
 * این تست **مسیرِ داده** را سرتاسر می‌آزماید با سازنده‌های **واقعی** (نه عناصرِ
 * دستیِ mock): ساخت → عبور از قراردادِ `CanvasSyncAdapter` → پایداری در hub →
 * بازخوانیِ کاملِ سند توسطِ یک کلاینتِ تازه‌وارد. همچنین ثابت می‌کند خروجیِ
 * سازنده‌ها با schema‌ی `shared-types` **معتبر** است — یعنی داده‌ای که به M2
 * تحویل می‌شود قراردادی است.
 *
 * ★ **undo/redo در سطحِ قرارداد** آزموده می‌شود (origin=`undo`، حذفِ نرم و
 * بازگردانی)، نه در سطحِ **history stackِ خودِ موتور**. undo/redoِ موتور به رندرِ
 * واقعی نیاز دارد که jsdom ندارد؛ آن بخش قبلاً در مرورگر تایید شده (گام‌های ۳٫۵/
 * ۳٫۶/۵٫۲) و در harnessِ مرورگریِ G-1 خودکار می‌شود. این تست رفتارِ **مکملِ
 * sync** را می‌گیرد: وقتی موتور یک undo را به‌صورتِ ChangeSet منتشر می‌کند،
 * آداپتور و بقیه‌ی کلاینت‌ها درست پخش/اعمالش می‌کنند.
 */

/** بذرِ قطعی — تا id و seedها بین اجراها ثابت بمانند. */
function seed(prefix: string) {
  let n = 0;
  return {
    makeId: () => `${prefix}_${(n++).toString().padStart(3, "0")}`,
    random: () => 0.5,
    now: 1,
  };
}

/** بومِ ساختگی که فقط آنچه از آداپتور می‌رسد را ثبت می‌کند. */
function fakeCanvas() {
  let lastDocument: CanvasDocument | null = null;
  const remote: HbElement[][] = [];
  const inbound = {
    applyRemoteChanges: vi.fn((c: { upserted: HbElement[] }) => remote.push(c.upserted)),
    applyPeers: vi.fn(),
    setConnectionState: vi.fn(),
    setSaveState: vi.fn(),
    setPermissions: vi.fn(),
    replaceDocument: vi.fn((doc: CanvasDocument) => {
      lastDocument = doc;
    }),
    focusOn: vi.fn(),
  };
  return {
    inbound,
    remote,
    get lastDocument() {
      return lastDocument;
    },
  };
}

/** ۵ استیکی + ۲ کانکتور بینِ آن‌ها — همان چیزی که یک کاربر در بوم می‌سازد. */
function buildBoard() {
  const s = seed("board");
  const stickies = Array.from({ length: 5 }, (_, i) =>
    createSticky({
      x: i * 240,
      y: 0,
      text: `یادداشت ${i + 1}`,
      authorId: "u_owner",
      index: `a${i}`,
      makeId: s.makeId,
      random: s.random,
      now: s.now,
    }),
  );

  const boxOf = (pair: (typeof stickies)[number]) => ({
    x: pair.container.x,
    y: pair.container.y,
    width: pair.container.width,
    height: pair.container.height,
  });

  // دو کانکتور: استیکی ۰→۱ و ۱→۲.
  const connectors = [
    createConnector({
      start: { elementId: stickies[0]!.container.id, box: boxOf(stickies[0]!) },
      end: { elementId: stickies[1]!.container.id, box: boxOf(stickies[1]!) },
      authorId: "u_owner",
      makeId: s.makeId,
      random: s.random,
      now: s.now,
    }),
    createConnector({
      start: { elementId: stickies[1]!.container.id, box: boxOf(stickies[1]!) },
      end: { elementId: stickies[2]!.container.id, box: boxOf(stickies[2]!) },
      authorId: "u_owner",
      makeId: s.makeId,
      random: s.random,
      now: s.now,
    }),
  ];

  const elements: HbElement[] = [...stickies.flatMap((p) => p.elements), ...connectors];
  return { stickies, connectors, elements };
}

describe("یکپارچه — ساختِ بوم، همگام‌سازی، و بازخوانی از آداپتور", () => {
  let hub: LocalSyncHub;

  beforeEach(() => {
    hub = new LocalSyncHub();
  });

  it("بوم با یک سندِ خالی باز می‌شود", async () => {
    const owner = new LocalSyncAdapter({ hub });
    const canvas = fakeCanvas();
    await owner.connect(canvas.inbound);

    expect(canvas.inbound.replaceDocument).toHaveBeenCalledTimes(1);
    expect(canvas.lastDocument?.elements).toEqual([]);
  });

  it("خروجیِ سازنده‌ها با schema‌ی shared-types معتبر است (قراردادِ M2)", () => {
    const { elements } = buildBoard();
    // ۵ استیکی = ۱۰ عنصر (ظرف + متن)، + ۲ کانکتور = ۱۲.
    expect(elements).toHaveLength(12);
    for (const el of elements) {
      const parsed = hbElement.safeParse(el);
      expect(parsed.success, `عنصر ${el.id} (${el.type}) باید معتبر باشد`).toBe(true);
    }
  });

  it("ساختِ ۵ استیکی و ۲ کانکتور در یک ژست منتشر و پایدار می‌شود", async () => {
    const owner = new LocalSyncAdapter({ hub });
    const out = await owner.connect(fakeCanvas().inbound);
    const { elements } = buildBoard();

    out.emitElementChanges({
      upserted: elements,
      deleted: [],
      origin: "local-user",
      gestureId: "g_build",
    });

    const snap = hub.snapshot();
    expect(snap.elements).toHaveLength(12);
    // کانکتورها واقعاً به ظرفِ استیکی‌ها مقیدند (یکپارچگیِ بینِ انواع عنصر).
    const arrows = snap.elements.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) {
      const binding = (arrow as { startBinding?: { elementId: string } }).startBinding;
      expect(binding?.elementId).toMatch(/^stk_board_/);
    }
  });

  it("★ بازخوانی از آداپتور — کلاینتِ تازه‌وارد کلِ بوم را می‌گیرد", async () => {
    const owner = new LocalSyncAdapter({ hub });
    const out = await owner.connect(fakeCanvas().inbound);
    const { elements } = buildBoard();
    out.emitElementChanges({ upserted: elements, deleted: [], origin: "local-user" });

    // یک نمونه‌ی دوم به همان hub وصل می‌شود = «بازخوانی از آداپتور».
    const viewer = new LocalSyncAdapter({ hub });
    const viewerCanvas = fakeCanvas();
    await viewer.connect(viewerCanvas.inbound);

    const reloaded = viewerCanvas.lastDocument?.elements ?? [];
    expect(reloaded).toHaveLength(12);
    expect(new Set(reloaded.map((e) => e.id))).toEqual(new Set(elements.map((e) => e.id)));
  });

  it("تغییرِ سازنده به کلاینتِ متصلِ دیگر می‌رسد (origin=remote)", async () => {
    const owner = new LocalSyncAdapter({ hub });
    const out = await owner.connect(fakeCanvas().inbound);

    const viewer = new LocalSyncAdapter({ hub });
    const viewerCanvas = fakeCanvas();
    await viewer.connect(viewerCanvas.inbound);

    const { elements } = buildBoard();
    out.emitElementChanges({ upserted: elements, deleted: [], origin: "local-user" });

    expect(viewerCanvas.remote).toHaveLength(1);
    expect(viewerCanvas.remote[0]).toHaveLength(12);
  });

  it("★ undo/redo در سطحِ قرارداد — حذفِ نرم و بازگردانی", async () => {
    const owner = new LocalSyncAdapter({ hub });
    const out = await owner.connect(fakeCanvas().inbound);
    const { elements } = buildBoard();
    const ids = elements.map((e) => e.id);

    out.emitElementChanges({ upserted: elements, deleted: [], origin: "local-user" });
    expect(hub.snapshot().elements.filter((e) => !e.isDeleted)).toHaveLength(12);

    // undo: موتور معکوسِ ساخت را به‌صورتِ حذف منتشر می‌کند (origin=undo مجاز است).
    out.emitElementChanges({ upserted: [], deleted: ids, origin: "undo" });
    const afterUndo = hub.snapshot();
    // حذفِ نرم — عناصر می‌مانند ولی isDeleted (CRDT و redo هر دو لازمش دارند).
    expect(afterUndo.elements).toHaveLength(12);
    expect(afterUndo.elements.every((e) => e.isDeleted)).toBe(true);

    // redo: دوباره upsert.
    out.emitElementChanges({ upserted: elements, deleted: [], origin: "undo" });
    expect(hub.snapshot().elements.every((e) => !e.isDeleted)).toBe(true);
  });
});
