import type { ObjectStore } from "@hamboom/storage";

import type { SnapshotStore } from "./snapshot-store.ts";

/**
 * `StorageSnapshotStore` — پیاده‌سازیِ پورتِ [`SnapshotStore`](./snapshot-store.ts) روی
 * `@hamboom/storage` (M3 گام ۳٫۲، [ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031)).
 *
 * جایگزینِ `FsSnapshotStore`ِ D-3 در production است؛ چون **همان interface** را می‌دهد،
 * هیچ خطی از [`compactor.ts`](./compactor.ts) عوض نمی‌شود. تزریقش در `main.ts` کارِ **فاز ۷** است.
 *
 * ── چرا اینجا readback نیست (برخلافِ چیزی که شاید انتظار برود) ───────────
 *
 * قراردادِ پورت «وقتی resolve شد، خواندنی است» را S3 خودش می‌دهد: `PutObject` فقط با
 * پاسخِ موفق resolve می‌شود و read-after-write برای شیءِ نو تضمین است. سدِ دومِ «putِ
 * دروغین» هم **compactor** است، نه اینجا: مرحله‌ی ۴ فشرده‌سازی بعد از `put` از **خودِ
 * انبار** بازمی‌خواند و state vector را می‌سنجد. یک readbackِ دومِ اینجا فقط کندی است،
 * نه امنیتِ بیشتر — و FsSnapshotStore هم به همین دلیل ندارد.
 *
 * ⚠️ **مهارِ مسیرِ FsSnapshotStore اینجا لازم نیست:** کلیدِ `../..` روی S3 فقط یک کلیدِ
 * تحت‌اللفظی است (بیرونِ باکت نمی‌زند)، نه پیمایشِ فایل‌سیستم. آن نگهبان مالِ دیسک بود.
 *
 * یک نمونه به **یک باکت** (`S3_BUCKET_SNAPSHOTS`) مقید است — مصرف‌کننده `objectStore` را
 * از `createS3ObjectStore({..., bucket })` می‌سازد و اینجا تزریق می‌کند.
 */
export function createStorageSnapshotStore(objectStore: ObjectStore): SnapshotStore {
  return {
    async put(key, bytes) {
      await objectStore.putObject(key, bytes, { contentType: "application/octet-stream" });
    },

    get(key) {
      return objectStore.getObject(key);
    },

    async delete(key) {
      // S3 `DeleteObject` روی کلیدِ ناموجود هم موفق است — همان idempotencyِ موردِنیازِ پورت.
      await objectStore.deleteObject(key);
    },
  };
}
