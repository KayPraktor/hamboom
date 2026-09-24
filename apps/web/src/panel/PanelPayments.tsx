import type { AdminPaymentQuery, AdminPaymentSummary, PaymentStatus } from "@hamboom/shared-types";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { errorMessage } from "../api/error-message.ts";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";
import { useAdminPayments, useReconcile } from "./panel-queries.ts";
import { PAYMENT_STATUS_FA, toman } from "./payment-fa.ts";
import { StepUpForm } from "./StepUpForm.tsx";
import { isStepUpRequired } from "./step-up.ts";

/**
 * پرداخت‌ها — `/panel/payments` (M6 فاز ۶، [ADR-068](../../../../ARCHITECTURE_DECISIONS.md#adr-068)).
 *
 * ★ **دو کارِ متفاوت در یک صفحه، عمداً:** پیداکردنِ پرداختِ یک مشتری (فیلترها) و اجرای دستیِ
 * آشتی‌دهی. دومی همان کدِ تایمرِ خودکار است، فقط با دستِ آدم — و ردیفِ ممیزیِ خودش را می‌گیرد.
 *
 * ★ صفحه‌بندی keyset است (همان الگوی `/panel/audit`): «بیشتر» صفحه‌ی بعد را می‌چسبانَد و
 * `nextCursor === null` یعنی پایان. فیلترها بخشی از کلیدِ کوئری‌اند.
 *
 * ⚠️ شماره‌ی پیگیری (`refId`) تطبیقِ **دقیق** است و authority **پیشوندی** — چون اپراتور اولی را کامل از
 * رسیدِ مشتری دارد و دومی را معمولاً ناقص از لاگ.
 */

const fmtTime = (iso: string | null): string =>
  iso === null
    ? "—"
    : new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(
        new Date(iso),
      );

const STATUSES: readonly PaymentStatus[] = [
  "pending",
  "paid",
  "failed",
  "canceled",
  "refunded",
  "verify_failed",
];

const COLUMNS: readonly PanelColumn<AdminPaymentSummary>[] = [
  { key: "at", header: "زمان", render: (p) => fmtTime(p.requestedAt) },
  { key: "team", header: "تیم", render: (p) => p.teamName },
  { key: "amount", header: "مبلغ", render: (p) => toman(p.amountRial) },
  { key: "status", header: "وضعیت", render: (p) => PAYMENT_STATUS_FA[p.status] },
  { key: "gateway", header: "درگاه", render: (p) => `${p.gateway}/${p.gatewayMode}`, ltr: true },
  { key: "ref", header: "پیگیری", render: (p) => p.refId ?? "—", ltr: true },
  {
    key: "open",
    header: "",
    render: (p) => (
      <Link
        to="/panel/payments/$paymentId"
        params={{ paymentId: p.id }}
        className="btn btn--ghost btn--sm"
      >
        جزئیات
      </Link>
    ),
  },
];

const PAGE = 25;

export function PanelPayments() {
  const [refIdInput, setRefIdInput] = useState("");
  const [authorityInput, setAuthorityInput] = useState("");
  const [statusInput, setStatusInput] = useState<"" | PaymentStatus>("");
  const [filter, setFilter] = useState<Partial<AdminPaymentQuery>>({ limit: PAGE });
  const q = useAdminPayments(filter);
  const reconcile = useReconcile();

  const apply = (e: FormEvent): void => {
    e.preventDefault();
    const refId = refIdInput.trim();
    const authority = authorityInput.trim();
    setFilter({
      limit: PAGE,
      ...(refId.length > 0 ? { refId } : {}),
      ...(authority.length > 0 ? { authority } : {}),
      ...(statusInput === "" ? {} : { status: statusInput }),
    });
  };

  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const report = reconcile.data;
  const [reportDry, setReportDry] = useState(false);
  const needsStepUp = isStepUpRequired(reconcile.error);

  return (
    <>
      <div className="dashboard__bar">
        <h1>پرداخت‌ها</h1>
        <form className="dashboard__actions" onSubmit={apply}>
          <input
            className="input"
            type="search"
            placeholder="شماره‌ی پیگیری (کامل)"
            value={refIdInput}
            onChange={(e) => setRefIdInput(e.target.value)}
            aria-label="شماره‌ی پیگیری"
            dir="ltr"
          />
          <input
            className="input"
            type="search"
            placeholder="authority (پیشوند)"
            value={authorityInput}
            onChange={(e) => setAuthorityInput(e.target.value)}
            aria-label="authority"
            dir="ltr"
          />
          <select
            className="input"
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value as "" | PaymentStatus)}
            aria-label="وضعیت"
          >
            <option value="">همه‌ی وضعیت‌ها</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_FA[s]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn--ghost btn--sm">
            فیلتر
          </button>
        </form>
      </div>

      <section className="card panel-stepup" aria-labelledby="reconcile-title">
        <h2 id="reconcile-title">آشتی‌دهیِ دستی</h2>
        <p className="field-hint">
          همان sweepِ خودکار، این‌بار با دست: پرداخت‌های کهنه را از درگاه می‌پرسد و آن‌هایی را که پولشان
          گرفته شده فعال می‌کند. ⚠️ اگر تایمر یا نودِ دیگری در حالِ اجراست، ۴۰۹ می‌گیری — دوباره بزن.
        </p>
        <div className="dashboard__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={reconcile.isPending}
            onClick={() => {
              setReportDry(true);
              reconcile.mutate({ dryRun: true, batchSize: 5, adoptOrphans: false });
            }}
          >
            {reconcile.isPending ? "در حال اجرا…" : "فقط گزارش (بدونِ تغییر)"}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={reconcile.isPending}
            onClick={() => {
              if (!window.confirm("آشتی‌دهیِ واقعی اجرا شود؟ ممکن است اشتراک فعال یا پرداخت باطل شود."))
                return;
              setReportDry(false);
              reconcile.mutate({ dryRun: false, batchSize: 5, adoptOrphans: false });
            }}
          >
            اجرای واقعی
          </button>
        </div>
        {report !== undefined &&
          (reportDry ? (
            // ★ در حالتِ «فقط گزارش» شمارنده‌های **عمل** همیشه صفرند (هیچ عملی انجام نمی‌شود)، پس
            //   نشان‌دادنشان کنارِ هم گمراه‌کننده است (یافته‌ی بازبینیِ ۶٫۵): فقط آنچه واقعاً سنجیده شد.
            <p className="field-hint" role="status">
              گزارشِ آزمایشی (هیچ تغییری داده نشد): {report.scanned} ردیف بررسی شد ·{" "}
              {report.skipped} تا هنوز جوان‌اند · {report.orphans} یتیم
            </p>
          ) : (
            <p className="field-hint" role="status">
              بررسی‌شده {report.scanned} · فعال‌شده {report.activated} · باطل‌شده {report.expired} ·
              یتیم {report.orphans} · فرزندخوانده {report.adopted} · اشتراکِ بسته‌شده{" "}
              {report.subscriptionsEnded}
            </p>
          ))}
        {report !== undefined && report.errors.length > 0 && (
          <ul className="field-hint">
            {report.errors.slice(0, 5).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {reconcile.isError && !needsStepUp && (
          <p className="field-error" role="alert">
            {errorMessage(reconcile.error)}
          </p>
        )}
        {needsStepUp && (
          <div className="panel-stepup__inline">
            <p className="field-hint" role="alert">
              این عمل تاییدِ دوباره می‌خواهد: کد بگیر، تایید کن، بعد دوباره بزن.
            </p>
            <StepUpForm onVerified={() => reconcile.reset()} />
          </div>
        )}
      </section>

      {q.isPending ? (
        <div className="loader">در حال بارگذاری…</div>
      ) : q.isError ? (
        <p className="field-error" role="alert">
          {errorMessage(q.error)}
        </p>
      ) : (
        <>
          <PanelTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(p) => p.id}
            caption={`${String(rows.length)} پرداخت${q.hasNextPage ? " (ادامه دارد)" : ""}`}
            empty="پرداختی با این فیلترها نیست."
          />
          {q.hasNextPage && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {q.isFetchingNextPage ? "در حال بارگذاری…" : "بیشتر"}
            </button>
          )}
        </>
      )}
    </>
  );
}
