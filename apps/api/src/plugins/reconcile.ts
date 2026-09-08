import type { PaymentGateway } from "@hamboom/billing-core";
import type { FastifyInstance } from "fastify";
import type pg from "pg";

import type { ApiConfig } from "../config.ts";
import type { ReconcileRecorder } from "../metrics.ts";
import { runReconcile, type ReconcilePolicy } from "../services/reconcile.ts";

/**
 * پلاگینِ بازه‌ایِ آشتی‌دهی — [ADR-051](../../../../ARCHITECTURE_DECISIONS.md#adr-051)
 * (M4 فاز ۷ گام ۷٫۴).
 *
 * ★★ **چرا این‌جا و نه `apps/worker`:** M4-D4 گفت workerِ جدا برای یک `setInterval` یک اپِ
 * کامل، Dockerfile، و مسیرِ استقرارِ تازه می‌خواهد — و کاری که می‌کند دقیقاً همان چیزی است
 * که اسکریپتِ `billing:reconcile` می‌کند. پس همان کد، این‌بار با یک تایمر.
 *
 * ⚠️ **پیش‌فرض خاموش است.** در استقرارِ چندنودی هر نود تایمرِ خودش را دارد و سه نود یعنی
 * سه sweepِ هم‌زمان. **ایمن است** — قفلِ ردیفِ ADR-050 دو تسویه‌ی هم‌زمانِ یک پرداخت را
 * سریالی می‌کند و سنجه‌ی فاز ۷ همین را روی Postgresِ زنده اثبات می‌کند — ولی اتلاف است و
 * سه برابر به درگاه تماس می‌زند. **انتخابِ رهبر کارِ M5 است**، و تا آن‌وقت راهِ درست
 * `pnpm billing:reconcile` از یک cronِ بیرونی است.
 */

export interface ReconcileJobDeps {
  pool: pg.Pool;
  gateway: PaymentGateway;
  config: ApiConfig;
  /** ★ اختیاری — بدونش پلاگین دقیقاً مثلِ قبل کار می‌کند (M5 گام ۵٫۲). */
  recorder?: ReconcileRecorder;
}

/** سیاستِ اجرا از config — تنها جایی که این متغیرها خوانده می‌شوند. */
export function reconcilePolicyFrom(config: ApiConfig): ReconcilePolicy {
  return {
    staleAfterMs: config.BILLING_PENDING_STALE_MINUTES * 60_000,
    expireAfterMs: config.BILLING_PENDING_EXPIRE_HOURS * 3_600_000,
    batchSize: config.BILLING_RECONCILE_BATCH,
    adoptOrphans: config.BILLING_ADOPT_ORPHANS,
    dryRun: false,
  };
}

export function registerReconcileJob(app: FastifyInstance, deps: ReconcileJobDeps): void {
  const { config } = deps;
  if (!config.BILLING_RECONCILE_ENABLED) {
    // ★ سکوت نه: خاموش‌بودن باید در لاگِ بوت **دیده** شود، وگرنه کسی فرض می‌کند روشن است
    //   و پرداختِ گم‌شده ماه‌ها منتظر می‌مانَد.
    app.log.info(
      "آشتی‌دهیِ خودکار خاموش است (BILLING_RECONCILE_ENABLED=false). " +
        "اجرای دستی: pnpm billing:reconcile",
    );
    return;
  }

  const policy = reconcilePolicyFrom(config);
  const intervalMs = config.BILLING_RECONCILE_INTERVAL_SECONDS * 1000;

  // ⚠️ اجرای هم‌پوشان ممنوع: اگر یک sweep از بازه‌اش کندتر شود (درگاهِ کُند × ۵۰ ردیف)،
  //    تایمر اجراهای تازه روی هم می‌ریزد و اتصال‌های استخر تمام می‌شود.
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) {
      app.log.warn("آشتی‌دهیِ قبلی هنوز تمام نشده — این نوبت رد شد.");
      return;
    }
    running = true;
    try {
      const report = await runReconcile({ pool: deps.pool, gateway: deps.gateway }, policy);
      // ★ پیش از هر شاخه‌ی لاگ ضبط می‌شود: یک اجرای «بدونِ تغییر» هم باید در
      //   `runs_total` دیده شود، وگرنه «آشتی‌دهی اصلاً اجرا شده؟» جواب ندارد.
      deps.recorder?.record(report);
      if (report.activated > 0 || report.expired > 0 || report.subscriptionsEnded > 0) {
        app.log.info(
          {
            activated: report.activated,
            expired: report.expired,
            orphans: report.orphans,
            adopted: report.adopted,
            subscriptionsEnded: report.subscriptionsEnded,
          },
          "آشتی‌دهی چیزی را تغییر داد",
        );
      } else {
        app.log.debug({ scanned: report.scanned, skipped: report.skipped }, "آشتی‌دهی — بدونِ تغییر");
      }
      for (const error of report.errors) app.log.error({ reconcile: error }, "خطای آشتی‌دهی");
    } catch (error) {
      // ★ هر خطایی این‌جا **بلعیده** می‌شود: یک درگاهِ خراب یا یک دیتابیسِ لحظه‌ای قطع
      //   نباید سرورِ api را بیندازد. نوبتِ بعد دوباره تلاش می‌شود.
      app.log.error({ err: error }, "آشتی‌دهی اجرا نشد");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  // ⚠️ `unref` یعنی این تایمر مانعِ خروجِ پروسه نمی‌شود — بدونش `SIGTERM` منتظرِ تایمر
  //    می‌مانَد و خاموشیِ مودبانه به کشتنِ اجباری تبدیل می‌شود (درسِ سنجه‌ی rt:shutdownِ M2).
  timer.unref();
  app.addHook("onClose", () => {
    clearInterval(timer);
  });

  app.log.info(
    `آشتی‌دهیِ خودکار روشن است — هر ${config.BILLING_RECONCILE_INTERVAL_SECONDS} ثانیه ` +
      `(کهنگی ${config.BILLING_PENDING_STALE_MINUTES} دقیقه، انقضا ${config.BILLING_PENDING_EXPIRE_HOURS} ساعت). ` +
      "⚠️ چندنودی: هر نود نسخه‌ی خودش را اجرا می‌کند (انتخابِ رهبر = M5).",
  );
}
