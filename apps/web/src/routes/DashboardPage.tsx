import { toPersianDigits } from "@hamboom/i18n";

import { useSession } from "../auth/session-context.ts";

/**
 * داشبورد — جای‌نگه‌دارِ ۸٫۲. لیستِ واقعیِ تیم/بورد/فولدر در ۸٫۳ می‌آید. اینجا فقط
 * ثابت می‌کند نشست برقرار است و `me` بارگذاری شده.
 */
export function DashboardPage() {
  const { user, teams, signOut } = useSession();
  return (
    <div className="card">
      <h1>داشبورد</h1>
      <p>
        خوش آمدید، <strong>{user?.displayName ?? "کاربر"}</strong>.
      </p>
      <p className="field-hint">
        شما در {toPersianDigits(teams.length)} تیم عضو هستید. لیستِ بوردها به‌زودی (فاز ۸٫۳).
      </p>
      <button className="btn btn--ghost" type="button" onClick={signOut}>
        خروج
      </button>
    </div>
  );
}
