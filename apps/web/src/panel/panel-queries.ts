import type {
  AdminMe,
  AdminPaymentQuery,
  AdminUserDetail,
  ReconcileRequest,
  RefundRequest,
} from "@hamboom/shared-types";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";

/**
 * hookهای پنلِ ادمین — M6 فاز ۳. همه روی `sdk.admin.*`؛ کلیدها با پیشوندِ `["admin", …]` تا
 * فازهای بعد (کاربران، پرداخت‌ها، audit) کنارِ هم بنشینند و با خروج یک‌جا باطل شوند.
 */
export const adminMeKey = ["admin", "me"] as const;

/** `GET /admin/me` — کیستم + آخرین step-up. ۴۰۳ برای غیرِ staff (که `RequireStaff` جلوترش را گرفته). */
export function useAdminMe() {
  return useQuery({ queryKey: adminMeKey, queryFn: () => api.admin.me() });
}

/** درخواستِ کدِ step-up به شماره‌ی خودِ staff. */
export function useStepUpRequest() {
  return useMutation({ mutationFn: () => api.admin.stepUp.request() });
}

/** تاییدِ کد → پاسخِ تازه‌ی `adminMe` مستقیم در کش می‌نشیند (بدونِ refetchِ دوم). */
export function useStepUpVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.admin.stepUp.verify({ code }),
    onSuccess: (me: AdminMe) => {
      qc.setQueryData(adminMeKey, me);
    },
  });
}

// ── فاز ۵ — کاربران و تیم‌ها (ADR-066) ─────────────────────────────────────
export const adminUserKey = (id: string) => ["admin", "users", id] as const;
export const adminTeamKey = (id: string) => ["admin", "teams", id] as const;

/** `POST /admin/search` — فقط با q ناتهی؛ کلید شاملِ q تا هر جست‌وجو کشِ خودش را داشته باشد (کش فقط در حافظه). */
export function useAdminSearch(q: string) {
  return useQuery({
    queryKey: ["admin", "search", q] as const,
    queryFn: () => api.admin.search(q),
    enabled: q.trim().length > 0,
  });
}

export function useAdminUser(id: string) {
  return useQuery({ queryKey: adminUserKey(id), queryFn: () => api.admin.users.get(id) });
}

/** نمای پشتیبانی — بوردهای کاربر با نقشِ خودش (۵٫۴). */
export function useAdminUserBoards(id: string) {
  return useQuery({
    queryKey: [...adminUserKey(id), "boards"] as const,
    queryFn: () => api.admin.users.boards(id),
  });
}

export function useAdminTeam(id: string) {
  return useQuery({ queryKey: adminTeamKey(id), queryFn: () => api.admin.teams.get(id) });
}

/** شماره‌ی کامل — هر کلیک یک ردیفِ audit (`user.phone.reveal`)؛ عمداً کش نمی‌شود. */
export function useRevealPhone(id: string) {
  return useMutation({ mutationFn: () => api.admin.users.revealPhone(id) });
}

/**
 * تعلیق/رفعِ تعلیق — پاسخ (AdminUserSummary) روی جزئیاتِ کش‌شده می‌نشیند و فهرستِ جست‌وجو باطل می‌شود.
 * ⚠️ ۴۲۸ `STEP_UP_REQUIRED` را مصرف‌کننده می‌گیرد و فرمِ step-up را نشان می‌دهد؛ این hook چیزی را پنهان نمی‌کند.
 */
export function useSuspend(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.admin.users.suspend(id, { reason }),
    onSuccess: (u) => {
      qc.setQueryData(adminUserKey(id), (old: AdminUserDetail | undefined) =>
        old === undefined ? old : { ...old, ...u },
      );
      // شمارش‌ها (نشست‌های زنده) در پاسخِ summary نیستند ⇒ جزئیات دوباره خوانده می‌شود؛ وضعیتِ عضو در
      // صفحه‌ی تیم هم (یافته‌ی ۵٫۵: staleTime ۳۰s «فعال» را نگه می‌داشت).
      void qc.invalidateQueries({ queryKey: adminUserKey(id) });
      void qc.invalidateQueries({ queryKey: ["admin", "search"] });
      void qc.invalidateQueries({ queryKey: ["admin", "teams"] });
    },
  });
}

export function useUnsuspend(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.admin.users.unsuspend(id),
    onSuccess: (u) => {
      qc.setQueryData(adminUserKey(id), (old: AdminUserDetail | undefined) =>
        old === undefined ? old : { ...old, ...u },
      );
      void qc.invalidateQueries({ queryKey: adminUserKey(id) });
      void qc.invalidateQueries({ queryKey: ["admin", "search"] });
      void qc.invalidateQueries({ queryKey: ["admin", "teams"] });
    },
  });
}

// ── فاز ۶ — پرداخت‌ها و استرداد (ADR-068) ──────────────────────────────────
export const adminPaymentKey = (id: string) => ["admin", "payments", id] as const;

/**
 * فهرستِ پرداخت‌ها — `useInfiniteQuery` روی `nextCursor` (همان الگوی `/panel/audit`).
 *
 * ★ فیلترها بخشی از کلیدند، پس تغییرشان صفحه‌ها را از نو می‌سازد — با keyset هیچ offsetی جا نمی‌ماند.
 */
export function useAdminPayments(filter: Partial<AdminPaymentQuery>) {
  return useInfiniteQuery({
    queryKey: ["admin", "payments", "list", filter] as const,
    queryFn: ({ pageParam }) => api.admin.payments.list({ ...filter, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useAdminPayment(id: string) {
  return useQuery({ queryKey: adminPaymentKey(id), queryFn: () => api.admin.payments.get(id) });
}

/**
 * جهش‌های پرداخت — هر سه یک کار با کش می‌کنند: **جزئیات و فهرست را باطل می‌کنند**.
 *
 * ⚠️ فقط `setQueryData` کافی نیست: پاسخِ این مسیرها `AdminPaymentSummary` است، ولی صفحه‌ی جزئیات
 * `expireBlocked`/اشتراک/فاکتور را هم نشان می‌دهد که بعد از عمل عوض می‌شوند (یافته‌ی ۵٫۵، این‌بار روی پرداخت).
 * ★ و `["admin","teams"]` هم باطل می‌شود: استرداد اشتراکِ تیم را لغو می‌کند و صفحه‌ی تیم پلن را نشان می‌دهد.
 */
function usePaymentMutation<TVars, TData>(
  id: string,
  fn: (vars: TVars) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminPaymentKey(id) });
      void qc.invalidateQueries({ queryKey: ["admin", "payments", "list"] });
      void qc.invalidateQueries({ queryKey: ["admin", "teams"] });
    },
  });
}

export function useVerifyPayment(id: string) {
  return usePaymentMutation(id, () => api.admin.payments.verify(id));
}

export function useExpirePayment(id: string) {
  return usePaymentMutation(id, (reason: string) => api.admin.payments.expire(id, { reason }));
}

export function useRefundPayment(id: string) {
  return usePaymentMutation(id, (body: RefundRequest) => api.admin.payments.refund(id, body));
}

/**
 * sweepِ دستی — روی هیچ کلیدی ننشیند: نتیجه‌اش یک **گزارشِ یک‌بارمصرف** است، نه وضعیتِ یک منبع.
 * ولی فهرست باطل می‌شود، چون ممکن است چند ردیف فعال/باطل شده باشند.
 */
export function useReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReconcileRequest) => api.admin.payments.reconcile(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "payments", "list"] });
    },
  });
}

// ── فاز ۷ — آمار و وضعیتِ سیستم (ADR-067) ─────────────────────────────────

export const adminStatsKey = (days: number) => ["admin", "stats", days] as const;
export const adminSystemKey = ["admin", "system"] as const;
export const adminFlagsKey = ["admin", "feature-flags"] as const;

/** `GET /admin/stats` — `days` بخشی از کلید است تا هر پنجره کشِ خودش را داشته باشد. */
export function useAdminStats(days: number) {
  return useQuery({ queryKey: adminStatsKey(days), queryFn: () => api.admin.stats({ days }) });
}

/**
 * `GET /admin/system` — ⚠️ برخلافِ بقیه‌ی hookها، این یکی **probeِ شبکه** می‌زند (S3، Redis).
 * پس نه با فوکوسِ پنجره refetch می‌شود و نه با mountِ دوباره؛ تازه‌سازی **دستی** است تا
 * باز‌کردنِ یک تب، سه سرویس را بی‌دلیل صدا نزند.
 */
export function useAdminSystem() {
  return useQuery({
    queryKey: adminSystemKey,
    queryFn: () => api.admin.system(),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 30_000,
  });
}

/** نمای فقط‌خواندنیِ پرچم‌ها (M6-D7) — امروز عمداً خالی است. */
export function useAdminFeatureFlags() {
  return useQuery({ queryKey: adminFlagsKey, queryFn: () => api.admin.featureFlags() });
}
