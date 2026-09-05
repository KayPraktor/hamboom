import type { BillingPeriod } from "@hamboom/shared-types";

/**
 * دوره‌ی اشتراک و شماره‌ی فاکتور — [ADR-052](../../../ARCHITECTURE_DECISIONS.md#adr-052)،
 * [ADR-018](../../../ARCHITECTURE_DECISIONS.md#adr-018) (ذخیره UTC، نمایش جلالی).
 *
 * ★★ **یک منبعِ زمانِ واحد.** هر تابعِ این فایل لحظه‌ی مرجع را **پارامتر** می‌گیرد و هیچ‌جا
 * `new Date()` صدا نمی‌زند. دلیلش probeِ گام ۱٫۵ است: بینِ ~۲۰:۳۰ UTC و نیمه‌شبِ آخرین روزِ
 * اسفند، تهران از قبل واردِ سالِ جلالیِ بعد شده ولی روزِ UTC عوض نشده — پس اگر شماره‌ی فاکتور
 * از `new Date()`ِ خودش و `issued_at` از `now()`ِ دیتابیس بیاید، **سالی یک‌بار** دنباله
 * می‌شکند. اندازه‌گیری‌شده: `2027-03-20T20:00Z` ⇒ ۱۴۰۵ ولی یک ساعت بعد ⇒ ۱۴۰۶.
 */

const TEHRAN = "Asia/Tehran";

const jalaliYearFormatter = new Intl.DateTimeFormat("en-CA-u-ca-persian-nu-latn", {
  timeZone: TEHRAN,
  year: "numeric",
});

/**
 * سالِ جلالیِ یک لحظه، به وقتِ تهران.
 *
 * از `Intl`ِ بومی استفاده می‌کند، بدونِ کتابخانه‌ی تقویم (P1/ADR-018) — همان کاری که
 * `@hamboom/i18n` برای نمایش می‌کند. اینجا تکرار نشده تا `billing-core` به لایه‌ی نمایش
 * وابسته نشود؛ این یک عددِ **دامنه‌ای** است (در شماره‌ی فاکتور می‌نشیند)، نه یک قالبِ نمایشی.
 */
export function jalaliYearOf(at: Date): number {
  // خروجی مثلِ «1405 AP» است؛ فقط رقم‌ها را می‌خواهیم.
  const parsed = Number.parseInt(jalaliYearFormatter.format(at), 10);
  if (!Number.isInteger(parsed)) {
    throw new RangeError(`سالِ جلالی از «${at.toISOString()}» استخراج نشد.`);
  }
  return parsed;
}

/**
 * شماره‌ی فاکتور — `HB-1405-000123` ([PLAN §۵٫۱](../../../PLAN.md)).
 *
 * ⚠️ `sequence` باید **از دیتابیس** بیاید (یک دنباله‌ی اتمیک به‌ازای هر سالِ جلالی)، نه از
 * `max(number)+1` در کد: دو درخواستِ هم‌زمان همان عدد را می‌گیرند و دومی با ۲۳۵۰۵ می‌افتد —
 * **بعد از اینکه پول جابه‌جا شده**. کارِ فاز ۴ (migration `0004`).
 */
export function formatInvoiceNumber(issuedAt: Date, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError(`شماره‌ی دنباله باید عددِ صحیحِ مثبت باشد، نه «${String(sequence)}».`);
  }
  return `HB-${jalaliYearOf(issuedAt)}-${String(sequence).padStart(6, "0")}`;
}

export interface Period {
  start: Date;
  end: Date;
}

/**
 * دوره‌ی اشتراک از یک لنگرِ مشخص.
 *
 * ⚠️ **لنگر، لحظه‌ی پرداخت است، نه `now()`.** اگر آشتی‌دهی سه ساعت بعد اشتراک را فعال کند و
 * دوره به `now()` بسته شود، آن سه ساعت از مشتری کم می‌شود؛ روی یک سالِ تمدید، روزها.
 *
 * ⚠️ **حسابِ ماه با clampِ صریح.** ۳۱ فروردین + یک ماه در حسابِ ساده به ۳۱ اردیبهشتِ ناموجود
 * می‌افتد و موتور بی‌صدا به ماهِ بعد سُر می‌خورد (۳۱ ژانویه → ۳ مارس). اینجا به **آخرین روزِ
 * ماهِ مقصد** بسته می‌شود، که رفتارِ موردِ انتظارِ مشتری است.
 */
export function computePeriod(anchor: Date, period: BillingPeriod): Period {
  const start = new Date(anchor.getTime());
  const end = period === "yearly" ? addUtcMonths(start, 12) : addUtcMonths(start, 1);
  return { start, end };
}

/** ماه را در UTC جلو می‌برد و روز را به آخرین روزِ ماهِ مقصد **clamp** می‌کند. */
export function addUtcMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();

  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;

  // روزِ ۰ی ماهِ بعد = آخرین روزِ ماهِ جاری.
  const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTarget);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/**
 * آیا این پرداختِ `pending` آن‌قدر کهنه هست که sweep سراغش برود؟
 *
 * ⚠️ عددِ `staleAfterMs` **تصمیمِ فاز ۷** است، نه اینجا. دو ورودی دارد که هیچ‌کدام هنوز قطعی
 * نیستند: بازه‌ی مجازِ verify قبل از بازگشتِ خودکارِ پول (زرین‌پال عددش را نگفته) و انقضای
 * authorityِ پرداخت‌نشده — که در گام ۱٫۱ **دیده شد** (لینک بعد از ~۲۰ دقیقه منقضی شد) ولی
 * اندازه‌گیری‌شده نیست.
 */
export function isStalePending(requestedAt: Date, now: Date, staleAfterMs: number): boolean {
  return now.getTime() - requestedAt.getTime() >= staleAfterMs;
}
