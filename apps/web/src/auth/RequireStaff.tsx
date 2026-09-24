import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useSession } from "./session-context.ts";

/**
 * گاردِ پنلِ ادمین (M6 فاز ۳، [ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066)) —
 * **داخلِ** `RequireAuth` می‌نشیند و فقط `User.isStaff`ِ نشست را می‌خوانَد؛ غیرِ staff به داشبورد
 * برمی‌گردد (لینکی هم ندیده که این‌جا برسد).
 *
 * ⚠️ مثلِ `RequireAuth` فقط **راحتیِ UI** است: گیتِ واقعی `requireStaff`ِ سرور است که در هر
 * درخواستِ `/admin` از دیتابیس می‌خوانَد و ۴۰۳ می‌دهد. این فقط زودتر برمی‌گردانَد — نه اینکه
 * چیزی را محافظت کند.
 *
 * ★ عمداً **کوچک** و در chunkِ ورودی (معیارِ ۳٫۶: رشدِ ورودی < ۱KB)، تا کاربرِ غیرِ staff اصلاً
 * chunkِ lazyِ پنل را دانلود نکند. به همین دلیل `Navigate` است نه یک کارتِ «دسترسی ندارید».
 */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (user === null || !user.isStaff) return <Navigate to="/dashboard" />;
  return <>{children}</>;
}
