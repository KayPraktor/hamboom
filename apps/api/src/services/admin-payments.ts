import { escapeLike } from "./audit-log.ts";
import {
  INVOICE_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  type InvoiceRow,
  type SubscriptionRow,
} from "../dto.ts";
import type { Executor } from "../plugins/db.ts";

/**
 * خواندنِ پرداخت‌ها برای پنل — M6 فاز ۶٫۱ ([ADR-068](../../../../ARCHITECTURE_DECISIONS.md#adr-068)).
 *
 * ★ **فقط خواندن، با کوئری‌های خودش** — همان قاعده‌ی [`admin-users.ts`](./admin-users.ts): مسیرهای
 * کاربر (`GET /teams/:id/billing/*`) «چه چیزی برای **این** owner دیده می‌شود» هستند؛ این‌جا «staff درباره‌ی
 * **آن** پرداخت چه می‌بیند». هر جهش (verify، expire، refund، sweep) در `services/billing.ts`/`reconcile.ts`
 * است، نه این فایل — یک مسیرِ فعال‌سازی، یک مسیرِ استرداد.
 *
 * ★ **صفحه‌بندیِ keyset** روی `(requested_at DESC, id DESC)` — همان الگوی `audit-log.ts`؛ cursor =
 * `base64url("<requested_at::text>|<id>")`. ⚠️ **متنِ خودِ Postgres، نه `Date.toISOString()`:** ستون
 * میکروثانیه دارد و `Date` میلی‌ثانیه؛ cursorِ بریده‌شده به ms ردیفی را که در همان میلی‌ثانیه (دو checkoutِ
 * هم‌زمان روی دو نود، seedِ یک‌دستوری) نوشته شده **بینِ دو صفحه گم می‌کند** (یافته‌ی منتقدِ فاز ۶؛ `audit-log.ts`
 * همان اصلاح را گرفت). با فیلترِ تیم روی `payments_team_idx` (۰۰۰۸) می‌نشیند؛ بی‌فیلتر روی
 * `payments_requested_idx` (۰۰۰۹)؛ `ref_id` روی `payments_ref_idx`؛ `authority` روی `payments_authority_uq`.
 *
 * ★ `expireBlockedReason` خالص است و **تنها** جایی است که قاعده‌ی «انقضای دستی فقط پله‌ی ۳ی ADR-056» نوشته
 * شده — **همان پله، نه شل‌تر:** کهنه‌تر از سقفِ انقضا (`expireAfterMs`، ۷۲ ساعت) **و** دستِ‌کم یک پاسخِ درگاه
 * (`failure_code IS NOT NULL`)؛ یتیم هرگز. نگارشِ اول آستانه‌ی کهنگی (۲۰ دقیقه) را کافی می‌دانست و منتقد گرفت:
 * کاربری که روی صفحه‌ی بانک کُند است در دقیقه‌ی ۲۱ باطل می‌شد و در دقیقه‌ی ۲۴ پول می‌داد — ردیفِ `canceled` از
 * ایندکسِ sweep بیرون است و پول برای همیشه پیشِ درگاه می‌مانْد. دکمه‌ی پنل با همین دلیل غیرفعال می‌شود و مسیرِ
 * `expire` هم با همین رد می‌کند — و تازه بعدش یک verifyِ **تازه** زیرِ همان قفل می‌زند (§۶٫۳): فقط پاسخِ
 * «پرداخت نشد»ِ همین لحظه باطل می‌کند؛ «پرداخت شد» فعال می‌کند، نه باطل.
 *
 * ⚠️ `request_payload`/`callback_payload`/`verify_payload` بدونِ PII‌اند (نیّتِ خرید؛ `{Authority, Status}`؛
 * verdictِ نرمال‌شده بدونِ کارت) — ولی ستونِ `card_pan_masked` فقط در **جزئیات** می‌آید، نه فهرست.
 */

export type PaymentStatusValue =
  | "pending"
  | "paid"
  | "failed"
  | "canceled"
  | "refunded"
  | "verify_failed";

export interface AdminPaymentRow {
  id: string;
  team_id: string;
  team_name: string;
  initiated_by: string;
  invoice_id: string | null;
  invoice_number: string | null;
  gateway: string;
  gateway_mode: string;
  amount_rial: number;
  status: string;
  authority: string | null;
  ref_id: string | null;
  failure_code: string | null;
  requested_at: Date;
  /** `requested_at::text` — دقتِ میکروثانیه برای cursor (Date فقط ms دارد). */
  requested_at_cursor: string;
  paid_at: Date | null;
  verified_at: Date | null;
  // ── ۰۰۰۹ (ADR-068) ──
  refunded_at: Date | null;
  refund_ref: string | null;
  refund_amount_rial: number | null;
}

export interface AdminPaymentDetailRow extends AdminPaymentRow {
  card_pan_masked: string | null;
  fee_rial: number | null;
  request_payload: unknown;
  callback_payload: unknown;
  verify_payload: unknown;
}

/** ستون‌های فهرست — با alias برای join؛ `p.` تا با `invoices`/`teams` تصادم نکند. */
const LIST_COLUMNS =
  "p.id, p.team_id, t.name AS team_name, p.initiated_by, p.invoice_id, i.number AS invoice_number, " +
  "p.gateway, p.gateway_mode, p.amount_rial, p.status, p.authority, p.ref_id, p.failure_code, " +
  "p.requested_at, p.requested_at::text AS requested_at_cursor, p.paid_at, p.verified_at, " +
  "p.refunded_at, p.refund_ref, p.refund_amount_rial";

const DETAIL_COLUMNS =
  `${LIST_COLUMNS}, p.card_pan_masked, p.fee_rial, p.request_payload, p.callback_payload, p.verify_payload`;

const FROM = "FROM payments p JOIN teams t ON t.id = p.team_id LEFT JOIN invoices i ON i.id = p.invoice_id";

export interface AdminPaymentFilter {
  teamId?: string;
  /** تطبیقِ **دقیق** — شماره‌ی پیگیریِ بانک همان‌طور که کاربر از رسیدش می‌خوانَد. */
  refId?: string;
  /** تطبیقِ **پیشوندی** (case-sensitive): authority ۳۶ کاراکتر است و اپراتور معمولاً چند حرفِ اول را دارد. */
  authority?: string;
  status?: PaymentStatusValue;
  limit: number;
  cursor?: string;
}

export function encodePaymentCursor(requestedAtText: string, id: string): string {
  return Buffer.from(`${requestedAtText}|${id}`, "utf8").toString("base64url");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `null` = cursorِ خراب ⇒ ۴۰۰ (همان قاعده‌ی audit: سکوت یعنی صفحه‌ی تکراری). */
export function decodePaymentCursor(cursor: string): { requestedAt: string; id: string } | null {
  let text: string;
  try {
    text = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const sep = text.lastIndexOf("|");
  if (sep <= 0) return null;
  const requestedAt = text.slice(0, sep);
  const id = text.slice(sep + 1);
  // ★ متن به `::timestamptz` داده می‌شود؛ این‌جا فقط شکلِ کلی سنجیده می‌شود تا cursorِ خراب ۴۰۰ بگیرد نه ۵۰۰.
  if (Number.isNaN(Date.parse(requestedAt)) || !UUID_RE.test(id)) return null;
  return { requestedAt, id };
}

export class InvalidPaymentCursorError extends Error {
  constructor() {
    super("cursor نامعتبر است.");
    this.name = "InvalidPaymentCursorError";
  }
}

/** SQL + پارامترها — خالص، تا شکلِ کوئری بدونِ دیتابیس آزموده شود. `limit+1` برای «صفحه‌ی بعد هست؟». */
export function buildPaymentQuery(filter: AdminPaymentFilter): { text: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown): void => {
    params.push(value);
    where.push(clause.replace("?", `$${String(params.length)}`));
  };
  if (filter.teamId !== undefined) add("p.team_id = ?", filter.teamId);
  if (filter.refId !== undefined) add("p.ref_id = ?", filter.refId);
  if (filter.authority !== undefined) add("p.authority LIKE ?", `${escapeLike(filter.authority)}%`);
  if (filter.status !== undefined) add("p.status = ?", filter.status);
  if (filter.cursor !== undefined) {
    const c = decodePaymentCursor(filter.cursor);
    if (c === null) throw new InvalidPaymentCursorError();
    params.push(c.requestedAt, c.id);
    where.push(
      `(p.requested_at, p.id) < ($${String(params.length - 1)}::timestamptz, $${String(params.length)}::uuid)`,
    );
  }
  params.push(filter.limit + 1);
  const text =
    `SELECT ${LIST_COLUMNS} ${FROM}` +
    (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY p.requested_at DESC, p.id DESC LIMIT $${String(params.length)}`;
  return { text, params };
}

export interface AdminPaymentPage {
  rows: AdminPaymentRow[];
  nextCursor: string | null;
}

export async function listPayments(
  db: Executor,
  filter: AdminPaymentFilter,
): Promise<AdminPaymentPage> {
  const q = buildPaymentQuery(filter);
  const { rows } = await db.query<AdminPaymentRow>(q.text, q.params);
  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > filter.limit && last !== undefined
      ? encodePaymentCursor(last.requested_at_cursor, last.id)
      : null;
  return { rows: page, nextCursor };
}

export interface AdminPaymentDetailRows {
  payment: AdminPaymentDetailRow;
  invoice: InvoiceRow | null;
  /** اشتراکی که `activated_by_payment_id` به همین پرداخت اشاره می‌کند — هدفِ استردادِ ADR-068؛ `null` اگر هیچ. */
  subscription: SubscriptionRow | null;
}

export async function readPaymentDetail(
  db: Executor,
  paymentId: string,
): Promise<AdminPaymentDetailRows | null> {
  const { rows } = await db.query<AdminPaymentDetailRow>(
    `SELECT ${DETAIL_COLUMNS} ${FROM} WHERE p.id = $1`,
    [paymentId],
  );
  const payment = rows[0];
  if (payment === undefined) return null;
  const [invoice, subscription] = await Promise.all([
    payment.invoice_id === null
      ? Promise.resolve(null)
      : db
          .query<InvoiceRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1`, [
            payment.invoice_id,
          ])
          .then((r) => r.rows[0] ?? null),
    db
      .query<SubscriptionRow>(
        `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE activated_by_payment_id = $1`,
        [paymentId],
      )
      .then((r) => r.rows[0] ?? null),
  ]);
  return { payment, invoice, subscription };
}

// ── انقضای دستی: فقط پله‌ی ۳ی ADR-056 ──────────────────────────────────────

export interface ExpirePolicy {
  /** همان `BILLING_PENDING_EXPIRE_HOURS` — سقفِ پله‌ی ۳ی ADR-056؛ زیرِ آن، کاربر هنوز می‌تواند پرداخت را کامل کند. */
  expireAfterMs: number;
}

export interface ExpireCandidate {
  status: string;
  authority: string | null;
  failure_code: string | null;
  requested_at: Date;
}

/**
 * چرا این ردیف را نمی‌شود دستی باطل کرد — یا `null` اگر می‌شود.
 *
 * ★★ نردبانِ ADR-056، همان ترتیب و **همان سقف**: فقط `pending` · یتیم (بدونِ authority) **هرگز** (ممکن است
 * پولش گرفته شده باشد و چیزی برای پرسیدن نداریم — راهش فرزندخواندگی است، نه انقضا) · بدونِ حتی یک پاسخِ
 * درگاه هرگز (`failure_code IS NULL` یعنی هنوز نپرسیده‌ایم) · جوان‌تر از سقفِ انقضا (۷۲ ساعت) هرگز — نه
 * آستانه‌ی ۲۰ دقیقه‌ی کهنگی: staff این‌جا **همان** قاعده‌ی sweep را دستی اجرا می‌کند (وقتی sweep خاموش است)،
 * نه قاعده‌ای شل‌تر. و خودِ مسیر پیش از باطل‌کردن یک verifyِ تازه زیرِ قفل می‌زند.
 */
export function expireBlockedReason(
  row: ExpireCandidate,
  policy: ExpirePolicy,
  now: Date,
): string | null {
  if (row.status !== "pending") return `ردیف در وضعیتِ «${row.status}» است؛ فقط pending باطل می‌شود.`;
  if (row.authority === null) {
    return "ردیفِ یتیم (بدونِ authority) باطل نمی‌شود — شاید پولش گرفته شده؛ راهش فرزندخواندگی است.";
  }
  if (row.failure_code === null) {
    return "درگاه هنوز یک‌بار هم پاسخ نداده (ADR-056) — اول verify کن.";
  }
  const ageMs = now.getTime() - row.requested_at.getTime();
  if (ageMs < policy.expireAfterMs) {
    const hours = Math.ceil((policy.expireAfterMs - ageMs) / 3_600_000);
    return `جوان‌تر از سقفِ انقضا است — کاربر هنوز می‌تواند پرداخت را کامل کند؛ ${String(hours)} ساعتِ دیگر.`;
  }
  return null;
}
