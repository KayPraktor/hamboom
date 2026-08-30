import "@fontsource-variable/vazirmatn";
import "./styles/app.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SessionProvider } from "./auth/session.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { router } from "./router.tsx";

/**
 * نقطه‌ی ورودِ اپ.
 *
 * ⚠️ **StrictMode از خط اول روشن است** — نه سلیقه: بایندرِ بوم (فاز ۸٫۴) باید
 * StrictMode-safe باشد ([ADR-032](../../../ARCHITECTURE_DECISIONS.md#adr-032))، و
 * اگر اپ از اول زیرِ StrictMode توسعه یابد، آن باگ همان‌جا که ساخته می‌شود پیدا
 * می‌شود، نه بعداً.
 *
 * فونتِ Vazirmatn خودمیزبان بالای فایل import شده (P2)؛ گیتِ `document.fonts.ready`
 * برای رندرِ **بوم** در `fonts.ts` است، نه اینجا (پوسته با `font-display: swap`
 * مشکلی ندارد).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // تازه‌سازیِ منطقی؛ داشبورد در ۸٫۳ ریزترش می‌کند.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("عنصرِ #root پیدا نشد — index.html را ببین.");
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
