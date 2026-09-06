import { formatNumber, formatToman } from "@hamboom/i18n";
import type { Plan } from "@hamboom/shared-types";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { errorMessage } from "../api/error-message.ts";
import { useSession } from "../auth/session-context.ts";
import { usePlans } from "./billing-queries.ts";

/**
 * صفحه‌ی قیمت — **عمومی** (M4 فاز ۹ گام ۹٫۱).
 *
 * ⚠️ مسیرِ SPA عمداً `/pricing` است و نه `/billing/…`: در dev کلِ پیشوندِ `/billing` به api
 * پروکسی می‌شود و یک صفحه‌ی SPA با آن نام اصلاً به مرورگر نمی‌رسد.
 *
 * ★ **تومان در صفحه، ریال در فاکتور** (تصمیمِ مالک ۱۴۰۵/۰۶/۱۵). تبدیل فقط در
 * `formatToman` رخ می‌دهد؛ داده‌ی روی سیم و در دیتابیس همیشه ریالِ صحیح است (P5).
 *
 * ★★ **هیچ دکمه‌ی «به‌زودی» این‌جا نیست** (درسِ ۴ی M3): `GET /billing/plans` فقط پلنِ
 * `is_active` را می‌دهد، پس هرچه دیده می‌شود واقعاً خریدنی است.
 */
export function PricingPage() {
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const plans = usePlans();

  return (
    <div className="pricing">
      <header className="pricing__head">
        <h1>پلن‌ها و قیمت‌ها</h1>
        <p className="pricing__lede">
          قیمت‌ها به ازای <strong>هر عضو</strong> است. هر وقت خواستی می‌توانی لغو کنی؛ تا پایانِ
          دوره‌ای که پولش را داده‌ای سرویس برقرار است.
        </p>

        <div className="pricing__toggle" role="group" aria-label="دوره‌ی پرداخت">
          <button
            type="button"
            className={`btn btn--sm ${period === "monthly" ? "btn--primary" : "btn--ghost"}`}
            aria-pressed={period === "monthly"}
            onClick={() => {
              setPeriod("monthly");
            }}
          >
            ماهانه
          </button>
          <button
            type="button"
            className={`btn btn--sm ${period === "yearly" ? "btn--primary" : "btn--ghost"}`}
            aria-pressed={period === "yearly"}
            onClick={() => {
              setPeriod("yearly");
            }}
          >
            سالانه <span className="pricing__badge">دو ماه هدیه</span>
          </button>
        </div>
      </header>

      {plans.isPending && <div className="loader">در حال بارگذاری…</div>}
      {plans.isError && (
        <p className="field-error" role="alert">
          {errorMessage(plans.error)}
        </p>
      )}

      {plans.data && (
        <ul className="pricing__grid">
          {plans.data.map((plan) => (
            <li key={plan.code}>
              <PlanCard plan={plan} period={period} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `-1` یعنی نامحدود — همان سنتینلِ قرارداد (`planLimit`). هرگز به «۰» یا «خالی» ترجمه نشود. */
function limitText(value: number, unit: string): string {
  return value === -1 ? `${unit}ِ نامحدود` : `${formatNumber(value)} ${unit}`;
}

function storageText(bytes: number): string {
  if (bytes === -1) return "فضای نامحدود";
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1
    ? `${formatNumber(Math.round(gb * 10) / 10)} گیگابایت فضا`
    : `${formatNumber(Math.round(bytes / (1024 * 1024)))} مگابایت فضا`;
}

function PlanCard({ plan, period }: { plan: Plan; period: "monthly" | "yearly" }) {
  const { status, teams } = useSession();
  const navigate = useNavigate();
  const rial = period === "monthly" ? plan.priceMonthlyRial : plan.priceYearlyRial;
  const isFree = rial === 0;

  // ★ تیمی که کاربر در آن **owner** است، تنها جایی است که می‌تواند خرید کند (گیتِ سرور).
  const ownedTeam = teams.find((t) => t.myRole === "owner");

  return (
    <article className={`plan-card${isFree ? "" : " plan-card--paid"}`}>
      <h2>{plan.name}</h2>
      <p className="plan-card__price">
        {isFree ? (
          <span className="plan-card__amount">رایگان</span>
        ) : (
          <>
            <span className="plan-card__amount">{formatToman(rial)}</span>
            <span className="plan-card__per">/ {period === "monthly" ? "ماه" : "سال"} برای هر عضو</span>
          </>
        )}
      </p>
      <p className="plan-card__desc">{plan.description}</p>

      <ul className="plan-card__limits">
        <li>{limitText(plan.maxMembers, "عضو")}</li>
        <li>{limitText(plan.maxBoards, "بورد")}</li>
        <li>{storageText(plan.maxStorageBytes)}</li>
      </ul>

      {plan.features.length > 0 && (
        <ul className="plan-card__features">
          {plan.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {isFree ? (
        <p className="plan-card__note">همین حالا فعال است — کاری لازم نیست.</p>
      ) : status === "authenticated" && ownedTeam !== undefined ? (
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            // ★ خرید در صفحه‌ی billingِ تیم انجام می‌شود، نه این‌جا: آن‌جا تعدادِ عضو و
            //   اشتراکِ فعلی معلوم است، پس مبلغ برای کاربر قابلِ فهم می‌شود.
            void navigate({
              to: "/team/$teamId/billing",
              params: { teamId: ownedTeam.id },
              search: { plan: plan.code, period },
            });
          }}
        >
          ارتقا به {plan.name}
        </button>
      ) : status === "authenticated" ? (
        <p className="plan-card__note">
          فقط مالکِ تیم می‌تواند پلن را ارتقا دهد. از مالکِ تیمت بخواه.
        </p>
      ) : (
        <Link to="/login" className="btn btn--primary">
          برای ارتقا وارد شو
        </Link>
      )}
    </article>
  );
}
