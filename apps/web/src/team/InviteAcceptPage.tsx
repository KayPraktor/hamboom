import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { api } from "../api/client.ts";
import { errorMessage } from "../api/error-message.ts";
import { useSession } from "../auth/session-context.ts";

/**
 * پذیرشِ دعوت — `/invite/$token`. اگر وارد شده باشد، خودکار می‌پذیرد و به داشبورد
 * می‌رود؛ وگرنه اول باید وارد شود.
 *
 * ⚠️ StrictMode-safe: `done` ref مانعِ پذیرشِ دوباره در اجرای دوگانه‌ی افکت است.
 */
export function InviteAcceptPage() {
  const { token } = useParams({ from: "/invite/$token" });
  const { status, establish } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || done.current) return;
    done.current = true;
    void (async () => {
      try {
        await api.teams.acceptInvite(token);
        await establish();
        await navigate({ to: "/dashboard" });
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [status, token, establish, navigate]);

  if (status === "loading") {
    return <div className="loader">در حال بارگذاری…</div>;
  }

  if (status === "anonymous") {
    return (
      <div className="card">
        <h1>پیوستن به تیم</h1>
        <p className="field-hint">برای پذیرشِ دعوت ابتدا وارد شوید، سپس همین لینک را باز کنید.</p>
        <Link to="/login" className="btn btn--primary">
          ورود
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>پیوستن به تیم</h1>
      {error !== null ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="field-hint">در حال پذیرش…</p>
      )}
    </div>
  );
}
