import type { HbElement } from "@hamboom/shared-types";
import { readDocument } from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { YjsSyncAdapter } from "./adapter.ts";
import {
  element,
  PartitionHub,
  QueuedTransport,
  recordingCanvas,
  textElement,
  tick,
  type RecordingCanvas,
} from "./test-harness.ts";

/**
 * ★★ گام ۶٫۲ — **تعارضِ واقعی روی مسیرِ واقعیِ binder**.
 *
 * ── چرا این‌ها تکرارِ probeهای فاز ۱ نیستند ────────────────────────────
 *
 * `ydoc-schema/src/merge-probe.test.ts` و `text-probe.test.ts` همین ادعاها را
 * یک‌بار سنجیده‌اند، ولی روی **Yjsِ خالص**: آن‌جا تست خودش `Y.Map` می‌سازد و
 * مستقیم `set` می‌کند. آن سطح ثابت می‌کند *CRDT* درست است — نه اینکه **ما** درست
 * از آن استفاده می‌کنیم.
 *
 * فاصله‌ی بینِ آن دو دقیقاً جایی است که باگ زندگی می‌کند: `emitElementChanges` →
 * زمان‌بندِ محلی → `writeElement`ِ افتراقی → تراکنشِ `LocalOrigin` → ترابری →
 * `readSyncMessage` → `observeDeep` → `flushRemote`. هر حلقه‌ی این زنجیره
 * می‌تواند خاصیتِ per-property را بی‌صدا از بین ببرد — مثلاً اگر روزی کسی
 * `writeElement` را با «شیءِ کامل را بنویس» عوض کند، **هر ۱۵۵ تستِ ydoc-schema
 * سبز می‌مانند** و probeها هم، چون هیچ‌کدام از این مسیر رد نمی‌شوند.
 *
 * ── ★ چرا `LocalTransportHub` اینجا به کار نمی‌آید ─────────────────────
 *
 * آن hub **همزمان** پخش می‌کند، پس هر تعارضی در عمل سریالی می‌شود و تست
 * بی‌معنا. اینجا از `PartitionHub` استفاده می‌شود که صندوقِ ورودی را نگه می‌دارد.
 * ⚠️ و هر تست **صریحاً می‌آزماید که پارتیشن واقعاً برقرار بوده** — وگرنه یک
 * تستِ سبز فقط ثابت می‌کند «اول A بعد B» کار می‌کند، که هیچ‌وقت مسئله نبود.
 */

interface Seat {
  readonly adapter: YjsSyncAdapter;
  readonly transport: QueuedTransport;
  readonly canvas: RecordingCanvas;
  readonly outbound: Awaited<ReturnType<YjsSyncAdapter["connect"]>>;
}

async function seats(count: number): Promise<{ hub: PartitionHub; seats: Seat[] }> {
  const hub = new PartitionHub();
  const list: Seat[] = [];
  for (let index = 0; index < count; index += 1) {
    const transport = new QueuedTransport(hub);
    const adapter = new YjsSyncAdapter({
      transport,
      // ★ صفر یعنی «همان مسیر، بدونِ انتظار» — نه «مسیرِ دیگر». زمان‌بند باز هم
      //   یک `setTimeout` می‌زند، پس تست‌ها بعدش `tick()` می‌کنند.
      throttle: { gestureMs: 0, textDebounceMs: 0 },
    });
    const canvas = recordingCanvas();
    const outbound = await adapter.connect(canvas.inbound);
    list.push({ adapter, transport, canvas, outbound });
  }
  return { hub, seats: list };
}

function elementsOf(seat: Seat): HbElement[] {
  return readDocument(seat.adapter.document).elements;
}

function elementOf(seat: Seat, id: string): HbElement {
  const found = elementsOf(seat).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`عنصر ${id} در سند نیست`);
  return found;
}

/**
 * ★ **`originalText`، نه `text`** ([ADR-034](../../../ARCHITECTURE_DECISIONS.md#adr-034)).
 *
 * `HbElement` یک اجتماعِ تایپی است و `originalText` فقط روی نوعِ متنی هست، پس
 * خواندنش یک cast می‌خواهد. همین‌جا یک‌بار انجام می‌شود تا هیچ تستی وسوسه نشود
 * `text` را — که مشتق است و تا بازمحاسبه غلط — مقایسه کند.
 */
function originalTextOf(seat: Seat, id: string): string {
  return (elementOf(seat, id) as { originalText?: string }).originalText ?? "";
}

/**
 * ادعای همگرایی — **بردارِ وضعیت** و **نتیجه‌ی دیده‌شده**، هر دو.
 *
 * ★ فقط یکی‌شان کافی نیست: بردارِ وضعیتِ یکسان یعنی «همه‌ی opها رسیده»، و
 * برابریِ عناصر یعنی «همان چیزی هم دیده می‌شود». اولی بدونِ دومی می‌تواند یک
 * باگِ خواندن را پنهان کند.
 */
function expectConverged(a: Seat, b: Seat): void {
  expect([...Y.encodeStateVector(a.adapter.document)]).toEqual([
    ...Y.encodeStateVector(b.adapter.document),
  ]);
  expect(elementsOf(a)).toEqual(elementsOf(b));
}

describe("★ تعارضِ همزمان روی مسیرِ واقعیِ binder", () => {
  it("حرکتِ همزمانِ یک عنصر: همگرا می‌شوند و هیچ‌کدام روی مقدارِ خودش نمی‌مانَد", async () => {
    const { seats: pair } = await seats(2);
    const [a, b] = pair as [Seat, Seat];

    a.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 0, y: 0 })],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    // ── پارتیشن: از این لحظه هیچ‌کدام کارِ دیگری را نمی‌بیند ────────────
    a.transport.hold();
    b.transport.hold();

    a.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 100, y: 100 })],
      deleted: [],
      origin: "local-user",
    });
    b.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 900, y: 900 })],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    // ★ **گیتِ خودِ تست:** ثابت کن واقعاً همزمان بودند. بدونِ این، سبز شدنِ تست
    //   فقط یعنی «اول A بعد B» کار می‌کند.
    expect(elementOf(a, "stk_1").x, "A نباید کارِ B را دیده باشد").toBe(100);
    expect(elementOf(b, "stk_1").x, "B نباید کارِ A را دیده باشد").toBe(900);

    a.transport.release();
    b.transport.release();

    expectConverged(a, b);
    // برنده مهم نیست؛ **واگرا نبودن** مهم است — همان ادعای LWWِ ADR-007.
    expect([100, 900]).toContain(elementOf(a, "stk_1").x);
    // و بازنده باید از بوم خبردار شده باشد، نه اینکه بی‌صدا عوض شود.
    const bothTold = a.canvas.remote.length > 0 || b.canvas.remote.length > 0;
    expect(bothTold, "دستِ‌کم یکی از دو بوم باید تغییرِ remote گرفته باشد").toBe(true);
  });

  it("★★ ADR-007 روی مسیرِ واقعی: رنگ در یکی، موقعیت در دیگری — هر دو می‌مانند", async () => {
    const { seats: pair } = await seats(2);
    const [a, b] = pair as [Seat, Seat];

    a.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 100, y: 200, backgroundColor: "#FFF9B1" })],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    a.transport.hold();
    b.transport.hold();

    // A فقط رنگ را عوض می‌کند — ولی **شیءِ کامل** را emit می‌کند، مثلِ بومِ واقعی.
    a.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 100, y: 200, backgroundColor: "#D0C6F5" })],
      deleted: [],
      origin: "local-user",
    });
    // B فقط جابه‌جا می‌کند، با رنگِ **قدیمی** در همان شیء.
    b.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 640, y: 480, backgroundColor: "#FFF9B1" })],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    expect(elementOf(a, "stk_1").x, "پارتیشن باید برقرار بوده باشد").toBe(100);
    expect(elementOf(b, "stk_1").backgroundColor, "پارتیشن باید برقرار بوده باشد").toBe("#FFF9B1");

    a.transport.release();
    b.transport.release();

    // ★★ ادعای مرکزی: چون `writeElement` **افتراقی** می‌نویسد، رنگِ قدیمیِ داخلِ
    //    شیءِ B اصلاً روی سیم نرفت — پس تغییرِ A را پاک نمی‌کند.
    for (const [name, seat] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const merged = elementOf(seat, "stk_1");
      expect(merged.backgroundColor, `${name}: رنگِ A`).toBe("#D0C6F5");
      expect(merged.x, `${name}: موقعیتِ B`).toBe(640);
      expect(merged.y, `${name}: موقعیتِ B`).toBe(480);
    }
    expectConverged(a, b);
  });

  it("حذف در یکی و ویرایش در دیگری: حذفِ نرم برنده است و ویرایش گم نمی‌شود", async () => {
    const { seats: pair } = await seats(2);
    const [a, b] = pair as [Seat, Seat];

    a.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 10 })],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    a.transport.hold();
    b.transport.hold();

    a.outbound.emitElementChanges({ upserted: [], deleted: ["stk_1"], origin: "local-user" });
    b.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 99 })],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    expect(elementOf(a, "stk_1").isDeleted, "پارتیشن: A حذف کرده").toBe(true);
    expect(elementOf(b, "stk_1").isDeleted, "پارتیشن: B هنوز حذف را ندیده").toBe(false);

    a.transport.release();
    b.transport.release();

    expectConverged(a, b);
    const merged = elementOf(a, "stk_1");
    expect(merged.isDeleted, "حذفِ نرم می‌مانَد").toBe(true);
    // ★ حرکتِ B گم نشده — اگر بعداً undo شود، عنصر سرِ جای درست برمی‌گردد.
    expect(merged.x).toBe(99);
    // ★★ و بومِ B باید حذف را **دیده** باشد؛ عنصرِ حذف‌شده در `deleted` می‌آید،
    //    نه در `upserted` — همان ترجمه‌ای که `flushRemote` انجام می‌دهد.
    expect(b.canvas.deletedIds()).toContain("stk_1");
  });

  it("★★ تایپِ همزمان روی یک متن: هر دو درج می‌مانند (`originalText`، نه `text`)", async () => {
    const { seats: pair } = await seats(2);
    const [a, b] = pair as [Seat, Seat];

    a.outbound.emitElementChanges({
      upserted: [textElement("txt_1", "سلام")],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    a.transport.hold();
    b.transport.hold();

    // هر دو به **انتهای** متن اضافه می‌کنند، بدونِ اینکه کارِ دیگری را دیده باشند.
    a.outbound.emitElementChanges({
      upserted: [textElement("txt_1", "سلام رفیق")],
      deleted: [],
      origin: "local-user",
      gestureId: "g_type_a",
    });
    b.outbound.emitElementChanges({
      upserted: [textElement("txt_1", "سلام دنیا")],
      deleted: [],
      origin: "local-user",
      gestureId: "g_type_b",
    });
    // ⚠️ مسیرِ تایپ **debounce** دارد؛ بدونِ این انتظار، هیچ‌کدام هنوز ننوشته‌اند.
    await tick();

    expect(originalTextOf(a, "txt_1"), "پارتیشن برقرار").toBe("سلام رفیق");
    expect(originalTextOf(b, "txt_1"), "پارتیشن برقرار").toBe("سلام دنیا");

    a.transport.release();
    b.transport.release();

    const mergedA = originalTextOf(a, "txt_1");
    const mergedB = originalTextOf(b, "txt_1");
    // ★ همگرایی اول — بدونِ آن، بقیه‌ی ادعاها بی‌معنا هستند.
    expect(mergedA).toBe(mergedB);
    // ★★ و هیچ‌کدام کاراکترِ دیگری را پاک نکرده: این همان تفاوتِ `Y.Text` با
    //    رشته‌ی LWW است (probeِ گام ۱٫۳).
    expect(mergedA, "درجِ A باید مانده باشد").toContain("رفیق");
    expect(mergedA, "درجِ B باید مانده باشد").toContain("دنیا");
    expect(mergedA.startsWith("سلام"), "پایه‌ی مشترک نباید مخدوش شده باشد").toBe(true);
    expectConverged(a, b);
  });

  it("★★ ADR-033 روی مسیرِ واقعی: پالتِ استیکی در یکی، برچسب در دیگری — هر دو می‌مانند", async () => {
    const { seats: pair } = await seats(2);
    const [a, b] = pair as [Seat, Seat];

    const sticky = (palette: string, tags: string[]): HbElement =>
      element("stk_1", {
        customData: {
          hb: {
            schema: 1,
            kind: "sticky",
            createdBy: "u_test",
            lastEditedBy: "u_test",
            createdAt: 0,
            tags,
            sticky: { palette, autoFit: true },
          },
        },
      } as Partial<HbElement>);

    a.outbound.emitElementChanges({
      upserted: [sticky("yellow", [])],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    a.transport.hold();
    b.transport.hold();

    // A رنگِ استیکی را عوض می‌کند …
    a.outbound.emitElementChanges({
      upserted: [sticky("violet", [])],
      deleted: [],
      origin: "local-user",
    });
    // … و B در همان لحظه برچسب می‌زند.
    b.outbound.emitElementChanges({
      upserted: [sticky("yellow", ["مهم"])],
      deleted: [],
      origin: "local-user",
    });
    await tick();
    a.transport.release();
    b.transport.release();

    // ★★ اگر `customData` یک مقدارِ ساده بود، یکی از این دو خورده می‌شد — همان
    //    جدولِ ADR-033، این‌بار از راهِ binder نه `Y.Map`ِ دستی.
    for (const [name, seat] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const hb = (elementOf(seat, "stk_1").customData as HbElement["customData"])!.hb;
      expect(hb.sticky?.palette, `${name}: پالت`).toBe("violet");
      expect(hb.tags, `${name}: برچسب`).toEqual(["مهم"]);
      // `kind` دست‌نخورده مانده — کلِ ADR-010 رویش سوار است.
      expect(hb.kind, `${name}: kind`).toBe("sticky");
    }
    expectConverged(a, b);
  });

  it("سه کلاینت، سه تغییرِ همزمان روی سه property مختلف — هر سه می‌مانند", async () => {
    const { seats: trio } = await seats(3);
    const [a, b, c] = trio as [Seat, Seat, Seat];

    a.outbound.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    for (const seat of trio) seat.transport.hold();

    a.outbound.emitElementChanges({
      upserted: [element("stk_1", { backgroundColor: "#D0C6F5" })],
      deleted: [],
      origin: "local-user",
    });
    b.outbound.emitElementChanges({
      upserted: [element("stk_1", { x: 640 })],
      deleted: [],
      origin: "local-user",
    });
    c.outbound.emitElementChanges({
      upserted: [element("stk_1", { opacity: 30 })],
      deleted: [],
      origin: "local-user",
    });
    await tick();
    for (const seat of trio) seat.transport.release();

    for (const [name, seat] of [
      ["A", a],
      ["B", b],
      ["C", c],
    ] as const) {
      const merged = elementOf(seat, "stk_1");
      expect(merged.backgroundColor, `${name}: رنگ`).toBe("#D0C6F5");
      expect(merged.x, `${name}: موقعیت`).toBe(640);
      expect(merged.opacity, `${name}: شفافیت`).toBe(30);
    }
    expectConverged(a, b);
    expectConverged(b, c);
  });

  it("ساختِ همزمانِ دو عنصرِ متفاوت — هیچ‌کدام دیگری را پاک نمی‌کند", async () => {
    const { seats: pair } = await seats(2);
    const [a, b] = pair as [Seat, Seat];

    a.transport.hold();
    b.transport.hold();

    a.outbound.emitElementChanges({
      upserted: [element("stk_a")],
      deleted: [],
      origin: "local-user",
    });
    b.outbound.emitElementChanges({
      upserted: [element("stk_b")],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    expect(elementsOf(a).map((el) => el.id)).toEqual(["stk_a"]);
    expect(elementsOf(b).map((el) => el.id)).toEqual(["stk_b"]);

    a.transport.release();
    b.transport.release();

    expect(
      elementsOf(a)
        .map((el) => el.id)
        .sort(),
    ).toEqual(["stk_a", "stk_b"]);
    expectConverged(a, b);
  });
});
