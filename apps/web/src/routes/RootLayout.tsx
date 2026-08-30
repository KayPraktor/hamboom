import { Outlet } from "@tanstack/react-router";

/**
 * پوسته‌ی ریشه — هدر + محتوای مسیر. جهت از `<html dir="rtl">` می‌آید؛ اینجا فقط
 * logical properties (ADR-016).
 */
export function RootLayout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__brand">هم‌بوم</span>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
