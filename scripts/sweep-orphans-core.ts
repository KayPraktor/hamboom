/**
 * منطقِ **خالصِ** جاروبِ بلابِ یتیم — M5 گام ۸٫۲. بدونِ هیچ اثرِ جانبی.
 *
 * ⚠️ **چرا فایلِ جدا، برای بارِ دوم:** دقیقاً همان تله‌ی `backup-common.ts` در فاز ۷.
 * [`sweep-orphans.ts`](sweep-orphans.ts) یک ورودیِ اجرایی است و در انتها `await main()`
 * دارد؛ وقتی خودآزمون از آن import کرد، حلقه‌ی ESM با top-level await قفل شد و Node
 * فقط گفت «unsettled top-level await». پس هر چیزی که هر دو لازم دارند این‌جاست.
 *
 * ★ و سودِ جانبی‌اش این است که منطقِ تصمیم — یعنی خطرناک‌ترین بخش — بدونِ دیتابیس و
 * بدونِ S3 قابلِ آزمون است.
 */
import type { ObjectStore } from "@hamboom/storage";

export interface SweepPlan {
  bucket: string;
  /** اشیائی که ردیفِ مرجع دارند. */
  referenced: number;
  /** بی‌مرجع، ولی جوان‌تر از مهلت ⇒ **دست‌نخورده**. */
  tooYoung: string[];
  /** بی‌مرجع و سنشان نامعلوم ⇒ **دست‌نخورده** (ابهام). */
  unknownAge: string[];
  /** بی‌مرجع و از مهلت گذشته ⇒ نامزدِ حذف. */
  orphans: { key: string; ageHours: number; bytes: number }[];
}

/**
 * نقشه‌ی جاروب برای یک باکت — **بدونِ هیچ حذفی**.
 *
 * ★ عمداً از خودِ حذف جداست: همین تابع هم گزارشِ dry-run را می‌سازد و هم فهرستِ حذف
 * را، پس چیزی که اپراتور می‌بیند **دقیقاً** همان چیزی است که پاک می‌شود.
 */
export async function planSweep(
  store: ObjectStore,
  bucket: string,
  referencedKeys: ReadonlySet<string>,
  now: number,
  minAgeHours: number,
): Promise<SweepPlan> {
  const plan: SweepPlan = { bucket, referenced: 0, tooYoung: [], unknownAge: [], orphans: [] };

  // ★ M6 فاز ۲ (ADR-069): صفحه‌به‌صفحه از انبار، نه `listPrefix("")` — تا M5 همه‌ی کلیدها در
  //   حافظه بودند و فقط بالای ۲۰۰هزار شیء هشدار می‌داد، آن هم **بعد** از این‌که فهرست کامل شده بود.
  for await (const key of store.iteratePrefix("")) {
    if (referencedKeys.has(key)) {
      plan.referenced += 1;
      continue;
    }
    const head = await store.headObject(key);
    if (head === null) continue; // بینِ list و head پاک شده — عادی است
    if (head.lastModified === undefined) {
      // ★ ابهام ⇒ دست نمی‌زنیم، ولی ساکت هم نمی‌مانیم.
      plan.unknownAge.push(key);
      continue;
    }
    const ageHours = (now - head.lastModified.getTime()) / 3_600_000;
    if (ageHours < minAgeHours) {
      plan.tooYoung.push(key);
      continue;
    }
    plan.orphans.push({ key, ageHours, bytes: head.size });
  }

  return plan;
}

/**
 * ★★ تنها جایی که واقعاً پاک می‌کند — و عمداً **فقط** `plan.orphans` را می‌بیند.
 *
 * ⚠️ اگر حذف داخلِ حلقه‌ی `main` می‌مانْد، خطرناک‌ترین چند خطِ ریپو تنها بخشِ
 * **آزمون‌ناپذیر** آن می‌شد: برای اثباتش باید داده‌ی واقعی پاک می‌شد. این‌جا با یک
 * انبارِ ساختگی اثبات می‌شود که هیچ کلیدِ دارای‌مرجع، جوان، یا مبهمی به آن نمی‌رسد.
 */
export async function deleteOrphans(store: ObjectStore, plan: SweepPlan): Promise<string[]> {
  const removed: string[] = [];
  for (const orphan of plan.orphans) {
    await store.deleteObject(orphan.key);
    removed.push(orphan.key);
  }
  return removed;
}
