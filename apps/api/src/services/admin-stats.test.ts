import { describe, expect, it } from "vitest";

import { buildPlansQuery, buildSeriesQuery, buildTotalsQuery } from "./admin-stats.ts";

/**
 * ★ M6 ۷٫۲ — **شکلِ SQL**، خالص و بدونِ دیتابیس (همان سبکِ `buildPaymentQuery`).
 *
 * ⚠️⚠️ **چرا این فایل لازم بود:** اولین نسخه‌ی چکِ `sdk:contract` ادعا می‌کرد افتادنِ یک `::bigint`
 * را می‌گیرد. با شکستنِ عمدی معلوم شد **نمی‌گیرد**: `toAdminStats` هر مقدار را از `Number()` رد
 * می‌کند، پس رشته پیش از رسیدن به قرارداد به عدد تبدیل می‌شود و چک سبز می‌مانَد. آن چک شکلِ
 * **خروجیِ API** را می‌سنجد (که ارزشِ خودش را دارد)، و این فایل شکلِ **کوئری** را.
 *
 * ★ و `::bigint` واقعاً باربر است، نه تشریفات: بدونش `sum()` نوعِ `numeric` می‌دهد که استخر
 * کوئرس نمی‌کند، و `Number()`ِ mapper روی عددِ بزرگ‌تر از `MAX_SAFE_INTEGER` **بی‌صدا** دقت را
 * می‌بازد — در حالی که مسیرِ `::bigint` همان‌جا `RangeError` می‌دهد (P5).
 */

/** هر `count(` یا `sum(` باید بلافاصله بعد از پرانتزِ بسته‌اش `::bigint` داشته باشد. */
function aggregatesWithoutCast(sql: string): string[] {
  const bad: string[] = [];
  const re = /\b(count|sum|avg)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    // تا پرانتزِ متناظر جلو برو
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < sql.length; i += 1) {
      if (sql[i] === "(") depth += 1;
      else if (sql[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    // ⚠️ cast می‌تواند بعد از `coalesce(...)` بنشیند، نه بلافاصله بعد از خودِ تجمیع:
    //    `coalesce(sum(x), 0)::bigint`. دمِ coalesce رد می‌شود، بعد cast الزامی است.
    const after = sql.slice(i + 1, i + 24).replace(/^,\s*\d+\)/, "");
    if (!after.startsWith("::bigint")) bad.push(sql.slice(m.index, i + 24).replace(/\s+/g, " "));
  }
  return bad;
}

describe("buildTotalsQuery — B-2 و پنجره", () => {
  const q = buildTotalsQuery(30);

  it("★★ هیچ تجمیعی بدونِ `::bigint` نیست (B-2)", () => {
    expect(aggregatesWithoutCast(q.text)).toEqual([]);
  });

  it("★ هیچ `avg(` ای نیست — آن هم numeric می‌دهد و هیچ‌جا لازم نبود", () => {
    expect(/\bavg\s*\(/i.test(q.text)).toBe(false);
  });

  it("پنجره از **روزِ تهران** شروع می‌شود و `days` تنها پارامتر است", () => {
    expect(q.text).toContain("AT TIME ZONE 'Asia/Tehran'");
    expect(q.text).toContain("make_interval(days => $1::int - 1)");
    expect(q.params).toEqual([30]);
  });

  it("★ حذف‌شده‌ها شمرده نمی‌شوند، ولی سطلِ بازیافت **جدا** شمرده می‌شود", () => {
    expect(q.text).toContain("FROM boards WHERE deleted_at IS NULL) AS boards_live");
    expect(q.text).toContain("FROM boards WHERE deleted_at IS NOT NULL) AS boards_trashed");
  });

  it("★★ درآمدِ ناخالص `refunded` را هم می‌شمارد — آن ردیف روزی واقعاً پرداخت شده", () => {
    expect(q.text).toContain("WHERE status IN ('paid', 'refunded')) AS revenue_gross");
    expect(q.text).toContain("WHERE status = 'refunded') AS revenue_refunded");
  });

  it("پرچمِ «آیا اصلاً فعالیتی ثبت شده» جدا از شمارشِ فعال‌هاست", () => {
    expect(q.text).toContain("last_seen_at IS NOT NULL) AS users_seen_any");
  });
});

describe("buildPlansQuery — تیمِ بی‌اشتراک گم نشود", () => {
  const q = buildPlansQuery();

  it("★★ از `teams` شروع می‌شود و `subscriptions` را LEFT JOIN می‌کند", () => {
    // شروع از subscriptions هر تیمِ رایگان/شخصی را بی‌صدا حذف می‌کرد — یعنی اکثریتِ تیم‌ها.
    expect(q.text).toContain("FROM teams t");
    expect(q.text).toContain("LEFT JOIN subscriptions s");
    expect(q.text).toContain("CASE WHEN t.is_personal THEN 'personal' ELSE 'free' END");
  });

  it("فقط اشتراکِ **زنده** (همان سه‌تاییِ ایندکسِ یکتا) و فقط تیمِ حذف‌نشده", () => {
    expect(q.text).toContain("s.status IN ('trialing', 'active', 'past_due')");
    expect(q.text).toContain("t.deleted_at IS NULL");
  });

  it("هیچ تجمیعی بدونِ `::bigint`", () => {
    expect(aggregatesWithoutCast(q.text)).toEqual([]);
  });
});

describe("buildSeriesQuery — سریِ صفر‌پُر", () => {
  const q = buildSeriesQuery(14);

  it("★ `generate_series` روزها را می‌سازد و هر سری LEFT JOIN می‌شود (روزِ خالی = نقطه‌ی صفر)", () => {
    expect(q.text).toContain("generate_series(");
    expect((q.text.match(/LEFT JOIN/g) ?? []).length).toBe(3);
    expect((q.text.match(/coalesce\((b|u|r)\.value, 0\)::bigint/g) ?? []).length).toBe(3);
  });

  it("★★ سطل **روزِ تهران** است و دوباره به لحظه برمی‌گردد تا نما ریاضیِ منطقه‌ای نکند", () => {
    expect(q.text).toContain("date_trunc('day', created_at AT TIME ZONE 'Asia/Tehran')");
    expect(q.text).toContain("date_trunc('day', paid_at AT TIME ZONE 'Asia/Tehran')");
    expect(q.text).toContain("(d.day AT TIME ZONE 'Asia/Tehran') AS bucket");
    // و هیچ‌جا سطلِ UTCِ برهنه نیست
    expect(/date_trunc\('day', \w+\)/.test(q.text)).toBe(false);
  });

  it("هر سه سری در یک رفت‌وبرگشت، و درآمد از `paid_at` می‌آید نه `requested_at`", () => {
    expect((q.text.match(/UNION ALL/g) ?? []).length).toBe(2);
    expect(q.text).toContain("FROM payments WHERE status IN ('paid', 'refunded') AND paid_at >=");
    expect(q.params).toEqual([14]);
  });

  it("هیچ تجمیعی بدونِ `::bigint`", () => {
    expect(aggregatesWithoutCast(q.text)).toEqual([]);
  });
});
