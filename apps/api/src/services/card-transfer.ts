import {
  CardTransferGateway,
  resolveTransferDestination,
  type PaymentGateway,
  type TransferApprovalReader,
  type TransferDestination,
  type TransferRecord,
} from "@hamboom/billing-core";

import { recordAudit, type AuditActor } from "../audit.ts";
import { HttpError } from "../errors.ts";
import type { Executor } from "../plugins/db.ts";
import { lockPaymentForSettle, settleLocked, type SettleOutcome } from "./billing.ts";

/**
 * کارت‌به‌کارت/شبا با تاییدِ دستی — لایه‌ی `apps/api`
 * ([ADR-070](../../../../ARCHITECTURE_DECISIONS.md#adr-070)).
 *
 * ★ قرینه‌ی `board-access-db`: **پورت** در `billing-core` است، **جدول و تراکنش** این‌جا.
 */

export const CARD_TRANSFER_NAME = "card_transfer";

interface TransferRow {
  transfer_approved_at: Date | null;
  transfer_ref: string | null;
  transfer_sender_last4: string | null;
  transfer_claimed_at: Date | null;
  requested_at: Date;
  now_at: Date;
}

/**
 * خواننده‌ی وضعیتِ انتقال از جدولِ `payments`.
 *
 * ⚠️⚠️ **`db` باید همان `tx`ی باشد که تایید را می‌نویسد.** تایید و فعال‌سازی در یک تراکنش‌اند
 * (ADR-014)، و خواننده‌ای که روی اتصالِ **دیگری** از استخر بخواند تاییدِ commit‌نشده را نمی‌بیند —
 * آن‌وقت `verifyPayment` می‌گوید «هنوز تایید نشده» و staff فکر می‌کند دکمه کار نکرده.
 * همان تله‌ی اتصالِ استخر که `infra:probe-lock` در M5 فاز ۱ ثبتش کرد.
 *
 * ⊕ برای مسیرهای فقط‌خواندنی (sweepِ آشتی‌دهی، `payment.verify`ِ پنل) استخر درست است: آن‌جا
 *   وضعیتِ **commit‌شده** همان چیزی است که باید دیده شود.
 */
export function createPgTransferReader(db: Executor): TransferApprovalReader {
  return {
    async read(authority: string): Promise<TransferRecord | null> {
      const { rows } = await db.query<TransferRow>(
        `SELECT transfer_approved_at, transfer_ref, transfer_sender_last4,
                transfer_claimed_at, requested_at, now() AS now_at
           FROM payments
          WHERE gateway = $1 AND authority = $2`,
        [CARD_TRANSFER_NAME, authority],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return {
        approvedAtMs: row.transfer_approved_at?.getTime() ?? null,
        transferRef: row.transfer_ref,
        senderLast4: row.transfer_sender_last4,
        claimedAtMs: row.transfer_claimed_at?.getTime() ?? null,
        requestedAtMs: row.requested_at.getTime(),
        // ★ `now()` عمدی است، نه `clock_timestamp()`: زمانِ **شروعِ تراکنش** می‌دهد، پس دو
        //   خواندن در یک تراکنش هرگز دو سن نمی‌دهند. و مهم‌تر، همان ساعتی است که
        //   `requested_at` را نوشته — مقایسه‌ی دو ساعتِ متفاوت همان باگی بود که در فاز ۷
        //   حلقه‌ی بی‌پایانِ ۴۲۸ را ساخت.
        nowMs: row.now_at.getTime(),
      };
    },
  };
}

export interface CardTransferSettings {
  destination: TransferDestination;
  claimWindowMs: number;
  checkoutBaseUrl: string;
  mode: string;
}

/**
 * ★ یک درگاهِ **تازه** روی یک executorِ مشخص.
 *
 * `settleLocked(tx, { gateway }, payment)` درگاه را **هر بار** می‌گیرد (M4، دست‌نخورده)، پس
 * مسیرِ تایید می‌تواند نمونه‌ی tx-محدود بدهد بدونِ اینکه امضای هیچ تابعِ M4 عوض شود.
 */
export function createCardTransferGatewayOn(
  settings: CardTransferSettings,
  db: Executor,
): PaymentGateway {
  return new CardTransferGateway({
    checkoutBaseUrl: settings.checkoutBaseUrl,
    mode: settings.mode,
    reader: createPgTransferReader(db),
    claimWindowMs: settings.claimWindowMs,
  });
}

/** ورودیِ ساختِ تنظیمات از env — عمداً `unknown`دوست، تا `plugins/payment.ts` تنها خواننده‌اش بماند. */
export interface CardTransferEnv {
  CARD_TRANSFER_CARD_NUMBER?: string | undefined;
  CARD_TRANSFER_SHEBA?: string | undefined;
  CARD_TRANSFER_HOLDER_NAME?: string | undefined;
  CARD_TRANSFER_BANK_NAME?: string | undefined;
  CARD_TRANSFER_CLAIM_WINDOW_HOURS: number;
}

export function resolveCardTransferSettings(
  env: CardTransferEnv,
  webBaseUrl: string,
  mode: string,
): CardTransferSettings {
  return {
    // ⚠️ این‌جا می‌شکند اگر مقصد غایب یا بدرقم باشد — یعنی **در بوت**، نه سرِ اولین مشتری.
    destination: resolveTransferDestination({
      card: env.CARD_TRANSFER_CARD_NUMBER,
      sheba: env.CARD_TRANSFER_SHEBA,
      holderName: env.CARD_TRANSFER_HOLDER_NAME,
      bankName: env.CARD_TRANSFER_BANK_NAME,
    }),
    claimWindowMs: env.CARD_TRANSFER_CLAIM_WINDOW_HOURS * 3_600_000,
    checkoutBaseUrl: `${webBaseUrl.replace(/\/+$/, "")}${TRANSFER_PAGE_PATH}`,
    mode,
  };
}

/**
 * ⚠️⚠️ **دو مسیرِ متفاوت، و یکی‌کردنشان یک باگِ واقعی می‌سازد.**
 *
 * `TRANSFER_API_PATH` مسیرِ **api** است و مثلِ کلِ `/billing` به سرور پروکسی می‌شود.
 * `TRANSFER_PAGE_PATH` مسیرِ **SPA** است که مرورگرِ کاربر به آن می‌رود، و عمداً با
 * `/billing` شروع **نمی‌شود**: آن پیشوند در dev و پشتِ nginx کاملاً مالِ api است، پس یک
 * صفحه‌ی SPA با آن نام اصلاً به مرورگر نمی‌رسد و کاربر یک ۴۰۴ی JSON می‌بیند
 * ([`router.tsx`](../../../web/src/router.tsx) همین را برای `/pricing` و `/payment/result` ثبت کرده).
 *
 * ★ نگارشِ اول هر دو را یک ثابت گرفته بود — همان کلاسِ نقصی که در M4 فاز ۹ با
 *   `MOCK_CHECKOUT_PATH` و `ZARINPAL_CALLBACK_URL` رخ داد و فقط **اجرای واقعی** پیدایش کرد.
 *   این‌بار گاردِ بوتِ `registerBillingRoutes` جلویش را می‌گیرد.
 */
export const TRANSFER_API_PATH = "/billing/transfer";
export const TRANSFER_PAGE_PATH = "/payment/transfer";

// ── ادعای کاربر ───────────────────────────────────────────────────────────

export interface ClaimInput {
  paymentId: string;
  /** کاربری که ادعا را ثبت می‌کند — باید عضوِ تیمِ همان پرداخت باشد (چکش در route). */
  ref: string;
  last4: string | null;
}

interface ClaimRow {
  id: string;
  team_id: string;
  status: string;
  gateway: string;
  transfer_claimed_at: Date | null;
}

/**
 * «پول را ریختم، این هم شماره‌اش.»
 *
 * ★★ اثرِ واقعی‌اش یک ستون نیست، **منجمدکردنِ ابطال** است: از این لحظه `verifyPayment` پاسخِ
 * `gatewayError` می‌دهد، `failure_code` دست‌نخورده می‌مانَد، و پله‌ی ۳ی ADR-056 هرگز شلیک
 * نمی‌کند. بدونِ این، یک واریزِ پایا که روزِ بعد می‌نشیند، ردیفش را باطل‌شده پیدا می‌کرد.
 *
 * ⊕ ادعای تکراری **مجاز** است (ردیف دوباره نوشته می‌شود): کاربری که اشتباه تایپ کرده باید
 *   بتواند تصحیحش کند، و یکتایی جایی است که تصمیم گرفته می‌شود (`transfer_ref`ِ staff).
 */
export async function claimTransfer(tx: Executor, input: ClaimInput): Promise<{ teamId: string }> {
  const { rows } = await tx.query<ClaimRow>(
    `SELECT id, team_id, status, gateway, transfer_claimed_at
       FROM payments WHERE id = $1 FOR UPDATE`,
    [input.paymentId],
  );
  const row = rows[0];
  if (row === undefined) throw new HttpError(404, "PAYMENT_NOT_FOUND", "پرداخت یافت نشد.");
  if (row.gateway !== CARD_TRANSFER_NAME) {
    throw new HttpError(409, "INVALID_TRANSITION", "این پرداخت کارت‌به‌کارت نیست.");
  }
  if (row.status !== "pending") {
    // ★ ردیفِ تسویه‌شده ادعا نمی‌خواهد، و ردیفِ باطل‌شده با ادعا زنده نمی‌شود — آن یکی کارِ staff است.
    throw new HttpError(409, "INVALID_TRANSITION", "این پرداخت دیگر در انتظارِ واریز نیست.");
  }

  await tx.query(
    `UPDATE payments
        SET transfer_claimed_ref = $2, transfer_claimed_last4 = $3, transfer_claimed_at = now()
      WHERE id = $1`,
    [input.paymentId, input.ref, input.last4],
  );
  return { teamId: row.team_id };
}

// ── تاییدِ staff ───────────────────────────────────────────────────────────

export interface ApproveInput {
  paymentId: string;
  /** شماره‌ی مرجعی که staff در **صورت‌حسابِ بانک** دید — نه ادعای کاربر. */
  ref: string;
  last4: string | null;
  /** مبلغی که staff در صورت‌حساب دید. با `amount_rial` سنجیده می‌شود. */
  observedAmountRial: number;
  note: string | null;
}

export interface ApproveDeps {
  settings: CardTransferSettings;
  actor: AuditActor;
}

/**
 * تاییدِ واریز — و بلافاصله تسویه، **در همان تراکنش**.
 *
 * ★★ فعال‌سازی این‌جا **بازنویسی نمی‌شود**: تایید فقط دو ستون می‌نویسد و بعد همان
 * `settleLocked`ِ M4 صدا زده می‌شود که درگاه را می‌پرسد و درگاه همین دو ستون را می‌خوانَد.
 * پس قفلِ ردیف، مصرفِ کوپن، محاسبه‌ی دوره و `subscriptions_active_uq` همه دست‌نخورده‌اند و
 * سنجه‌ی `billing:settle` همچنان این مسیر را هم پوشش می‌دهد (ADR-055).
 */
export async function approveTransfer(
  tx: Executor,
  deps: ApproveDeps,
  input: ApproveInput,
): Promise<SettleOutcome> {
  const gateway = createCardTransferGatewayOn(deps.settings, tx);
  // ★ همین یک تماس هم قفلِ ردیف را می‌گیرد و هم `assertGatewayMatches` را اجرا می‌کند —
  //   یعنی ردیفِ زرین‌پال هرگز از این مسیر تایید نمی‌شود.
  const payment = await lockPaymentForSettle(tx, gateway, { by: "id", id: input.paymentId });

  if (payment.status !== "pending") {
    throw new HttpError(409, "INVALID_TRANSITION", "این پرداخت دیگر در انتظارِ تایید نیست.");
  }

  // ★★ چیزی که ماشین می‌تواند بسنجد را **ماشین** می‌سنجد. بدونِ این، کسی ۱۰ هزار تومان
  //    می‌ریزد و پلنِ تیم را ادعا می‌کند، و تنها نگهبان چشمِ اپراتورِ خسته است.
  if (input.observedAmountRial !== payment.amount_rial) {
    throw new HttpError(409, "TRANSFER_AMOUNT_MISMATCH", "مبلغِ واریز با مبلغِ فاکتور یکی نیست.", {
      expectedRial: payment.amount_rial,
      observedRial: input.observedAmountRial,
    });
  }

  // ⚠️ پیش‌چک برای **پیامِ روشن**؛ نگهبانِ واقعی `payments_transfer_ref_uq` است. بعد از
  //    `23505` کلِ تراکنش abort می‌شود و دیگر نمی‌شود پیامِ مهربانی داد — همان چیزی که
  //    `createCheckoutIdempotent` هم با آن روبه‌رو شد. مسابقه‌ی دو staffِ هم‌زمان روی **یک
  //    شماره‌ی یکسان و دو پرداختِ متفاوت** همچنان به ایندکس می‌رسد و ۵۰۰ می‌دهد؛ داده در
  //    هر دو حالت درست می‌مانَد، که چیزی است که اهمیت دارد.
  const taken = await tx.query<{ id: string }>(
    `SELECT id FROM payments
      WHERE gateway = $1 AND transfer_ref = $2 AND id <> $3 LIMIT 1`,
    [CARD_TRANSFER_NAME, input.ref, input.paymentId],
  );
  if (taken.rows.length > 0) {
    throw new HttpError(409, "TRANSFER_REF_TAKEN", "این شماره‌ی مرجع قبلاً برای پرداختِ دیگری ثبت شده.", {
      paymentId: taken.rows[0]?.id ?? null,
    });
  }

  await tx.query(
    `UPDATE payments
        SET transfer_ref = $2, transfer_sender_last4 = $3,
            transfer_approved_by = $4, transfer_approved_at = now()
      WHERE id = $1`,
    [input.paymentId, input.ref, input.last4, deps.actor.userId],
  );

  const outcome = await settleLocked(tx, { gateway }, payment);

  // ★ ممیزی در **همان** تراکنش (ADR-067): اگر تسویه rollback شود، هیچ ردیفی هم نمی‌مانَد.
  //   و اگر ممیزی بشکند، تایید هم برنمی‌گردد — گیتِ ۱۶ همین را می‌خواهد.
  await recordAudit(tx, {
    actor: deps.actor,
    action: "payment.approveTransfer",
    target: { type: "payment", id: input.paymentId },
    metadata: {
      outcome: outcome.kind,
      amountRial: input.observedAmountRial,
      // ⚠️ P7: شماره‌ی مرجع یک شناسه‌ی بانکی است. **ثبت می‌شود** چون ممیزیِ مالی بدونش
      //    بی‌معنی است، ولی ۴ رقمِ کارت نه — آن چیزی به پاسخ‌گویی اضافه نمی‌کند.
      transferRef: input.ref,
      ...(input.note === null ? {} : { note: input.note }),
    },
  });

  return outcome;
}
