import { randomUUID } from "node:crypto";

import {
  assertGatewayAmount,
  computeCharge,
  computePeriod,
  formatInvoiceNumber,
  jalaliYearOf,
  type CouponEffect,
  type PaymentGateway,
} from "@hamboom/billing-core";
import type { BillingPeriod } from "@hamboom/shared-types";
import type pg from "pg";

import { toPlan, type PlanRow } from "../dto.ts";
import { HttpError } from "../errors.ts";
import { withTransaction, type Executor } from "../plugins/db.ts";

/**
 * تسویه‌ی پرداخت — **قلبِ M4** ([ADR-014](../../../../ARCHITECTURE_DECISIONS.md#adr-014)،
 * [ADR-050](../../../../ARCHITECTURE_DECISIONS.md#adr-050)،
 * [ADR-055](../../../../ARCHITECTURE_DECISIONS.md#adr-055)).
 *
 * ★★ **تنها مسیرِ فعال‌سازیِ اشتراک.** هم callbackِ مرورگر و هم verifyِ دستی همین را صدا
 * می‌زنند — دو کپی یعنی دو تعریفِ متفاوت از «یک‌بار».
 */

/** وضعیت‌هایی که «اشتراکِ زنده» شمرده می‌شوند — همان مجموعه‌ی `subscriptions_active_uq`. */
export const LIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due"] as const;

export type SettleOutcome =
  | { kind: "activated"; subscriptionId: string; invoiceId: string; refId: string }
  | { kind: "alreadySettled"; subscriptionId: string | null; invoiceId: string | null }
  | { kind: "notPaid"; code: number | null; message: string }
  | { kind: "unknown"; message: string };

/**
 * پارامترهای خریدی که در `payments.request_payload` منجمد می‌شوند.
 *
 * ★★ **چرا این‌جا و نه از `invoices.line_items`:** نگارشِ اول پلن/دوره/صندلی را با
 * `line_items->0->>'…'` از JSONِ فاکتور بیرون می‌کشید. اگر آن آرایه روزی ترتیبش عوض شود یا
 * سطرِ دیگری اولش بنشیند، **همه‌ی فیلدها `NULL` می‌شوند** — و بدترینش این است که
 * `period === "yearly"` روی `NULL` به شاخه‌ی ماهانه می‌افتد: مشتری‌ای که پولِ **یک سال**
 * داده یک **ماه** می‌گیرد. و این خرابی **بعد از** گرفتنِ پول رخ می‌دهد.
 */
interface PurchaseIntent {
  planCode: string;
  period: BillingPeriod;
  seats: number;
  unitPriceRial: number;
  couponCode: string | null;
}

interface PaymentRow {
  id: string;
  team_id: string;
  initiated_by: string;
  invoice_id: string | null;
  amount_rial: number;
  status: string;
  authority: string | null;
  request_payload: unknown;
}

export interface SettleDeps {
  pool: pg.Pool;
  gateway: PaymentGateway;
}

export type PaymentLocator = { by: "id"; id: string } | { by: "authority"; authority: string };

/** پارامترهای خرید را از ردیفِ پرداخت می‌خواند و **سخت‌گیرانه** اعتبارسنجی می‌کند. */
function readIntent(raw: unknown): PurchaseIntent {
  const o = raw as Partial<PurchaseIntent> | null;
  const period = o?.period;
  const okPeriod = period === "monthly" || period === "yearly";
  if (
    o === null ||
    o === undefined ||
    typeof o.planCode !== "string" ||
    o.planCode.length === 0 ||
    !okPeriod ||
    !Number.isSafeInteger(o.seats) ||
    (o.seats ?? 0) < 1 ||
    !Number.isSafeInteger(o.unitPriceRial)
  ) {
    // ★ بلند می‌شکند و تراکنش rollback می‌شود ⇒ ردیف `pending` می‌مانَد و sweep دوباره سراغش
    //   می‌آید. سکوت اینجا یعنی اشتراکِ اشتباه به مشتریِ پرداخت‌کرده.
    throw new HttpError(500, "INTERNAL", "پارامترهای خریدِ این پرداخت خوانا نیست.");
  }
  return {
    planCode: o.planCode,
    period,
    seats: o.seats as number,
    unitPriceRial: o.unitPriceRial as number,
    couponCode: typeof o.couponCode === "string" ? o.couponCode : null,
  };
}

/**
 * ★★ **مرجعِ یگانگی وضعیتِ ردیفِ خودمان است زیرِ `FOR UPDATE`، نه کدِ درگاه** (ADR-055).
 *
 * {۱۰۰، ۱۰۱} هر دو یعنی «پول گرفته شده»؛ فعال‌سازی وقتی رخ می‌دهد که ردیفِ ما از `pending`
 * خارج شود — که قفل تضمین می‌کند فقط یک‌بار ممکن است.
 */
export async function settlePayment(
  deps: SettleDeps,
  locator: PaymentLocator,
): Promise<SettleOutcome> {
  return withTransaction(deps.pool, async (tx) => {
    // ⚠️ `payments_authority_uq` روی **جفتِ** `(gateway, authority)` است. بدونِ فیلترِ
    //    gateway، ردیفِ mock و zarinpal با authorityِ یکسان قابلِ اشتباه‌گرفتن‌اند و کوئری
    //    هم نمی‌تواند از آن ایندکس استفاده کند (seq scan روی مسیرِ عمومیِ callback).
    const { rows } = await tx.query<PaymentRow>(
      locator.by === "id"
        ? `SELECT id, team_id, initiated_by, invoice_id, amount_rial, status, authority, request_payload
             FROM payments WHERE id = $1 FOR UPDATE`
        : `SELECT id, team_id, initiated_by, invoice_id, amount_rial, status, authority, request_payload
             FROM payments WHERE gateway = $2 AND authority = $1 LIMIT 1 FOR UPDATE`,
      locator.by === "id" ? [locator.id] : [locator.authority, deps.gateway.name],
    );
    const payment = rows[0];
    if (payment === undefined) {
      throw new HttpError(404, "PAYMENT_NOT_FOUND", "پرداخت یافت نشد.");
    }

    // ★★ خروجِ زودهنگام روی **هر** وضعیتِ غیر-`pending`، نه فقط `paid`.
    //    ⚠️ نگارشِ اول فقط `paid` را می‌گرفت: ردیفِ `refunded` یا `canceled` دوباره verify
    //    می‌شد، درگاه ۱۰۱ می‌داد، و یک اشتراکِ **دوم** برای پرداختی که پولش برگشته ساخته
    //    می‌شد — و `subscriptions_active_uq` هم نمی‌گرفتش، چون خودمان قبلش ردیفِ زنده را
    //    expire می‌کنیم.
    if (payment.status !== "pending") {
      const sub = await tx.query<{ id: string }>(
        "SELECT id FROM subscriptions WHERE activated_by_payment_id = $1",
        [payment.id],
      );
      return {
        kind: "alreadySettled",
        subscriptionId: sub.rows[0]?.id ?? null,
        invoiceId: payment.invoice_id,
      };
    }

    if (payment.authority === null) {
      return { kind: "unknown", message: "این پرداخت هنوز به درگاه نرسیده است." };
    }

    const verdict = await deps.gateway.verifyPayment({
      authority: payment.authority,
      amountRial: payment.amount_rial,
    });

    if (verdict.status === "gatewayError") {
      return { kind: "unknown", message: verdict.message };
    }

    if (verdict.status === "notPaid") {
      // ★★ **«هنوز پرداخت نشده» پایانِ کار نیست.** کدِ `-51`ِ زرین‌پال دقیقاً وقتی می‌آید که
      //    کاربر هنوز روی صفحه‌ی بانک است. نگارشِ اول ردیف را `failed` می‌کرد و چون ایندکسِ
      //    sweep روی `status='pending'` است، آن پرداخت **برای همیشه نامرئی** می‌شد — پول
      //    گرفته می‌شد و هیچ‌کس دیگر سراغش نمی‌رفت. پس وضعیت `pending` می‌مانَد و فقط آخرین
      //    کدِ شکست ثبت می‌شود؛ کهنه‌بودن را **سنِ ردیف** در sweepِ فاز ۷ تعیین می‌کند.
      await tx.query("UPDATE payments SET failure_code = $2, verified_at = now() WHERE id = $1", [
        payment.id,
        verdict.code === null ? null : String(verdict.code),
      ]);
      return { kind: "notPaid", code: verdict.code, message: verdict.message };
    }

    const activated = await activateFromPayment(tx, payment);
    await tx.query(
      `UPDATE payments SET status = 'paid', ref_id = $2, card_pan_masked = $3, card_hash = $4,
              fee_rial = $5, paid_at = now(), verified_at = now(), failure_code = NULL
         WHERE id = $1`,
      [payment.id, verdict.refId, verdict.cardPanMasked, verdict.cardHash, verdict.feeRial],
    );
    return {
      kind: "activated",
      subscriptionId: activated.subscriptionId,
      invoiceId: activated.invoiceId,
      refId: verdict.refId,
    };
  });
}

/** فاکتور را `paid` می‌کند، کوپن را **حالا** مصرف می‌کند، و اشتراک را می‌سازد/تمدید. */
async function activateFromPayment(
  tx: Executor,
  payment: PaymentRow,
): Promise<{ subscriptionId: string; invoiceId: string }> {
  const invoiceId = payment.invoice_id;
  if (invoiceId === null) {
    throw new HttpError(500, "INTERNAL", "پرداختِ بدونِ فاکتور قابلِ تسویه نیست.");
  }
  const intent = readIntent(payment.request_payload);

  await tx.query("UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1", [invoiceId]);

  // ★★ **کوپن این‌جا مصرف می‌شود، نه سرِ checkout.** نگارشِ اول ردیفِ مصرف را در همان
  //    تراکنشِ checkout درج می‌کرد که **چه پول بیاید چه نیاید** commit می‌شد؛ پس یک اختلالِ
  //    درگاه کوپن را برای همیشه می‌سوزاند و کاربر دیگر نمی‌توانست همان خرید را کامل کند.
  if (intent.couponCode !== null) {
    await tx.query(
      `INSERT INTO coupon_redemptions (coupon_code, team_id, invoice_id) VALUES ($1, $2, $3)
       ON CONFLICT (coupon_code, team_id) DO NOTHING`,
      [intent.couponCode, payment.team_id, invoiceId],
    );
    await tx.query("UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE code = $1", [
      intent.couponCode,
    ]);
  }

  const subscriptionId = await upsertSubscription(tx, payment.team_id, payment.id, intent);
  return { subscriptionId, invoiceId };
}

/**
 * اشتراک را می‌سازد — و اگر تمدیدِ **همان پلن** باشد، از پایانِ دوره‌ی فعلی ادامه می‌دهد.
 *
 * ⚠️ نگارشِ اول همیشه از `now()` شروع می‌کرد و ردیفِ قبلی را expire می‌کرد: مشتری‌ای که
 * روزِ ۲۰ از یک دوره‌ی ۳۰روزه تمدید می‌کرد، **۱۰ روزِ پرداخت‌شده را از دست می‌داد**.
 */
async function upsertSubscription(
  tx: Executor,
  teamId: string,
  paymentId: string,
  intent: PurchaseIntent,
): Promise<string> {
  const existing = await tx.query<{ id: string; plan_code: string; current_period_end: Date }>(
    `SELECT id, plan_code, current_period_end FROM subscriptions
      WHERE team_id = $1 AND status = ANY($2::text[]) FOR UPDATE`,
    [teamId, [...LIVE_SUBSCRIPTION_STATUSES]],
  );
  const live = existing.rows[0];
  const now = new Date();

  // تمدیدِ همان پلن ⇒ لنگر = دیرترِ «اکنون» و «پایانِ دوره‌ی فعلی».
  const samePlan = live !== undefined && live.plan_code === intent.planCode;
  const anchor =
    samePlan && live.current_period_end.getTime() > now.getTime() ? live.current_period_end : now;
  const period = computePeriod(anchor, intent.period);

  if (live !== undefined) {
    await tx.query("UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE id = $1", [
      live.id,
    ]);
  }

  const subscriptionId = randomUUID();
  await tx.query(
    `INSERT INTO subscriptions (id, team_id, plan_code, status, period, seats,
                                current_period_start, current_period_end,
                                activated_by_payment_id, unit_price_rial)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9)`,
    [
      subscriptionId,
      teamId,
      intent.planCode,
      intent.period,
      intent.seats,
      period.start,
      period.end,
      paymentId,
      intent.unitPriceRial,
    ],
  );
  return subscriptionId;
}

// ── ساختِ فاکتور و پرداخت (checkout) ─────────────────────────────────────

export interface CheckoutInput {
  teamId: string;
  userId: string;
  planCode: string;
  period: BillingPeriod;
  seats: number;
  couponCode?: string;
  vatPercent: number;
  gatewayName: string;
  gatewayMode: string;
}

export interface CheckoutDraft {
  paymentId: string;
  invoiceId: string;
  amountRial: number;
  invoiceNumber: string;
  /** ★ `true` یعنی این کلیدِ idempotency از قبل وجود داشت و همان پیش‌نویس برگشت. */
  replayed: boolean;
}

/**
 * فاکتور + ردیفِ `pending`ِ پرداخت را **در یک تراکنش** می‌سازد.
 *
 * ★★ مبلغ کاملاً سمتِ سرور محاسبه می‌شود (ADR-014). بدنه‌ی درخواست فیلدِ ریالی ندارد.
 */
/**
 * ★★ همان `createCheckout`، ولی **امن در برابرِ دو نودِ هم‌زمان** — M5 گام ۶٫۳.
 *
 * ── مسئله‌ای که با اندازه‌گیری پیدا شد ────────────────────────────────────
 *
 * `createCheckout` اول `SELECT` می‌زند و بعد `INSERT`. برای یک retryِ **پشتِ سرِ هم**
 * (double-click، تلاشِ دوباره بعد از timeout) کافی است: SELECT ردیفِ قبلی را می‌بیند و
 * همان پیش‌نویس برمی‌گردد. ولی میان‌افزارِ `idempotency.ts` **حافظه‌ای و تک‌نودی** است، پس
 * با دو نود دو درخواستِ **هم‌زمان** هر دو SELECT را خالی می‌بینند.
 *
 * ⚠️ سنجه‌ی `billing:settle` با یک هم‌پوشانیِ **اجباری** (`pg_sleep` بینِ SELECT و INSERT
 * روی دو استخرِ جدا) اندازه گرفت: ردیف **یکی** می‌مانَد — یکتاییِ `payments_idem_uq` کار
 * می‌کند — ولی بازنده **`23505`** می‌گیرد، که به کاربر ۵۰۰ نشان می‌دهد.
 *
 * ★ یعنی داده هرگز خراب نمی‌شود؛ فقط یکی از دو کاربرِ **هم‌زمان** خطای بی‌ربط می‌بیند.
 *
 * ── چرا retry بیرونِ تراکنش است، نه داخلِ `createCheckout` ────────────────
 *
 * ⚠️ بعد از `23505` **کلِ تراکنش abort شده**؛ هر کوئریِ بعدی روی همان `tx` با
 * «current transaction is aborted» می‌شکند. پس نمی‌شود داخلِ همان تراکنش دوباره خواند —
 * باید rollback شود و تراکنشِ **تازه‌ای** باز شود، که SELECTش حالا ردیفِ commit‌شده‌ی نودِ
 * برنده را می‌بیند و `replayed: true` برمی‌گردانَد.
 *
 * ⊕ **یک بار** retry می‌شود و نه بیشتر: تنها چیزی که این خطا را می‌سازد، یک برنده‌ی
 * commit‌شده است — و آن ردیف دیگر جایی نمی‌رود. حلقه‌ی نامحدود فقط یک خطای دیگر را
 * می‌پوشانَد.
 */
export async function createCheckoutIdempotent(
  pool: pg.Pool,
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<CheckoutDraft> {
  try {
    return await withTransaction(pool, async (tx) => createCheckout(tx, input, idempotencyKey));
  } catch (error) {
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    return withTransaction(pool, async (tx) => createCheckout(tx, input, idempotencyKey));
  }
}

/** کدِ خطای نقضِ یکتاییِ Postgres. */
const UNIQUE_VIOLATION = "23505";

export async function createCheckout(
  tx: Executor,
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<CheckoutDraft> {
  // ★★ **retryِ مشروع نباید برای همیشه ۵۰۰ بدهد.** `payments_idem_uq` یکتاست و نگارشِ اول
  //    فقط INSERT می‌زد: اگر تماسِ اول با درگاه می‌شکست (۵۰۲، که کش هم نمی‌شود)، کلاینت با
  //    همان کلید دوباره می‌آمد، ۲۳۵۰۵ می‌خورد و **همیشه** ۵۰۰ می‌گرفت.
  const prior = await tx.query<{
    id: string;
    invoice_id: string | null;
    amount_rial: number;
    number: string | null;
  }>(
    `SELECT p.id, p.invoice_id, p.amount_rial, i.number
       FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.idempotency_key = $1`,
    [idempotencyKey],
  );
  const existing = prior.rows[0];
  if (existing !== undefined) {
    return {
      paymentId: existing.id,
      invoiceId: existing.invoice_id ?? "",
      amountRial: existing.amount_rial,
      invoiceNumber: existing.number ?? "",
      replayed: true,
    };
  }

  const planRows = await tx.query<PlanRow>("SELECT * FROM plans WHERE code = $1", [input.planCode]);
  const planRow = planRows.rows[0];
  if (planRow === undefined) throw new HttpError(404, "PLAN_NOT_FOUND", "پلن یافت نشد.");
  const plan = toPlan(planRow);
  if (!plan.isActive) {
    throw new HttpError(409, "PLAN_INACTIVE", "این پلن در حالِ حاضر قابلِ خرید نیست.");
  }

  const coupon = await resolveCoupon(tx, input.teamId, input.couponCode, input.planCode);
  const charge = computeCharge({
    plan,
    period: input.period,
    seats: input.seats,
    coupon,
    vatPercent: input.vatPercent,
  });

  // ★ نگهبانِ مبلغ **قبل از** نوشتنِ هر ردیفی. نگارشِ اول این را فقط داخلِ درگاه داشت،
  //   یعنی بعد از commit — و آن‌وقت یک فاکتورِ یتیم و یک شماره‌ی سوخته می‌ماند.
  // ⚠️ مبلغِ صفر (پلنِ رایگان یا کوپنِ ۱۰۰٪) اصلاً به درگاه نمی‌رود؛ پیش از این یک ۵۰۰ی
  //    خاموش می‌داد چون `payments_amount_ck` کفِ ۱۰۰۰ ریال دارد.
  if (charge.totalRial === 0) {
    throw new HttpError(
      409,
      "PLAN_INACTIVE",
      "مبلغِ این خرید صفر است و به درگاه نمی‌رود. برای پلنِ رایگان نیازی به پرداخت نیست.",
    );
  }
  assertGatewayAmount(charge.totalRial);

  const issuedAt = new Date();
  const seqRows = await tx.query<{ last_seq: number }>(
    `INSERT INTO invoice_sequences (jalali_year, last_seq) VALUES ($1, 1)
     ON CONFLICT (jalali_year) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1,
                                             updated_at = now()
     RETURNING last_seq`,
    [jalaliYearOf(issuedAt)],
  );
  const invoiceNumber = formatInvoiceNumber(issuedAt, seqRows.rows[0]!.last_seq);

  const invoiceId = randomUUID();
  await tx.query(
    `INSERT INTO invoices (id, team_id, number, subtotal_rial, discount_rial, vat_rial,
                           total_rial, status, line_items, coupon_code, vat_percent, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8::jsonb, $9, $10, $11)`,
    [
      invoiceId,
      input.teamId,
      invoiceNumber,
      charge.subtotalRial,
      charge.discountRial,
      charge.vatRial,
      charge.totalRial,
      JSON.stringify(charge.lineItems),
      input.couponCode ?? null,
      charge.vatPercent,
      issuedAt,
    ],
  );

  // ★ پارامترهای خرید به‌صورتِ یک **شیءِ صریح** منجمد می‌شوند — نه ایندکسِ یک آرایه‌ی JSON.
  const intent: PurchaseIntent = {
    planCode: plan.code,
    period: input.period,
    seats: input.seats,
    unitPriceRial: charge.lineItems[0]!.unitPriceRial,
    couponCode: input.couponCode ?? null,
  };

  const paymentId = randomUUID();
  await tx.query(
    `INSERT INTO payments (id, team_id, invoice_id, initiated_by, gateway, gateway_mode,
                           amount_rial, status, idempotency_key, request_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9::jsonb)`,
    [
      paymentId,
      input.teamId,
      invoiceId,
      input.userId,
      input.gatewayName,
      input.gatewayMode,
      charge.totalRial,
      idempotencyKey,
      JSON.stringify(intent),
    ],
  );

  return { paymentId, invoiceId, amountRial: charge.totalRial, invoiceNumber, replayed: false };
}

/**
 * فاکتور و پرداختِ یک checkoutِ شکست‌خورده را **باطل** می‌کند.
 *
 * ⚠️ بدونِ این، هر تلاشِ ناموفق یک شماره‌ی فاکتورِ سوخته و یک فاکتورِ `open`ِ شبح باقی
 * می‌گذاشت — هم در فهرستِ فاکتورهای کاربر دیده می‌شد، هم دنباله‌ی شماره‌گذاری را سوراخ
 * می‌کرد (که برای فاکتورِ رسمی مسئله‌ساز است).
 */
export async function voidFailedCheckout(
  db: Executor,
  paymentId: string,
  failureCode: string,
): Promise<void> {
  await db.query(
    `UPDATE invoices SET status = 'void'
      WHERE id = (SELECT invoice_id FROM payments WHERE id = $1) AND status = 'open'`,
    [paymentId],
  );
  await db.query(
    "UPDATE payments SET status = 'failed', failure_code = $2 WHERE id = $1 AND status = 'pending'",
    [paymentId, failureCode],
  );
}

/** کوپن را اعتبارسنجی می‌کند — **بدونِ مصرف‌کردن**. مصرف سرِ فعال‌سازی است. */
async function resolveCoupon(
  tx: Executor,
  teamId: string,
  code: string | undefined,
  planCode: string,
): Promise<CouponEffect | null> {
  if (code === undefined) return null;

  const { rows } = await tx.query<{
    percent_off: number | null;
    amount_off_rial: number | null;
    max_redemptions: number | null;
    redeemed_count: number;
    valid_from: Date | null;
    valid_until: Date | null;
    plan_codes: string[];
  }>("SELECT * FROM coupons WHERE code = $1", [code]);
  const c = rows[0];
  if (c === undefined) throw new HttpError(404, "COUPON_INVALID", "کدِ تخفیف معتبر نیست.");

  const now = Date.now();
  if (c.valid_from !== null && c.valid_from.getTime() > now) {
    throw new HttpError(409, "COUPON_INVALID", "این کدِ تخفیف هنوز فعال نشده.");
  }
  if (c.valid_until !== null && c.valid_until.getTime() < now) {
    throw new HttpError(409, "COUPON_INVALID", "این کدِ تخفیف منقضی شده.");
  }
  // ★ `plan_codes` تا امروز خوانده می‌شد و **هرگز اعمال نمی‌شد** — یعنی کوپنِ ساخته‌شده برای
  //   پلنِ ارزان، با همان درصد روی گران‌ترین پلن هم می‌نشست. زیانِ مستقیمِ درآمدی.
  if (c.plan_codes.length > 0 && !c.plan_codes.includes(planCode)) {
    throw new HttpError(409, "COUPON_INVALID", "این کدِ تخفیف برای این پلن نیست.");
  }
  if (c.max_redemptions !== null && c.redeemed_count >= c.max_redemptions) {
    throw new HttpError(409, "COUPON_EXHAUSTED", "ظرفیتِ این کدِ تخفیف تمام شده.");
  }

  const already = await tx.query(
    "SELECT 1 FROM coupon_redemptions WHERE coupon_code = $1 AND team_id = $2",
    [code, teamId],
  );
  if (already.rows.length > 0) {
    throw new HttpError(409, "COUPON_EXHAUSTED", "این کدِ تخفیف قبلاً برای این تیم استفاده شده.");
  }

  return c.percent_off !== null
    ? { kind: "percent", percentOff: c.percent_off }
    : { kind: "amount", amountOffRial: c.amount_off_rial ?? 0 };
}
