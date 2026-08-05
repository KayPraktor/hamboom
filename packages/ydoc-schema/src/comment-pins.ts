import * as Y from "yjs";

import { writeInto } from "./value-codec.ts";

/**
 * سنجاقِ کامنت روی بوم — `threadId → { x, y, elementId?, resolved }`
 * ([PLAN بخش ۷٫۱](../../../PLAN.md)).
 *
 * ── چرا فقط مختصات، و متن اینجا نیست ──────────────────────────────────
 *
 * متنِ کامنت‌ها در Postgres است (`comment_threads`/`comments` — کارِ M3). چیزی که
 * **باید** در CRDT باشد فقط جای سنجاق است: وقتی کسی عنصر را جابه‌جا می‌کند یا دو
 * نفر همزمان یک نخ را حل می‌کنند، همان‌جا باید همگرا شود. ریختنِ متن داخلِ سند
 * یعنی همان متن در هر `board_updates` تکرار می‌شود و از دسترسِ جستجو و مجوزهای
 * API بیرون می‌مانَد.
 *
 * ⚠️ **تایپِ `CommentPin` عمداً اینجاست، نه در `shared-types`.** قیدِ فعالِ M2 این
 * است که این ماژول بدونِ هیچ تغییری در `shared-types` تمام شود، و M3 هنوز
 * قراردادِ کامنت را ننوشته. اگر M3 لازم داشت، آن‌وقت با تاییدِ مالک بالا می‌رود —
 * در فهرستِ تحویلِ گام ۶٫۴ ثبت است.
 */

export interface CommentPin {
  /** مختصاتِ بوم — هرگز آینه نمی‌شود، حتی در RTL (P6). */
  x: number;
  y: number;
  /** اگر سنجاق به یک عنصر چسبیده باشد. نبودش یعنی سنجاقِ آزاد روی بوم. */
  elementId?: string;
  resolved: boolean;
}

export interface CommentPinEntry extends CommentPin {
  threadId: string;
}

/**
 * نوشتنِ یک سنجاق.
 *
 * `pin` **کامل** است نه patch — پس برداشتنِ `elementId` (وقتی سنجاق از عنصر جدا
 * می‌شود) واقعاً کلید را از سند برمی‌دارد.
 */
export function writeCommentPin(
  commentPins: Y.Map<unknown>,
  threadId: string,
  pin: CommentPin,
): void {
  const existing = commentPins.get(threadId);
  let map: Y.Map<unknown>;
  if (existing instanceof Y.Map) {
    map = existing;
  } else {
    map = new Y.Map<unknown>();
    commentPins.set(threadId, map);
  }
  writeInto(map, pin as unknown as Record<string, unknown>, { prune: true });
}

/** همه‌ی سنجاق‌ها، مرتب با `threadId` تا ترتیب قطعی بماند. */
export function readCommentPins(commentPins: Y.Map<unknown>): CommentPinEntry[] {
  const result: CommentPinEntry[] = [];
  for (const [threadId, value] of commentPins.entries()) {
    if (!(value instanceof Y.Map)) continue;
    result.push({ threadId, ...(value.toJSON() as CommentPin) });
  }
  return result.sort((a, b) => (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0));
}

/**
 * برداشتنِ سنجاق.
 *
 * حذفِ **سخت**: سنجاق یک برآمدگیِ نخِ کامنت است، نه تاریخچه‌ی ویرایشِ کاربر.
 * حذفِ خودِ نخ در Postgres انجام می‌شود (کارِ M3) و این فقط دنبالش می‌آید.
 */
export function removeCommentPin(commentPins: Y.Map<unknown>, threadId: string): void {
  commentPins.delete(threadId);
}
