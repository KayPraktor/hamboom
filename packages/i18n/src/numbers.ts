/**
 * اعداد فارسی — P6.
 *
 * برای قالب‌بندی از `Intl.NumberFormat("fa-IR")` استفاده می‌شود که هم ارقام
 * فارسی و هم جداکننده‌ی هزارگانِ فارسی را **بومی** می‌دهد؛ هیچ کتابخانه‌ی
 * اضافه‌ای لازم نیست (مثل تاریخ در [ADR-018](../../../ARCHITECTURE_DECISIONS.md#adr-018)).
 * `toPersianDigits`/`toLatinDigits` سطحِ پایین‌اند — برای جاهایی که فقط باید
 * ارقام یک رشته عوض شوند (شماره‌ی فاکتور، ورودی فرم) نه یک عددِ قالب‌بندی‌شده.
 */

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

/** ارقام لاتینِ یک رشته/عدد را به فارسی تبدیل می‌کند (بقیه‌ی نویسه‌ها دست‌نخورده). */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/** ارقام فارسی/عربیِ یک رشته را به لاتین برمی‌گرداند — برای پارس کردنِ ورودی کاربر. */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const code = d.codePointAt(0) ?? 0;
    // بازه‌ی فارسی (U+06F0) و عربی (U+0660) هر دو صفرتا‌نه‌اند.
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return d;
  });
}

const faNumber = new Intl.NumberFormat("fa-IR");

/** یک عدد را با ارقام و جداکننده‌ی هزارگانِ فارسی قالب می‌کند. */
export function formatNumber(value: number | bigint): string {
  return faNumber.format(value);
}

/**
 * نمایشِ مبلغ به **ریال**. ورودی همیشه ریالِ صحیح است (P5) — هیچ تبدیلی لازم نیست.
 */
export function formatRial(rial: bigint | number): string {
  return `${formatNumber(rial)} ریال`;
}

/**
 * نمایشِ مبلغ به **تومان**. تبدیل (÷۱۰) فقط همین‌جا، در لایه‌ی نمایش، رخ می‌دهد
 * (P5). ریالِ غیرمضربِ ۱۰ در نمایش به تومان کوتاه می‌شود — مقدارِ حقیقی ریال است.
 */
export function formatToman(rial: bigint | number): string {
  const toman = typeof rial === "bigint" ? rial / 10n : Math.trunc(rial / 10);
  return `${formatNumber(toman)} تومان`;
}
