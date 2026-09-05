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
 * مبلغ به **ریالِ صحیح** — [PLAN §۵٫۱](../../../../PLAN.md) (`type Rial = number`)،
 * [ADR-015](../../../../ARCHITECTURE_DECISIONS.md#adr-015)،
 * [ADR-054](../../../../ARCHITECTURE_DECISIONS.md#adr-054).
 *
 * ★★ **چرا این primitive وجود دارد:** تا `.int()` **یک‌بار** نوشته شود. یک `z.number()`ِ خام
 * مقدارِ `1234.5` ریال را بی‌صدا می‌پذیرد — همه‌ی تست‌ها سبز می‌مانند، OpenAPI `type: number`
 * نشان می‌دهد، و floatِ پول تا خودِ دیتابیس می‌رود. نقضِ P5 بدونِ هیچ علامتِ قرمزی.
 *
 * ⚠️ **روی سیم `number` است، نه رشته و نه `bigint`.** در DB `BIGINT` است و کوئرسِ
 * `int8→number` (تنها در `apps/api/src/plugins/db.ts`) روی خروج از محدوده‌ی امن **خطا**
 * می‌دهد نه گِردکردنِ خاموش — همان تضمینی که رشته قرار بود بدهد. و `z.bigint()` در DTO
 * تله است: zod قبولش می‌کند و بعد `JSON.stringify` داخلِ serializerِ Fastify می‌ترکد،
 * یعنی خطا در **زمانِ پاسخ** و به شکلِ ۵۰۰ی بی‌کد.
 */
export const rial = z.number().int().nonnegative();
export type Rial = z.infer<typeof rial>;

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
