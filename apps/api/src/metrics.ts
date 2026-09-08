import { memoryUsage } from "node:process";

import type pg from "pg";

/**
 * ★★ متریک‌های `apps/api` — M5 گام ۵٫۲ ([ADR-061](../../../ARCHITECTURE_DECISIONS.md#adr-061)).
 *
 * ── چه چیزی منتشر می‌شود و چرا **همین‌ها** ──────────────────────────────────
 *
 * ADR-061 فهرستِ حداقلی را از چیزهایی ساخت که **قبلاً** ثابت شده بود مهم‌اند، نه از یک
 * فهرستِ عمومیِ «متریک‌های خوب»:
 *
 * - **شمارنده‌های آشتی‌دهی** — `activated > 0` یعنی «پولی گم شده بود و پیدا شد»، و این
 *   مهم‌ترین عددِ کلِ سیستم است. اگر مرتب بالا برود، یعنی callbackها به ما نمی‌رسند.
 * - **اشباعِ استخر** — [ADR-057](../../../ARCHITECTURE_DECISIONS.md#adr-057): تسویه تماسِ
 *   شبکه‌ایِ درگاه را **داخلِ** تراکنش نگه می‌دارد، پس یک درگاهِ کُند اتصال‌ها را می‌بلعد.
 *   `waiting > 0` یعنی درخواست‌ها پشتِ اتصال صف کشیده‌اند.
 * - **`pending`ِ کهنه** — پولِ در انتظار. عددش باید ~صفر بماند.
 *
 * ⚠️ **`stale pending` یک کوئریِ دیتابیس است، پس کش می‌شود.** یک `/metrics` که در هر
 * scrape به دیتابیس بزند، خودش به باری تبدیل می‌شود که قرار بود بسنجدش.
 */

/** آخرین گزارشِ آشتی‌دهی — پلاگین پرش می‌کند، `/metrics` می‌خواندش. */
export interface ReconcileSnapshot {
  runs: number;
  activated: number;
  expired: number;
  orphans: number;
  adopted: number;
  subscriptionsEnded: number;
  errors: number;
  /** زمانِ آخرین اجرا (ms). صفر یعنی هرگز اجرا نشده. */
  lastRunAt: number;
}

const EMPTY: ReconcileSnapshot = {
  runs: 0,
  activated: 0,
  expired: 0,
  orphans: 0,
  adopted: 0,
  subscriptionsEnded: 0,
  errors: 0,
  lastRunAt: 0,
};

/**
 * انباره‌ی تجمعیِ شمارنده‌های آشتی‌دهی.
 *
 * ★ عمداً **تجمعی** است (counter، نه gauge): یک gauge که فقط آخرین اجرا را نشان دهد،
 * بینِ دو scrape می‌تواند یک `activated` را کاملاً پنهان کند.
 */
export function createReconcileRecorder(now: () => number = Date.now) {
  let state: ReconcileSnapshot = { ...EMPTY };
  return {
    record(report: {
      activated: number;
      expired: number;
      orphans: number;
      adopted: number;
      subscriptionsEnded: number;
      errors: readonly unknown[];
    }): void {
      state = {
        runs: state.runs + 1,
        activated: state.activated + report.activated,
        expired: state.expired + report.expired,
        orphans: state.orphans + report.orphans,
        adopted: state.adopted + report.adopted,
        subscriptionsEnded: state.subscriptionsEnded + report.subscriptionsEnded,
        errors: state.errors + report.errors.length,
        lastRunAt: now(),
      };
    },
    snapshot: (): ReconcileSnapshot => state,
  };
}

export type ReconcileRecorder = ReturnType<typeof createReconcileRecorder>;

/**
 * شمارشِ **کش‌شده‌ی** پرداخت‌های `pending`ِ کهنه.
 *
 * ⚠️ اگر کوئری بشکند (دیتابیس قطع)، آخرین مقدارِ شناخته‌شده برمی‌گردد و خطا **بالا
 * نمی‌رود** — یک `/metrics`ی که با قطعیِ دیتابیس ۵۰۰ بدهد، دقیقاً در لحظه‌ای که بیشترین
 * نیاز به آن هست خاموش می‌شود.
 */
export function createStalePendingCounter(
  pool: Pick<pg.Pool, "query">,
  staleMinutes: number,
  ttlMs = 30_000,
  now: () => number = Date.now,
) {
  let value = 0;
  let at = 0;
  let inFlight = false;

  return {
    value: (): number => value,
    /** در پس‌زمینه تازه می‌کند؛ هرگز scrape را بلاک نمی‌کند. */
    refresh(): void {
      if (inFlight || now() - at < ttlMs) return;
      inFlight = true;
      void pool
        .query<{ n: string }>(
          "SELECT count(*)::text AS n FROM payments WHERE status = 'pending' AND requested_at < now() - ($1 || ' minutes')::interval",
          [String(staleMinutes)],
        )
        .then((res) => {
          value = Number(res.rows[0]?.n ?? 0);
          at = now();
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    },
  };
}

export type StalePendingCounter = ReturnType<typeof createStalePendingCounter>;

export interface ApiMetricsInput {
  /** ⚠️ `pg.Pool` این سه را بدونِ کوئری می‌دهد — رایگان و لحظه‌ای. */
  pool: { totalCount: number; idleCount: number; waitingCount: number };
  poolMax: number;
  reconcile: ReconcileSnapshot;
  stalePending: number;
}

function metric(name: string, help: string, type: "gauge" | "counter", value: number): string {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${String(value)}`].join("\n");
}

export function renderApiMetrics(input: ApiMetricsInput): string {
  const { pool, reconcile } = input;
  return (
    [
      metric("hamboom_api_pool_total", "اتصال‌های ساخته‌شده‌ی استخر", "gauge", pool.totalCount),
      metric("hamboom_api_pool_idle", "اتصال‌های بی‌کار", "gauge", pool.idleCount),
      metric(
        "hamboom_api_pool_waiting",
        "★★ درخواست‌های منتظرِ اتصال — بالای صفر یعنی صف (ADR-057)",
        "gauge",
        pool.waitingCount,
      ),
      metric("hamboom_api_pool_max", "سقفِ استخر (DATABASE_POOL_MAX)", "gauge", input.poolMax),
      metric(
        "hamboom_api_pool_saturation",
        "اتصال‌های استفاده‌شده ÷ سقف",
        "gauge",
        input.poolMax > 0 ? (pool.totalCount - pool.idleCount) / input.poolMax : 0,
      ),
      metric("hamboom_api_reconcile_runs_total", "اجراهای آشتی‌دهی", "counter", reconcile.runs),
      metric(
        "hamboom_api_reconcile_activated_total",
        "★★ پرداخت‌هایی که آشتی‌دهی نجاتشان داد — پولِ گم‌شده‌ی پیداشده",
        "counter",
        reconcile.activated,
      ),
      metric("hamboom_api_reconcile_expired_total", "ردیف‌های باطل‌شده", "counter", reconcile.expired),
      metric("hamboom_api_reconcile_orphans_total", "ردیف‌های یتیم", "counter", reconcile.orphans),
      metric("hamboom_api_reconcile_adopted_total", "یتیم‌های فرزندخوانده", "counter", reconcile.adopted),
      metric(
        "hamboom_api_reconcile_subscriptions_ended_total",
        "اشتراک‌های پایان‌یافته",
        "counter",
        reconcile.subscriptionsEnded,
      ),
      metric("hamboom_api_reconcile_errors_total", "خطاهای آشتی‌دهی", "counter", reconcile.errors),
      metric(
        "hamboom_api_reconcile_last_run_seconds",
        "زمانِ آخرین اجرای آشتی‌دهی (unix). صفر یعنی هرگز",
        "gauge",
        reconcile.lastRunAt === 0 ? 0 : Math.floor(reconcile.lastRunAt / 1000),
      ),
      metric(
        "hamboom_api_payments_stale_pending",
        "★★ پرداخت‌های pendingِ کهنه — پولِ در انتظار؛ باید ~صفر بماند",
        "gauge",
        input.stalePending,
      ),
      metric("hamboom_api_heap_used_bytes", "heapUsedِ فرایند", "gauge", memoryUsage().heapUsed),
    ].join("\n") + "\n"
  );
}
