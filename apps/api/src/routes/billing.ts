import { randomUUID } from "node:crypto";

import type { PaymentGateway } from "@hamboom/billing-core";
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
import { withTransaction } from "../plugins/db.ts";
import { assertUuid, checkoutBody, parseBody, zarinpalCallbackQuery } from "../schemas.ts";
import {
  createCheckout,
  LIVE_SUBSCRIPTION_STATUSES,
  settlePayment,
} from "../services/billing.ts";
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
}

export function registerBillingRoutes(app: FastifyInstance, deps: BillingRouteDeps): void {
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
    const draft = await withTransaction(deps.pool, async (tx) =>
      createCheckout(
        tx,
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
        },
        // ★★ کلیدِ یکتای **ماندگار** — ایندکسِ `payments_idem_uq`. برخلافِ میان‌افزارِ
        // حافظه‌ایِ `idempotency.ts`، این از ری‌استارت و نودِ دوم جان به در می‌بَرد (ADR-050).
        // ⚠️ **حتماً با `teamId` دامنه‌دار می‌شود:** آن ایندکس **سراسری** است، پس کلیدِ خامِ
        //    کلاینت می‌تواند با کلیدِ تیمِ دیگری تصادف کند و ردیفِ آن تیم را برگرداند.
        idempotencyKeyFor(teamId, req.headers["idempotency-key"]),
      ),
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
      await deps.pool.query(
        "UPDATE payments SET status = 'failed', failure_code = 'GATEWAY' WHERE id = $1",
        [draft.paymentId],
      );
      throw new HttpError(
        502,
        "GATEWAY_UNAVAILABLE",
        "ارتباط با درگاهِ پرداخت برقرار نشد. کمی بعد دوباره تلاش کن.",
        { cause: String((cause as Error).message) },
      );
    }

    await deps.pool.query("UPDATE payments SET authority = $2 WHERE id = $1", [
      draft.paymentId,
      created.authority,
    ]);

    return { paymentId: draft.paymentId, redirectUrl: created.redirectUrl };
  });

  // ── ★★ بازگشت از درگاه (عمومی) — قلبِ ADR-050 ────────────────────────
  //
  // ⚠️ اینجا **نه** هدرِ auth هست و **نه** کوکیِ refresh (که روی `path=/auth` است). پس
  //    میان‌افزارِ `Idempotency-Key` هم اجرا نمی‌شود (اثباتِ گام ۱٫۳). تنها حفاظ،
  //    `SELECT … FOR UPDATE` داخلِ `settlePayment` است.
  app.get(
    "/billing/zarinpal/callback",
    { config: { rateLimit: deps.callbackRateLimit } },
    async (req, reply) => {
      const query = zarinpalCallbackQuery.safeParse(req.query);
      if (!query.success) {
        return reply.redirect(`${deps.webBaseUrl}/billing/result?status=invalid`);
      }

      // ★ به `Status` **اعتماد نمی‌شود** (ADR-014 قاعده ۱). حتی روی `NOK` هم verifyِ
      //   سرور-به-سرور زده می‌شود: ممکن است پول capture شده باشد و مرورگر دروغ بگوید.
      const outcome = await settlePayment(
        { pool: deps.pool, gateway: deps.gateway },
        { by: "authority", authority: query.data.Authority },
      ).catch((error: unknown) => {
        if (error instanceof HttpError && error.code === "PAYMENT_NOT_FOUND") {
          return { kind: "notPaid" as const, code: null, message: "پرداخت یافت نشد." };
        }
        throw error;
      });

      const status =
        outcome.kind === "activated" || outcome.kind === "alreadySettled" ? "ok" : "failed";
      return reply.redirect(`${deps.webBaseUrl}/billing/result?status=${status}`);
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
    app.get("/billing/mock/pay/:authority", async (req, reply) => {
      const { authority } = req.params as { authority: string };
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
function mockPayPage(authority: string, callbackUrl: string): string {
  const ok = `${callbackUrl}?Authority=${encodeURIComponent(authority)}&Status=OK`;
  const nok = `${callbackUrl}?Authority=${encodeURIComponent(authority)}&Status=NOK`;
  return `<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8">
<title>درگاهِ ساختگیِ هم‌بوم</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9}
.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 8px #0001;text-align:center;max-width:24rem}
a{display:block;margin-block-start:.75rem;padding:.6rem;border-radius:8px;text-decoration:none}
.ok{background:#0a7d33;color:#fff}.no{background:#eee;color:#333}</style>
<div class="card"><h1>درگاهِ ساختگی</h1>
<p>این صفحه جای درگاهِ واقعی است تا توسعه به اینترنت نیاز نداشته باشد.</p>
<p><small>${authority}</small></p>
<a class="ok" href="${ok}">پرداختِ موفق</a>
<a class="no" href="${nok}">انصراف</a></div></html>`;
}
