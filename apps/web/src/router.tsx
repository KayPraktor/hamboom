import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { HomePage } from "./routes/HomePage.tsx";
import { RootLayout } from "./routes/RootLayout.tsx";

/**
 * روترِ **code-based** (نه file-based) — عمداً.
 *
 * ⚠️ چرا: گیتِ `typecheck`ِ verify با `tsc`ِ خالص اجرا می‌شود، بدونِ Vite. پلاگینِ
 * file-based یک `routeTree.gen.ts` تولید می‌کند که هنگامِ `tsc` باید از قبل وجود
 * داشته باشد — یعنی یا commit شود (فایلِ تولیدی) یا یک هوکِ codegen پیش از
 * typecheck. code-based هر دو دردسر را حذف می‌کند و کاملاً typed می‌مانَد.
 */
const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

// تایپِ سراسریِ روتر تا `Link`/`useNavigate` در همه‌ی اپ typed باشند.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
