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
  /**
   * همه‌ی updateهای بعد از `afterSeq`، به ترتیب.
   *
   * ★ `uptoSeq` (گام ۴٫۴) بازه را از بالا می‌بندد و **اختیاری نیست از سرِ راحتی**:
   * فشرده‌سازی باید بداند snapshot دقیقاً تا کدام `seq` را در خود دارد. بدونِ
   * کران، بینِ خواندن و نوشتنِ snapshot ممکن است updateهای تازه‌ای برسند که در
   * بایت‌ها هستند ولی `seq_upto` از آن‌ها خبر ندارد — یعنی متادیتا **دروغ** می‌گوید.
   */
  since(boardId: string, afterSeq: number, uptoSeq?: number): Promise<Uint8Array[]>;
  /** آخرین `seq`ِ ثبت‌شده — صفر یعنی بوردِ نو. */
  latestSeq(boardId: string): Promise<number>;
  /**
   * ★★ حذفِ updateهای `seq <= uptoSeq` — **فقط بعد از اینکه snapshot نشست**.
   *
   * ⚠️ این خطرناک‌ترین متدِ کلِ M2 است: تنها جایی که داده‌ی پایدار **پاک** می‌شود.
   * قراردادش این است که صدازننده قبلاً ثابت کرده باشد همان بازه در یک snapshotِ
   * **خوانده‌شده** موجود است. ترتیبِ امنش در [`compactor.ts`](./compactor.ts) است
   * و آنجا با تست قفل شده.
   *
   * @returns تعدادِ ردیف‌های حذف‌شده.
   */
  prune(boardId: string, uptoSeq: number): Promise<number>;
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
  /**
   * ★★ نشانه‌ی بلندترین `seq`ی که **تا حالا** داده شده — و `prune` پاکش نمی‌کند.
   *
   * ⚠️ بدونِ این، حذف یک باگِ خاموش می‌سازد: اگر همه‌ی ردیف‌های یک بورد فشرده و
   * حذف شوند، `MAX(seq)` صفر می‌شود و updateِ بعدی دوباره `seq = 1` می‌گیرد —
   * در حالی که snapshot می‌گوید «تا ۵۰۰ در من هست». کلاینتِ بعدی
   * `since(500)` می‌خواند و آن update را **هرگز نمی‌بیند**.
   * ★ همتای واقعی‌اش در Postgres `GREATEST(MAX(seq), MAX(seq_upto))` است.
   */
  private readonly highWater = new Map<string, number>();
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
    const seq = (this.highWater.get(boardId) ?? 0) + 1;
    entries.push({ payload, seq });
    this.logs.set(boardId, entries);
    this.highWater.set(boardId, seq);
    return { seq, at: Date.now() };
  }

  since(
    boardId: string,
    afterSeq: number,
    uptoSeq = Number.POSITIVE_INFINITY,
  ): Promise<Uint8Array[]> {
    const entries = this.logs.get(boardId) ?? [];
    return Promise.resolve(
      entries.filter((e) => e.seq > afterSeq && e.seq <= uptoSeq).map((e) => e.payload),
    );
  }

  latestSeq(boardId: string): Promise<number> {
    return Promise.resolve(this.highWater.get(boardId) ?? 0);
  }

  prune(boardId: string, uptoSeq: number): Promise<number> {
    const entries = this.logs.get(boardId) ?? [];
    const kept = entries.filter((entry) => entry.seq > uptoSeq);
    this.logs.set(boardId, kept);
    return Promise.resolve(entries.length - kept.length);
  }
}
