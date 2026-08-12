import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

/**
 * گذرگاهِ بینِ نودها — گام ۴٫۷، فاز ۲ در
 * [ADR-006](../../../../ARCHITECTURE_DECISIONS.md#adr-006).
 *
 * ── چرا پورت، و نه `ioredis` مستقیم در `room.ts` ──────────────────────
 *
 * [ADR-030](../../../../ARCHITECTURE_DECISIONS.md#adr-030): ترابری پشتِ seam
 * می‌مانَد. منطقِ اتاق نباید بداند پیام از Redis می‌آید یا از یک آرایه در حافظه —
 * و همین است که تستِ چندنودی را **بدونِ Redis** ممکن می‌کند.
 *
 * ── ★★ چرا این کار از نظرِ صحت درست است ───────────────────────────────
 *
 * ADR-006 دلیلش را می‌گوید: **updateهای Yjs جابه‌جایی‌پذیر و idempotent اند**، پس
 * ترتیبِ رسیدن و تکرار مهم نیست. یعنی fanoutِ ساده کافی است و لازم نیست گذرگاه
 * تضمینِ ترتیب بدهد — چیزی که Redis pub/sub هم نمی‌دهد.
 *
 * ⚠️ **ولی این فقط برای سند صادق است.** `saved` (پایین) یک عدد است، نه CRDT؛
 * آنجا عقب‌نرفتن را خودِ اتاق تضمین می‌کند، نه گذرگاه.
 */

/** چه چیزی روی گذرگاه می‌رود. */
export const BUS_KINDS = {
  /** updateِ باینریِ Yjs — روی `hb:board:<boardId>`. */
  UPDATE: 0,
  /** به‌روزرسانیِ awareness — روی `hb:aware:<boardId>`. */
  AWARENESS: 1,
  /** پیامِ ephemeralِ خام — روی `hb:aware:<boardId>`، بدونِ هیچ پایداری. */
  EPHEMERAL: 2,
  /**
   * ★ «تا `seq` پایدار شد» — از **نودِ صاحب**.
   *
   * ⚠️ بدونِ این، کلاینتی که روی نودِ **غیرِ صاحب** نشسته هرگز راستش را
   * نمی‌فهمید: یا باید دروغِ خوش‌بینانه می‌گفتیم («ذخیره شد» بدونِ نوشتن — نقضِ
   * [ADR-009](../../../../ARCHITECTURE_DECISIONS.md#adr-009)) یا برای همیشه
   * `saving` نشان می‌دادیم. صاحب بعد از نوشتنِ واقعی این را پخش می‌کند.
   */
  SAVED: 3,
} as const;

export type BusKind = (typeof BUS_KINDS)[keyof typeof BUS_KINDS];

export interface BusEnvelope {
  /**
   * ★★ شناسه‌ی نودِ **مبدأ** — ضدِ حلقه.
   *
   * ⚠️ بدونش هر نود پیامِ خودش را پس می‌گیرد، دوباره اعمال و **دوباره منتشر**
   * می‌کند: یک حلقه‌ی بی‌پایان بینِ دو نود. ADR-006 صریحاً همین را خواسته.
   */
  node: string;
  kind: BusKind;
  payload: Uint8Array;
  /** فقط برای `SAVED`. */
  seq: number;
}

export interface BoardBus {
  /** انتشار برای بقیه‌ی نودها. */
  publish(boardId: string, envelope: BusEnvelope): void;
  /**
   * اشتراک روی یک بورد. تابعِ بازگشتی اشتراک را برمی‌دارد.
   *
   * ⚠️ **`async` است چون Redis واقعاً یک رفت‌وبرگشت لازم دارد** — و اتاق باید
   * **قبل از** خواندن از دیتابیس منتظرش بمانَد، وگرنه updateهایی که در همان
   * فاصله منتشر می‌شوند برای همیشه گم می‌شوند.
   */
  subscribe(boardId: string, handler: (envelope: BusEnvelope) => void): Promise<() => void>;
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// codec
// ─────────────────────────────────────────────────────────────

/**
 * قالبِ روی سیمِ **داخلی**.
 *
 * ⚠️ عمداً `encodeMessage`ِ `ydoc-schema` نیست: آن قراردادِ **کلاینت** است و
 * `nodeId` در آن جایی ندارد. قاطی‌کردنشان یعنی یک فیلدِ داخلیِ سرور به قراردادِ
 * عمومی نشت کند.
 */
export function encodeEnvelope(envelope: BusEnvelope): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, envelope.kind);
  encoding.writeVarString(encoder, envelope.node);
  encoding.writeVarUint(encoder, envelope.seq);
  encoding.writeVarUint8Array(encoder, envelope.payload);
  return encoding.toUint8Array(encoder);
}

/** `null` یعنی خوانده نشد — یک نودِ **جدیدتر** می‌تواند چیزی بفرستد که نمی‌فهمیم. */
export function decodeEnvelope(bytes: Uint8Array): BusEnvelope | null {
  try {
    const decoder = decoding.createDecoder(bytes);
    const kind = decoding.readVarUint(decoder);
    if (!isBusKind(kind)) return null;
    const node = decoding.readVarString(decoder);
    const seq = decoding.readVarUint(decoder);
    const payload = decoding.readVarUint8Array(decoder);
    return { kind, node, seq, payload };
  } catch {
    // ⚠️ همان قاعده‌ی `decodeMessage`: پیامِ نامفهوم نباید نود را بیندازد. در یک
    //    استقرارِ چندنودی، نسخه‌های مختلف **همزمان** بالا هستند.
    return null;
  }
}

function isBusKind(value: number): value is BusKind {
  return (Object.values(BUS_KINDS) as number[]).includes(value);
}

// ─────────────────────────────────────────────────────────────
// پیاده‌سازیِ حافظه‌ای
// ─────────────────────────────────────────────────────────────

/**
 * گذرگاهِ درون‌فرایندی — برای آزمودنِ **منطقِ چندنودی بدونِ Redis**.
 *
 * ★ دو `createRoomManager` که این را به اشتراک بگذارند دقیقاً مثلِ دو نودِ واقعی
 * رفتار می‌کنند: همان envelopeها، همان ضدِ حلقه. آنچه اینجا دیده **نمی‌شود** تاخیرِ
 * شبکه و از دست رفتنِ پیام است — سنجه‌ی زنده‌ی `rt-cluster` برای همان است.
 */
export class MemoryBoardBus implements BoardBus {
  private readonly handlers = new Map<string, Set<(envelope: BusEnvelope) => void>>();
  /** شمارشِ انتشارها — تستِ ضدِ حلقه همین را می‌خواند. */
  published = 0;

  publish(boardId: string, envelope: BusEnvelope): void {
    this.published++;
    // ⚠️ از راهِ codec رد می‌شود، نه ارجاعِ مستقیم: وگرنه تست روی همان شیء کار
    //    می‌کرد و یک باگِ codec را هرگز نمی‌دید.
    const bytes = encodeEnvelope(envelope);
    for (const handler of this.handlers.get(boardId) ?? []) {
      const decoded = decodeEnvelope(bytes);
      if (decoded) handler(decoded);
    }
  }

  subscribe(boardId: string, handler: (envelope: BusEnvelope) => void): Promise<() => void> {
    const set = this.handlers.get(boardId) ?? new Set();
    set.add(handler);
    this.handlers.set(boardId, set);
    return Promise.resolve(() => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(boardId);
    });
  }

  close(): Promise<void> {
    this.handlers.clear();
    return Promise.resolve();
  }
}
