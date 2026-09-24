import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { LoginPage } from "./auth/LoginPage.tsx";
import { RequireAuth } from "./auth/RequireAuth.tsx";
import { RequireStaff } from "./auth/RequireStaff.tsx";
import { PaymentResultPage } from "./billing/PaymentResultPage.tsx";
import { PricingPage } from "./billing/PricingPage.tsx";
import { TeamBillingPage } from "./billing/TeamBillingPage.tsx";
import { BoardPage } from "./board/BoardPage.tsx";
import { DashboardPage } from "./dashboard/DashboardPage.tsx";
import { IndexRedirect } from "./routes/IndexRedirect.tsx";
import { RootLayout } from "./routes/RootLayout.tsx";
import { InviteAcceptPage } from "./team/InviteAcceptPage.tsx";
import { TeamPage } from "./team/TeamPage.tsx";

/**
 * روترِ **code-based** (نه file-based) — عمداً.
 *
 * ⚠️ چرا: گیتِ `typecheck`ِ verify با `tsc`ِ خالص اجرا می‌شود، بدونِ Vite. پلاگینِ
 * file-based یک `routeTree.gen.ts` تولید می‌کند که هنگامِ `tsc` باید از قبل وجود
 * داشته باشد. code-based آن دردسر را حذف می‌کند و کاملاً typed می‌مانَد.
 *
 * گاردِ نشست **در کامپوننت** است (`RequireAuth`، redirectِ درونِ `LoginPage`)، نه
 * `beforeLoad`ِ روتر — چون نشست در React context است و ناهمگام از کوکی بازیابی می‌شود.
 * (این فایل عمداً هیچ کامپوننتِ سطحِ بالا تعریف نمی‌کند تا Fast Refresh تمیز بماند.)
 */
const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexRedirect,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: () => (
    <RequireAuth>
      <DashboardPage />
    </RequireAuth>
  ),
});

const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team/$teamId",
  component: () => (
    <RequireAuth>
      <TeamPage />
    </RequireAuth>
  ),
});

/**
 * ★ مسیرهای پرداخت (M4 فاز ۹).
 *
 * ⚠️ **هیچ‌کدام با `/billing` شروع نمی‌شوند** — آن پیشوند در dev کاملاً به api پروکسی
 * می‌شود ([`vite.config.ts`](../vite.config.ts))، پس یک صفحه‌ی SPA با آن نام اصلاً به
 * مرورگر نمی‌رسد و کاربر یک ۴۰۴ی JSON می‌بیند. صفحه‌ی قیمت `/pricing` و بازگشت از درگاه
 * `/payment/result` است.
 */
const pricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pricing",
  component: PricingPage, // ★ عمومی — بدونِ RequireAuth
});

const teamBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team/$teamId/billing",
  // ★ پیش‌انتخابِ آمده از صفحه‌ی قیمت — هر دو اختیاری‌اند و هر مقدارِ ناشناخته **دور
  //   ریخته** می‌شود، نه اینکه به کامپوننت برسد.
  validateSearch: (
    search: Record<string, unknown>,
  ): { plan?: string; period?: "monthly" | "yearly" } => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
    period:
      search.period === "yearly" ? "yearly" : search.period === "monthly" ? "monthly" : undefined,
  }),
  component: () => (
    <RequireAuth>
      <TeamBillingPage />
    </RequireAuth>
  ),
});

const paymentResultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/payment/result",
  validateSearch: (search: Record<string, unknown>) => ({
    status: search.status === "ok" || search.status === "failed" ? search.status : "invalid",
  }),
  // ★★ **عمداً بدونِ `RequireAuth`**: بازگشت از درگاه یک بارگذاریِ سردِ صفحه است و توکنِ
  //    دسترسی فقط در حافظه بوده. با گارد، کاربر پیش از بازسازیِ نشست به `/login` می‌پرد و
  //    فکر می‌کند پولش گم شده. تسویه هم این‌جا انجام نمی‌شود — سرور قبلاً کرده.
  component: PaymentResultPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: InviteAcceptPage,
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/b/$boardId",
  component: () => (
    <RequireAuth>
      <BoardPage />
    </RequireAuth>
  ),
});

/**
 * ★★ پنلِ ادمین — **lazy** (M6 فاز ۳، [ADR-065](../../../ARCHITECTURE_DECISIONS.md#adr-065)).
 *
 * تنها `React.lazy`ِ اپ: کاربرِ عادی هیچ بایتی از پنل را دانلود نمی‌کند. probe ۱٫۴ عدد داد
 * (stubِ lazy + route = +۱۸۹ B روی chunkِ ورودی) و معیارِ ۳٫۶ همان است: رشدِ ورودی < ۱KB.
 * گاردها (`RequireAuth` → `RequireStaff`) عمداً **بیرونِ** chunkِ lazy‌اند تا غیرِ staff
 * حتی درخواستِ آن chunk را هم نزند. مسیرِ SPA `/panel` است، نه `/admin` — آن یکی پیشوندِ
 * API است و پروکسی می‌بَردش (`api-prefixes.ts`).
 */
const PanelLayout = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelLayout })),
);
const PanelHome = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelHome })),
);
const PanelAudit = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelAudit })),
);
// فاز ۵ — کاربران و تیم‌ها؛ همان chunk.
const PanelUsers = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelUsers })),
);
const PanelUser = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelUser })),
);
const PanelTeam = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelTeam })),
);
// فاز ۶ — پرداخت‌ها و استرداد؛ همان chunk.
const PanelPayments = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelPayments })),
);
const PanelPayment = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelPayment })),
);
// فاز ۷ — آمار و وضعیتِ سیستم؛ همان chunk (نمودارِ SVG هم داخلِ همین است، نه chunkِ ورودی).
const PanelStats = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelStats })),
);
const PanelSystem = lazy(() =>
  import("./panel/panel-chunk.ts").then((m) => ({ default: m.PanelSystem })),
);
const panelFallback = <div className="loader">در حال بارگذاری…</div>;

const panelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/panel",
  component: () => (
    <RequireAuth>
      <RequireStaff>
        <Suspense fallback={panelFallback}>
          <PanelLayout />
        </Suspense>
      </RequireStaff>
    </RequireAuth>
  ),
});

// ★ بدونِ Suspenseِ دوم: مرزِ Suspenseِ والد (بالای PanelLayout) هر lazyِ زیرِ Outlet را هم می‌گیرد،
//   و هر دو از یک chunk‌اند — بعد از اولین بارگذاری، دومی فوری resolve می‌شود.
const panelIndexRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/",
  component: PanelHome,
});

// فاز ۴٫۳ — ممیزی (اولین مصرف‌کننده‌ی صفحه‌بندیِ cursor در پنل). همان chunk، همان Suspenseِ والد.
const panelAuditRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/audit",
  component: PanelAudit,
});

// فاز ۵ — عبارتِ جست‌وجو عمداً در URL **نیست** (یافته‌ی ۵٫۵: `?q=<شماره>` در تاریخچه/لاگ می‌نشست)؛ stateِ صفحه است.
const panelUsersRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/users",
  component: PanelUsers,
});
const panelUserRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/users/$userId",
  component: PanelUser,
});
const panelTeamRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/teams/$teamId",
  component: PanelTeam,
});

// فاز ۶ — فیلترها مثلِ جست‌وجوی کاربران **در URL نیستند**: شماره‌ی پیگیری و authority شناسه‌های مالیِ یک
// مشتری‌اند و جایشان در تاریخچه‌ی مرورگر و لاگِ nginx نیست (همان یافته‌ی ۵٫۵).
const panelPaymentsRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/payments",
  component: PanelPayments,
});
const panelPaymentRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/payments/$paymentId",
  component: PanelPayment,
});

// فاز ۷ — پنجره‌ی آمار (۷/۳۰/۹۰) عمداً در URL نیست: یک تنظیمِ نمایشیِ بی‌اهمیت است و
// نگه‌داشتنِ الگوی «هیچ پارامترِ پنلی در تاریخچه» ساده‌تر از استثنا‌گذاشتن است.
const panelStatsRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/stats",
  component: PanelStats,
});
const panelSystemRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/system",
  component: PanelSystem,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  dashboardRoute,
  teamRoute,
  inviteRoute,
  boardRoute,
  pricingRoute,
  teamBillingRoute,
  paymentResultRoute,
  panelRoute.addChildren([
    panelIndexRoute,
    panelAuditRoute,
    panelUsersRoute,
    panelUserRoute,
    panelTeamRoute,
    panelPaymentsRoute,
    panelPaymentRoute,
    panelStatsRoute,
    panelSystemRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
