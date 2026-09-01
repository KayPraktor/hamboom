/**
 * ردیابِ مرزِ ژست — از **فاصله‌ی زمانیِ** onChange تشخیص می‌دهد یک درگ کجا تمام
 * می‌شود. عمداً خالص (زمان تزریق می‌شود) تا تست‌پذیر باشد.
 *
 * ── چرا لازم است ──────────────────────────────────────────────────────
 *
 * `createEmitScheduler`ِ canvas-sync درگ را با `gestureId` گروه می‌کند: هر emitِ
 * میان‌درگ با **یک** gestureId → یک ورودیِ undo + throttleِ ۵۰msِ زنده. پس اپ باید
 * روی هر onChange یک gestureId بدهد که **در طولِ یک درگ ثابت** و بینِ ژست‌ها نو باشد.
 *
 * onChangeهای یک درگ با نرخِ فریم (~۱۶ms) می‌آیند؛ کنش‌های مجزا فاصله‌ی بلندتری
 * دارند. پس «همان ژست اگر ظرفِ `idleMs` از قبلی، وگرنه ژستِ نو» یک مرزِ خوب است —
 * بدونِ تکیه به داخلی‌های موتور (که handoff §۴ می‌گوید هنوز pointer up/down نمی‌دهد).
 */
export interface GestureTracker {
  /** gestureId برای تغییری در زمانِ `nowMs`. در `idleMs` همان، پس از آن نو. */
  idFor(nowMs: number): string;
}

export function createGestureTracker(userId: string, idleMs: number): GestureTracker {
  let seq = 0;
  let id = "";
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    idFor(nowMs) {
      if (nowMs - lastAt > idleMs) {
        seq += 1;
        id = `g_${userId}_${String(seq)}`;
      }
      lastAt = nowMs;
      return id;
    },
  };
}
