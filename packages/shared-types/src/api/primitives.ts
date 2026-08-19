import { z } from "zod";

/** زمانِ UTC به‌صورت ISO-8601 (همیشه با `Z`) — [PLAN §۵٫۱](../../../../PLAN.md). */
export const isoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof isoDateTime>;

/** شناسه‌ی UUID (اپ تولیدش می‌کند — UUIDv7 برای ترتیبِ زمانی). */
export const uuid = z.uuid();
export type Uuid = z.infer<typeof uuid>;

/** زبانِ کاربر. */
export const locale = z.enum(["fa", "en"]);
export type Locale = z.infer<typeof locale>;

/**
 * پرس‌وجوی صفحه‌بندیِ cursor — `?limit=&cursor=` ([PLAN §۵](../../../../PLAN.md)).
 * `limit` از رشته‌ی query کوئرس می‌شود؛ سقفِ ۱۰۰ تا صفحه‌ی غول‌آسا درخواست نشود.
 */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;

/** یک صفحه از نتایج — `{ items, nextCursor }`؛ `nextCursor === null` یعنی پایان. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
