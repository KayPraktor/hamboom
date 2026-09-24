import { formatJalaliShort, formatNumber, formatToman } from "@hamboom/i18n";
import type { AdminPlanUsage, AdminStats } from "@hamboom/shared-types";
import { useState } from "react";

import { errorMessage } from "../api/error-message.ts";
import { BarChart, type BarPoint } from "./BarChart.tsx";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";
import { useAdminStats } from "./panel-queries.ts";

/**
 * آمارِ محصول — M6 فاز ۷٫۲/۷٫۳ (M6-D8).
 *
 * ★ **همه‌ی فرمت‌کننده‌ها از [`@hamboom/i18n`](../../../../packages/i18n/) می‌آیند، نه محلی** (ADR-024).
 * ⚠️ این پنل تا امروز `fmtTime`ِ محلیِ خودش را داشت که منطقه‌ی زمانی را **پین نمی‌کرد**؛ آن‌ها
 * `Asia/Tehran` را پین می‌کنند، پس روی ماشینی با منطقه‌ی دیگر هم همان چیزی را نشان می‌دهند که
 * سرور سطل‌بندی کرده.
 *
 * ★ سطلِ سری‌ها از سرور **لحظه‌ی شروعِ روزِ تهران** می‌آید، پس این‌جا هیچ ریاضیِ منطقه‌ای نمی‌شود —
 * فقط `formatJalaliShort`.
 */

const WINDOWS = [7, 30, 90] as const;

const PLAN_COLUMNS: readonly PanelColumn<AdminPlanUsage & { key: string }>[] = [
  { key: "plan", header: "پلن", render: (r) => r.planName },
  { key: "code", header: "کد", render: (r) => r.planCode, ltr: true },
  {
    key: "period",
    header: "دوره",
    render: (r) => (r.period === null ? "—" : r.period === "monthly" ? "ماهانه" : "سالانه"),
  },
  { key: "teams", header: "تیم", render: (r) => formatNumber(r.teams) },
  {
    key: "seats",
    header: "صندلیِ فروخته‌شده",
    render: (r) => (r.seats === 0 ? "—" : formatNumber(r.seats)),
  },
];

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="hb-kpi">
      <p className="hb-kpi__label">{label}</p>
      <p className="hb-kpi__value">{value}</p>
      {hint === undefined ? null : <p className="hb-kpi__hint">{hint}</p>}
    </div>
  );
}

const toPoints = (
  series: readonly { date: string; count?: number; rial?: number }[],
  money: boolean,
): BarPoint[] =>
  series.map((p) => {
    const value = money ? (p.rial ?? 0) : (p.count ?? 0);
    const label = formatJalaliShort(new Date(p.date));
    return {
      key: p.date,
      label,
      value,
      title: `${label}: ${money ? formatToman(value) : formatNumber(value)}`,
    };
  });

function ActiveUsers({ users }: { users: AdminStats["users"] }) {
  // ★★ «هیچ ردیفی last_seen_at ندارد» ≠ «هیچ‌کس فعال نیست». تا پیش از ۷٫۱ دومی یک صفرِ
  //    راست‌گونما بود؛ حالا سرور با `activityTracked` این دو را از هم جدا می‌کند.
  if (!users.activityTracked) {
    return (
      <Kpi
        label="کاربرِ فعال"
        value="نامعلوم"
        hint="هنوز هیچ فعالیتی ثبت نشده — این عدد بعد از اولین ورود/تمدیدِ نشست معنا پیدا می‌کند."
      />
    );
  }
  return (
    <Kpi
      label="کاربرِ فعال"
      value={formatNumber(users.active7d)}
      hint={`۱ روزه ${formatNumber(users.active1d)} · ۳۰ روزه ${formatNumber(users.active30d)}`}
    />
  );
}

export function PanelStats() {
  const [days, setDays] = useState<number>(30);
  const q = useAdminStats(days);

  if (q.isPending) return <div className="loader">در حال بارگذاری…</div>;
  if (q.isError) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(q.error)}
      </p>
    );
  }

  const s = q.data;
  const windowLabel = `${formatNumber(s.windowDays)} روزِ اخیر`;

  return (
    <>
      <div className="dashboard__bar">
        <h1>آمار</h1>
        <div className="dashboard__actions">
          {WINDOWS.map((d) => (
            <button
              key={d}
              type="button"
              className={d === days ? "btn btn--sm" : "btn btn--ghost btn--sm"}
              aria-pressed={d === days}
              onClick={() => {
                setDays(d);
              }}
            >
              {formatNumber(d)} روز
            </button>
          ))}
        </div>
      </div>

      <section className="hb-kpis" aria-label="خلاصه">
        <Kpi
          label="کاربر"
          value={formatNumber(s.users.total)}
          hint={`${formatNumber(s.users.newInWindow)} تازه در ${windowLabel}`}
        />
        <ActiveUsers users={s.users} />
        <Kpi
          label="بورد"
          value={formatNumber(s.boards.live)}
          hint={`${formatNumber(s.boards.newInWindow)} تازه · ${formatNumber(s.boards.trashed)} در سطلِ بازیافت`}
        />
        <Kpi
          label="تیم"
          value={formatNumber(s.teams.total - s.teams.personal)}
          hint={`به‌علاوه‌ی ${formatNumber(s.teams.personal)} فضای شخصی`}
        />
        <Kpi
          label="درآمدِ خالص"
          value={formatToman(s.revenue.netRial)}
          hint={`ناخالص ${formatToman(s.revenue.grossRial)} · مسترد ${formatToman(s.revenue.refundedRial)}`}
        />
        <Kpi label={`درآمدِ ${windowLabel}`} value={formatToman(s.revenue.windowGrossRial)} />
      </section>

      <section className="card hb-chart-card" aria-labelledby="chart-boards">
        <h2 id="chart-boards">بوردِ ساخته‌شده در روز</h2>
        <BarChart
          points={toPoints(s.series.boards, false)}
          caption="بوردِ ساخته‌شده"
          formatValue={formatNumber}
        />
      </section>

      <section className="card hb-chart-card" aria-labelledby="chart-users">
        <h2 id="chart-users">کاربرِ تازه در روز</h2>
        <BarChart
          points={toPoints(s.series.users, false)}
          caption="کاربرِ تازه"
          formatValue={formatNumber}
        />
      </section>

      <section className="card hb-chart-card" aria-labelledby="chart-revenue">
        <h2 id="chart-revenue">درآمدِ روزانه</h2>
        <p className="field-hint">
          مبلغِ پرداخت‌های تسویه‌شده بر اساسِ روزِ پرداخت. استردادها این‌جا کم نمی‌شوند؛ عددِ خالص
          بالا آمده است.
        </p>
        <BarChart
          points={toPoints(s.series.revenue, true)}
          caption="درآمدِ روزانه"
          formatValue={formatToman}
        />
      </section>

      <PanelTable
        columns={PLAN_COLUMNS}
        rows={s.plans.map((p) => ({ ...p, key: `${p.planCode}:${p.period ?? "none"}` }))}
        rowKey={(r) => r.key}
        caption="تیم‌ها به تفکیکِ پلن"
        empty="هیچ تیمی نیست."
      />
      <p className="field-hint">
        تیمی که ردیفِ اشتراک ندارد بی‌پلن نیست: رایگان یا فضای شخصی شمرده می‌شود و دوره‌اش «—» است.
        «صندلیِ فروخته‌شده» شمارشِ عضو نیست، عددِ صورتحساب است.
      </p>
    </>
  );
}
