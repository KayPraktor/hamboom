import { z } from "zod";

import { isoDateTime, uuid } from "./primitives.ts";

/**
 * فولدرِ سازمان‌دهیِ بوردها در یک تیم — [PLAN §۵٫۱](../../../../PLAN.md).
 *
 * مصرف‌کننده‌اش گام ۶ (sdk/api) است؛ تا این نبود، api ردیفِ خامِ snake_case می‌داد و sdk نمی‌توانست
 * typeِ صادق بدهد. `position` (ترتیبِ نمایش) عمداً بیرون است تا فاز ۸ (UIِ کشیدن‌ورهاکردن) بیایدش.
 */
export const folder = z.object({
  id: uuid,
  teamId: uuid,
  name: z.string(),
  parentId: uuid.nullable(),
  createdAt: isoDateTime,
});
export type Folder = z.infer<typeof folder>;
