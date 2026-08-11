import type { UpdateLog } from "../persistence/update-log.ts";
import type { BoardSnapshot, BoardStore } from "./board-store.ts";

/**
 * بارگذاریِ بورد از لاگِ پایدار — [ADR-009](../../../../ARCHITECTURE_DECISIONS.md#adr-009).
 *
 * ⚠️ فعلاً **snapshot ندارد** و همه‌ی updateها از ابتدا خوانده می‌شوند. این تا
 * گام ۴٫۴ درست است و بعدش نه: بوردِ قدیمی با ده‌ها هزار update کند بالا می‌آید،
 * که دقیقاً همان چیزی است که ADR-009 برایش snapshot تعریف کرده. اینجا عمداً
 * نیمه‌کاره نمی‌سازیمش — ۴٫۴ `seqUpto` را هم اضافه می‌کند.
 *
 * ★ ترتیب اهمیتِ حیاتی دارد: `since` با `ORDER BY seq` می‌خواند، چون Yjs updateِ
 * بی‌پیشینه را **بی‌صدا** بایگانی می‌کند (نگهبانِ `pendingStructs` در `room.ts`).
 */
export function createPersistedBoardStore(log: UpdateLog): BoardStore {
  return {
    async load(boardId): Promise<BoardSnapshot> {
      return { snapshot: null, updates: await log.since(boardId, 0) };
    },
  };
}
