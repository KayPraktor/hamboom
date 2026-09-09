import type { PaymentGateway } from "@hamboom/billing-core";
import type { FastifyInstance } from "fastify";
import type pg from "pg";

import type { ApiConfig } from "../config.ts";
import type { ReconcileRecorder } from "../metrics.ts";
import { runReconcile, type ReconcilePolicy } from "../services/reconcile.ts";
import { withAdvisoryLock } from "./leader-lock.ts";

/**
 * پلاگینِ بازه‌ایِ آشتی‌دهی — [ADR-051](../../../../ARCHITECTURE_DECISIONS.md#adr-051)
 * (M4 فاز ۷ گام ۷٫۴).
 *
 * ★★ **چرا این‌جا و نه `apps/worker`:** M4-D4 گفت workerِ جدا برای یک `setInterval` یک اپِ
 * کامل، Dockerfile، و مسیرِ استقرارِ تازه می‌خواهد — و کاری که می‌کند دقیقاً همان چیزی است
 * که اسکریپتِ `billing:reconcile` می‌کند. پس همان کد، این‌بار با یک تایمر.
 *
 * ★★ **از M5 گام ۶٫۱ انتخابِ رهبر دارد** ([ADR-060](../../../../ARCHITECTURE_DECISIONS.md#adr-060)):
 * پیش از هر sweep یک advisory lockِ Postgres گرفته می‌شود و نودی که نگیرد، آن نوبت را رد
 * می‌کند. پس `BILLING_RECONCILE_ENABLED` می‌تواند در production روشن باشد.
 *
 * ⚠️ **ولی آن قفل برای اتلاف است نه درستی.** حتی بدونش هم دو sweepِ هم‌زمان **ایمن**اند —
 * قفلِ ردیفِ [ADR-050](../../../../ARCHITECTURE_DECISIONS.md#adr-050) دو تسویه‌ی هم‌زمانِ یک
 * پرداخت را سریالی می‌کند و سنجه‌ی فاز ۷ همین را روی Postgresِ زنده اثبات می‌کند. قفلِ رهبر
 * فقط جلوی **سه برابر تماس با درگاه** را می‌گیرد.
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
      /**
       * ★★ **انتخابِ رهبر** — M5 گام ۶٫۱ ([ADR-060](../../../../ARCHITECTURE_DECISIONS.md#adr-060)).
       *
       * هر نود تایمرِ خودش را دارد؛ بدونِ این، سه نود یعنی سه sweepِ هم‌زمان و **سه برابر
       * تماس با درگاه**. ⚠️ ولی این قفل برای **اتلاف** است نه درستی — درستی از قفلِ ردیفِ
       * `payments` می‌آید و همان‌جا هم می‌مانَد.
       */
      const report = await withAdvisoryLock({ pool: deps.pool }, () =>
        runReconcile({ pool: deps.pool, gateway: deps.gateway }, policy),
      );
      if (report === null) {
        // ★ سطحِ `debug` عمدی است: در یک استقرارِ سه‌نودی، **هر نوبت** دو نود بازنده‌اند.
        //   `info` یعنی دو سومِ لاگِ آشتی‌دهی نویزِ «کار نکردم» باشد.
        app.log.debug("آشتی‌دهی: نودِ دیگری رهبر است — این نوبت رد شد.");
        return;
      }
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
      "★ چندنودی: هر نوبت فقط **یک** نود رهبر می‌شود (advisory lock، ADR-060).",
  );
}
