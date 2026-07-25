import { toPersianDigits } from "./numbers";
import { fa, type FaKey } from "./strings/fa";

/**
 * جست‌وجوی رشته با درج پارامتر — `t("connection.connected", { count: 3 })`.
 *
 * ساختار برای چند-زبانه بودن آماده است (نگاشتِ `catalogs`)، ولی الان فقط `fa`
 * (Q7). پارامترها با `{name}` در متن درج می‌شوند. اگر کلید نبود، **خودِ کلید**
 * برگردانده می‌شود تا در UI به‌جای رشته‌ی خالی، نبودِ ترجمه دیده شود.
 */

export type Locale = "fa";
export type TKey = FaKey;
export type TParams = Record<string, string | number>;

const catalogs: Record<Locale, Record<string, string>> = { fa };

let currentLocale: Locale = "fa";

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * درجِ پارامترها: `{name}` → مقدار. پارامترِ نبوده دست‌نخورده می‌ماند.
 * پارامترِ **عددی** به ارقام فارسی تبدیل می‌شود (P6) — پس `{ count: 3 }` می‌شود «۳».
 */
function interpolate(template: string, params: TParams): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? toPersianDigits(value) : value;
  });
}

export function t(key: TKey | (string & {}), params?: TParams): string {
  const template = catalogs[currentLocale][key] ?? key;
  return params ? interpolate(template, params) : template;
}
