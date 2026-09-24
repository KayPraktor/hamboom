import { formatJalaliDateTime, formatNumber, toPersianDigits } from "@hamboom/i18n";
import type { AdminFeatureFlag, SystemCheck, SystemCheckState } from "@hamboom/shared-types";

import { errorMessage } from "../api/error-message.ts";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";
import { useAdminFeatureFlags, useAdminSystem } from "./panel-queries.ts";

/**
 * وضعیتِ سیستم — M6 فاز ۷٫۴/۷٫۵ ([ADR-067](../../../../ARCHITECTURE_DECISIONS.md#adr-067)).
 *
 * ★★ این صفحه دقیقاً برای **دیدنیِ‌کردنِ نقاطِ کورِ `/readyz`** است (handoff §۱٫۵): امروز
 * Object Storageِ قطع و Redisِ قطع هر دو با ۲۰۰ی readyz رد می‌شوند، در حالی که اولی بوردِ
 * فشرده‌شده را باز نمی‌کند و دومی **نوشتنِ هیچ نودی** را ممکن نمی‌گذارد.
 *
 * ⚠️ «نمی‌دانم» رنگِ خودش را دارد و با «خراب» یکی نیست — Redisِ پیکربندی‌نشده روی یک ماشینِ dev
 * خرابی نیست و نباید مثلِ خرابی دیده شود.
 */

const STATE_FA: Record<SystemCheckState, string> = {
  ok: "سالم",
  warn: "هشدار",
  fail: "خراب",
  unknown: "نامعلوم",
};

const CHECK_FA: Record<string, string> = {
  db: "دیتابیس",
  "s3:assets": "انبارِ دارایی‌ها",
  "s3:snapshots": "انبارِ snapshotها",
  "s3:backups": "باکتِ پشتیبان",
  redis: "Redis",
  clock: "ساعت",
  backup: "سنِ پشتیبان",
  reconcile: "آشتی‌دهی",
};

function StateBadge({ state }: { state: SystemCheckState }) {
  return <span className={`hb-state hb-state--${state}`}>{STATE_FA[state]}</span>;
}

const CHECK_COLUMNS: readonly PanelColumn<SystemCheck>[] = [
  { key: "name", header: "چه", render: (c) => CHECK_FA[c.key] ?? c.key },
  { key: "state", header: "وضعیت", render: (c) => <StateBadge state={c.state} /> },
  // ★ P6: تبدیلِ رقم **فقط** در لایه‌ی نمایش. سرور عددها را لاتین می‌نویسد (و باید بنویسد —
  //   آن‌جا لایه‌ی نمایش نیست)، پس تبدیل این‌جا انجام می‌شود، نه آن‌جا.
  { key: "detail", header: "توضیح", render: (c) => toPersianDigits(c.detail) },
  {
    key: "latency",
    header: "زمانِ پاسخ",
    render: (c) => (c.latencyMs === null ? "—" : `${formatNumber(c.latencyMs)} میلی‌ثانیه`),
  },
];

const FLAG_COLUMNS: readonly PanelColumn<AdminFeatureFlag>[] = [
  { key: "key", header: "کلید", render: (f) => f.key, ltr: true },
  { key: "enabled", header: "روشن؟", render: (f) => (f.enabled ? "بله" : "خیر") },
  { key: "pct", header: "درصدِ انتشار", render: (f) => `${formatNumber(f.rolloutPct)}٪` },
  {
    key: "teams",
    header: "تیم‌های هدف",
    render: (f) => (f.teamIds.length === 0 ? "همه" : formatNumber(f.teamIds.length)),
  },
  { key: "at", header: "آخرین تغییر", render: (f) => formatJalaliDateTime(new Date(f.updatedAt)) },
];

export function PanelSystem() {
  const q = useAdminSystem();
  const flags = useAdminFeatureFlags();

  if (q.isPending) return <div className="loader">در حال بارگذاری…</div>;
  if (q.isError) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(q.error)}
      </p>
    );
  }

  const s = q.data;

  return (
    <>
      <div className="dashboard__bar">
        <h1>
          وضعیتِ سیستم <StateBadge state={s.state} />
        </h1>
        <div className="dashboard__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={q.isFetching}
            onClick={() => {
              void q.refetch();
            }}
          >
            {q.isFetching ? "در حال سنجش…" : "سنجشِ دوباره"}
          </button>
        </div>
      </div>

      <p className="field-hint" role="status">
        سنجیده‌شده در {formatJalaliDateTime(new Date(s.generatedAt))}. ⚠️ این صفحه هر بار واقعاً به
        دیتابیس، انبارها و Redis وصل می‌شود، پس خودکار تازه نمی‌شود.
      </p>

      <PanelTable
        columns={CHECK_COLUMNS}
        rows={[...s.checks]}
        rowKey={(c) => c.key}
        caption="چک‌های زنده"
      />

      <section className="card" aria-labelledby="backup-title">
        <h2 id="backup-title">پشتیبان</h2>
        <p className="field-hint">
          {s.backup.ageHours === null
            ? "هیچ پشتیبانی پیدا نشد."
            : `تازه‌ترین پشتیبان ${formatNumber(Math.round(s.backup.ageHours * 10) / 10)} ساعت پیش (آستانه‌ی کهنگی: ${formatNumber(s.backup.staleAfterHours)} ساعت).`}
        </p>
        <p className="field-hint">
          آخرین dumpِ دیتابیس:{" "}
          {s.backup.lastDumpAt === null ? "—" : formatJalaliDateTime(new Date(s.backup.lastDumpAt))}{" "}
          · آخرین آینه‌ی انبار:{" "}
          {s.backup.lastMirrorAt === null
            ? "—"
            : formatJalaliDateTime(new Date(s.backup.lastMirrorAt))}
        </p>
      </section>

      <section className="card" aria-labelledby="reconcile-title">
        <h2 id="reconcile-title">آشتی‌دهی</h2>
        <p className="field-hint">
          {s.reconcile.enabled
            ? `فعال، هر ${formatNumber(s.reconcile.intervalSeconds)} ثانیه.`
            : "خاموش است (BILLING_RECONCILE_ENABLED=false) — روی یک ماشینِ توسعه طبیعی است."}
        </p>
        <p className="field-hint">
          آخرین اجرای تایمر:{" "}
          {s.reconcile.lastRunAt === null
            ? "هرگز"
            : formatJalaliDateTime(new Date(s.reconcile.lastRunAt))}{" "}
          · {formatNumber(s.reconcile.runs)} اجرا · {formatNumber(s.reconcile.activated)} فعال‌سازی
          · {formatNumber(s.reconcile.expired)} ابطال · {formatNumber(s.reconcile.errors)} خطا
        </p>
        <p className="field-hint">
          ⚠️ این شمارنده‌ها فقط مسیرِ <strong>تایمر</strong> را می‌شمارند؛ sweepِ دستی از صفحه‌ی
          پرداخت‌ها به آن‌ها دست نمی‌زند.
        </p>
      </section>

      <section className="card" aria-labelledby="clock-title">
        <h2 id="clock-title">ساعت</h2>
        <p className="field-hint">
          {s.clockSkewMs === null
            ? "دیتابیس پاسخ نداد، پس اختلافِ ساعت سنجیده نشد."
            : `ساعتِ دیتابیس حدودِ ${formatNumber(s.clockSkewMs)} میلی‌ثانیه با ساعتِ سرورِ api اختلاف دارد.`}
        </p>
        <p className="field-hint">
          ⚠️ این عدد <strong>تخمین</strong> است: خطایش تا حدودِ نصفِ زمانِ پاسخِ دیتابیس است، پس چند
          ده میلی‌ثانیه اختلاف معنی‌دار نیست. اگر بزرگ شود، تاییدِ دوباره (step-up) می‌تواند
          بی‌پایان ۴۲۸ بدهد — مهرِ تایید را دیتابیس می‌زند و تازگی‌اش را api می‌سنجد.
        </p>
      </section>

      <h2>پرچم‌های قابلیت</h2>
      {flags.isError ? (
        <p className="field-error" role="alert">
          {errorMessage(flags.error)}
        </p>
      ) : (
        <PanelTable
          columns={FLAG_COLUMNS}
          rows={flags.data?.items ?? []}
          rowKey={(f) => f.key}
          caption="feature_flags (فقط‌خواندنی)"
          empty="هیچ پرچمی تعریف نشده — امروز هیچ قابلیتی پشتِ پرچم نیست."
        />
      )}
    </>
  );
}
