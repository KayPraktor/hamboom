/**
 * تاریخِ جلالی در نمایش — [ADR-018](../../../ARCHITECTURE_DECISIONS.md#adr-018).
 *
 * ذخیره‌سازی همیشه UTC است؛ تبدیل به تقویم جلالی و منطقه‌ی زمانیِ تهران **فقط
 * اینجا، در لایه‌ی نمایش** انجام می‌شود — با `Intl.DateTimeFormat` و کلندرِ
 * `persian`ِ بومیِ زبان، بدون هیچ کتابخانه‌ی تبدیلِ تاریخ. ارقامِ خروجی هم به‌طور
 * خودکار فارسی‌اند چون locale برابر `fa-IR` است.
 */

const TEHRAN = "Asia/Tehran";
const LOCALE = "fa-IR-u-ca-persian";

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TEHRAN,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TEHRAN,
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TEHRAN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** «۳ مرداد ۱۴۰۵» */
export function formatJalaliDate(date: Date): string {
  return dateFmt.format(date);
}

/** «۳ مرداد ۱۴۰۵، ۱۴:۳۰» */
export function formatJalaliDateTime(date: Date): string {
  return dateTimeFmt.format(date);
}

/** «۱۴۰۵/۰۵/۰۳» — فشرده، برای جدول و لیست. */
export function formatJalaliShort(date: Date): string {
  return shortDateFmt.format(date);
}

/**
 * سالِ جلالیِ یک تاریخ به‌صورت **عدد** (نه رشته‌ی فارسی) — برای شماره‌ی فاکتور
 * (`HB-1405-000123`) که رشته‌ای لاتین است، نه نمایشی (ADR-018).
 */
export function jalaliYear(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    timeZone: TEHRAN,
    year: "numeric",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "0";
  return Number(year);
}
