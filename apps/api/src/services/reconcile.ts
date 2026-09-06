import {
  matchOrphans,
  planSweep,
  supportsUnverifiedList,
  type PaymentGateway,
  type PendingPaymentSnapshot,
  type SweepDecision,
} from "@hamboom/billing-core";
import type pg from "pg";

import { withTransaction, type Executor } from "../plugins/db.ts";
import { LIVE_SUBSCRIPTION_STATUSES, settlePayment } from "./billing.ts";

/**
 * اجرای آشتی‌دهی — [ADR-014](../../../../ARCHITECTURE_DECISIONS.md#adr-014) قاعده ۳،
 * [ADR-051](../../../../ARCHITECTURE_DECISIONS.md#adr-051)،
 * [ADR-056](../../../../ARCHITECTURE_DECISIONS.md#adr-056) (M4 فاز ۷).
 *
 * تصمیم در [`billing-core/reconcile.ts`](../../../../packages/billing-core/src/reconcile.ts)
 * است و **خالص**؛ این‌جا فقط I/O است. یک پیاده‌سازی، دو ورودی: `pnpm billing:reconcile`
 * (اپراتور) و پلاگینِ بازه‌ایِ `apps/api` (خودکار، پشتِ فلگ) — قرینه‌ی «`settlePayment`
 * تنها مسیرِ فعال‌سازی است».
 *
 * ★★ **فعال‌سازی این‌جا بازنویسی نمی‌شود.** هر ردیفی که باید تسویه شود از همان
 * `settlePayment` رد می‌شود؛ یک مسیرِ دومِ فعال‌سازی یعنی دو تعریفِ متفاوت از «یک‌بار» —
 * و آن‌وقت قفلِ ردیف دیگر چیزی را تضمین نمی‌کند.
 */

export interface ReconcilePolicy {
  /** زیرِ این سن به ردیف دست نمی‌زنیم. */
  staleAfterMs: number;
  /** بالای این سن **و بعد از دستِ‌کم یک پرسش** ردیف باطل می‌شود. */
  expireAfterMs: number;
  /** سقفِ ردیف در هر اجرا — یک sweep نباید ساعت‌ها طول بکشد. */
  batchSize: number;
  /** ★ فرزندخواندگیِ ردیفِ یتیم از فهرستِ `unVerified` (پیش‌فرض **خاموش**). */
  adoptOrphans: boolean;
  /** فقط تصمیم بگیر و چیزی ننویس. */
  dryRun: boolean;
}

export const DEFAULT_RECONCILE_POLICY: ReconcilePolicy = {
  // ⚠️ ۲۰ دقیقه یک **مشاهده** است نه عددی مستند: در گام ۱٫۱ یک authorityِ پرداخت‌نشده
  //    بعد از ~۲۰ دقیقه «منقضی» شد. تا وقتی زرین‌پال عددِ رسمی را ندهد، همین می‌مانَد.
  staleAfterMs: 20 * 60_000,
  expireAfterMs: 72 * 60 * 60_000,
  batchSize: 50,
  adoptOrphans: false,
  dryRun: false,
};

export interface ReconcileReport {
  scanned: number;
  skipped: number;
  /** پول گرفته شده بود و سرویس داده نشده بود ⇒ حالا فعال شد. **عددِ مهمِ این گزارش.** */
  activated: number;
  alreadySettled: number;
  /** درگاه گفت هنوز پرداخت نشده — ردیف `pending` می‌مانَد. */
  stillPending: number;
  /** درگاه جواب نداد ⇒ «نمی‌دانیم» ⇒ ردیف `pending` می‌مانَد. */
  unknown: number;
  expired: number;
  orphans: number;
  adopted: number;
  /** اشتراک‌هایی که دوره‌شان تمام شد و بسته شدند. */
  subscriptionsEnded: number;
  /** خطای هر ردیف — اجرا با یک ردیفِ خراب **متوقف نمی‌شود**. */
  errors: string[];
  decisions: SweepDecision[];
}

const emptyReport = (): ReconcileReport => ({
  scanned: 0,
  skipped: 0,
  activated: 0,
  alreadySettled: 0,
  stillPending: 0,
  unknown: 0,
  expired: 0,
  orphans: 0,
  adopted: 0,
  subscriptionsEnded: 0,
  errors: [],
  decisions: [],
});

export interface ReconcileDeps {
  pool: pg.Pool;
  gateway: PaymentGateway;
  /** تزریق‌پذیر برای سنجه؛ در runtime `new Date()`. */
  now?: () => Date;
}

/**
 * ★★ **گیتِ B-3 — اولین کاری که این اجرا می‌کند.**
 *
 * درایورِ `pg` بدونِ ثبتِ parser برای OIDِ ۲۰، `bigint` را **رشته** می‌دهد. آن‌وقت
 * `amount_rial` می‌شود «۱۹۹۰۰۰۰» و مقایسه‌ها الفبایی می‌شوند — بی‌صدا، چون `count(*)` و
 * ستون‌های `int4` سالم‌اند و کدِ اطراف درست به‌نظر می‌رسد (probeِ گام ۱٫۲).
 *
 * ⚠️ **دقتِ ادعا (اندازه‌گیری‌شده در سنجه‌ی فاز ۷):** `registerInt8Parser` روی
 * `pg.types`ِ **سراسری** می‌نشیند، نه روی استخر. پس این گیت خاصیتِ **پروسه** را می‌سنجد،
 * نه خاصیتِ استخر را: در پروسه‌ای که یک‌بار `createDbPool` صدا زده شده، حتی یک
 * `new pg.Pool`ِ خام هم عدد می‌دهد. خطرِ واقعیِ B-3 هم دقیقاً همین است — یک اسکریپت یا
 * workerِ **جدا** که هرگز `createDbPool` را صدا نمی‌زند. سنجه در یک پروسه‌ی فرزند اثباتش می‌کند.
 */
export async function assertBigintCoercion(db: Executor): Promise<void> {
  const { rows } = await db.query<{ probe: unknown }>("SELECT 1000::bigint AS probe");
  const seen = typeof rows[0]?.probe;
  if (seen !== "number") {
    throw new Error(
      `استخرِ دیتابیس bigint را عدد نمی‌کند (نوعِ دیده‌شده: ${seen}). ` +
        "آشتی‌دهی با اعدادِ رشته‌ای اجرا نمی‌شود — استخر باید با createDbPool ساخته شود، " +
        "نه new pg.Pool (B-3/P5).",
    );
  }
}

interface PendingRow {
  id: string;
  authority: string | null;
  amount_rial: number;
  requested_at: Date;
  failure_code: string | null;
}

const toSnapshot = (row: PendingRow): PendingPaymentSnapshot => ({
  id: row.id,
  authority: row.authority,
  amountRial: row.amount_rial,
  requestedAt: row.requested_at,
  failureCode: row.failure_code,
});

export async function runReconcile(
  deps: ReconcileDeps,
  policy: ReconcilePolicy = DEFAULT_RECONCILE_POLICY,
): Promise<ReconcileReport> {
  const report = emptyReport();
  const now = (deps.now ?? (() => new Date()))();

  await assertBigintCoercion(deps.pool);

  // ⚠️ **فیلترِ `gateway` اختیاری نیست.** ردیفِ `mock` را با درگاهِ زرین‌پال verify کردن یعنی
  //    پرسیدنِ یک authorityِ بیگانه از درگاهِ واقعی؛ و برعکس، mock به هر authority «پرداخت
  //    شد» می‌گوید. ایندکسِ `payments_pending_idx` هم روی همین مسیر می‌نشیند.
  const { rows } = await deps.pool.query<PendingRow>(
    `SELECT id, authority, amount_rial, requested_at, failure_code
       FROM payments
      WHERE status = 'pending' AND gateway = $1
      ORDER BY requested_at ASC
      LIMIT $2`,
    [deps.gateway.name, policy.batchSize],
  );
  report.scanned = rows.length;

  const snapshots = rows.map(toSnapshot);
  const decisions = planSweep(snapshots, {
    now,
    staleAfterMs: policy.staleAfterMs,
    expireAfterMs: policy.expireAfterMs,
  });
  report.decisions = decisions;

  const byId = new Map(snapshots.map((s) => [s.id, s]));
  const orphans: PendingPaymentSnapshot[] = [];

  for (const decision of decisions) {
    if (decision.action === "skip") {
      report.skipped += 1;
      continue;
    }
    if (decision.action === "orphan") {
      report.orphans += 1;
      orphans.push(byId.get(decision.paymentId)!);
      continue;
    }
    if (policy.dryRun) continue;

    try {
      if (decision.action === "expire") {
        if (await expireAbandonedPayment(deps.pool, decision.paymentId)) report.expired += 1;
      } else {
        tallySettle(report, await settleOne(deps, decision.paymentId));
      }
    } catch (error) {
      // ★ یک ردیفِ خراب کلِ اجرا را نمی‌کُشد — وگرنه هر ردیفِ بعدی هم گیر می‌افتد.
      //   ⚠️ فقط `message` ثبت می‌شود، نه شیءِ خطای pg: `err.detail` مقادیرِ ردیف را
      //   داخلِ خودش می‌آورد (یافته‌ی P7ِ فاز ۵٫۹).
      report.errors.push(`${decision.paymentId}: ${String((error as Error).message)}`);
    }
  }

  if (orphans.length > 0 && policy.adoptOrphans && !policy.dryRun) {
    await adoptOrphans(deps, orphans, report);
  }

  if (!policy.dryRun) {
    report.subscriptionsEnded = await endFinishedSubscriptions(deps.pool);
  }

  return report;
}

type SettleKind = "activated" | "alreadySettled" | "notPaid" | "unknown";

async function settleOne(deps: ReconcileDeps, paymentId: string): Promise<SettleKind> {
  const outcome = await settlePayment(
    { pool: deps.pool, gateway: deps.gateway },
    { by: "id", id: paymentId },
  );
  return outcome.kind;
}

function tallySettle(report: ReconcileReport, kind: SettleKind): void {
  if (kind === "activated") report.activated += 1;
  else if (kind === "alreadySettled") report.alreadySettled += 1;
  else if (kind === "notPaid") report.stillPending += 1;
  else report.unknown += 1;
}

/**
 * پرداختِ رهاشده را می‌بندد: ردیف `canceled` و فاکتور `void`.
 *
 * ⚠️ **چرا `voidFailedCheckout` را دوباره استفاده نمی‌کنیم:** آن تابع برای شکستِ **همان
 * لحظه‌ی** checkout است و دو `UPDATE`ِ جدا می‌زند. این‌جا ردیف ممکن است **همین حالا**
 * توسطِ callbackِ کاربر تسویه شود؛ پس اول قفل، بعد بازبینیِ وضعیت، و همه در یک تراکنش.
 * بدونِ آن، یک فاکتورِ **پرداخت‌شده** می‌توانست `void` شود.
 *
 * ★ وضعیت `canceled` است نه `failed`: کاربر پولی نداد و رها کرد — این شکستِ سیستم نیست.
 */
async function expireAbandonedPayment(pool: pg.Pool, paymentId: string): Promise<boolean> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<{ status: string; invoice_id: string | null }>(
      "SELECT status, invoice_id FROM payments WHERE id = $1 FOR UPDATE",
      [paymentId],
    );
    const payment = rows[0];
    if (payment === undefined || payment.status !== "pending") return false;

    await tx.query(
      `UPDATE payments SET status = 'canceled', failure_code = 'EXPIRED', verified_at = now()
        WHERE id = $1`,
      [paymentId],
    );
    if (payment.invoice_id !== null) {
      await tx.query("UPDATE invoices SET status = 'void' WHERE id = $1 AND status = 'open'", [
        payment.invoice_id,
      ]);
    }
    return true;
  });
}

/** ردیف‌های یتیم را با فهرستِ `unVerified`ِ درگاه تطبیق می‌دهد و تسویه می‌کند. */
async function adoptOrphans(
  deps: ReconcileDeps,
  orphans: PendingPaymentSnapshot[],
  report: ReconcileReport,
): Promise<void> {
  if (!supportsUnverifiedList(deps.gateway)) return;

  let unverified;
  try {
    unverified = await deps.gateway.listUnverified();
  } catch (error) {
    report.errors.push(`unVerified: ${String((error as Error).message)}`);
    return;
  }
  if (unverified.length === 0) return;

  // ★ **همه‌ی** authorityهای ثبت‌شده، نه فقط pendingها: authorityِ یک پرداختِ تسویه‌شده
  //   هرگز نباید دوباره فرزندخوانده شود.
  const known = await deps.pool.query<{ authority: string }>(
    "SELECT authority FROM payments WHERE gateway = $1 AND authority IS NOT NULL",
    [deps.gateway.name],
  );
  const knownAuthorities = new Set(known.rows.map((r) => r.authority));

  for (const decision of matchOrphans(orphans, unverified, knownAuthorities)) {
    if (decision.action === "refuse") continue;
    try {
      // ⚠️ شرطِ `authority IS NULL` نگهبانِ مسابقه است: اگر بینِ تصمیم و نوشتن، خودِ
      //    checkout بالاخره authority را نشانده باشد، این UPDATE هیچ ردیفی نمی‌گیرد.
      const updated = await deps.pool.query(
        "UPDATE payments SET authority = $2 WHERE id = $1 AND authority IS NULL",
        [decision.paymentId, decision.authority],
      );
      if (updated.rowCount === 0) continue;
      report.adopted += 1;
      tallySettle(report, await settleOne(deps, decision.paymentId));
    } catch (error) {
      report.errors.push(`${decision.paymentId} (adopt): ${String((error as Error).message)}`);
    }
  }
}

/**
 * ★★ **ارثیه‌ی سومِ فاز ۵٫۹: هیچ‌چیز اشتراکِ تمام‌شده را نمی‌بست.**
 *
 * `cancel_at_period_end` نوشته می‌شد و هیچ‌کس در پایانِ دوره نگاهش نمی‌کرد — یعنی مشتریِ
 * لغوکرده **برای همیشه** سرویس می‌گرفت، و مشتریِ تمدیدنکرده هم همین‌طور.
 *
 * ★ دو وضعیتِ متفاوت، چون دو چیزِ متفاوت‌اند: `canceled` یعنی مشتری خودش لغو کرد،
 * `expired` یعنی دوره تمام شد و تمدید نشد. تنها تفاوتِ کاربردیِ امروزِ
 * `cancel_at_period_end` همین است — تمدیدِ خودکار در M4 وجود ندارد (کارتی ذخیره نمی‌شود).
 */
async function endFinishedSubscriptions(pool: pg.Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE subscriptions
        SET status = CASE WHEN cancel_at_period_end THEN 'canceled' ELSE 'expired' END,
            updated_at = now()
      WHERE status = ANY($1::text[]) AND current_period_end <= now()`,
    [[...LIVE_SUBSCRIPTION_STATUSES]],
  );
  return rowCount ?? 0;
}
