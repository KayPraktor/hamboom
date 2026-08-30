import { SdkError } from "@hamboom/sdk";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { api } from "../api/client.ts";
import { useSession } from "./session-context.ts";
import { normalizeCode, normalizePhone } from "./validate.ts";

/**
 * ورود با شماره‌ی موبایل + OTP — دو گامِ روی یک صفحه (بدونِ تغییرِ مسیر وسطِ کار).
 *
 * ★ ارقامِ فارسی با `toLatinDigits` نرمال می‌شوند (کاربر ۰۹… فارسی تایپ می‌کند،
 * سرور ASCII می‌خواهد). اعتبارسنجیِ اینجا فقط برای بازخوردِ سریع است؛ **سرور
 * مرجعِ نهایی است** و پیامِ فارسیِ خطایش (§۵) مستقیم نشان داده می‌شود.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { establish, status } = useSession();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageOf = (e: unknown): string =>
    e instanceof SdkError ? e.message : "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";

  async function submitPhone(ev: FormEvent): Promise<void> {
    ev.preventDefault();
    setError(null);
    const normalized = normalizePhone(phone);
    if (normalized === null) {
      setError("شماره‌ی موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.");
      return;
    }
    setBusy(true);
    try {
      await api.auth.requestOtp({ phone: normalized });
      setPhone(normalized);
      setStep("otp");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(ev: FormEvent): Promise<void> {
    ev.preventDefault();
    setError(null);
    const clean = normalizeCode(code);
    if (clean === null) {
      setError("کد باید ۶ رقم باشد.");
      return;
    }
    setBusy(true);
    try {
      await api.auth.verifyOtp({ phone, code: clean });
      await establish();
      await navigate({ to: "/dashboard" });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  // اگر نشست از قبل برقرار است (مثلاً بازدیدِ مستقیمِ /login)، به داشبورد.
  if (status === "authenticated") {
    return <Navigate to="/dashboard" />;
  }

  return (
    <div className="card auth-card">
      <h1>ورود به هم‌بوم</h1>
      {step === "phone" ? (
        <form onSubmit={submitPhone} noValidate>
          <label className="field">
            <span>شماره‌ی موبایل</span>
            <input
              className="input"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="۰۹۱۲۳۴۵۶۷۸۹"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          {error !== null && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? "در حال ارسال…" : "ارسال کد"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitOtp} noValidate>
          <p className="field-hint">
            کدِ ۶ رقمی به شماره‌ی <bdi>{phone}</bdi> فرستاده شد.
          </p>
          <label className="field">
            <span>کد ورود</span>
            <input
              className="input input--code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="------"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          {error !== null && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? "در حال بررسی…" : "ورود"}
          </button>
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
          >
            تغییرِ شماره
          </button>
        </form>
      )}
    </div>
  );
}
