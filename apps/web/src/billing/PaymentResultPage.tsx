import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useSession } from "../auth/session-context.ts";
import { useInvalidateBilling } from "./billing-queries.ts";

/**
 * صفحه‌ی بازگشت از درگاه (M4 فاز ۹ گام ۹٫۴).
 *
 * ★★ **دو تله‌ای که این صفحه را از بقیه جدا می‌کند:**
 *
 * ۱. **این یک بارگذاریِ سردِ صفحه است، نه ناوبریِ SPA.** کاربر از دامنه‌ی درگاه برگشته، پس
 *    توکنِ دسترسی — که فقط در closureی sdk زندگی می‌کند — **از بین رفته**. اگر این صفحه
 *    زیرِ `RequireAuth` برود، پیش از آنکه `SessionProvider` نشست را از کوکی بازسازی کند به
 *    `/login` می‌پرد و کاربر فکر می‌کند پولش گم شده. پس **بدونِ گارد** است و نتیجه را
 *    بی‌درنگ نشان می‌دهد.
 *
 * ۲. ★ **تسویه این‌جا انجام نمی‌شود.** پیش از رسیدنِ مرورگر به این صفحه، api در
 *    `/billing/zarinpal/callback` سرور-به-سرور verify کرده و اشتراک را فعال کرده است. این
 *    صفحه فقط **گزارش** می‌دهد. اگر تسویه را این‌جا می‌گذاشتیم، کاربری که تبَش را بست
 *    هرگز سرویسش را نمی‌گرفت — دقیقاً همان چیزی که آشتی‌دهی برای نجاتش ساخته شد.
 *
 * ⚠️ `done` refِ StrictMode لازم است (مثلِ [`InviteAcceptPage`](../team/InviteAcceptPage.tsx)):
 * زیرِ StrictMode افکت دوبار اجرا می‌شود.
 */
export function PaymentResultPage() {
  const { status } = useSearch({ from: "/payment/result" });
  const session = useSession();
  const invalidate = useInvalidateBilling();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // ★ کشِ اشتراک/تیم باید دور ریخته شود، وگرنه کاربر با برگشت به داشبورد **پلنِ قدیمی**
    //   را می‌بیند و فکر می‌کند پرداختش اثر نکرده.
    if (status === "ok") invalidate();
  }, [status, invalidate]);

  const ownedTeam = session.teams.find((t) => t.myRole === "owner");

  return (
    <div className="card payment-result">
      {status === "ok" ? (
        <>
          <h1>پرداخت انجام شد ✅</h1>
          <p>اشتراکت فعال شد. رسیدِ این پرداخت در فهرستِ فاکتورها هست.</p>
        </>
      ) : status === "failed" ? (
        <>
          <h1>پرداخت کامل نشد</h1>
          <p>
            اگر مبلغی از حسابت کم شده، نگران نباش: تا ۷۲ ساعت به‌صورت خودکار بررسی می‌شود و
            اگر پرداخت واقعاً انجام شده باشد اشتراکت فعال می‌شود. وگرنه مبلغ به حسابت
            برمی‌گردد.
          </p>
        </>
      ) : (
        <>
          <h1>بازگشت از درگاه نامعتبر بود</h1>
          <p>این آدرس پارامترهای درستی نداشت. اگر پرداختی انجام داده‌ای، از صفحه‌ی پرداختِ تیم پیگیری کن.</p>
        </>
      )}

      <div className="payment-result__actions">
        {/* ⚠️ لینک‌ها فقط وقتی تیم را می‌شناسیم نشان داده می‌شوند؛ در بارگذاریِ سرد ممکن است
            نشست هنوز در حالِ بازسازی باشد. */}
        {ownedTeam !== undefined && (
          <Link
            to="/team/$teamId/billing"
            params={{ teamId: ownedTeam.id }}
            search={{ plan: undefined, period: undefined }}
            className="btn btn--primary"
          >
            صفحه‌ی پرداختِ تیم
          </Link>
        )}
        <Link to="/dashboard" className="btn btn--ghost">
          داشبورد
        </Link>
      </div>

      {session.status === "loading" && <p className="billing-note">در حال بازسازیِ نشست…</p>}
    </div>
  );
}
