import { z } from "zod";

import { isoDateTime, uuid } from "./primitives.ts";
import { boardAccessMode, boardRole } from "./roles.ts";
import { userPublic } from "./user.ts";

/**
 * بورد — [PLAN §۵٫۱](../../../../PLAN.md).
 *
 * `accessMode` سمتِ سرور به `effectiveBoardRole` می‌رود تا مسیرِ نقشِ تیم را گِیت کند (OD-1):
 * بوردِ `private` → عضویتِ تیم به‌تنهایی هیچ نقشی نمی‌دهد.
 */
export const board = z.object({
  id: uuid,
  teamId: uuid,
  folderId: uuid.nullable(),
  title: z.string(),
  thumbnailUrl: z.url().nullable(), // worker می‌سازدش (M3-D5) → فعلاً null
  accessMode: boardAccessMode,
  linkToken: z.string().nullable(), // فقط اگر accessMode لینک‌محور باشد
  myRole: boardRole,
  createdBy: userPublic,
  elementCount: z.number().int().nonnegative(), // تقریبی، برای نمایش
  docSizeBytes: z.number().int().nonnegative(),
  lastActivityAt: isoDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  isFavorite: z.boolean(),
  templateId: uuid.nullable(), // در M3 همیشه null (قالب‌ها فاز ۱۰)
});
export type Board = z.infer<typeof board>;

/** نسخه‌ی خلاصه برای فهرستِ داشبورد — [PLAN §۵٫۱](../../../../PLAN.md). */
export const boardSummary = board.pick({
  id: true,
  title: true,
  thumbnailUrl: true,
  lastActivityAt: true,
  myRole: true,
  isFavorite: true,
  folderId: true,
});
export type BoardSummary = z.infer<typeof boardSummary>;

/**
 * عضوِ مستقیمِ بورد (`board_members`) — دسترسیِ فردی فراتر از عضویتِ تیم.
 * `role` خواندنی کاملِ `boardRole` است؛ ورودیِ **تخصیص** `assignableBoardRole` است
 * (بدونِ `commenter` تا فاز ۱۰ — `roles.ts`).
 */
export const boardMember = z.object({
  user: userPublic,
  role: boardRole,
  addedBy: uuid.nullable(),
  addedAt: isoDateTime,
});
export type BoardMember = z.infer<typeof boardMember>;
