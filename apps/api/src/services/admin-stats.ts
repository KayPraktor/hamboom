/**
 * آمارِ محصول برای پنلِ ادمین — M6 فاز ۷٫۲ (M6-D8).
 *
 * ★★ **فقط SQLِ خالص، بدونِ هیچ جدولِ شمارنده.** درسِ B-5ِ M4: `usage_counters` ساخته شد، هیچ‌وقت
 * به‌روز نشد، و در M5 حذف شد. یک شمارنده‌ی نادرست از نبودِ شمارنده بدتر است.
 *
 * ★★ **هر تجمیعی `::bigint` می‌خورد (B-2).** `sum()` روی ستونِ `bigint` نوعِ `numeric` (OID ۱۷۰۰)
 * برمی‌گرداند و کوئرسِ `int8→number`ِ استخر آن را **نمی‌پوشانَد** ⇒ پول به‌صورتِ **رشته** برمی‌گشت،
 * در حالی که `count(*)` در همان ردیف عدد است و همه‌چیز سالم به‌نظر می‌رسید. روی PGِ زنده تایید شد:
 * `sum(x)` → OID ۱۷۰۰ · `sum(x)::bigint` → OID ۲۰. (و `avg` هم ۱۷۰۰ است، پس اصلاً استفاده نمی‌شود.)
 *
 * ★★ **سطلِ روزانه، روزِ تهران است نه UTC** (انحرافِ تاییدشده‌ی «الف»). لایه‌ی نمایش
 * (`@hamboom/i18n`) منطقه را روی `Asia/Tehran` پین کرده؛ اگر سطل UTC باشد، برچسبِ جلالیِ یک روز
 * روی بازه‌ی ۰۳:۳۰ تا ۰۳:۳۰ می‌نشیند. روی داده‌ی همین ماشین **۴ از ۱۶** سطل روزِ دیگری می‌افتاد.
 * سرور سطل را دوباره به **لحظه** تبدیل می‌کند تا نما هیچ ریاضیِ منطقه‌ای نکند.
 *
 * ★ **سری صفر‌پُر است.** یک نمودار با روزهای غایب دروغ می‌گوید (روزِ بی‌بورد از نمودار حذف
 * می‌شود و شیب را عوض می‌کند)، پس `generate_series` چپ‌جوین می‌شود.
 *
 * ⚠️ **ایندکس عمداً اضافه نشد.** اندازه‌گیریِ ۷٫۰ روی جدولِ ۳۰۰هزار ردیفی: سریِ ۳۰ روزه **۱۶ms**
 * بدونِ ایندکس، **۵ms** با ایندکسِ جزئی (۳٫۶×) به قیمتِ ۶٫۱MB روی جدولِ ۱۳MB. برای صفحه‌ای که
 * روزی چند بار باز می‌شود نمی‌ارزد. تریگرِ بازنگری: وقتی این عدد از ~۲۰۰ms رد شود.
 */
import type { Executor } from "../plugins/db.ts";

/** ⚠️ ثابت، نه env: مخاطبِ این پنل ایران است و یک منطقه‌ی زمانیِ قابلِ تنظیم فقط ابهام می‌ساخت. */
const TEHRAN = "Asia/Tehran";

/** لحظه‌ی شروعِ روزِ تهران، `days - 1` روز پیش — یعنی سری دقیقاً `days` سطل دارد که آخری «امروز» است. */
const WINDOW_START = `(date_trunc('day', now() AT TIME ZONE '${TEHRAN}') - make_interval(days => $1::int - 1)) AT TIME ZONE '${TEHRAN}'`;

/** ردیفِ خامِ کوئریِ مجموع‌ها. مقادیر `number` می‌آیند (OID ۲۰)، ولی مثلِ بقیه‌ی سرویس‌ها دفاعی تایپ می‌شوند. */
export interface StatsTotalsRow {
  generated_at: Date | string;
  users_total: number | string;
  users_suspended: number | string;
  users_staff: number | string;
  users_1d: number | string;
  users_7d: number | string;
  users_30d: number | string;
  users_new: number | string;
  users_seen_any: number | string;
  boards_live: number | string;
  boards_trashed: number | string;
  boards_new: number | string;
  teams_total: number | string;
  teams_personal: number | string;
  teams_new: number | string;
  revenue_gross: number | string;
  revenue_refunded: number | string;
  revenue_window: number | string;
}

export interface StatsPlanRow {
  plan_code: string;
  plan_name: string;
  period: string | null;
  teams: number | string;
  seats: number | string;
}

export interface StatsSeriesRow {
  kind: "boards" | "users" | "revenue";
  bucket: Date | string;
  value: number | string;
}

export interface StatsRows {
  totals: StatsTotalsRow;
  plans: StatsPlanRow[];
  series: StatsSeriesRow[];
}

/** یک کوئری، همه‌ی مجموع‌ها — خالص، برای تست بدونِ دیتابیس. */
export function buildTotalsQuery(days: number): { text: string; params: unknown[] } {
  // ⚠️ «درآمدِ ناخالص» یعنی پولی که یک‌بار **واقعاً پرداخت شده**؛ ردیفِ `refunded` هم روزی `paid`
  //    بوده و `paid_at`ش با استرداد پاک نمی‌شود (`payments_paid_at_ck`). حذفش درآمدِ تاریخی را
  //    بازنویسی می‌کند، که دروغ است — استرداد جداگانه گزارش می‌شود.
  const text = `
    SELECT now() AS generated_at,
           (SELECT count(*)::bigint FROM users WHERE deleted_at IS NULL) AS users_total,
           (SELECT count(*)::bigint FROM users WHERE deleted_at IS NULL AND status = 'suspended') AS users_suspended,
           (SELECT count(*)::bigint FROM users WHERE deleted_at IS NULL AND is_staff) AS users_staff,
           (SELECT count(*)::bigint FROM users WHERE deleted_at IS NULL AND last_seen_at >= now() - interval '1 day') AS users_1d,
           (SELECT count(*)::bigint FROM users WHERE deleted_at IS NULL AND last_seen_at >= now() - interval '7 days') AS users_7d,
           (SELECT count(*)::bigint FROM users WHERE deleted_at IS NULL AND last_seen_at >= now() - interval '30 days') AS users_30d,
           (SELECT count(*)::bigint FROM users WHERE deleted_at IS NULL AND created_at >= ${WINDOW_START}) AS users_new,
           (SELECT count(*)::bigint FROM users WHERE last_seen_at IS NOT NULL) AS users_seen_any,
           (SELECT count(*)::bigint FROM boards WHERE deleted_at IS NULL) AS boards_live,
           (SELECT count(*)::bigint FROM boards WHERE deleted_at IS NOT NULL) AS boards_trashed,
           (SELECT count(*)::bigint FROM boards WHERE deleted_at IS NULL AND created_at >= ${WINDOW_START}) AS boards_new,
           (SELECT count(*)::bigint FROM teams WHERE deleted_at IS NULL) AS teams_total,
           (SELECT count(*)::bigint FROM teams WHERE deleted_at IS NULL AND is_personal) AS teams_personal,
           (SELECT count(*)::bigint FROM teams WHERE deleted_at IS NULL AND created_at >= ${WINDOW_START}) AS teams_new,
           (SELECT coalesce(sum(amount_rial), 0)::bigint FROM payments WHERE status IN ('paid', 'refunded')) AS revenue_gross,
           (SELECT coalesce(sum(refund_amount_rial), 0)::bigint FROM payments WHERE status = 'refunded') AS revenue_refunded,
           (SELECT coalesce(sum(amount_rial), 0)::bigint FROM payments
             WHERE status IN ('paid', 'refunded') AND paid_at >= ${WINDOW_START}) AS revenue_window`;
  return { text, params: [days] };
}

/**
 * تیم‌ها به تفکیکِ پلن.
 *
 * ★★ از `teams` شروع می‌شود، نه از `subscriptions`. تیمی که ردیفِ اشتراک ندارد **بی‌پلن نیست**:
 * همان قاعده‌ی `PLAN_CODE_SQL`ِ `dto.ts` به `personal`/`free` می‌رساندش. شروع از `subscriptions`
 * هر تیمِ رایگان و شخصی را بی‌صدا از نمودار حذف می‌کرد — یعنی اکثریتِ تیم‌ها.
 *
 * ⚠️ `seats` صندلیِ **فروخته‌شده** است (`subscriptions.seats`)، نه شمارشِ عضو؛ برای پلنِ بی‌ردیف صفر است.
 * `team_members` تاریخچه ندارد (خروج ردیف را hard-delete می‌کند) پس عددِ دیگری قابلِ اتکا نیست.
 */
export function buildPlansQuery(): { text: string; params: unknown[] } {
  const text = `
    SELECT p.code AS plan_code, p.name AS plan_name, s.period,
           count(*)::bigint AS teams,
           coalesce(sum(s.seats), 0)::bigint AS seats
      FROM teams t
      LEFT JOIN subscriptions s
        ON s.team_id = t.id AND s.status IN ('trialing', 'active', 'past_due')
      JOIN plans p
        ON p.code = coalesce(s.plan_code, CASE WHEN t.is_personal THEN 'personal' ELSE 'free' END)
     WHERE t.deleted_at IS NULL
     GROUP BY p.code, p.name, p.sort_order, s.period
     ORDER BY p.sort_order, p.code, s.period NULLS FIRST`;
  return { text, params: [] };
}

/**
 * هر سه سری در **یک** رفت‌وبرگشت، صفر‌پُر.
 *
 * ★ `generate_series` روی روزهای تهران ساخته می‌شود و هر سری چپ‌جوین می‌شود، پس روزِ بی‌رویداد
 * هم یک نقطه‌ی صفر دارد. بدونِ این، نمودار روزهای خالی را حذف می‌کرد و شیب را عوض می‌داد.
 */
export function buildSeriesQuery(days: number): { text: string; params: unknown[] } {
  const bucket = (col: string): string => `date_trunc('day', ${col} AT TIME ZONE '${TEHRAN}')`;
  const text = `
    WITH d AS (
      SELECT generate_series(
               date_trunc('day', now() AT TIME ZONE '${TEHRAN}') - make_interval(days => $1::int - 1),
               date_trunc('day', now() AT TIME ZONE '${TEHRAN}'),
               interval '1 day') AS day
    ),
    b AS (
      SELECT ${bucket("created_at")} AS day, count(*)::bigint AS value
        FROM boards WHERE deleted_at IS NULL AND created_at >= ${WINDOW_START} GROUP BY 1
    ),
    u AS (
      SELECT ${bucket("created_at")} AS day, count(*)::bigint AS value
        FROM users WHERE deleted_at IS NULL AND created_at >= ${WINDOW_START} GROUP BY 1
    ),
    r AS (
      SELECT ${bucket("paid_at")} AS day, coalesce(sum(amount_rial), 0)::bigint AS value
        FROM payments WHERE status IN ('paid', 'refunded') AND paid_at >= ${WINDOW_START} GROUP BY 1
    )
    SELECT 'boards' AS kind, (d.day AT TIME ZONE '${TEHRAN}') AS bucket, coalesce(b.value, 0)::bigint AS value
      FROM d LEFT JOIN b USING (day)
    UNION ALL
    SELECT 'users', (d.day AT TIME ZONE '${TEHRAN}'), coalesce(u.value, 0)::bigint
      FROM d LEFT JOIN u USING (day)
    UNION ALL
    SELECT 'revenue', (d.day AT TIME ZONE '${TEHRAN}'), coalesce(r.value, 0)::bigint
      FROM d LEFT JOIN r USING (day)
    ORDER BY 1, 2`;
  return { text, params: [days] };
}

/** سه رفت‌وبرگشت، هیچ‌کدام تراکنش نمی‌خواهند (فقط خواندن؛ ناهم‌زمانیِ چند میلی‌ثانیه‌ای بی‌اهمیت است). */
export async function readStats(db: Executor, days: number): Promise<StatsRows> {
  const totalsQ = buildTotalsQuery(days);
  const plansQ = buildPlansQuery();
  const seriesQ = buildSeriesQuery(days);
  const [totals, plans, series] = await Promise.all([
    db.query<StatsTotalsRow>(totalsQ.text, totalsQ.params),
    db.query<StatsPlanRow>(plansQ.text, plansQ.params),
    db.query<StatsSeriesRow>(seriesQ.text, seriesQ.params),
  ]);
  const row = totals.rows[0];
  if (row === undefined) throw new Error("کوئریِ مجموع‌ها هیچ ردیفی برنگرداند");
  return { totals: row, plans: plans.rows, series: series.rows };
}
