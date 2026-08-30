import { Navigate } from "@tanstack/react-router";

import { useSession } from "../auth/session-context.ts";

/**
 * ریشه `/` — بسته به نشست به داشبورد یا ورود می‌رود. تا وقتی نشست معلوم نشده،
 * loader (تا یک‌لحظه صفحه‌ی ورود قبل از تشخیصِ نشست چشمک نزند).
 */
export function IndexRedirect() {
  const { status } = useSession();
  if (status === "loading") {
    return <div className="loader">در حال بارگذاری…</div>;
  }
  return <Navigate to={status === "authenticated" ? "/dashboard" : "/login"} />;
}
