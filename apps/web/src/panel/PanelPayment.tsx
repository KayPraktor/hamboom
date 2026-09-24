import { Link, useParams } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

import { errorMessage } from "../api/error-message.ts";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";
import {
  useAdminPayment,
  useExpirePayment,
  useRefundPayment,
  useVerifyPayment,
} from "./panel-queries.ts";
import { PAYMENT_STATUS_FA, toman } from "./payment-fa.ts";
import { StepUpForm } from "./StepUpForm.tsx";
import { isStepUpRequired } from "./step-up.ts";

/**
 * یک پرداخت — `/panel/payments/$paymentId` (M6 فاز ۶، [ADR-068](../../../../ARCHITECTURE_DECISIONS.md#adr-068)).
 *
 * سه عملِ مخرب، هر سه پشتِ step-up و ممیزی‌شده:
 *
 * ★ **verify** همان `settlePayment` است (نه مسیرِ دوم) و برای **هر** نتیجه ۲۰۰ می‌دهد — «درگاه گفت
 * هنوز پرداخت نشده» برای اپراتور یک جواب است، نه خطا؛ پس این‌جا هم به‌شکلِ پیام نشان داده می‌شود نه هشدار.
 *
 * ★ **انقضا** دکمه‌اش با `expireBlocked`ِ **سرور** غیرفعال می‌شود، نه با محاسبه‌ی رابط: سقفش configی است
 * (۷۲ ساعت) و ADR-056 می‌گوید هیچ ردیفی پیش از دستِ‌کم یک پاسخِ درگاه باطل نمی‌شود. خودِ مسیر هم دوباره
 * زیرِ قفل می‌سنجد و **بعد یک verifyِ تازه می‌زند** — اگر کاربر همین حالا پرداخت کرده باشد، فعال می‌شود.
 *
 * ★ **استرداد** دو کانالِ صریح دارد: «ثبتِ دستی» (پول را در پنلِ درگاه برگردانده‌ای و شماره‌ی مرجع را
 * می‌دهی — امروز تنها مسیرِ اجرایی) و «از درگاه» (زرین‌پال `REFUND_UNAVAILABLE` می‌دهد تا کانالِ واقعی بیاید).
 * اثرش روی اشتراک در پاسخ صریح است، چون همان چیزی است که پشتیبانی باید به مشتری بگوید.
 */

const fmtTime = (iso: string | null): string =>
  iso === null
    ? "—"
    : new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      );

interface InfoRow {
  key: string;
  label: string;
  value: ReactNode;
}
const INFO_COLUMNS: readonly PanelColumn<InfoRow>[] = [
  { key: "label", header: "چه", render: (r) => r.label },
  { key: "value", header: "مقدار", render: (r) => r.value },
];

const ltr = (v: string | null): ReactNode => <span className="panel-table__ltr">{v ?? "—"}</span>;

/** JSONِ ستون — کوچک و خوانا؛ این payloadها عمداً بدونِ PII و بدونِ کارت‌اند. */
const Payload = ({ title, value }: { title: string; value: unknown }): ReactNode =>
  value === null ? null : (
    <details className="panel-payload">
      <summary>{title}</summary>
      <pre dir="ltr">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );

export function PanelPayment() {
  const { paymentId } = useParams({ from: "/panel/payments/$paymentId" });
  const payment = useAdminPayment(paymentId);
  const verify = useVerifyPayment(paymentId);
  const expire = useExpirePayment(paymentId);
  const refund = useRefundPayment(paymentId);
  const [expireReason, setExpireReason] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundRef, setRefundRef] = useState("");

  if (payment.isPending) return <div className="loader">در حال بارگذاری…</div>;
  if (payment.isError) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(payment.error)}
      </p>
    );
  }
  const p = payment.data;
  const actionError = verify.error ?? expire.error ?? refund.error;
  const needsStepUp = isStepUpRequired(actionError);
  const resetActions = (): void => {
    verify.reset();
    expire.reset();
    refund.reset();
  };

  const doExpire = (e: FormEvent): void => {
    e.preventDefault();
    const r = expireReason.trim();
    if (r.length < 3) return;
    if (!window.confirm("این پرداخت باطل شود؟ فاکتورش هم void می‌شود.")) return;
    expire.mutate(r, { onSuccess: () => setExpireReason("") });
  };

  const doRefund = (channel: "manual" | "gateway") => (e: FormEvent) => {
    e.preventDefault();
    const reason = refundReason.trim();
    if (reason.length < 3) return;
    if (channel === "manual" && refundRef.trim().length === 0) return;
    // ★ متنِ تایید با کانال فرق می‌کند (یافته‌ی بازبینیِ ۶٫۵): «ثبتِ دستی» پولی جابه‌جا **نمی‌کند** و
    //   وانمودکردنش به این‌که می‌کند، همان دروغی است که staff بعداً رویش حساب می‌کند.
    const question =
      channel === "manual"
        ? `ثبتِ استردادِ ${toman(p.amountRial)}؟ این پول را جابه‌جا نمی‌کند — فقط ثبت می‌کند که در ` +
          "پنلِ درگاه برگردانده‌ای. اشتراکی که با این پرداخت فعال شده لغو می‌شود."
        : `استردادِ ${toman(p.amountRial)} از خودِ درگاه؟ اشتراکی که با این پرداخت فعال شده لغو می‌شود.`;
    if (!window.confirm(question)) return;
    refund.mutate(
      channel === "manual"
        ? { channel: "manual", refundRef: refundRef.trim(), reason }
        : { channel: "gateway", reason },
      {
        onSuccess: () => {
          setRefundReason("");
          setRefundRef("");
        },
      },
    );
  };

  const rows: InfoRow[] = [
    { key: "id", label: "شناسه", value: ltr(p.id) },
    {
      key: "team",
      label: "تیم",
      value: (
        <Link to="/panel/teams/$teamId" params={{ teamId: p.teamId }}>
          {p.teamName}
        </Link>
      ),
    },
    { key: "amount", label: "مبلغ", value: toman(p.amountRial) },
    { key: "status", label: "وضعیت", value: PAYMENT_STATUS_FA[p.status] },
    { key: "gateway", label: "درگاه", value: ltr(`${p.gateway}/${p.gatewayMode}`) },
    { key: "authority", label: "authority", value: ltr(p.authority) },
    { key: "ref", label: "شماره‌ی پیگیری", value: ltr(p.refId) },
    { key: "card", label: "کارت", value: ltr(p.cardPanMasked) },
    { key: "fee", label: "کارمزد", value: p.feeRial === null ? "—" : toman(p.feeRial) },
    { key: "failure", label: "آخرین کدِ شکست", value: ltr(p.failureCode) },
    { key: "requested", label: "شروع", value: fmtTime(p.requestedAt) },
    { key: "paid", label: "پرداخت", value: fmtTime(p.paidAt) },
    { key: "verified", label: "آخرین تایید", value: fmtTime(p.verifiedAt) },
    {
      key: "refunded",
      label: "استرداد",
      value:
        p.refundedAt === null
          ? "—"
          : `${fmtTime(p.refundedAt)} · ${toman(p.refundAmountRial ?? 0)} · ${p.refundRef ?? "—"}`,
    },
    {
      key: "invoice",
      label: "فاکتور",
      value: p.invoice === null ? "—" : `${p.invoice.number} (${p.invoice.status})`,
    },
    {
      key: "sub",
      label: "اشتراکِ فعال‌شده",
      value: p.subscription === null ? "—" : `${p.subscription.planCode} · ${p.subscription.status}`,
    },
  ];

  return (
    <>
      <div className="dashboard__bar">
        <h1>پرداخت</h1>
        <Link to="/panel/payments" className="btn btn--ghost btn--sm">
          ← فهرستِ پرداخت‌ها
        </Link>
      </div>

      <PanelTable columns={INFO_COLUMNS} rows={rows} rowKey={(r) => r.key} caption="پرداخت" />

      <Payload title="نیّتِ خرید (request)" value={p.requestPayload} />
      <Payload title="بازگشت از درگاه (callback)" value={p.callbackPayload} />
      <Payload title="آخرین پاسخِ verify" value={p.verifyPayload} />

      <section className="card panel-stepup" aria-labelledby="actions-title">
        <h2 id="actions-title">عمل‌ها</h2>

        <div className="dashboard__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={verify.isPending}
            onClick={() => verify.mutate(undefined)}
          >
            {verify.isPending ? "در حال پرسیدن…" : "پرسیدن از درگاه (verify)"}
          </button>
        </div>
        {verify.data !== undefined && (
          <p className="field-hint" role="status">
            نتیجه: {verify.data.outcome}
            {verify.data.message === null ? "" : ` — ${verify.data.message}`}
          </p>
        )}

        <form onSubmit={doExpire} noValidate>
          <label className="field">
            <span>دلیلِ ابطال (در ممیزی ثبت می‌شود)</span>
            <input
              className="input"
              value={expireReason}
              onChange={(e) => setExpireReason(e.target.value)}
              minLength={3}
              maxLength={200}
              disabled={p.expireBlocked !== null || expire.isPending}
            />
          </label>
          {p.expireBlocked !== null && (
            <p className="field-hint">⚠️ ابطال ممکن نیست: {p.expireBlocked}</p>
          )}
          <button
            type="submit"
            className="btn btn--danger"
            disabled={p.expireBlocked !== null || expire.isPending || expireReason.trim().length < 3}
          >
            {expire.isPending ? "در حال اجرا…" : "ابطالِ پرداخت"}
          </button>
        </form>
        {expire.data !== undefined && (
          <p className="field-hint" role="status">
            نتیجه: {expire.data.outcome}
            {expire.data.message === null ? "" : ` — ${expire.data.message}`}
          </p>
        )}

        {p.status === "paid" && (
          <form onSubmit={doRefund("manual")} noValidate>
            <label className="field">
              <span>دلیلِ استرداد (در ممیزی ثبت می‌شود)</span>
              <input
                className="input"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                minLength={3}
                maxLength={200}
                disabled={refund.isPending}
              />
            </label>
            <label className="field">
              <span>شماره‌ی مرجعِ استرداد (از پنلِ درگاه)</span>
              <input
                className="input"
                value={refundRef}
                onChange={(e) => setRefundRef(e.target.value)}
                maxLength={80}
                disabled={refund.isPending}
                dir="ltr"
              />
            </label>
            <div className="dashboard__actions">
              <button
                type="submit"
                className="btn btn--danger"
                disabled={
                  refund.isPending ||
                  refundReason.trim().length < 3 ||
                  refundRef.trim().length === 0
                }
              >
                ثبتِ استردادِ دستی
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={refund.isPending || refundReason.trim().length < 3}
                onClick={(e) => doRefund("gateway")(e)}
              >
                استرداد از درگاه
              </button>
            </div>
            <p className="field-hint">
              «ثبتِ دستی» یعنی پول را در پنلِ درگاه برگردانده‌ای و فقط مرجعش را این‌جا ثبت می‌کنی —
              امروز تنها مسیرِ اجرایی. «از درگاه» برای زرین‌پال هنوز کار نمی‌کند و صریح می‌گوید.
            </p>
          </form>
        )}
        {refund.data !== undefined && (
          <p className="field-hint" role="status">
            مسترد شد. اشتراکِ لغوشده: {refund.data.subscriptionCanceled ?? "—"} · اشتراکِ بازگشته:{" "}
            {refund.data.subscriptionRestored ?? "—"}
          </p>
        )}

        {actionError !== null && !needsStepUp && (
          <p className="field-error" role="alert">
            {errorMessage(actionError)}
          </p>
        )}
        {needsStepUp && (
          <div className="panel-stepup__inline">
            <p className="field-hint" role="alert">
              این عمل تاییدِ دوباره می‌خواهد: کد بگیر، تایید کن، بعد دوباره بزن.
            </p>
            <StepUpForm onVerified={resetActions} />
          </div>
        )}
      </section>
    </>
  );
}
