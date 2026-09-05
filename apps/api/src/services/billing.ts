import { randomUUID } from "node:crypto";

import {
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
 * [ADR-050](../../../../ARCHITECTURE_DECISIONS.md#adr-050)).
 *
 * ★★ **این تابع تنها مسیرِ فعال‌سازیِ اشتراک است.** هم `GET /billing/zarinpal/callback` و هم
 * `POST /billing/payments/:id/verify` همین را صدا می‌زنند — نه دو کپی. دو کپی یعنی دو تعریفِ
 * متفاوت از «یک‌بار»، و آن‌وقت callbackِ مرورگر و verifyِ دستیِ همزمان دو اشتراک می‌سازند.
 */

/** وضعیت‌هایی که «اشتراکِ زنده» شمرده می‌شوند — همان مجموعه‌ی `subscriptions_active_uq`. */
export const LIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due"] as const;

export type SettleOutcome =
  | { kind: "activated"; subscriptionId: string; invoiceId: string; refId: string }
  | { kind: "alreadySettled"; subscriptionId: string | null; invoiceId: string | null }
  | { kind: "notPaid"; code: number | null; message: string }
  | { kind: "unknown"; message: string };

interface PaymentRow {
  id: string;
  team_id: string;
  initiated_by: string;
  invoice_id: string | null;
  amount_rial: number;
  status: string;
  authority: string | null;
  ref_id: string | null;
}

export interface SettleDeps {
  pool: pg.Pool;
  gateway: PaymentGateway;
}

/** پرداخت را با شناسه یا با `authority` پیدا می‌کند — دو ورودیِ یک مسیر. */
export type PaymentLocator = { by: "id"; id: string } | { by: "authority"; authority: string };

/**
 * ★★ **قاعده‌ی یگانگی: وضعیتِ ردیفِ خودمان زیرِ `FOR UPDATE`، نه کدِ درگاه.**
 *
 * ADR-050 نوشته بود «فقط کدِ ۱۰۰ حق دارد فعال کند». probe نشان داد این یک بندِ **ناقص** است:
 * اگر callback را گم کرده باشیم (کاربر مرورگر را بست) ردیفِ ما `pending` می‌مانَد ولی درگاه
 * در verifyِ بعدی **۱۰۱** می‌دهد — و با آن بندِ تحت‌اللفظی، آشتی‌دهی می‌گفت «قبلاً تسویه شده»
 * و هرگز فعال نمی‌کرد. یعنی دقیقاً همان «پول گرفته شد، سرویس داده نشد» که ADR-014 قاعده ۳
 * برای جلوگیری‌اش نوشته شده.
 *
 * پس قاعده‌ی درست: **{۱۰۰، ۱۰۱} یعنی پول گرفته شده**، و فعال‌سازی وقتی رخ می‌دهد که
 * **ردیفِ ما** از `pending` به `paid` برود — که `SELECT … FOR UPDATE` تضمین می‌کند فقط
 * یک‌بار ممکن است. ⚠️ این یک اصلاحِ ADR-050 است و **تاییدِ مالک می‌خواهد** (ADR-055).
 *
 * ⚠️ تماسِ شبکه‌ای **داخلِ** تراکنش است و قفلِ ردیف را تا پایانِ رفت‌وبرگشت نگه می‌دارد. این
 * عمدی است: ADR-014 می‌خواهد verify و فعال‌سازی اتمیک باشند. قفل فقط بینِ تسویه‌های **همان
 * پرداخت** رقابت می‌سازد — یعنی دقیقاً همان چیزی که باید سریالی شود.
 */
export async function settlePayment(
  deps: SettleDeps,
  locator: PaymentLocator,
): Promise<SettleOutcome> {
  return withTransaction(deps.pool, async (tx) => {
    const where = locator.by === "id" ? "id = $1" : "authority = $1";
    const key = locator.by === "id" ? locator.id : locator.authority;
    const { rows } = await tx.query<PaymentRow>(
      `SELECT id, team_id, initiated_by, invoice_id, amount_rial, status, authority, ref_id
         FROM payments WHERE ${where} FOR UPDATE`,
      [key],
    );
    const payment = rows[0];
    if (payment === undefined) {
      throw new HttpError(404, "PAYMENT_NOT_FOUND", "پرداخت یافت نشد.");
    }

    // ★ راهِ خروجِ زودهنگام: ردیفِ ما از قبل تسویه شده ⇒ **بدونِ تماس با درگاه** همان نتیجه.
    if (payment.status === "paid") {
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
      // «نمی‌دانیم» ⇒ ردیف `pending` می‌مانَد تا sweepِ فاز ۷ دوباره بپرسد. هیچ‌چیز نوشته نمی‌شود.
      return { kind: "unknown", message: verdict.message };
    }

    if (verdict.status === "notPaid") {
      await tx.query(
        "UPDATE payments SET status = 'failed', failure_code = $2, verified_at = now() WHERE id = $1",
        [payment.id, verdict.code === null ? null : String(verdict.code)],
      );
      return { kind: "notPaid", code: verdict.code, message: verdict.message };
    }

    // ★★ پول گرفته شده ({۱۰۰، ۱۰۱}) و ردیفِ ما هنوز `pending` است ⇒ همین‌جا فعال می‌کنیم.
    const activated = await activateFromPayment(tx, payment);
    await tx.query(
      `UPDATE payments SET status = 'paid', ref_id = $2, card_pan_masked = $3, card_hash = $4,
              fee_rial = $5, paid_at = now(), verified_at = now(), invoice_id = $6
         WHERE id = $1`,
      [
        payment.id,
        verdict.refId,
        verdict.cardPanMasked,
        verdict.cardHash,
        verdict.feeRial,
        activated.invoiceId,
      ],
    );
    return {
      kind: "activated",
      subscriptionId: activated.subscriptionId,
      invoiceId: activated.invoiceId,
      refId: verdict.refId,
    };
  });
}

/**
 * فاکتور را `paid` می‌کند و اشتراک را می‌سازد/تمدید می‌کند — **در همان تراکنش**.
 *
 * ⚠️ ترتیب مهم است: اول اشتراکِ زنده‌ی قبلی از مجموعه‌ی `subscriptions_active_uq` بیرون
 * می‌رود، بعد ردیفِ تازه درج می‌شود. اگر برعکس بود، ایندکسِ یکتا با ۲۳۵۰۵ می‌افتاد — **بعد
 * از اینکه پول گرفته شده**.
 */
async function activateFromPayment(
  tx: Executor,
  payment: PaymentRow,
): Promise<{ subscriptionId: string; invoiceId: string }> {
  const invoiceId = payment.invoice_id;
  if (invoiceId === null) {
    throw new HttpError(500, "INTERNAL", "پرداختِ بدونِ فاکتور قابلِ تسویه نیست.");
  }

  const inv = await tx.query<{ plan_code: string; period: string; seats: number; unit: number }>(
    `SELECT (line_items->0->>'planCode') AS plan_code, (line_items->0->>'period') AS period,
            (line_items->0->>'qty')::int AS seats, (line_items->0->>'unitPriceRial')::bigint AS unit
       FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  const meta = inv.rows[0];
  if (meta === undefined) {
    throw new HttpError(500, "INTERNAL", "فاکتورِ این پرداخت یافت نشد.");
  }

  await tx.query("UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1", [invoiceId]);

  // ★ اشتراکِ زنده‌ی قبلی (اگر بود) بسته می‌شود تا ایندکسِ یکتا آزاد شود.
  await tx.query(
    `UPDATE subscriptions SET status = 'expired', updated_at = now()
      WHERE team_id = $1 AND status = ANY($2::text[])`,
    [payment.team_id, [...LIVE_SUBSCRIPTION_STATUSES]],
  );

  // لنگرِ دوره = **اکنون**، که همان لحظه‌ی تسویه است. اگر آشتی‌دهی دیر برسد، دوره از همین
  // لحظه شروع می‌شود — نه از لحظه‌ی درخواست؛ مشتری زمان از دست نمی‌دهد.
  const anchor = new Date();
  const period = computePeriod(anchor, meta.period as BillingPeriod);
  const subscriptionId = randomUUID();
  await tx.query(
    `INSERT INTO subscriptions (id, team_id, plan_code, status, period, seats,
                                current_period_start, current_period_end,
                                activated_by_payment_id, unit_price_rial)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9)`,
    [
      subscriptionId,
      payment.team_id,
      meta.plan_code,
      meta.period,
      meta.seats,
      period.start,
      period.end,
      payment.id,
      meta.unit,
    ],
  );

  return { subscriptionId, invoiceId };
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
  /**
   * نام و حالتِ درگاه — از همان `PaymentGateway`ی که قرار است صدا زده شود.
   *
   * ⚠️ اینجا **جای‌نگهدار نگذار.** نگارشِ اول `'pending'` می‌گذاشت و `payments_gateway_ck`ِ
   * migration ۰۰۰۴ همان لحظه ردش کرد — دقیقاً کاری که آن `CHECK` برایش نوشته شد.
   */
  gatewayName: string;
  gatewayMode: string;
}

export interface CheckoutDraft {
  paymentId: string;
  invoiceId: string;
  amountRial: number;
  invoiceNumber: string;
}

/**
 * فاکتور + ردیفِ `pending`ِ پرداخت را **در یک تراکنش** می‌سازد و برمی‌گرداند.
 *
 * ★★ مبلغ کاملاً سمتِ سرور از جدولِ `plans` محاسبه می‌شود (ADR-014، آخرین خط). بدنه‌ی
 * درخواست اصلاً فیلدِ ریالی ندارد و `checkoutBody` این را در قرارداد قفل کرده.
 */
export async function createCheckout(
  tx: Executor,
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<CheckoutDraft> {
  const planRows = await tx.query<PlanRow>(
    "SELECT * FROM plans WHERE code = $1",
    [input.planCode],
  );
  const planRow = planRows.rows[0];
  if (planRow === undefined) {
    throw new HttpError(404, "PLAN_NOT_FOUND", "پلن یافت نشد.");
  }
  const plan = toPlan(planRow);
  if (!plan.isActive) {
    // ★ «فقط قابلیتِ واقعی» — پلنی که قیمتش تایید نشده قابلِ خرید نیست (فاز ۴، seed).
    throw new HttpError(409, "PLAN_INACTIVE", "این پلن در حالِ حاضر قابلِ خرید نیست.");
  }

  const coupon = await resolveCoupon(tx, input.teamId, input.couponCode);
  const charge = computeCharge({
    plan,
    period: input.period,
    seats: input.seats,
    coupon,
    vatPercent: input.vatPercent,
  });

  const issuedAt = new Date();
  const seqRows = await tx.query<{ last_seq: number }>(
    `INSERT INTO invoice_sequences (jalali_year, last_seq) VALUES ($1, 1)
     ON CONFLICT (jalali_year) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1,
                                             updated_at = now()
     RETURNING last_seq`,
    [jalaliYearOf(issuedAt)],
  );
  const invoiceNumber = formatInvoiceNumber(issuedAt, seqRows.rows[0]!.last_seq);

  // ★ `planCode`/`period` داخلِ سطرِ فاکتور می‌روند تا تسویه بتواند بدونِ ستونِ اضافه بسازدشان.
  const lineItems = charge.lineItems.map((item) => ({
    ...item,
    planCode: plan.code,
    period: input.period,
  }));

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
      JSON.stringify(lineItems),
      input.couponCode ?? null,
      charge.vatPercent,
      issuedAt,
    ],
  );

  if (input.couponCode !== undefined) {
    // ⚠️ ایندکسِ یکتای `(coupon_code, team_id)` مسابقه را می‌بندد — نه چکِ خواندن-سپس-نوشتن.
    await tx.query(
      "INSERT INTO coupon_redemptions (coupon_code, team_id, invoice_id) VALUES ($1, $2, $3)",
      [input.couponCode, input.teamId, invoiceId],
    );
    await tx.query("UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE code = $1", [
      input.couponCode,
    ]);
  }

  const paymentId = randomUUID();
  await tx.query(
    `INSERT INTO payments (id, team_id, invoice_id, initiated_by, gateway, gateway_mode,
                           amount_rial, status, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
    [
      paymentId,
      input.teamId,
      invoiceId,
      input.userId,
      input.gatewayName,
      input.gatewayMode,
      charge.totalRial,
      idempotencyKey,
    ],
  );

  return { paymentId, invoiceId, amountRial: charge.totalRial, invoiceNumber };
}

/** کوپن را اعتبارسنجی می‌کند و به اثرِ ریاضی تبدیل — یا `null` اگر کوپنی نبود. */
async function resolveCoupon(
  tx: Executor,
  teamId: string,
  code: string | undefined,
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
