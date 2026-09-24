import { errorMessage } from "../api/error-message.ts";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";
import { useAdminMe } from "./panel-queries.ts";
import { StepUpForm } from "./StepUpForm.tsx";

/**
 * خانه‌ی پنل — M6 فاز ۳: «کیستم» + step-up ([ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066) §۳).
 *
 * step-up همان OTPِ ورود است با هدفِ جدا: کد به شماره‌ی **خودِ** staff می‌رود (سرور شماره را از
 * ردیفِ او می‌خوانَد، نه از این فرم) و موفقیت `stepUpVerifiedAt` را تازه می‌کند. عمل‌های مخرب
 * (تعلیق از فاز ۵، استرداد در فاز ۶) بدونِ step-upِ تازه ۴۲۸ می‌گیرند و همان فرم را **در جا** نشان می‌دهند.
 *
 * ⚠️ «تازه بودن» را **سرور** تصمیم می‌گیرد (`ADMIN_STEP_UP_SECONDS`)؛ این صفحه فقط زمانِ آخرین
 * تایید را نشان می‌دهد و ادعای «هنوز معتبر است» نمی‌کند — عددِ پنجره به کلاینت نمی‌رسد.
 */

interface InfoRow {
  key: string;
  label: string;
  value: string;
  ltr?: boolean;
}

const INFO_COLUMNS: readonly PanelColumn<InfoRow>[] = [
  { key: "label", header: "چه", render: (r) => r.label },
  {
    key: "value",
    header: "مقدار",
    render: (r) => (r.ltr === true ? <span className="panel-table__ltr">{r.value}</span> : r.value),
  },
];

const fmtTime = (iso: string): string =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

export function PanelHome() {
  const me = useAdminMe();

  if (me.isPending) return <div className="loader">در حال بارگذاری…</div>;
  if (me.isError) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(me.error)}
      </p>
    );
  }

  const rows: InfoRow[] = [
    { key: "id", label: "شناسه‌ی staff", value: me.data.userId, ltr: true },
    {
      key: "stepup",
      label: "آخرین step-up",
      value: me.data.stepUpVerifiedAt === null ? "هرگز" : fmtTime(me.data.stepUpVerifiedAt),
    },
  ];

  return (
    <>
      <div className="dashboard__bar">
        <h1>پنلِ ادمین</h1>
      </div>
      <PanelTable
        columns={INFO_COLUMNS}
        rows={rows}
        rowKey={(r) => r.key}
        caption="وضعیتِ دسترسی"
      />

      <section className="card panel-stepup" aria-labelledby="stepup-title">
        <h2 id="stepup-title">تاییدِ دوباره (step-up)</h2>
        <p className="field-hint">
          عمل‌های مخرب (تعلیق، استرداد) یک کدِ پیامکیِ تازه می‌خواهند. کد به شماره‌ی خودِ شما
          فرستاده می‌شود.
        </p>
        <StepUpForm />
      </section>
    </>
  );
}
