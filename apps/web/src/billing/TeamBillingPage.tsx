import { formatJalaliDate, formatNumber, formatRial, formatToman } from "@hamboom/i18n";
import type { Invoice, Plan, Team } from "@hamboom/shared-types";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { errorMessage } from "../api/error-message.ts";
import { useTeam } from "../team/team-queries.ts";
import {
  useCancelSubscription,
  useCheckout,
  useInvoices,
  usePlans,
  useSubscription,
} from "./billing-queries.ts";

/**
 * صفحه‌ی پرداختِ تیم — اشتراکِ فعلی، سنجه‌ی مصرف، خرید/ارتقا، و فهرستِ فاکتور
 * (M4 فاز ۹ گام ۹٫۳).
 *
 * ★ **اولین مصرف‌کننده‌ی واقعیِ `formatRial`/`formatToman`/`formatJalaliDate`** — تا امروز
 * هر سه صفر call site داشتند.
 *
 * ★ تصمیمِ مالک: **تومان در جای بازاریابی (قیمتِ پلن)، ریال در فاکتور.** فاکتور سندِ مالی
 * است و باید با چیزی که در دیتابیس و درگاه رفته یکی باشد (P5).
 */
export function TeamBillingPage() {
  const { teamId } = useParams({ from: "/team/$teamId/billing" });
  const search = useSearch({ from: "/team/$teamId/billing" });
  const team = useTeam(teamId);
  const subscription = useSubscription(teamId);
  const invoices = useInvoices(teamId);
  const plans = usePlans();

  if (team.isPending) return <div className="loader">در حال بارگذاری…</div>;
  if (team.isError) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(team.error)}
      </p>
    );
  }

  const isOwner = team.data.myRole === "owner";

  return (
    <div className="billing-page">
      <div className="dashboard__bar">
        <div>
          <Link to="/team/$teamId" params={{ teamId }} className="back-link">
            ← {team.data.name}
          </Link>
          <h1>پرداخت و اشتراک</h1>
        </div>
        <Link to="/pricing" className="btn btn--ghost btn--sm">
          مقایسه‌ی پلن‌ها
        </Link>
      </div>

      <section className="billing-section">
        <h2>پلنِ فعلی</h2>
        {subscription.isError ? (
          <p className="field-error" role="alert">
            {errorMessage(subscription.error)}
          </p>
        ) : subscription.isPending ? (
          <div className="loader">در حال بارگذاری…</div>
        ) : subscription.data === null ? (
          <p className="billing-current">
            پلنِ <strong>{team.data.planCode === "personal" ? "شخصی" : "رایگان"}</strong> — بدونِ
            اشتراکِ پولی.
          </p>
        ) : (
          <div className="billing-current">
            <p>
              پلنِ <strong>{subscription.data.planCode}</strong> ·{" "}
              {subscription.data.period === "monthly" ? "ماهانه" : "سالانه"} ·{" "}
              {formatNumber(subscription.data.seats)} صندلی
            </p>
            <p className="billing-current__period">
              تا <strong>{formatJalaliDate(new Date(subscription.data.currentPeriodEnd))}</strong>
              {subscription.data.cancelAtPeriodEnd && (
                <span className="billing-current__canceling">
                  {" "}
                  — لغو شده؛ در پایانِ همین دوره بسته می‌شود.
                </span>
              )}
            </p>
            {isOwner && !subscription.data.cancelAtPeriodEnd && <CancelButton teamId={teamId} />}
          </div>
        )}
      </section>

      <UsageSection team={team.data} />

      {isOwner && plans.data && (
        <BuySection
          teamId={teamId}
          plans={plans.data}
          memberCount={team.data.memberCount}
          preselect={search.plan}
          preselectPeriod={search.period}
        />
      )}
      {!isOwner && (
        <p className="billing-note">
          فقط مالکِ تیم می‌تواند پلن را تغییر دهد. (این فقط پیامِ رابط است — گیتِ واقعی سرور است.)
        </p>
      )}

      <section className="billing-section">
        <h2>فاکتورها</h2>
        {invoices.isPending ? (
          <div className="loader">در حال بارگذاری…</div>
        ) : invoices.isError ? (
          <p className="field-error" role="alert">
            {errorMessage(invoices.error)}
          </p>
        ) : invoices.data.length === 0 ? (
          <p className="billing-note">هنوز فاکتوری صادر نشده.</p>
        ) : (
          <InvoiceTable invoices={invoices.data} />
        )}
      </section>
    </div>
  );
}

function CancelButton({ teamId }: { teamId: string }) {
  const cancel = useCancelSubscription(teamId);
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={cancel.isPending}
        onClick={() => {
          cancel.mutate();
        }}
      >
        {cancel.isPending ? "در حال لغو…" : "لغو در پایانِ دوره"}
      </button>
      {cancel.isError && (
        <p className="field-error" role="alert">
          {errorMessage(cancel.error)}
        </p>
      )}
    </>
  );
}

/** سنجه‌ی مصرف — ⚠️ `-1` یعنی نامحدود و **نباید** به نوار تبدیل شود. */
function UsageSection({ team }: { team: Team }) {
  return (
    <section className="billing-section">
      <h2>مصرف</h2>
      <ul className="usage-list">
        <UsageRow label="اعضا" used={team.usage.members} limit={team.limits.maxMembers} />
        <UsageRow label="بوردها" used={team.usage.boards} limit={team.limits.maxBoards} />
        <UsageRow
          label="فضا"
          used={team.usage.storageBytes}
          limit={team.limits.maxStorageBytes}
          format={(n) => `${formatNumber(Math.round((n / (1024 * 1024)) * 10) / 10)} مگابایت`}
        />
      </ul>
    </section>
  );
}

function UsageRow({
  label,
  used,
  limit,
  format = formatNumber,
}: {
  label: string;
  used: number;
  limit: number;
  format?: (n: number) => string;
}) {
  const unlimited = limit === -1;
  // ★ کسر فقط وقتی معنا دارد که سقفی باشد. `used / -1` یک نوارِ منفی می‌داد.
  const ratio = unlimited ? 0 : Math.min(1, limit === 0 ? 1 : used / limit);
  const full = !unlimited && used >= limit;

  return (
    <li className="usage-row">
      <div className="usage-row__head">
        <span>{label}</span>
        <span className={full ? "usage-row__value usage-row__value--full" : "usage-row__value"}>
          {format(used)}
          {unlimited ? " از نامحدود" : ` از ${format(limit)}`}
        </span>
      </div>
      {!unlimited && (
        <div className="usage-bar" role="presentation">
          <div className="usage-bar__fill" style={{ inlineSize: `${String(ratio * 100)}%` }} />
        </div>
      )}
    </li>
  );
}

function BuySection({
  teamId,
  plans,
  memberCount,
  preselect,
  preselectPeriod,
}: {
  teamId: string;
  plans: Plan[];
  memberCount: number;
  preselect?: string;
  preselectPeriod?: "monthly" | "yearly";
}) {
  const paid = plans.filter((p) => p.priceMonthlyRial > 0);
  const [planCode, setPlanCode] = useState(preselect ?? paid[0]?.code ?? "");
  const [period, setPeriod] = useState<"monthly" | "yearly">(preselectPeriod ?? "monthly");
  // ★ صندلی پیش‌فرض = تعدادِ عضوِ فعلی. کمتر خریدن یعنی همان روزِ اول به سقف خوردن.
  const [seats, setSeats] = useState(Math.max(1, memberCount));
  const checkout = useCheckout(teamId);

  const plan = paid.find((p) => p.code === planCode);
  if (paid.length === 0 || plan === undefined) return null;

  const unit = period === "monthly" ? plan.priceMonthlyRial : plan.priceYearlyRial;

  return (
    <section className="billing-section">
      <h2>ارتقا</h2>
      <div className="buy-form">
        <label className="field">
          <span>پلن</span>
          <select
            className="input"
            value={planCode}
            onChange={(e) => {
              setPlanCode(e.target.value);
            }}
          >
            {paid.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>دوره</span>
          <select
            className="input"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value === "yearly" ? "yearly" : "monthly");
            }}
          >
            <option value="monthly">ماهانه</option>
            <option value="yearly">سالانه (دو ماه هدیه)</option>
          </select>
        </label>

        <label className="field">
          <span>تعدادِ صندلی</span>
          <input
            className="input"
            type="number"
            min={1}
            max={1000}
            value={seats}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSeats(Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.trunc(n))) : 1);
            }}
          />
        </label>
      </div>

      {/* ⚠️ این عدد فقط **پیش‌نمایش** است. مبلغِ واقعی را سرور می‌سازد (ADR-014) و اگر
          روزی این حساب با آن فرق کند، **سرور درست است**. */}
      <p className="buy-total">
        حدودِ پرداخت: <strong>{formatToman(unit * seats)}</strong>{" "}
        <span className="billing-note">(مبلغِ نهایی را سرور محاسبه می‌کند)</span>
      </p>

      <button
        type="button"
        className="btn btn--primary"
        disabled={checkout.isPending}
        onClick={() => {
          // ★★ کلید **یک‌بار به‌ازای همین ژست** ساخته می‌شود: دو کلیکِ پیاپی همان فاکتور را
          //    می‌گیرند، نه دو فاکتور و دو شماره‌ی رسمی.
          const idempotencyKey = crypto.randomUUID();
          checkout.mutate(
            { planCode, period, seats, idempotencyKey },
            {
              onSuccess: (result) => {
                // ★ ناوبریِ **کاملِ مرورگر** به بیرون — نه روترِ SPA.
                window.location.assign(result.redirectUrl);
              },
            },
          );
        }}
      >
        {checkout.isPending ? "در حال انتقال به درگاه…" : "پرداخت و فعال‌سازی"}
      </button>
      {checkout.isError && (
        <p className="field-error" role="alert">
          {errorMessage(checkout.error)}
        </p>
      )}
    </section>
  );
}

function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  const STATUS_FA: Record<string, string> = {
    draft: "پیش‌نویس",
    open: "در انتظار پرداخت",
    paid: "پرداخت‌شده",
    void: "باطل",
    refunded: "بازگشت‌داده‌شده",
  };
  return (
    <table className="invoice-table">
      <thead>
        <tr>
          <th>شماره</th>
          <th>تاریخ</th>
          <th>مبلغ</th>
          <th>وضعیت</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((inv) => (
          <tr key={inv.id}>
            <td className="invoice-table__number">{inv.number}</td>
            <td>{formatJalaliDate(new Date(inv.issuedAt))}</td>
            {/* ★ فاکتور **ریال** است — سندِ مالی با همان واحدی که به درگاه رفت. */}
            <td>{formatRial(inv.totalRial)}</td>
            <td>{STATUS_FA[inv.status] ?? inv.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
