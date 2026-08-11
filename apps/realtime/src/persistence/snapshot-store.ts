/**
 * پورتِ ذخیره‌ی بایت‌های snapshot — تصمیمِ **D-3** و
 * [ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031).
 *
 * ── چرا یک پورتِ جدا، و نه همان `UpdateLog` ────────────────────────────
 *
 * [ADR-009](../../../../ARCHITECTURE_DECISIONS.md#adr-009) عمداً این دو را از هم
 * جدا کرده: لاگ **کوچک، پرتراکنش و نیازمندِ ترتیب و دوام** است (کارِ Postgres)،
 * snapshot **بزرگ، کم‌تعداد و فقط-خواندنی** است (کارِ Object Storage، که به‌مراتب
 * ارزان‌تر است). یک پورتِ مشترک این تفکیک را در همان اولین پیاده‌سازی می‌بلعید.
 *
 * ⚠️ **اینجا هیچ `@aws-sdk/*`ی نیست و نباید باشد** (P4 و گیتِ ESLintِ گام ۰٫۲،
 * که خودش سه‌لایه خودآزمون است). وقتی M3 آمد، `packages/storage` یک پیاده‌سازیِ
 * دیگر از همین interface می‌دهد و **هیچ خطی از `compactor.ts` عوض نمی‌شود**.
 */

export interface SnapshotStore {
  /**
   * نوشتنِ بایت‌ها زیرِ `key`. وقتی resolve شد، **خواندنی است**.
   *
   * ⚠️ «خواندنی» یعنی روی دیسک، نه در بافر — همان قراردادی که `UpdateLog.append`
   * دارد و به همان دلیل: بلافاصله بعدش updateهای واقعی **حذف** می‌شوند.
   */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** `null` یعنی این کلید نیست — نه خطا، چون بورد بدونِ snapshot عادی است. */
  get(key: string): Promise<Uint8Array | null>;
  /** حذفِ snapshotِ کهنه. اختیاری: هر انبار زباله‌روبی ندارد. */
  delete?(key: string): Promise<void>;
}

/**
 * کلیدِ snapshot.
 *
 * ★ `seq` در خودِ کلید است تا هر snapshot **فایلِ خودش** باشد و هیچ‌وقت روی
 * قبلی بازنویسی نشود. اگر کلید ثابت بود (`{board}.bin`)، نوشتنِ نصفه‌کاره‌ی
 * snapshotِ جدید، snapshotِ سالمِ قبلی را هم می‌بلعید — و این دقیقاً لحظه‌ای است
 * که updateهای قدیمی از لاگ پاک شده‌اند.
 */
export function snapshotKey(boardId: string, seqUpto: number): string {
  return `${boardId}/${String(seqUpto).padStart(12, "0")}.ybin`;
}

/** انبارِ حافظه‌ای — برای تستِ **منطق**، نه برای ادعای دوام. */
export class MemorySnapshotStore implements SnapshotStore {
  private readonly objects = new Map<string, Uint8Array>();

  put(key: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(key, bytes.slice());
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array | null> {
    const found = this.objects.get(key);
    return Promise.resolve(found ? found.slice() : null);
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** فقط برای تست: چند شیء داخل است. */
  get size(): number {
    return this.objects.size;
  }
}
