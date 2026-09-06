import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { LoginPage } from "./auth/LoginPage.tsx";
import { RequireAuth } from "./auth/RequireAuth.tsx";
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
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
