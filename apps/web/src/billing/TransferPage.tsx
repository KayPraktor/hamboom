import type { TransferInstructions } from "@hamboom/shared-types";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api } from "../api/client.ts";
import { errorMessage } from "../api/error-message.ts";

/**
 * صفحه‌ی «این مبلغ را به این کارت بریز» — `/payment/transfer/$authority`
 * ([ADR-070](../../../../ARCHITECTURE_DECISIONS.md#adr-070)).
 *
 * ⚠️⚠️ **مسیرش عمداً زیرِ `/payment` است، نه `/billing`.** آن پیشوند در dev و پشتِ nginx
 * کاملاً به api می‌رود، پس صفحه‌ای با آن نام اصلاً به مرورگر نمی‌رسد و کاربر یک JSON
 * می‌بیند — همان نقصی که در M4 فاز ۹ با `MOCK_CHECKOUT_PATH` رخ داد. یک گاردِ بوت در
 * [`registerBillingRoutes`](../../../api/src/routes/billing.ts) همین را نگه می‌دارد.
 *
 * ★ مقصدِ واریز **از سرور** می‌آید، نه از باندل: عوض‌کردنِ شماره‌ی کارت نباید build بخواهد.
 */

const toman = (rial: number): string =>
  `${new Intl.NumberFormat("fa-IR").format(Math.round(rial / 10))} تومان`;

const groups = (digits: string): string => digits.replace(/(\d{4})(?=\d)/g, "$1-");

const fmt = (iso: string): string =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

const STATE_FA: Record<TransferInstructions["state"], string> = {
  awaiting: "در انتظارِ واریزِ تو",
  claimed: "واریز اعلام شد — در انتظارِ بررسی",
  approved: "تایید شد و اشتراک فعال است",
  expired: "مهلت گذشت",
};

export function TransferPage() {
  const { authority } = useParams({ from: "/payment/transfer/$authority" });
  const qc = useQueryClient();
  const key = ["billing", "transfer", authority] as const;

  const q = useQuery({
    queryKey: key,
    queryFn: () => api.billing.transfer(authority),
  });

  const [ref, setRef] = useState("");
  const [last4, setLast4] = useState("");
  const claim = useMutation({
    mutationFn: (body: { ref: string; last4: string | null }) =>
      api.billing.claimTransfer(authority, body),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      setRef("");
    },
  });

  if (q.isPending) return <p className="field-hint">در حال خواندن…</p>;
  if (q.error !== null) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(q.error)}
      </p>
    );
  }
  const info = q.data;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const r = ref.trim();
    if (r.length < 4) return;
    claim.mutate({ ref: r, last4: last4.length === 4 ? last4 : null });
  };

  return (
    <section className="card" aria-labelledby="transfer-title">
      <h1 id="transfer-title">پرداخت با کارت‌به‌کارت</h1>
      <p className="field-hint" role="status">
        وضعیت: <strong>{STATE_FA[info.state]}</strong>
      </p>

      <dl className="dashboard__meta">
        <dt>مبلغ</dt>
        <dd>
          <strong>{toman(info.amountRial)}</strong>
        </dd>
        {info.destination.card !== null && (
          <>
            <dt>شماره‌ی کارت</dt>
            <dd dir="ltr">{groups(info.destination.card)}</dd>
          </>
        )}
        {info.destination.sheba !== null && (
          <>
            <dt>شبا</dt>
            <dd dir="ltr">{info.destination.sheba}</dd>
          </>
        )}
        <dt>به نامِ</dt>
        <dd>{info.destination.holderName}</dd>
        {info.destination.bankName !== null && (
          <>
            <dt>بانک</dt>
            <dd>{info.destination.bankName}</dd>
          </>
        )}
        <dt>شماره‌ی فاکتور</dt>
        <dd dir="ltr">{info.invoiceNumber}</dd>
        <dt>مهلتِ اعلامِ واریز</dt>
        <dd>{fmt(info.claimDeadline)}</dd>
      </dl>

      {/*
        ★ نامِ صاحبِ حساب تزئینی نیست: تنها چیزی است که کاربر **پیش از** زدنِ دکمه‌ی واریز
        می‌تواند با اپِ بانکش تطبیق دهد. به همین دلیل گاردِ بوت بدونش بالا نمی‌آید.
      */}
      <p className="field-hint">
        پیش از واریز، نامِ صاحبِ حساب را در اپِ بانکت با «{info.destination.holderName}» بسنج.
      </p>

      {info.state === "approved" ? (
        <p className="field-hint" role="status">
          واریزت تایید شد و اشتراک فعال است.{" "}
          <Link to="/dashboard" className="btn btn--ghost btn--sm">
            رفتن به داشبورد
          </Link>
        </p>
      ) : (
        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>شماره‌ی پیگیری یا مرجعِ واریز</span>
            <input
              className="input"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              minLength={4}
              maxLength={80}
              disabled={claim.isPending}
              dir="ltr"
            />
          </label>
          <label className="field">
            <span>۴ رقمِ آخرِ کارتی که از آن واریز کردی (اختیاری)</span>
            <input
              className="input"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              disabled={claim.isPending}
              dir="ltr"
              inputMode="numeric"
            />
          </label>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={claim.isPending || ref.trim().length < 4}
          >
            {claim.isPending ? "در حال ثبت…" : "واریز کردم"}
          </button>
          {/*
            ★★ این جمله **ادعای بازاریابی نیست، رفتارِ واقعیِ سیستم است**: ثبتِ ادعا باعث
            می‌شود پاسخِ درگاه به «نمی‌دانم» تبدیل شود، `failure_code` دست‌نخورده بماند، و
            پله‌ی ۳ی ADR-056 هرگز این فاکتور را باطل نکند — حتی اگر واریزِ پایا فردا بنشیند.
          */}
          <p className="field-hint">
            وقتی اعلام کنی، این فاکتور دیگر خودکار منقضی نمی‌شود — حتی اگر واریزت (مثلِ پایا)
            روزِ کاری بعد بنشیند. اگر شماره را اشتباه زدی، دوباره ثبتش کن.
          </p>
        </form>
      )}

      {info.claimedRef !== null && (
        <p className="field-hint">
          آخرین شماره‌ای که ثبت کردی: <bdi dir="ltr">{info.claimedRef}</bdi>
          {info.claimedAt === null ? "" : ` (${fmt(info.claimedAt)})`}
        </p>
      )}
      {claim.error !== null && (
        <p className="field-error" role="alert">
          {errorMessage(claim.error)}
        </p>
      )}
    </section>
  );
}
