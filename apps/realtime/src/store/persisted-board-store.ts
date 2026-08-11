import type { SnapshotCatalog } from "../persistence/snapshot-catalog.ts";
import type { SnapshotStore } from "../persistence/snapshot-store.ts";
import type { UpdateLog } from "../persistence/update-log.ts";
import type { BoardSnapshot, BoardStore } from "./board-store.ts";

/**
 * بارگذاریِ بورد از لاگِ پایدار — [ADR-009](../../../../ARCHITECTURE_DECISIONS.md#adr-009).
 *
 * ★★ **گام ۴٫۴ این را از «همه‌ی updateها از صفر» به «snapshot + بعدش» رساند** —
 * و این تغییر **اختیاری نیست**: از لحظه‌ای که `compactor` شروع به حذف می‌کند،
 * خواندنِ `since(boardId, 0)` یعنی سرو کردنِ بوردی که نیمه‌ی اولش پاک شده.
 *
 * ⚠️ **و بی‌صدا هم خراب می‌شود.** updateهای باقی‌مانده بدونِ پیشینه‌شان در
 * `pendingStructs` می‌نشینند و Yjs هیچ خطایی نمی‌دهد؛ بورد ناقص بالا می‌آید و
 * کسی نمی‌فهمد. نگهبانش در `room.ts` است (`RoomLoadReport.pendingStructs`) ولی
 * نگهبان جای درست‌بودن را نمی‌گیرد.
 *
 * ★ ترتیب حیاتی است: `since` با `ORDER BY seq` می‌خواند و مبدأش **دقیقاً**
 * `seqUpto`ِ همان snapshot است — نه یک عددِ حدسی و نه `latestSeq`.
 */
export interface PersistedBoardStoreOptions {
  log: UpdateLog;
  /** بدونِ این دو، بورد همیشه از صفر خوانده می‌شود (رفتارِ تا گام ۴٫۳). */
  snapshots?: { store: SnapshotStore; catalog: SnapshotCatalog };
}

export function createPersistedBoardStore({
  log,
  snapshots,
}: PersistedBoardStoreOptions): BoardStore {
  return {
    async load(boardId): Promise<BoardSnapshot> {
      if (!snapshots) return { snapshot: null, updates: await log.since(boardId, 0), seqUpto: 0 };

      const latest = await snapshots.catalog.latest(boardId);
      if (!latest) return { snapshot: null, updates: await log.since(boardId, 0), seqUpto: 0 };

      const bytes = await snapshots.store.get(latest.storageKey);
      if (bytes === null) {
        // ⚠️ رکورد هست ولی بایت‌ها نه. اینجا **نباید** بی‌صدا به `since(0)` برگردیم:
        //    updateهای آن بازه قبلاً حذف شده‌اند، پس آن مسیر یک بوردِ ناقصِ
        //    قانع‌کننده می‌سازد. بگذار بالا برود.
        throw new Error(
          `[hamboom] بایت‌های snapshotِ بورد پیدا نشد (${latest.storageKey}); بارگذاری متوقف شد.`,
        );
      }

      return {
        snapshot: bytes,
        updates: await log.since(boardId, latest.seqUpto),
        seqUpto: latest.seqUpto,
      };
    },
  };
}
