/**
 * کاتالوگِ snapshotها — جدولِ `board_snapshots` (PLAN بخش ۶).
 *
 * ── ★★ چرا این «نقطه‌ی commit» است ─────────────────────────────────────
 *
 * بایت‌ها در `SnapshotStore` اند و متادیتا اینجا. تا وقتی **ردیف** ننشسته باشد،
 * آن فایل برای هیچ‌کس وجود ندارد — بارگذاری فقط از راهِ `latest()` سراغِ انبار
 * می‌رود. پس ترتیبِ امن این است:
 *
 *   بایت‌ها → بازخوانی و تایید → **ردیف** → و تازه بعدش `prune`
 *
 * یعنی اگر بینِ نوشتنِ فایل و نشستنِ ردیف برق برود، بدترین اتفاق یک فایلِ یتیم
 * است که فضا می‌گیرد. اگر ترتیب برعکس بود، بدترین اتفاق **حذفِ updateهایی بود
 * که هیچ snapshotی جایشان را نگرفته** — یعنی از دست رفتنِ کارِ کاربر.
 */

export interface SnapshotRecord {
  /** تا کدام `seq` فشرده شده — بارگذاری از همین‌جا به بعد update می‌خواند. */
  seqUpto: number;
  /** کلید در `SnapshotStore`. */
  storageKey: string;
  /** `Y.encodeStateVector` در همان لحظه — برای syncِ سریع (PLAN بخش ۶). */
  stateVector: Uint8Array;
  byteSize: number;
  elementCount: number;
}

export interface SnapshotCatalog {
  /** ثبتِ snapshotِ تازه. **بعد** از اینکه بایت‌هایش خوانده و تایید شدند. */
  record(boardId: string, entry: SnapshotRecord): Promise<void>;
  /** تازه‌ترین snapshot، یا `null` برای بوردی که هنوز فشرده نشده. */
  latest(boardId: string): Promise<SnapshotRecord | null>;
  /**
   * snapshotهای **کهنه‌تر** از `keepFromSeq` — برای زباله‌روبی.
   *
   * ⚠️ عمداً خودش پاک نمی‌کند: حذفِ ردیف قبل از حذفِ فایل یعنی فایلِ یتیمِ
   * نامرئی. صدازننده اول فایل را برمی‌دارد، بعد `forget` می‌کند.
   */
  older(boardId: string, keepFromSeq: number): Promise<SnapshotRecord[]>;
  forget(boardId: string, seqUpto: number): Promise<void>;
}

/** پیاده‌سازیِ حافظه‌ای — برای تستِ منطق. */
export class MemorySnapshotCatalog implements SnapshotCatalog {
  private readonly rows = new Map<string, SnapshotRecord[]>();

  record(boardId: string, entry: SnapshotRecord): Promise<void> {
    const list = this.rows.get(boardId) ?? [];
    list.push({ ...entry, stateVector: entry.stateVector.slice() });
    this.rows.set(boardId, list);
    return Promise.resolve();
  }

  latest(boardId: string): Promise<SnapshotRecord | null> {
    const list = this.rows.get(boardId) ?? [];
    const best = list.reduce<SnapshotRecord | null>(
      (top, row) => (top === null || row.seqUpto > top.seqUpto ? row : top),
      null,
    );
    return Promise.resolve(best);
  }

  older(boardId: string, keepFromSeq: number): Promise<SnapshotRecord[]> {
    const list = this.rows.get(boardId) ?? [];
    return Promise.resolve(list.filter((row) => row.seqUpto < keepFromSeq));
  }

  forget(boardId: string, seqUpto: number): Promise<void> {
    const list = this.rows.get(boardId) ?? [];
    this.rows.set(
      boardId,
      list.filter((row) => row.seqUpto !== seqUpto),
    );
    return Promise.resolve();
  }

  /** فقط برای تست: چند snapshot ثبت شده. */
  count(boardId: string): number {
    return (this.rows.get(boardId) ?? []).length;
  }
}
