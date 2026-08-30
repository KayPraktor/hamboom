import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { LoginPage } from "./auth/LoginPage.tsx";
import { RequireAuth } from "./auth/RequireAuth.tsx";
import { DashboardPage } from "./dashboard/DashboardPage.tsx";
import { IndexRedirect } from "./routes/IndexRedirect.tsx";
import { RootLayout } from "./routes/RootLayout.tsx";

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

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, dashboardRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
