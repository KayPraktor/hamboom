import type { HbElement } from "@hamboom/shared-types";
import { readDocument } from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { YjsSyncAdapter } from "./adapter.ts";
import {
  element,
  mulberry32,
  PartitionHub,
  QueuedTransport,
  recordingCanvas,
  shuffle,
  textElement,
  tick,
} from "./test-harness.ts";

/**
 * ★★ گام ۶٫۲ — **همگراییِ property-based**.
 *
 * ادعا: N عملیاتِ تصادفی روی K کلاینت، با **ترتیب‌های رسیدنِ متفاوت**، همیشه به
 * یک حالت می‌رسند. این خاصیتِ تعریف‌کننده‌ی CRDT است و کلِ معماریِ M2 رویش سوار.
 *
 * ── ⚠️ سه چیزی که این تست را از یک تستِ تشریفاتی جدا می‌کند ─────────────
 *
 * ۱. **ترتیب واقعاً جابه‌جا می‌شود، و اثباتش داخلِ خودِ تست است.** اگر همه‌ی
 *    کلاینت‌ها updateها را به یک ترتیب بگیرند، همگرایی **بی‌معنا** اثبات می‌شود
 *    — CRDT دقیقاً برای ترتیبِ متفاوت هست. `release` ترتیبِ تحویل‌شده را
 *    برمی‌گرداند و پایینِ همین فایل ادعا می‌شود که با ترتیبِ **تولید** یکی نیست.
 * ۲. **تصادفِ قطعی.** `Math.random` یعنی شکستِ بازتولیدناپذیر؛ seed در نامِ تست
 *    می‌آید تا هر قرمزی یک دستورِ اجرای مشخص داشته باشد.
 * ۳. ★ **کنترلِ منفی.** آخرین تستِ فایل یک پیام را عمداً می‌اندازد و انتظار
 *    دارد همگرایی **نقض شود**. بدونِ آن، «همه یکی شدند» می‌تواند فقط یعنی
 *    ادعایمان هیچ‌وقت چیزی نمی‌سنجد.
 */

interface Seat {
  readonly adapter: YjsSyncAdapter;
  readonly transport: QueuedTransport;
  readonly outbound: Awaited<ReturnType<YjsSyncAdapter["connect"]>>;
}

async function openSeats(count: number): Promise<Seat[]> {
  const hub = new PartitionHub();
  const list: Seat[] = [];
  for (let index = 0; index < count; index += 1) {
    const transport = new QueuedTransport(hub);
    const adapter = new YjsSyncAdapter({
      transport,
      throttle: { gestureMs: 0, textDebounceMs: 0 },
    });
    const outbound = await adapter.connect(recordingCanvas().inbound);
    list.push({ adapter, transport, outbound });
  }
  return list;
}

function stateVectorOf(seat: Seat): string {
  return [...Y.encodeStateVector(seat.adapter.document)].join(",");
}

function elementsOf(seat: Seat): HbElement[] {
  return readDocument(seat.adapter.document).elements;
}

/** عناصرِ **دیده‌شده‌ی** یک کلاینت — همان چیزی که بومش دارد. */
function liveElements(seat: Seat): HbElement[] {
  return elementsOf(seat).filter((candidate) => !candidate.isDeleted);
}

const COLORS = ["#FFF9B1", "#D0C6F5", "#B5F2C9", "#FFD6A5", "#A5D8FF"] as const;

/**
 * یک عملیاتِ تصادفی روی مسیرِ **واقعیِ** binder.
 *
 * ★ پایه‌ی هر عملیات از **سندِ خودِ همان کلاینت** خوانده می‌شود، نه از یک حالتِ
 * سراسری. این عمدی است: بومِ واقعی هم فقط چیزی را می‌بیند که به دستش رسیده،
 * پس زیرِ پارتیشن همه دارند روی یک نسخه‌ی **کهنه** کار می‌کنند — که دقیقاً
 * شرایطی است که تعارض می‌سازد.
 */
function randomOp(seat: Seat, random: () => number, index: number): void {
  const current = elementsOf(seat);
  const roll = random();

  // ساختِ عنصرِ تازه — شناسه‌ی سراسریِ یکتا، پس تعارضِ ساخت نمی‌سازد.
  if (roll < 0.2 || current.length === 0) {
    seat.outbound.emitElementChanges({
      upserted: [element(`el_${index}`, { x: index * 7, y: index * 11 })],
      deleted: [],
      origin: "local-user",
    });
    return;
  }

  const target = current[Math.floor(random() * current.length)]!;

  if (roll < 0.45) {
    // درگ — مسیرِ throttleشده‌ی ژست.
    seat.outbound.emitElementChanges({
      upserted: [{ ...target, x: Math.floor(random() * 1000), y: Math.floor(random() * 1000) }],
      deleted: [],
      origin: "local-user",
      gestureId: `g_${index}`,
    });
    return;
  }

  if (roll < 0.65) {
    seat.outbound.emitElementChanges({
      upserted: [{ ...target, backgroundColor: COLORS[Math.floor(random() * COLORS.length)]! }],
      deleted: [],
      origin: "local-user",
    });
    return;
  }

  if (roll < 0.8) {
    seat.outbound.emitElementChanges({
      upserted: [{ ...target, opacity: Math.floor(random() * 100) }],
      deleted: [],
      origin: "local-user",
    });
    return;
  }

  if (roll < 0.9) {
    seat.outbound.emitElementChanges({ upserted: [], deleted: [target.id], origin: "local-user" });
    return;
  }

  // تایپ — مسیرِ debounce، و **روی `originalText`** نه `text` (ADR-034).
  const text = current.find((candidate) => candidate.type === "text");
  if (!text) return;
  const previous = (text as { originalText?: string }).originalText ?? "";
  seat.outbound.emitElementChanges({
    upserted: [{ ...text, originalText: `${previous}${index % 10}` } as HbElement],
    deleted: [],
    origin: "local-user",
    gestureId: `g_type_${index}`,
  });
}

interface RoundResult {
  readonly seats: Seat[];
  /** ترتیبِ **تحویل‌شده‌ی** هر کلاینت، به شماره‌ی تولید. */
  readonly orders: number[][];
  /** آیا زیرِ پارتیشن واقعاً واگرا شده بودند؟ */
  readonly divergedWhilePartitioned: boolean;
}

async function playRound(seed: number, clients: number, ops: number): Promise<RoundResult> {
  const list = await openSeats(clients);
  const random = mulberry32(seed);

  // حالتِ اولیه‌ی مشترک — قبل از پارتیشن، پس همه یکی‌اش را دارند.
  list[0]!.outbound.emitElementChanges({
    upserted: [element("el_seed", { x: 10, y: 20 }), textElement("txt_seed", "سلام")],
    deleted: [],
    origin: "local-user",
  });
  await tick();

  for (const seat of list) seat.transport.hold();

  for (let index = 0; index < ops; index += 1) {
    randomOp(list[Math.floor(random() * list.length)]!, random, index);
    // ⚠️ مسیرهای ژست و تایپ `setTimeout` می‌زنند؛ بدونِ این، نصفِ عملیات‌ها
    //    هرگز روی سند نمی‌نشینند و تست بی‌صدا ضعیف می‌شود.
    await tick();
  }

  const vectorsWhileSplit = new Set(list.map(stateVectorOf));

  // ★ هر کلاینت با **جابه‌جاییِ خودش** تغذیه می‌شود.
  const orders = list.map((seat) => seat.transport.release((queued) => shuffle(queued, random)));

  return { seats: list, orders, divergedWhilePartitioned: vectorsWhileSplit.size > 1 };
}

function isAscending(order: readonly number[]): boolean {
  return order.every((value, index) => index === 0 || value > order[index - 1]!);
}

describe("★★ همگرایی زیرِ ترتیب‌های رسیدنِ متفاوت", () => {
  // seedهای ثابت — قطعی، بازتولیدپذیر، و به‌اندازه‌ی کافی متنوع.
  for (const seed of [1, 7, 42, 1400, 20250814]) {
    it(`seed=${seed}: سه کلاینت، ۳۰ عملیات، سه ترتیبِ متفاوت → یک حالت`, async () => {
      const { seats: list, orders, divergedWhilePartitioned } = await playRound(seed, 3, 30);

      // ── گیتِ اولِ خودِ تست: پارتیشن واقعاً واگرایی ساخت ────────────────
      expect(divergedWhilePartitioned, "زیرِ پارتیشن باید واگرا شده باشند").toBe(true);

      // ── گیتِ دومِ خودِ تست: ترتیبِ رسیدن واقعاً جابه‌جا شد ──────────────
      for (const order of orders) {
        expect(order.length, "هر کلاینت باید چیزی گرفته باشد").toBeGreaterThan(5);
      }
      const shuffled = orders.filter((order) => !isAscending(order)).length;
      expect(
        shuffled,
        "دستِ‌کم دو کلاینت باید خارج از ترتیبِ تولید تحویل گرفته باشند",
      ).toBeGreaterThanOrEqual(2);

      // ── ادعای اصلی ─────────────────────────────────────────────────
      const [first, ...rest] = list as [Seat, ...Seat[]];
      for (const seat of rest) {
        expect(stateVectorOf(seat), "بردارِ وضعیت").toBe(stateVectorOf(first));
        expect(elementsOf(seat), "نتیجه‌ی دیده‌شده").toEqual(elementsOf(first));
      }
      // و چیزی برای مقایسه وجود داشت — نه یک بوردِ خالی.
      expect(liveElements(first).length).toBeGreaterThan(0);
    });
  }

  it("دو کلاینت با ترتیبِ **وارونه** هم به یک حالت می‌رسند", async () => {
    const list = await openSeats(2);
    const [a, b] = list as [Seat, Seat];
    const random = mulberry32(99);

    a.outbound.emitElementChanges({
      upserted: [element("el_seed")],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    a.transport.hold();
    b.transport.hold();
    for (let index = 0; index < 20; index += 1) {
      randomOp(index % 2 === 0 ? a : b, random, index);
      await tick();
    }

    // ★ ترتیبِ رسیدنِ B دقیقاً **وارونه‌ی** ترتیبِ تولید است — بدترین حالتِ ممکن،
    //   نه یک جابه‌جاییِ تصادفی.
    const orderA = a.transport.release();
    const orderB = b.transport.release((queued) => [...queued].reverse());

    expect(isAscending(orderA)).toBe(true);
    expect(isAscending(orderB), "ترتیبِ B باید وارونه باشد").toBe(false);
    expect(stateVectorOf(a)).toBe(stateVectorOf(b));
    expect(elementsOf(a)).toEqual(elementsOf(b));
  });

  it("★ کنترلِ منفی: با انداختنِ صفِ یک کلاینت، همگرایی **نقض می‌شود**", async () => {
    const list = await openSeats(2);
    const [a, b] = list as [Seat, Seat];

    a.outbound.emitElementChanges({
      upserted: [element("el_seed")],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    b.transport.hold();
    a.outbound.emitElementChanges({
      upserted: [element("el_lost", { x: 555 })],
      deleted: [],
      origin: "local-user",
    });
    await tick();

    const dropped = b.transport.drop();
    expect(dropped.length, "چیزی برای انداختن باید بوده باشد").toBeGreaterThan(0);

    // ⚠️ اگر این ادعا روزی سبز شد، یعنی ادعای همگراییِ بالا هیچ‌وقت چیزی
    //    نمی‌سنجیده — نه اینکه CRDT قوی‌تر شده.
    expect(stateVectorOf(a)).not.toBe(stateVectorOf(b));
    expect(elementsOf(b).map((el) => el.id)).not.toContain("el_lost");
  });
});
