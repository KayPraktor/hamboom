import type { ElementChangeSet } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import type * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YjsSyncAdapter } from "./adapter.ts";
import { createEmitScheduler, HB_THROTTLE, LocalOrigin, type EmitSink } from "./emit-local.ts";

/**
 * تست‌های گام ۳٫۳ — **جدولِ فرکانسِ PLAN ۷٫۴**.
 *
 * دو ادعای عددی که معیارِ پذیرشِ گام‌اند:
 *
 * - یک درگِ ۲ثانیه‌ای → **حداکثر ۴۰ update**، و آخری دقیقاً مختصاتِ نهایی.
 * - استروکِ ۳۰۰ نقطه‌ای → **دقیقاً یک** update.
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

/** sinkِ ساختگی — با کنترلِ اینکه چه چیزی «از قبل در سند هست». */
function fakeSink(existing: string[] = [], texts: Record<string, string> = {}) {
  const committed: ElementChangeSet[] = [];
  const ids = new Set(existing);
  const sink: EmitSink = {
    commit: (changes) => {
      committed.push(changes);
      for (const el of changes.upserted) ids.add(el.id);
    },
    has: (id) => ids.has(id),
    textOf: (id) => texts[id],
  };
  return { sink, committed };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("فوری — ساخت، حذف، و تغییرِ بی‌ژست", () => {
  it("ساختِ عنصر بلافاصله نوشته می‌شود، حتی با `gestureId`", () => {
    // استیکی با `gestureId` ساخته می‌شود (نمونه‌ی خودِ sync/README)، ولی
    // «ساخت» باید فوری باشد وگرنه کاربر ۵۰ms شکلِ خودش را در بومِ همتا نمی‌بیند.
    const { sink, committed } = fakeSink();
    const scheduler = createEmitScheduler(sink);

    scheduler.push({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
      gestureId: "g_1",
    });

    expect(committed).toHaveLength(1);
  });

  it("حذف بلافاصله نوشته می‌شود", () => {
    const { sink, committed } = fakeSink(["stk_1"]);
    const scheduler = createEmitScheduler(sink);
    scheduler.push({ upserted: [], deleted: ["stk_1"], origin: "local-user", gestureId: "g_1" });
    expect(committed).toHaveLength(1);
  });

  it("تغییرِ بدونِ `gestureId` (استایل) فوری است", () => {
    const { sink, committed } = fakeSink(["stk_1"]);
    const scheduler = createEmitScheduler(sink);
    scheduler.push({
      upserted: [element("stk_1", { backgroundColor: "#D0C6F5" })],
      deleted: [],
      origin: "local-user",
    });
    expect(committed).toHaveLength(1);
  });
});

describe("★★ درگ — throttle ۵۰ms", () => {
  /** یک درگِ واقعی: `durationMs` ثانیه با نرخِ `frameMs`. */
  function drag(
    scheduler: ReturnType<typeof createEmitScheduler>,
    durationMs: number,
    frameMs: number,
  ) {
    let x = 0;
    for (let t = 0; t < durationMs; t += frameMs) {
      x += 1;
      scheduler.push({
        upserted: [element("stk_1", { x, y: x * 2 })],
        deleted: [],
        origin: "local-user",
        gestureId: "g_drag",
      });
      vi.advanceTimersByTime(frameMs);
    }
    return x;
  }

  it("★ درگِ ۲ثانیه‌ای با ۱۲۰ فریم در ثانیه → حداکثر ۴۰ update", () => {
    const { sink, committed } = fakeSink(["stk_1"]);
    const scheduler = createEmitScheduler(sink);

    drag(scheduler, 2000, 1000 / 120); // ۲۴۰ رویدادِ ورودی
    scheduler.flush();

    // ۲۰۰۰ / ۵۰ = ۴۰. اگر leading هم می‌داشتیم، ۴۱ می‌شد و سقف می‌شکست.
    expect(committed.length).toBeLessThanOrEqual(40);
    expect(committed.length).toBeGreaterThan(30);
  });

  it("★ آخرین update دقیقاً مختصاتِ نهایی است", () => {
    // ادغام با **شناسه** انجام می‌شود، نه صف — پس هیچ‌وقت یک حالتِ میانی
    // به‌عنوان حرفِ آخر روی سند نمی‌نشیند.
    const { sink, committed } = fakeSink(["stk_1"]);
    const scheduler = createEmitScheduler(sink);

    const finalX = drag(scheduler, 2000, 1000 / 120);
    scheduler.flush();

    const last = committed.at(-1)?.upserted[0] as { x: number; y: number };
    expect(last.x).toBe(finalX);
    expect(last.y).toBe(finalX * 2);
  });

  it("هر update فقط **یک** نمونه از هر عنصر دارد", () => {
    const { sink, committed } = fakeSink(["a", "b"]);
    const scheduler = createEmitScheduler(sink);

    for (let i = 0; i < 20; i++) {
      scheduler.push({
        upserted: [element("a", { x: i }), element("b", { x: i })],
        deleted: [],
        origin: "local-user",
        gestureId: "g_1",
      });
    }
    vi.advanceTimersByTime(HB_THROTTLE.gestureMs);

    expect(committed).toHaveLength(1);
    expect(committed[0]?.upserted.map((el) => el.id)).toEqual(["a", "b"]);
  });

  it("`gestureId` روی changeset نوشته‌شده می‌مانَد", () => {
    const { sink, committed } = fakeSink(["stk_1"]);
    const scheduler = createEmitScheduler(sink);
    scheduler.push({
      upserted: [element("stk_1", { x: 5 })],
      deleted: [],
      origin: "local-user",
      gestureId: "g_7",
    });
    vi.advanceTimersByTime(HB_THROTTLE.gestureMs);
    expect(committed[0]?.gestureId).toBe("g_7");
  });

  it("★ مرزِ ژست فوراً بسته می‌شود («commit نهایی در drop»)", () => {
    // اگر ژستِ قبلی منتظر می‌مانْد، دو ژست در یک update قاطی می‌شدند و
    // `UndoManager` نمی‌توانست مرزشان را ببیند.
    const { sink, committed } = fakeSink(["stk_1"]);
    const scheduler = createEmitScheduler(sink);

    scheduler.push({
      upserted: [element("stk_1", { x: 1 })],
      deleted: [],
      origin: "local-user",
      gestureId: "g_1",
    });
    scheduler.push({
      upserted: [element("stk_1", { x: 2 })],
      deleted: [],
      origin: "local-user",
      gestureId: "g_2",
    });

    expect(committed).toHaveLength(1);
    expect(committed[0]?.gestureId).toBe("g_1");
  });
});

describe("★ استروکِ قلم — دقیقاً یک commit", () => {
  it("استروکِ ۳۰۰ نقطه‌ای یک updateِ واحد می‌شود", () => {
    // [ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022): استروکِ در حالِ
    // کشیدن از کانالِ awareness می‌رود و **فقط نتیجه‌ی نهایی** در `pointerup`
    // وارد سند می‌شود. آن یک emit یک عنصرِ **نو** است، پس مسیرِ فوری را می‌رود.
    const { sink, committed } = fakeSink();
    const scheduler = createEmitScheduler(sink);

    const points: Array<[number, number]> = Array.from({ length: 300 }, (_, i) => [i, i * 2]);
    scheduler.push({
      upserted: [element("drw_1", { type: "freedraw", points } as Partial<HbElement>)],
      deleted: [],
      origin: "local-user",
      gestureId: "g_stroke",
    });

    expect(committed).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(committed).toHaveLength(1);
  });
});

describe("★ تایپ — debounce ۱۵۰ms", () => {
  it("تایپِ پیوسته فقط **یک** update در پایان می‌دهد", () => {
    const { sink, committed } = fakeSink(["txt_1"], { txt_1: "" });
    const scheduler = createEmitScheduler(sink);

    let text = "";
    for (const ch of "سلام دنیا") {
      text += ch;
      scheduler.push({
        upserted: [element("txt_1", { originalText: text } as Partial<HbElement>)],
        deleted: [],
        origin: "local-user",
        gestureId: "g_type",
      });
      vi.advanceTimersByTime(60); // سریع‌تر از debounce، کندتر از یک فریم
    }

    // هنوز چیزی ننشسته — debounce با هر حرف ریست می‌شود.
    expect(committed).toHaveLength(0);

    vi.advanceTimersByTime(HB_THROTTLE.textDebounceMs);
    expect(committed).toHaveLength(1);
    expect((committed[0]?.upserted[0] as { originalText: string }).originalText).toBe("سلام دنیا");
  });

  it("مکثِ کاربر یک update می‌سازد و تایپِ بعدی یکی دیگر", () => {
    const { sink, committed } = fakeSink(["txt_1"], { txt_1: "" });
    const scheduler = createEmitScheduler(sink);

    scheduler.push({
      upserted: [element("txt_1", { originalText: "سلام" } as Partial<HbElement>)],
      deleted: [],
      origin: "local-user",
      gestureId: "g_type",
    });
    vi.advanceTimersByTime(HB_THROTTLE.textDebounceMs);
    expect(committed).toHaveLength(1);

    scheduler.push({
      upserted: [element("txt_1", { originalText: "سلام دنیا" } as Partial<HbElement>)],
      deleted: [],
      origin: "local-user",
      gestureId: "g_type",
    });
    vi.advanceTimersByTime(HB_THROTTLE.textDebounceMs);
    expect(committed).toHaveLength(2);
  });

  it("جابه‌جاییِ همان عنصر throttle می‌گیرد نه debounce", () => {
    // تفکیک با `originalText` انجام می‌شود؛ اگر عوض نشده باشد، ژستِ معمولی است.
    const { sink, committed } = fakeSink(["txt_1"], { txt_1: "سلام" });
    const scheduler = createEmitScheduler(sink);

    scheduler.push({
      upserted: [element("txt_1", { originalText: "سلام", x: 99 } as Partial<HbElement>)],
      deleted: [],
      origin: "local-user",
      gestureId: "g_move",
    });

    vi.advanceTimersByTime(HB_THROTTLE.gestureMs);
    expect(committed).toHaveLength(1);
  });
});

describe("از دست نرفتنِ کارِ کاربر", () => {
  it("★ `dispose` صف را می‌نویسد، دور نمی‌ریزد", () => {
    const { sink, committed } = fakeSink(["stk_1"]);
    const scheduler = createEmitScheduler(sink);

    scheduler.push({
      upserted: [element("stk_1", { x: 42 })],
      deleted: [],
      origin: "local-user",
      gestureId: "g_1",
    });
    scheduler.dispose();

    expect(committed).toHaveLength(1);
    expect((committed[0]?.upserted[0] as { x: number }).x).toBe(42);
  });

  it("`flush`ِ روی صفِ خالی چیزی نمی‌نویسد", () => {
    const { sink, committed } = fakeSink();
    const scheduler = createEmitScheduler(sink);
    scheduler.flush();
    expect(committed).toEqual([]);
  });
});

/**
 * ★★ همان ادعاها، این‌بار روی **`Y.Doc`ِ واقعی** — چون معیارِ پذیرش می‌گوید
 * «update در Y.Doc»، نه «فراخوانیِ commit».
 */
describe("★★ روی سندِ واقعی", () => {
  function fakeCanvas() {
    return {
      applyRemoteChanges: vi.fn(),
      applyPeers: vi.fn(),
      setConnectionState: vi.fn(),
      setSaveState: vi.fn(),
      setPermissions: vi.fn(),
      replaceDocument: vi.fn(),
      focusOn: vi.fn(),
    };
  }

  it("درگِ ۲ثانیه‌ای → حداکثر ۴۰ updateِ Yjs، با مختصاتِ نهاییِ درست", async () => {
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(fakeCanvas());

    // عنصر باید از قبل باشد تا مسیرِ «ساخت = فوری» را نرود.
    outbound.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    let updates = 0;
    adapter.document.on("update", () => updates++);

    let x = 0;
    for (let t = 0; t < 2000; t += 1000 / 120) {
      x += 1;
      outbound.emitElementChanges({
        upserted: [element("stk_1", { x, y: x * 2 })],
        deleted: [],
        origin: "local-user",
        gestureId: "g_drag",
      });
      vi.advanceTimersByTime(1000 / 120);
    }
    adapter.disconnect(); // flush می‌کند

    expect(updates).toBeLessThanOrEqual(40);
    const map = adapter.document.getMap("elements").get("stk_1") as Y.Map<unknown>;
    expect(map.get("x")).toBe(x);
    expect(map.get("y")).toBe(x * 2);
  });

  it("★ originِ تراکنش `LocalOrigin` است و `gestureId` را حمل می‌کند", async () => {
    // پایه‌ی گام ۳٫۴: `trackedOrigins: new Set([LocalOrigin])` هر ژستی را
    // می‌گیرد، مستقل از `gestureId`.
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(fakeCanvas());
    outbound.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });

    const origins: unknown[] = [];
    adapter.document.on("update", (_u: Uint8Array, origin: unknown) => origins.push(origin));

    outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 9 })],
      deleted: [],
      origin: "local-user",
      gestureId: "g_9",
    });
    vi.advanceTimersByTime(HB_THROTTLE.gestureMs);

    expect(origins).toHaveLength(1);
    expect(origins[0]).toBeInstanceOf(LocalOrigin);
    expect((origins[0] as LocalOrigin).gestureId).toBe("g_9");
  });
});
