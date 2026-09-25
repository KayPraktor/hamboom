import { randomUUID } from "node:crypto";

import type { PaymentGateway } from "@hamboom/billing-core";
import { transferClaimRequest, type TransferInstructions } from "@hamboom/shared-types";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { requireSub } from "../auth-guard.ts";
import {
  INVOICE_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  toInvoice,
  toPlan,
  toSubscription,
  type InvoiceRow,
  type PlanRow,
  type SubscriptionRow,
} from "../dto.ts";
import { HttpError } from "../errors.ts";
import { assertUuid, checkoutBody, parseBody, zarinpalCallbackQuery } from "../schemas.ts";
import {
  createCheckoutIdempotent,
  LIVE_SUBSCRIPTION_STATUSES,
  settlePayment,
  voidFailedCheckout,
} from "../services/billing.ts";
import {
  CARD_TRANSFER_NAME,
  claimTransfer,
  TRANSFER_API_PATH,
  TRANSFER_PAGE_PATH,
  type CardTransferSettings,
} from "../services/card-transfer.ts";
import { withTransaction } from "../plugins/db.ts";
import { requireTeamRole } from "../services/teams.ts";

/**
 * مسیرهای پرداخت و اشتراک — [PLAN §۵٫۲](../../../../PLAN.md) ردیف‌های «پرداخت» (M4 فاز ۵).
 *
 * گیتِ نقش طبقِ PLAN: خواندن `admin`، خرید و لغو `owner`، فهرستِ پلن‌ها **عمومی**.
 * ★ تقارنِ عمدیِ M3 حفظ می‌شود: غیرعضو ⇒ ۴۰۴ (وجودِ تیم لو نرود)، عضوِ کم‌نقش ⇒ ۴۰۳.
 */

export interface BillingRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
  gateway: PaymentGateway;
  vatPercent: number;
  callbackUrl: string;
  /** ریشه‌ی اپِ وب — بازگشت از درگاه به آن‌جا ریدایرکت می‌شود. */
  webBaseUrl: string;
  appEnv: string;
  /** سقفِ نرخِ اختصاصیِ callback (mسیرِ عمومی). */
  callbackRateLimit: { max: number; timeWindow: number };
  /**
   * تنظیماتِ کارت‌به‌کارت، یا `null` وقتی provider چیزِ دیگری است (ADR-070).
   *
   * ⚠️ دو مسیرِ انتقال **همیشه** ثبت می‌شوند، حتی وقتی این `null` است. شرطی‌کردنشان جدولِ
   * مسیرها را به `.env` گره می‌زد و گیتِ `infra:check-proxy` بسته به محیط نتیجه‌ی متفاوت
   * می‌داد — یعنی یک گیت که می‌تواند دروغ بگوید.
   */
  transfer: CardTransferSettings | null;
}

/** مسیرِ **ثبت‌شده‌ی** بازگشت از درگاه — تنها تعریفش، و گاردِ بوت با همین می‌سنجد. */
export const ZARINPAL_CALLBACK_PATH = "/billing/zarinpal/callback";

export function registerBillingRoutes(app: FastifyInstance, deps: BillingRouteDeps): void {
  // ★★ **گاردِ بوت: آدرسی که به درگاه می‌دهیم باید واقعاً مسیرِ ماست.**
  //
  // پیش‌فرضِ `ZARINPAL_CALLBACK_URL` یک پیشوندِ `/api/v1` داشت که **هیچ‌جای این اپ ثبت
  // نمی‌شود**. یعنی درگاه کاربر را بعد از پرداختِ واقعی به یک ۴۰۴ می‌فرستاد و تسویه فقط
  // با آشتی‌دهی نجات پیدا می‌کرد — یک نقصِ خاموش که هیچ تستی نمی‌گرفتش، چون تست‌ها هرگز
  // این رشته را با جدولِ مسیرها مقایسه نمی‌کردند. با اجرای واقعی در فاز ۹ پیدا شد.
  //
  // ⚠️ بلند می‌شکند و در **بوت**، نه سرِ اولین پرداختِ مشتری.
  const callbackPath = new URL(deps.callbackUrl).pathname.replace(/\/+$/, "");
  if (callbackPath !== ZARINPAL_CALLBACK_PATH) {
    throw new Error(
      `ZARINPAL_CALLBACK_URL به «${callbackPath}» اشاره می‌کند ولی مسیرِ ثبت‌شده ` +
        `«${ZARINPAL_CALLBACK_PATH}» است. درگاه کاربر را به ۴۰۴ می‌فرستد و تسویه فقط با ` +
        "آشتی‌دهی نجات پیدا می‌کند.",
    );
  }

  // ★★ **گاردِ بوتِ دوم، قرینه‌ی اولی: صفحه‌ای که مرورگر به آن می‌رود نباید مسیرِ api باشد.**
  //
  // `createPayment`ِ کارت‌به‌کارت مرورگر را به `WEB_BASE_URL + TRANSFER_PAGE_PATH` می‌فرستد.
  // اگر آن مسیر زیرِ `/billing` بنشیند، هم در dev (پروکسیِ vite) و هم پشتِ nginx **کاملاً**
  // به api می‌رود و کاربر به‌جای صفحه‌ی «این مبلغ را به این کارت بریز» یک JSON می‌بیند —
  // همان کلاسِ نقصی که در M4 فاز ۹ با `MOCK_CHECKOUT_PATH` رخ داد و فقط اجرای واقعی پیدایش کرد.
  if (TRANSFER_PAGE_PATH.startsWith(TRANSFER_API_PATH.slice(0, TRANSFER_API_PATH.indexOf("/", 1)))) {
    throw new Error(
      `TRANSFER_PAGE_PATH («${TRANSFER_PAGE_PATH}») زیرِ پیشوندِ apiِ «${TRANSFER_API_PATH}» است؛ ` +
        "مرورگر به‌جای صفحه، پاسخِ JSONِ api را می‌گیرد (router.tsx همین قاعده را ثبت کرده).",
    );
  }

  // ── فهرستِ پلن‌ها (عمومی — صفحه‌ی قیمت) ──────────────────────────────
  app.get("/billing/plans", async () => {
    // ⚠️ فقط پلنِ **فعال**. پلنی که قیمتش تایید نشده (فاز ۴ seed) اصلاً دیده نمی‌شود.
    const { rows } = await deps.pool.query<PlanRow>(
      "SELECT * FROM plans WHERE is_active = true ORDER BY sort_order",
    );
    return { plans: rows.map(toPlan) };
  });

  // ── شروعِ خرید (owner) ───────────────────────────────────────────────
  app.post("/teams/:teamId/billing/checkout", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { teamId } = req.params as { teamId: string };
    assertUuid(teamId, "شناسه‌ی تیم");
    const body = parseBody(checkoutBody, req.body);
    await requireTeamRole(deps.pool, teamId, sub, "owner");

    // ★★ فاکتور و ردیفِ pending **قبل از** تماس با درگاه ساخته می‌شوند: اگر درگاه جواب نداد،
    //    یک ردیفِ pending داریم که sweepِ فاز ۷ می‌تواند سراغش برود — نه یک پرداختِ بی‌ردپا.
    // ★★ `…Idempotent` و نه `createCheckout`ِ خام: با دو نود، دو درخواستِ هم‌زمانِ یک کلید
    //    هر دو SELECT را خالی می‌بینند و بازنده `23505` می‌گیرد ⇒ ۵۰۰ی بی‌ربط (M5 گام ۶٫۳).
    const draft = await createCheckoutIdempotent(
      deps.pool,
      {
        teamId,
        userId: sub,
        planCode: body.planCode,
        period: body.period,
        seats: body.seats,
        couponCode: body.couponCode,
        vatPercent: deps.vatPercent,
        gatewayName: deps.gateway.name,
        gatewayMode: deps.gateway.mode,
        // ★ مقصدی که همین حالا به کاربر نشان داده می‌شود، همین‌جا منجمد می‌شود (ADR-070).
        gatewaySnapshot:
          deps.transfer === null
            ? undefined
            : {
                card: deps.transfer.destination.card,
                sheba: deps.transfer.destination.sheba,
                holderName: deps.transfer.destination.holderName,
                bankName: deps.transfer.destination.bankName,
              },
      },
      // ★★ کلیدِ یکتای **ماندگار** — ایندکسِ `payments_idem_uq`. برخلافِ میان‌افزارِ
      // حافظه‌ایِ `idempotency.ts`، این از ری‌استارت و نودِ دوم جان به در می‌بَرد (ADR-050).
      // ⚠️ **حتماً با `teamId` دامنه‌دار می‌شود:** آن ایندکس **سراسری** است، پس کلیدِ خامِ
      //    کلاینت می‌تواند با کلیدِ تیمِ دیگری تصادف کند و ردیفِ آن تیم را برگرداند.
      idempotencyKeyFor(teamId, req.headers["idempotency-key"]),
    );

    let created;
    try {
      created = await deps.gateway.createPayment({
        amountRial: draft.amountRial,
        description: `اشتراکِ هم‌بوم — فاکتور ${draft.invoiceNumber}`,
        callbackUrl: deps.callbackUrl,
        orderId: draft.invoiceNumber,
      });
    } catch (cause) {
      // ★ فاکتور هم **باطل** می‌شود، نه فقط پرداخت — وگرنه یک شماره‌ی فاکتورِ سوخته و یک
      //   فاکتورِ `open`ِ شبح در فهرستِ کاربر می‌مانَد و دنباله‌ی رسمی سوراخ می‌شود.
      await voidFailedCheckout(deps.pool, draft.paymentId, "GATEWAY");
      throw new HttpError(
        502,
        "GATEWAY_UNAVAILABLE",
        "ارتباط با درگاهِ پرداخت برقرار نشد. کمی بعد دوباره تلاش کن.",
        { cause: String((cause as Error).message) },
      );
    }

    // ★★ **این UPDATE هم می‌تواند بیفتد، و نگارشِ اول هیچ گاردی نداشت.**
    //    `payments_authority_uq` روی `(gateway, authority)` است؛ اگر درگاه authorityِ تکراری
    //    بدهد، اینجا ۲۳۵۰۵ می‌خورد و کاربر یک ۵۰۰ی خام می‌گیرد **و** یک ردیفِ `pending`ِ
    //    بدونِ authority جا می‌مانَد که تا ابد به‌عنوانِ «یتیم» در آشتی‌دهی گزارش می‌شود.
    //    ⚠️ در فاز ۸ این واقعاً رخ داد: authorityِ `MockGateway` بینِ پروسه‌ها یکتا نبود.
    // ★ باطل‌کردن این‌جا **امن** است چون `redirectUrl` هرگز به کاربر نرسیده — پس نمی‌تواند
    //   پولی بابتِ این authority بدهد.
    try {
      await deps.pool.query("UPDATE payments SET authority = $2 WHERE id = $1", [
        draft.paymentId,
        created.authority,
      ]);
    } catch (cause) {
      await voidFailedCheckout(deps.pool, draft.paymentId, "AUTHORITY");
      throw new HttpError(
        502,
        "GATEWAY_UNAVAILABLE",
        "شناسه‌ی پرداختِ درگاه ذخیره نشد. کمی بعد دوباره تلاش کن.",
        { cause: String((cause as Error).message) },
      );
    }

    return { paymentId: draft.paymentId, redirectUrl: created.redirectUrl };
  });

  // ── ★★ بازگشت از درگاه (عمومی) — قلبِ ADR-050 ────────────────────────
  //
  // ⚠️ اینجا **نه** هدرِ auth هست و **نه** کوکیِ refresh (که روی `path=/auth` است). پس
  //    میان‌افزارِ `Idempotency-Key` هم اجرا نمی‌شود (اثباتِ گام ۱٫۳). تنها حفاظ،
  //    `SELECT … FOR UPDATE` داخلِ `settlePayment` است.
  // ⚠️ مقصدِ ریدایرکت **`/payment/result`** است، نه `/billing/result`: در dev کلِ پیشوندِ
  //    `/billing` به api پروکسی می‌شود، پس یک مسیرِ SPA با آن نام اصلاً به مرورگر نمی‌رسد.
  app.get(
    ZARINPAL_CALLBACK_PATH,
    { config: { rateLimit: deps.callbackRateLimit } },
    async (req, reply) => {
      const query = zarinpalCallbackQuery.safeParse(req.query);
      if (!query.success) {
        return reply.redirect(`${deps.webBaseUrl}/payment/result?status=invalid`);
      }

      // ★ به `Status` **اعتماد نمی‌شود** (ADR-014 قاعده ۱). حتی روی `NOK` هم verifyِ
      //   سرور-به-سرور زده می‌شود: ممکن است پول capture شده باشد و مرورگر دروغ بگوید.
      // ★ M6 فاز ۶: خودِ بازگشت در `callback_payload` ثبت می‌شود — ستونی که از M4 همیشه NULL بود و
      //   اشکال‌زداییِ «کاربر می‌گوید پرداخت کردم» را بی‌سند می‌گذاشت.
      const outcome = await settlePayment(
        { pool: deps.pool, gateway: deps.gateway },
        { by: "authority", authority: query.data.Authority },
        { callbackPayload: { Authority: query.data.Authority, Status: query.data.Status } },
      ).catch((error: unknown) => {
        if (error instanceof HttpError && error.code === "PAYMENT_NOT_FOUND") {
          return { kind: "notPaid" as const, code: null, message: "پرداخت یافت نشد." };
        }
        throw error;
      });

      // ★★ `alreadySettled` فقط وقتی «موفق» است که ردیف واقعاً `paid` باشد (یافته‌ی منتقدِ فاز ۶):
      //    پرداختی که باطل یا مسترد شده هم `alreadySettled` می‌دهد، و نگارشِ اول به کاربر صفحه‌ی
      //    «پرداخت موفق» نشان می‌داد — بدترین جای ممکن برای یک دروغِ دلگرم‌کننده.
      const status =
        outcome.kind === "activated" ||
        (outcome.kind === "alreadySettled" && outcome.status === "paid")
          ? "ok"
          : "failed";
      return reply.redirect(`${deps.webBaseUrl}/payment/result?status=${status}`);
    },
  );

  // ── verifyِ دستی (owner) — بازیابیِ پرداختِ گم‌شده ────────────────────
  app.post("/billing/payments/:paymentId/verify", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { paymentId } = req.params as { paymentId: string };
    assertUuid(paymentId, "شناسه‌ی پرداخت");

    const owner = await deps.pool.query<{ team_id: string }>(
      "SELECT team_id FROM payments WHERE id = $1",
      [paymentId],
    );
    const teamId = owner.rows[0]?.team_id;
    if (teamId === undefined) throw new HttpError(404, "PAYMENT_NOT_FOUND", "پرداخت یافت نشد.");
    await requireTeamRole(deps.pool, teamId, sub, "owner");

    // ★ همان مسیرِ callback، نه یک کپیِ دوم — وگرنه دو تعریف از «یک‌بار» پیدا می‌شود.
    const outcome = await settlePayment(
      { pool: deps.pool, gateway: deps.gateway },
      { by: "id", id: paymentId },
    );
    if (outcome.kind === "notPaid") {
      throw new HttpError(409, "PAYMENT_FAILED", outcome.message);
    }
    if (outcome.kind === "unknown") {
      throw new HttpError(502, "GATEWAY_UNAVAILABLE", outcome.message);
    }
    // ★★ همان اصلاحِ callback، این‌بار در برادرش (یافته‌ی بازبینیِ ۶٫۵): `alreadySettled` روی ردیفِ
    //    **باطل/مسترد** هم می‌آید، و `settled: true` گفتن به مالک همان دروغِ دلگرم‌کننده است — این‌بار
    //    در پاسخِ API، جایی که رابط رویش تصمیم می‌گیرد.
    if (outcome.kind === "alreadySettled" && outcome.status !== "paid") {
      throw new HttpError(
        409,
        "INVALID_TRANSITION",
        `این پرداخت در وضعیتِ «${outcome.status}» است و دیگر تسویه نمی‌شود.`,
      );
    }
    return { settled: true, subscriptionId: outcome.subscriptionId };
  });

  // ── اشتراکِ فعلی (admin) ─────────────────────────────────────────────
  app.get("/teams/:teamId/billing/subscription", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { teamId } = req.params as { teamId: string };
    assertUuid(teamId, "شناسه‌ی تیم");
    await requireTeamRole(deps.pool, teamId, sub, "admin");

    const { rows } = await deps.pool.query<SubscriptionRow>(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
        WHERE team_id = $1 AND status = ANY($2::text[])`,
      [teamId, [...LIVE_SUBSCRIPTION_STATUSES]],
    );
    // ⚠️ `null` یعنی «تیمِ رایگان»، نه خطا — هر تیمِ تازه دقیقاً همین است.
    return { subscription: rows[0] === undefined ? null : toSubscription(rows[0]) };
  });

  // ── فاکتورها (admin) ────────────────────────────────────────────────
  app.get("/teams/:teamId/billing/invoices", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { teamId } = req.params as { teamId: string };
    assertUuid(teamId, "شناسه‌ی تیم");
    await requireTeamRole(deps.pool, teamId, sub, "admin");

    const { rows } = await deps.pool.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE team_id = $1 ORDER BY issued_at DESC LIMIT 100`,
      [teamId],
    );
    return { invoices: rows.map(toInvoice) };
  });

  // ── لغو در پایانِ دوره (owner) ───────────────────────────────────────
  app.post("/teams/:teamId/billing/cancel", { preHandler: deps.requireAuth }, async (req) => {
    const sub = requireSub(req);
    const { teamId } = req.params as { teamId: string };
    assertUuid(teamId, "شناسه‌ی تیم");
    await requireTeamRole(deps.pool, teamId, sub, "owner");

    // ★ لغو **در پایانِ دوره**، نه بی‌درنگ: مشتری تا آخرِ چیزی که پولش را داده سرویس می‌گیرد.
    const { rows } = await deps.pool.query<SubscriptionRow>(
      `UPDATE subscriptions SET cancel_at_period_end = true, canceled_at = now(), updated_at = now()
        WHERE team_id = $1 AND status = ANY($2::text[])
        RETURNING ${SUBSCRIPTION_COLUMNS}`,
      [teamId, [...LIVE_SUBSCRIPTION_STATUSES]],
    );
    if (rows.length === 0) {
      throw new HttpError(404, "SUBSCRIPTION_NOT_FOUND", "اشتراکِ فعالی برای لغو وجود ندارد.");
    }
    return { subscription: toSubscription(rows[0]!) };
  });

  // ── صفحه‌ی ساختگیِ پرداخت (فقط توسعه) ────────────────────────────────
  //
  // ★ P3: `docker compose up && pnpm dev` باید کافی باشد. این صفحه جای درگاهِ واقعی را
  //   می‌گیرد تا کلِ جریان بدونِ اینترنت قابلِ اجرا باشد. در production ثبت **نمی‌شود**.
  if (deps.appEnv !== "production") {
    // ── ★★ کارت‌به‌کارت/شبا (ADR-070) ──────────────────────────────────
  //
  // ⊕ مسیر با **authority** کلید می‌خورد نه `paymentId`: همان توکنی است که `createPayment`
  //   ساخته و `redirectUrl` به آن اشاره می‌کند، و ۳۲ رقمِ تصادفیِ Web Crypto است.

  const transferRow = async (
    authority: string,
  ): Promise<{
    id: string;
    team_id: string;
    status: string;
    amount_rial: number;
    requested_at: Date;
    invoice_number: string | null;
    transfer_claimed_ref: string | null;
    transfer_claimed_at: Date | null;
    transfer_approved_at: Date | null;
  }> => {
    const settings = deps.transfer;
    if (settings === null) {
      // ★ ۴۰۹ و نه ۴۰۴: مسیر هست، ولی این نصب اصلاً کارت‌به‌کارت نمی‌گیرد. تفکیکش برای
      //   کسی که `.env` را عوض کرده و می‌خواهد بفهمد چرا، تفاوتِ ده دقیقه و ده ساعت است.
      throw new HttpError(409, "INVALID_TRANSITION", "این نصب پرداختِ کارت‌به‌کارت ندارد.");
    }
    const { rows } = await deps.pool.query<{
      id: string;
      team_id: string;
      status: string;
      amount_rial: number;
      requested_at: Date;
      invoice_number: string | null;
      transfer_claimed_ref: string | null;
      transfer_claimed_at: Date | null;
      transfer_approved_at: Date | null;
    }>(
      `SELECT p.id, p.team_id, p.status, p.amount_rial, p.requested_at,
              p.transfer_claimed_ref, p.transfer_claimed_at, p.transfer_approved_at,
              i.number AS invoice_number
         FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
        WHERE p.gateway = $1 AND p.authority = $2`,
      [CARD_TRANSFER_NAME, authority],
    );
    const row = rows[0];
    if (row === undefined) throw new HttpError(404, "PAYMENT_NOT_FOUND", "پرداخت یافت نشد.");
    return row;
  };

  const instructionsOf = (
    row: Awaited<ReturnType<typeof transferRow>>,
    settings: CardTransferSettings,
  ): TransferInstructions => {
    const deadline = new Date(row.requested_at.getTime() + settings.claimWindowMs);
    // ⚠️ ترتیب مهم است: «تاییدشده» بر همه مقدم، بعد «باطل‌شده»، بعد «اعلام‌شده». ردیفی که هم
    //    ادعا دارد هم باطل شده، باید «مهلت گذشت» ببیند — نه «منتظرِ بررسی»، که دروغ است.
    const state: TransferInstructions["state"] =
      row.status === "paid" || row.transfer_approved_at !== null
        ? "approved"
        : row.status !== "pending"
          ? "expired"
          : row.transfer_claimed_at !== null
            ? "claimed"
            : Date.now() >= deadline.getTime()
              ? "expired"
              : "awaiting";
    return {
      paymentId: row.id,
      invoiceNumber: row.invoice_number ?? "",
      amountRial: Number(row.amount_rial),
      destination: settings.destination,
      state,
      claimDeadline: deadline.toISOString(),
      claimedRef: row.transfer_claimed_ref,
      claimedAt: row.transfer_claimed_at?.toISOString() ?? null,
    };
  };

  app.get(
    `${TRANSFER_API_PATH}/:authority`,
    { preHandler: deps.requireAuth },
    async (req): Promise<TransferInstructions> => {
      const sub = requireSub(req);
      const { authority } = req.params as { authority: string };
      const row = await transferRow(authority);
      // ★ همان گیتِ نقشِ checkout: خریدار `owner` است، پس فقط او دستورِ واریز را می‌بیند.
      await requireTeamRole(deps.pool, row.team_id, sub, "owner");
      return instructionsOf(row, deps.transfer!);
    },
  );

  app.post(
    `${TRANSFER_API_PATH}/:authority/claim`,
    { preHandler: deps.requireAuth },
    async (req): Promise<TransferInstructions> => {
      const sub = requireSub(req);
      const { authority } = req.params as { authority: string };
      const body = parseBody(transferClaimRequest, req.body);
      const row = await transferRow(authority);
      await requireTeamRole(deps.pool, row.team_id, sub, "owner");

      await withTransaction(deps.pool, async (tx) => {
        await claimTransfer(tx, { paymentId: row.id, ref: body.ref, last4: body.last4 });
      });

      // ★ وضعیتِ **تازه** برگردانده می‌شود، نه `{ok:true}`: رابط بلافاصله «در انتظارِ بررسی»
      //   را نشان می‌دهد بدونِ یک رفت‌وبرگشتِ دوم.
      return instructionsOf(await transferRow(authority), deps.transfer!);
    },
  );

  app.get("/billing/mock/pay/:authority", async (req, reply) => {
      const { authority } = req.params as { authority: string };
      // ⚠️ `:authority` متنِ دلخواهِ کاربر است ⇒ باید escape شود، وگرنه XSSِ بازتابی روی
      //    سرورِ dev که کوکیِ نشستِ واقعی دارد.
      return reply.type("text/html; charset=utf-8").send(mockPayPage(authority, deps.callbackUrl));
    });
  }
}

/**
 * کلیدِ idempotencyِ پرداخت، **دامنه‌دار به تیم**.
 *
 * کلاینت `Idempotency-Key` می‌فرستد تا دو کلیکِ پیاپی یک ردیف بسازند. اگر نفرستاد، یک
 * UUIDِ تازه — یعنی بدترین حالت یک ردیفِ اضافیِ `pending` است، نه یک شارژِ دوباره.
 */
function idempotencyKeyFor(teamId: string, header: string | string[] | undefined): string {
  const raw = typeof header === "string" && header.length > 0 ? header : randomUUID();
  return `${teamId}:${raw}`.slice(0, 80); // ستون varchar(80)
}

/** صفحه‌ی HTMLِ کمینه‌ی درگاهِ ساختگی — RTL، بدونِ asset خارجی (P2). */
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

function mockPayPage(authority: string, callbackUrl: string): string {
  const ok = `${callbackUrl}?Authority=${encodeURIComponent(authority)}&Status=OK`;
  const nok = `${callbackUrl}?Authority=${encodeURIComponent(authority)}&Status=NOK`;
  const shown = escapeHtml(authority);
  return `<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8">
<title>درگاهِ ساختگیِ هم‌بوم</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9}
.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 8px #0001;text-align:center;max-width:24rem}
a{display:block;margin-block-start:.75rem;padding:.6rem;border-radius:8px;text-decoration:none}
.ok{background:#0a7d33;color:#fff}.no{background:#eee;color:#333}</style>
<div class="card"><h1>درگاهِ ساختگی</h1>
<p>این صفحه جای درگاهِ واقعی است تا توسعه به اینترنت نیاز نداشته باشد.</p>
<p><small>${shown}</small></p>
<a class="ok" href="${ok}">پرداختِ موفق</a>
<a class="no" href="${nok}">انصراف</a></div></html>`;
}
