/**
 * لاگِ append-onlyِ updateها — [ADR-009](../../../../ARCHITECTURE_DECISIONS.md#adr-009).
 *
 * ── ★★ دوام **قبل از** ack ────────────────────────────────────────────
 *
 * قراردادِ M1 می‌گوید `SaveState` باید **حقیقت** را بگوید نه خوش‌بینی: اگر
 * «ذخیره شد» نشان دادیم و کاربر تب را بست، کارش نباید برود. تنها راهِ صادقانه‌ی
 * گفتنِ «ذخیره شد» این است که **قبلش** واقعاً نوشته باشیم.
 *
 * پس این پورت یک قرارداد دارد: `append` وقتی resolve می‌شود که update **روی
 * دیسکِ دیتابیس** باشد. هر پیاده‌سازی‌ای که زودتر resolve کند، آن قرارداد را
 * می‌شکند — و شکستنش در تستِ SIGKILL دیده می‌شود، نه در تستِ واحد.
 */

export interface AppendedUpdate {
  /** شماره‌ی ترتیبیِ **درونِ بورد** — ایندکسِ یکتای PLAN بخش ۶. */
  seq: number;
  /** زمانِ نوشتن، از ساعتِ **دیتابیس** نه ساعتِ اپ. */
  at: number;
}

export interface UpdateLog {
  /**
   * ثبتِ یک update. وقتی resolve شد، **دوام دارد**.
   *
   * `originUserId` برای ممیزی است؛ `null` یعنی خودِ سرور نوشته (مثلاً migration).
   */
  append(
    boardId: string,
    payload: Uint8Array,
    originUserId: string | null,
  ): Promise<AppendedUpdate>;
  /** همه‌ی updateهای بعد از `afterSeq`، به ترتیب. */
  since(boardId: string, afterSeq: number): Promise<Uint8Array[]>;
  /** آخرین `seq`ِ ثبت‌شده — صفر یعنی بوردِ نو. */
  latestSeq(boardId: string): Promise<number>;
  close?(): Promise<void>;
}

/**
 * پیاده‌سازیِ حافظه‌ای — برای تستِ **منطقِ اتاق**، نه برای ادعای دوام.
 *
 * ⚠️ عمداً هیچ ادعای دوامی ندارد و نباید داشته باشد: تستی که با این سبز شود
 * چیزی درباره‌ی «ذخیره شد» اثبات نمی‌کند. ادعای دوام فقط با Postgresِ واقعی و
 * `scripts/rt-durability.ts` سنجیده می‌شود.
 */
export class MemoryUpdateLog implements UpdateLog {
  private readonly logs = new Map<string, { payload: Uint8Array; seq: number }[]>();
  private readonly delayMs: number;

  /** تاخیرِ ساختگی — برای آزمودنِ «ackِ زودهنگام» در تستِ واحد. */
  constructor(delayMs = 0) {
    this.delayMs = delayMs;
  }

  async append(
    boardId: string,
    payload: Uint8Array,
    _originUserId: string | null = null,
  ): Promise<AppendedUpdate> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const entries = this.logs.get(boardId) ?? [];
    const seq = (entries.at(-1)?.seq ?? 0) + 1;
    entries.push({ payload, seq });
    this.logs.set(boardId, entries);
    return { seq, at: Date.now() };
  }

  since(boardId: string, afterSeq: number): Promise<Uint8Array[]> {
    const entries = this.logs.get(boardId) ?? [];
    return Promise.resolve(entries.filter((entry) => entry.seq > afterSeq).map((e) => e.payload));
  }

  latestSeq(boardId: string): Promise<number> {
    return Promise.resolve(this.logs.get(boardId)?.at(-1)?.seq ?? 0);
  }
}
