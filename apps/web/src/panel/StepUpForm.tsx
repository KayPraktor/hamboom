import { useState, type FormEvent } from "react";

import { errorMessage } from "../api/error-message.ts";
import { normalizeCode } from "../auth/validate.ts";
import { useStepUpRequest, useStepUpVerify } from "./panel-queries.ts";

/**
 * فرمِ step-up — M6 فاز ۳ (از `PanelHome` جدا شد در ۵٫۲ تا صفحه‌ی کاربر روی ۴۲۸ همان را نشان دهد).
 *
 * کد به شماره‌ی **خودِ** staff می‌رود (سرور شماره را از ردیفِ او می‌خوانَد، نه از این فرم) و موفقیت
 * `stepUpVerifiedAt` را تازه می‌کند. «تازه بودن» را سرور تصمیم می‌گیرد (`ADMIN_STEP_UP_SECONDS`).
 * `onVerified` برای مصرف‌کننده‌ای که بعد از تایید می‌خواهد عملِ ردشده را دوباره بزند.
 */
export function StepUpForm({ onVerified }: { onVerified?: () => void }) {
  const request = useStepUpRequest();
  const verify = useStepUpVerify();
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const submitCode = (e: FormEvent): void => {
    e.preventDefault();
    const normalized = normalizeCode(code);
    if (normalized === null) {
      setFormError("کد باید ۶ رقم باشد.");
      return;
    }
    setFormError(null);
    verify.mutate(normalized, {
      onSuccess: () => {
        setCode("");
        request.reset();
        onVerified?.();
      },
    });
  };

  if (request.isSuccess) {
    return (
      <form onSubmit={submitCode} noValidate>
        <label className="field">
          <span>کدِ پیامکی</span>
          <input
            className="input input--code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="------"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={verify.isPending}
            autoFocus
          />
        </label>
        {(formError !== null || verify.isError) && (
          <p className="field-error" role="alert">
            {formError ?? errorMessage(verify.error)}
          </p>
        )}
        <button className="btn btn--primary" type="submit" disabled={verify.isPending}>
          {verify.isPending ? "در حال بررسی…" : "تایید"}
        </button>
      </form>
    );
  }
  return (
    <>
      {request.isError && (
        <p className="field-error" role="alert">
          {errorMessage(request.error)}
        </p>
      )}
      {verify.isSuccess && (
        <p className="field-hint" role="status">
          تایید شد — آخرین step-up به‌روز است.
        </p>
      )}
      <button
        className="btn btn--primary"
        type="button"
        disabled={request.isPending}
        onClick={() => request.mutate()}
      >
        {request.isPending ? "در حال ارسال…" : "درخواستِ کد"}
      </button>
    </>
  );
}
