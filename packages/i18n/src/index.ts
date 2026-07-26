/**
 * `@hamboom/i18n` — رشته‌های فارسی، اعداد فارسی، تاریخ جلالی.
 *
 * لایه‌ی نمایشِ فارسی/RTL (P6). فارسی native است نه ترجمه؛ تبدیل‌های عدد و
 * تاریخ فقط اینجا و با `Intl` بومی انجام می‌شوند، بدون کتابخانه‌ی اضافه
 * ([ADR-018](../../../ARCHITECTURE_DECISIONS.md#adr-018)).
 */

export { t, setLocale, getLocale } from "./t";
export type { Locale, TKey, TParams } from "./t";
export { fa } from "./strings/fa";
export type { FaKey } from "./strings/fa";

export { toPersianDigits, toLatinDigits, formatNumber, formatRial, formatToman } from "./numbers";

export {
  formatJalaliDate,
  formatJalaliDateTime,
  formatJalaliShort,
  jalaliParts,
  jalaliYear,
} from "./dates";
