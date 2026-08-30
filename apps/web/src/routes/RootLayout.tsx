import { Link, Outlet } from "@tanstack/react-router";

import { useSession } from "../auth/session-context.ts";

/**
 * پوسته‌ی ریشه — هدر + محتوای مسیر. جهت از `<html dir="rtl">` می‌آید؛ اینجا فقط
 * logical properties (ADR-016). کاربر + خروج وقتی وارد شده در هدر می‌آید.
 */
export function RootLayout() {
  const { status, user, signOut } = useSession();
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-header__brand">
          هم‌بوم
        </Link>
        {status === "authenticated" && user !== null && (
          <div className="app-header__user">
            <span>{user.displayName}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
              خروج
            </button>
          </div>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
