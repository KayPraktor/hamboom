/**
 * پورتِ بارگذاریِ بورد — [ADR-009](../../../../ARCHITECTURE_DECISIONS.md#adr-009)
 * و [ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031).
 *
 * ── چرا اینجا فقط **خواندن** است ──────────────────────────────────────
 *
 * گام ۴٫۲ فقط چرخه‌ی عمرِ اتاق است: بارگذاری، حافظه، تخلیه. **نوشتن** کارِ
 * گام‌های ۴٫۳ (لاگِ update در Postgres) و ۴٫۴ (snapshot) است، و اگر همین حالا
 * متدِ نوشتن هم اینجا بود، یا خالی می‌مانْد یا نیمه‌کاره پیاده می‌شد — هر دو بدتر
 * از نبودنش‌اند.
 *
 * شکلِ بازگشتی همان چیزی است که ADR-009 توصیف می‌کند: یک snapshot (اختیاری) و
 * updateهایی که **بعد** از آن آمده‌اند.
 */
export interface BoardSnapshot {
  /** `Y.encodeStateAsUpdate` در لحظه‌ی snapshot. `null` یعنی هنوز snapshot نداریم. */
  snapshot: Uint8Array | null;
  /** updateهای بعد از snapshot، **به ترتیبِ `seq`**. */
  updates: Uint8Array[];
  /**
   * `seq`ی که snapshot تا آن را در خود دارد؛ صفر یعنی snapshotی نبوده.
   *
   * ★ گام ۴٫۴ این را اضافه کرد چون **اتاق باید بداند از کجا بشمارد**. بدونش
   * مبدأِ آستانه‌ی فشرده‌سازی یا صفر می‌شد (بوردِ تازه‌بارگذاری‌شده بلافاصله
   * دوباره فشرده می‌شد) یا `seq`ِ جاری (بوردی با ۴۹۹ updateِ فشرده‌نشده تا ۵۰۰
   * updateِ **دیگر** صبر می‌کرد). هیچ‌کدام آن چیزی نیست که ADR-009 می‌خواهد.
   */
  seqUpto: number;
}

export interface BoardStore {
  load(boardId: string): Promise<BoardSnapshot>;
}

/**
 * پیاده‌سازیِ درون‌حافظه‌ای — جای Postgres تا گام ۴٫۳.
 *
 * ⚠️ عمداً **فراموش‌کار** است: با ری‌استارتِ فرایند همه‌چیز می‌رود. این را در تست
 * می‌شود جدی گرفت (اتاق تخلیه می‌شود ولی داده می‌مانَد) و در تولید هرگز — چون
 * گام ۴٫۳ جایگزینش می‌کند.
 */
export class MemoryBoardStore implements BoardStore {
  private readonly boards = new Map<string, BoardSnapshot>();

  load(boardId: string): Promise<BoardSnapshot> {
    const stored = this.boards.get(boardId);
    return Promise.resolve({
      snapshot: stored?.snapshot ?? null,
      updates: [...(stored?.updates ?? [])],
      seqUpto: stored?.seqUpto ?? 0,
    });
  }

  /** فقط برای تست و توسعه — قراردادِ پورت نیست. */
  seed(boardId: string, data: Partial<BoardSnapshot>): void {
    this.boards.set(boardId, {
      snapshot: data.snapshot ?? null,
      updates: data.updates ?? [],
      seqUpto: data.seqUpto ?? 0,
    });
  }
}
