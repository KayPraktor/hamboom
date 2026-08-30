import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useSession } from "./session-context.ts";

/**
 * گاردِ مسیرهای نیازمندِ ورود. تا وقتی نشست در حالِ بازیابی است، loader؛ اگر
 * anonymous شد، به `/login`؛ وگرنه محتوا.
 *
 * ⚠️ این فقط **راحتیِ UI** است — گیتِ واقعی سرور است (هر درخواستِ api توکن
 * می‌خواهد و ۴۰۱ می‌دهد). این صفحه‌ی محافظت‌شده را زودتر پنهان می‌کند، نه اینکه
 * امنیت را تامین کند.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "loading") {
    return <div className="loader">در حال بارگذاری…</div>;
  }
  if (status === "anonymous") {
    return <Navigate to="/login" />;
  }
  return <>{children}</>;
}
