import type { BillingPeriod } from "@hamboom/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";

/**
 * کوئری‌های پرداخت و اشتراک (M4 فاز ۹) — قرینه‌ی [`team-queries`](../team/team-queries.ts).
 *
 * ★ هیچ منطقِ پولی این‌جا نیست: مبلغ کاملاً سمتِ سرور حساب می‌شود (ADR-014) و این لایه فقط
 * درخواست و بی‌اعتبارکردنِ کش است.
 */

/** فهرستِ پلن‌ها — **عمومی**، پس بدونِ نشست هم کار می‌کند (صفحه‌ی قیمت). */
export function usePlans() {
  return useQuery({
    queryKey: ["billing", "plans"],
    queryFn: () => api.billing.plans(),
    select: (data) => data.plans,
    // قیمت‌ها به‌ندرت عوض می‌شوند و این صفحه عمومی است.
    staleTime: 5 * 60_000,
  });
}

export function useSubscription(teamId: string) {
  return useQuery({
    queryKey: ["billing", teamId, "subscription"],
    queryFn: () => api.billing.subscription(teamId),
    // ⚠️ `null` یعنی تیمِ رایگان، نه خطا.
    select: (data) => data.subscription,
  });
}

export function useInvoices(teamId: string) {
  return useQuery({
    queryKey: ["billing", teamId, "invoices"],
    queryFn: () => api.billing.invoices(teamId),
    select: (data) => data.invoices,
  });
}

export interface CheckoutArgs {
  planCode: string;
  period: BillingPeriod;
  seats: number;
}

/**
 * شروعِ خرید → مرورگر به درگاه می‌رود.
 *
 * ★★ **کلیدِ idempotency این‌جا ساخته می‌شود، یک‌بار به‌ازای هر ژست** — نه در sdk و نه در
 * هر تلاشِ شبکه. اگر کاربر دو بار روی «ارتقا» بزند، همان کلید می‌رود و سرور **همان**
 * فاکتور را برمی‌گردانَد؛ وگرنه دو فاکتور و دو شماره‌ی رسمی ساخته می‌شود.
 *
 * ⚠️ `mutationKey` نداریم و react-query دو کلیکِ پیاپی را ادغام نمی‌کند — گاردِ واقعی
 * همان کلید است، نه UI.
 */
export function useCheckout(teamId: string) {
  return useMutation({
    mutationFn: (args: CheckoutArgs & { idempotencyKey: string }) =>
      api.billing.checkout(
        teamId,
        { planCode: args.planCode, period: args.period, seats: args.seats },
        { idempotencyKey: args.idempotencyKey },
      ),
  });
}

export function useCancelSubscription(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.billing.cancel(teamId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billing", teamId] });
      void qc.invalidateQueries({ queryKey: ["team", teamId] });
    },
  });
}

/**
 * ★ بعد از بازگشت از درگاه، کشِ اشتراک/تیم باید **دور ریخته** شود.
 *
 * صفحه‌ی نتیجه یک بارگذاریِ سردِ صفحه است، ولی کاربر معمولاً بلافاصله به داشبورد یا
 * صفحه‌ی billing برمی‌گردد — و آن‌جا اگر کشِ قبلی بماند، پلنِ **قدیمی** را می‌بیند و فکر
 * می‌کند پولش گم شده.
 */
export function useInvalidateBilling() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["billing"] });
    void qc.invalidateQueries({ queryKey: ["team"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
  };
}
