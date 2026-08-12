/**
 * قفلِ صاحبِ بورد — گام ۴٫۷،
 * [ADR-006](../../../../ARCHITECTURE_DECISIONS.md#adr-006) فاز ۲.
 *
 * ── ★★ چرا لازم است، در حالی که [ADR-037](../../../../ARCHITECTURE_DECISIONS.md#adr-037) هست ──
 *
 * ADR-037 تخصیصِ `seq` را برای هر بورد سریالی کرد، ولی آن صف **درونِ یک فرایند**
 * است. دو نود که همزمان روی یک بورد بنویسند همدیگر را نمی‌بینند و باز هم به یک
 * `seq` می‌رسند؛ آنجا تنها سدِ باقی‌مانده ایندکسِ یکتاست، که یعنی یکی از دو نوشتن
 * **می‌افتد**. قفلِ صاحب همان سدِ سومی است که گام ۴٫۳ نامش را برد.
 *
 * ★ و کارش فقط **پایداری** است، نه سرو کردن: هر نود هر اتاقی را باز می‌کند و به
 * کلاینت‌هایش سرو می‌کند (فاز ۲ صریحاً می‌گوید `sessionAffinity` لازم نیست).
 * فقط **نوشتن در دیتابیس** مالِ صاحب است.
 *
 * ── ★ چرا اجاره‌ی زمان‌دار، و نه یک قفلِ ابدی ──────────────────────────
 *
 * نودی که می‌میرد قفلش را پس نمی‌دهد. با `EX 30` اجاره خودش منقضی می‌شود و نودِ
 * بعدی صاحب می‌شود؛ هزینه‌اش حداکثر ۳۰ ثانیه تاخیر در پایداریِ آن بورد است —
 * ⚠️ نه از دست رفتنِ داده: updateها روی گذرگاه پخش شده‌اند و در حافظه‌ی نودهای
 * دیگر هستند، پس صاحبِ بعدی می‌نویسدشان.
 */

export interface OwnerLock {
  /** تلاش برای صاحب‌شدن. `false` یعنی نودِ دیگری صاحب است. */
  acquire(boardId: string): Promise<boolean>;
  /**
   * تمدیدِ اجاره. `false` یعنی **دیگر صاحب نیستیم** — و آن‌وقت باید فوراً دست از
   * نوشتن برداشت.
   *
   * ⚠️ تمدید باید **مشروط** باشد: اگر اجاره منقضی شده و نودِ دیگری آن را گرفته،
   * تمدیدِ کورکورانه قفلِ او را می‌دزدد و دو نود همزمان صاحب می‌شوند — دقیقاً
   * همان چیزی که این قفل برای جلوگیری‌اش هست.
   */
  renew(boardId: string): Promise<boolean>;
  /** رهاکردنِ داوطلبانه — فقط اگر هنوز مالِ ما باشد. */
  release(boardId: string): Promise<void>;
  close(): Promise<void>;
}

/** اجاره‌ی قفل، ثانیه — همان عددِ ADR-006. */
export const OWNER_LEASE_SECONDS = 30;

/**
 * قفلِ درون‌فرایندی — برای تست.
 *
 * ⚠️ **ادعای انحصار نمی‌کند و نباید بکند:** دو فرایندِ واقعی این را به اشتراک
 * نمی‌گذارند. ادعای «هیچ ردیفِ تکراری» فقط با Redisِ واقعی و دو پروسه سنجیده
 * می‌شود (`scripts/rt-cluster.ts`).
 */
export class MemoryOwnerLock implements OwnerLock {
  private readonly holders: Map<string, string>;
  private readonly nodeId: string;

  /**
   * @param holders ★ **دفترِ مشترک** بینِ نودها — جای همان یک Redis.
   *
   * ⚠️ اگر هر نود دفترِ خودش را داشته باشد، **همه** صاحب می‌شوند و تست چیزی را
   * می‌سنجد که در واقعیت وجود ندارد. (اولین نسخه‌ی تستِ خوشه دقیقاً همین بود و
   * با ردیف‌های تکراری قرمز شد — که خودش نشان داد مدل غلط است، نه کد.)
   */
  constructor(nodeId: string, holders = new Map<string, string>()) {
    this.nodeId = nodeId;
    this.holders = holders;
  }

  /** ★ برای تست: قفل را به‌زور به یک نودِ دیگر بده. */
  giveTo(boardId: string, nodeId: string): void {
    this.holders.set(boardId, nodeId);
  }

  acquire(boardId: string): Promise<boolean> {
    const holder = this.holders.get(boardId);
    if (holder !== undefined && holder !== this.nodeId) return Promise.resolve(false);
    this.holders.set(boardId, this.nodeId);
    return Promise.resolve(true);
  }

  renew(boardId: string): Promise<boolean> {
    return Promise.resolve(this.holders.get(boardId) === this.nodeId);
  }

  release(boardId: string): Promise<void> {
    if (this.holders.get(boardId) === this.nodeId) this.holders.delete(boardId);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.holders.clear();
    return Promise.resolve();
  }
}
