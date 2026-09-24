import { Link, Outlet } from "@tanstack/react-router";

/**
 * پوسته‌ی پنلِ ادمین — M6 فاز ۳ ([ADR-065](../../../../ARCHITECTURE_DECISIONS.md#adr-065)):
 * ریلِ ناوبری (همان کلاس‌های `folder-nav`/`nav-item`ِ داشبورد) + محتوای بخش.
 *
 * ★ کلِ این زیرشاخه **lazy** است (`React.lazy` در `router.tsx`)؛ کاربرِ عادی هیچ بایتی از پنل را
 * دانلود نمی‌کند (معیارِ ۳٫۶: رشدِ chunkِ ورودی < ۱KB). گاردها (`RequireAuth` → `RequireStaff`)
 * **بیرونِ** این chunk‌اند.
 *
 * بخش‌ها با هر فاز اضافه می‌شوند: کاربران/تیم‌ها (۵)، پرداخت‌ها (۶)، audit (۴)، آمار/سیستم (۷).
 * لینکِ بخشی که هنوز endpoint ندارد این‌جا نیست — منوی «به‌زودی» فقط شلوغی است.
 */
const SECTIONS: readonly {
  to: "/panel" | "/panel/audit" | "/panel/users" | "/panel/payments" | "/panel/stats" | "/panel/system";
  label: string;
  exact?: boolean;
}[] = [
  { to: "/panel", label: "خانه", exact: true },
  { to: "/panel/users", label: "کاربران و تیم‌ها" }, // فاز ۵
  { to: "/panel/payments", label: "پرداخت‌ها" }, // فاز ۶
  { to: "/panel/audit", label: "ممیزی" }, // فاز ۴٫۳
  { to: "/panel/stats", label: "آمار" }, // فاز ۷
  { to: "/panel/system", label: "وضعیتِ سیستم" }, // فاز ۷
];

export function PanelLayout() {
  return (
    <div className="dashboard-layout">
      <aside className="folder-nav" aria-label="پیمایشِ پنل">
        <p className="folder-nav__section-label">پنلِ ادمین</p>
        <nav className="folder-nav__group">
          {SECTIONS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="nav-item"
              activeProps={{ className: "nav-item nav-item--on", "aria-current": "page" }}
              activeOptions={{ exact: s.exact === true }}
            >
              <span className="nav-item__label">{s.label}</span>
            </Link>
          ))}
        </nav>
        <nav className="folder-nav__group">
          <Link to="/dashboard" className="nav-item">
            <span className="nav-item__label">← بازگشت به داشبورد</span>
          </Link>
        </nav>
      </aside>
      <div className="dashboard panel">
        <Outlet />
      </div>
    </div>
  );
}
