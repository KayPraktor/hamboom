import type { AuditRow } from "../dto.ts";
import type { Executor } from "../plugins/db.ts";

/**
 * خواندنِ `audit_logs` برای پنل — M6 فاز ۴٫۳ ([ADR-067](../../../../ARCHITECTURE_DECISIONS.md#adr-067)).
 *
 * ★ **صفحه‌بندیِ keyset، نه offset:** ترتیب `(created_at DESC, id DESC)` روی ایندکسِ `0008`؛ cursor =
 * `base64url("<created_at::text>|<id>")`ِ آخرین ردیفِ صفحه. ⚠️ **متنِ خودِ Postgres، نه `Date.toISOString()`** (اصلاحِ
 * فاز ۶، یافته‌ی منتقد): ستون میکروثانیه دارد و `Date` میلی‌ثانیه؛ cursorِ بریده‌شده به ms ردیفی را که در همان
 * میلی‌ثانیه نوشته شده (دو audit در یک تراکنش) بینِ دو صفحه **گم می‌کرد** — «بدونِ هم‌پوشانی» سبز بود و گپ را نمی‌دید. offset با ۱۰۰ هزار ردیف کُند می‌شود و با
 * درجِ هم‌زمان ردیف جا می‌اندازد/تکرار می‌کند؛ keyset هیچ‌کدام را ندارد. `limit+1` می‌خوانیم تا
 * «صفحه‌ی بعد هست؟» بدونِ `count(*)` معلوم شود.
 *
 * ★ **`ip` ماسک‌شده بیرون می‌رود** (ADR-067 §۳): v4 دو اکتتِ آخر، v6 همه جز دو گروهِ اول. خامش در
 * جدول می‌مانَد (forensics با دسترسیِ DB)، ولی هیچ DTO/لاگی آن را کامل نمی‌بیند.
 *
 * فیلترها همه اختیاری و AND؛ `action` تطبیقِ **پیشوندی** است (`user.` همه‌ی عمل‌های کاربر) چون
 * واژگان dotted و سلسله‌مراتبی است.
 */

export interface AuditListFilter {
  actorUserId?: string;
  /** پیشوندِ عمل (`staff.`، `user.suspend`) — تطبیقِ `LIKE prefix%`. */
  action?: string;
  targetType?: string;
  targetId?: string;
  /** ISO — بازه‌ی `created_at` (شامل). */
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}

export type { AuditRow };

export interface AuditPage {
  rows: AuditRow[];
  nextCursor: string | null;
}

export function encodeCursor(createdAtText: string, id: number): string {
  return Buffer.from(`${createdAtText}|${String(id)}`, "utf8").toString("base64url");
}

/** `null` = cursorِ خراب — مصرف‌کننده ۴۰۰ می‌دهد، نه اینکه از اول شروع کند (سکوت = صفحه‌ی تکراری). */
export function decodeCursor(cursor: string): { createdAt: string; id: number } | null {
  let text: string;
  try {
    text = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const sep = text.lastIndexOf("|");
  if (sep <= 0) return null;
  const createdAt = text.slice(0, sep);
  const id = Number(text.slice(sep + 1));
  // ★ متن به `::timestamptz` داده می‌شود؛ این‌جا فقط شکلِ کلی سنجیده می‌شود تا cursorِ خراب ۴۰۰ بگیرد نه ۵۰۰.
  if (Number.isNaN(Date.parse(createdAt)) || !Number.isSafeInteger(id) || id < 0) return null;
  return { createdAt, id };
}

/** v4 ⇒ `a.b.x.x` · v6 ⇒ `aaaa:bbbb::…` · هر چیزِ دیگر ⇒ `null` (چیزی لو نمی‌رود). */
export function maskIp(ip: string | null): string | null {
  if (ip === null) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (v4 !== null) return `${v4[1]!}.${v4[2]!}.x.x`;
  if (ip.includes(":")) {
    const groups = ip.split(":");
    return `${groups[0] ?? ""}:${groups[1] ?? ""}::…`;
  }
  return null;
}

/** SQL + پارامترها — خالص، تا شکلِ کوئری بدونِ دیتابیس آزموده شود. */
export function buildAuditQuery(filter: AuditListFilter): { text: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown): void => {
    params.push(value);
    where.push(clause.replace("?", `$${String(params.length)}`));
  };
  if (filter.actorUserId !== undefined) add("actor_user_id = ?", filter.actorUserId);
  if (filter.action !== undefined) add("action LIKE ?", `${escapeLike(filter.action)}%`);
  if (filter.targetType !== undefined) add("target_type = ?", filter.targetType);
  if (filter.targetId !== undefined) add("target_id = ?", filter.targetId);
  if (filter.from !== undefined) add("created_at >= ?", filter.from);
  if (filter.to !== undefined) add("created_at <= ?", filter.to);
  if (filter.cursor !== undefined) {
    const c = decodeCursor(filter.cursor);
    if (c === null) throw new InvalidCursorError();
    params.push(c.createdAt, c.id);
    where.push(
      `(created_at, id) < ($${String(params.length - 1)}::timestamptz, $${String(params.length)})`,
    );
  }
  params.push(filter.limit + 1);
  const text =
    `SELECT id, actor_user_id, team_id, action, target_type, target_id, host(ip) AS ip, user_agent, metadata,
            created_at, created_at::text AS created_at_cursor
       FROM audit_logs` +
    (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY created_at DESC, id DESC LIMIT $${String(params.length)}`;
  return { text, params };
}

export class InvalidCursorError extends Error {
  constructor() {
    super("cursor نامعتبر است.");
    this.name = "InvalidCursorError";
  }
}

/** فرارِ متاکاراکترهای LIKE — مشترک با جست‌وجوی پنل (`admin-users.ts`). */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export async function listAuditLogs(db: Executor, filter: AuditListFilter): Promise<AuditPage> {
  const { text, params } = buildAuditQuery(filter);
  const { rows } = await db.query<AuditRow>(text, params);
  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > filter.limit && last !== undefined
      ? encodeCursor(last.created_at_cursor, last.id)
      : null;
  return { rows: page, nextCursor };
}
