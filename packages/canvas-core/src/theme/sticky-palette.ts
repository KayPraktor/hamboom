import type { HbStickyColor } from "@hamboom/shared-types";

/**
 * پالت استیکی‌نوت — استایل میرو.
 *
 * ⚠️ این رنگ‌ها **بازسازی سلیقه‌ای در همان خانواده‌ی رنگی** هستند، نه کپی از
 * توکن‌های میرو ([PLAN بخش ۷٫۳](../../../../PLAN.md)).
 *
 * ── قاعده‌ی خوانایی ───────────────────────────────────────────────────
 *
 * هر جفت `bg`/`text` باید به WCAG AA برسد (کنتراست ≥ ۴٫۵) و هر جفت
 * `bg`/`accent` به آستانه‌ی اجزای رابط (≥ ۳). این یک توصیه نیست — تستی در
 * `sticky-palette.test.ts` روی **هر دوازده رنگ** آن را اعمال می‌کند، پس
 * افزودن رنگ ناخوانا build را می‌شکند.
 *
 * دلیل اهمیتش برای این محصول: استیکی‌نوت پرکاربردترین عنصر یک بورد است و
 * متنش معمولاً کوتاه و کوچک — دقیقاً حالتی که کنتراست پایین در آن آزاردهنده
 * می‌شود.
 */

export interface StickySwatch {
  /** کلید پایدار — در سند ذخیره می‌شود، پس هرگز عوض نمی‌شود. */
  key: HbStickyColor;
  /** نام فارسی برای رابط کاربری. */
  nameFa: string;
  /** پس‌زمینه‌ی استیکی. */
  bg: string;
  /** رنگ متن روی همین پس‌زمینه. */
  text: string;
  /** نوار انتخاب و نشانگرهای رابط — تیره‌تر از `bg`، نه متن. */
  accent: string;
}

/**
 * دوازده رنگ، به ترتیب نمایش در پنل انتخاب رنگ.
 *
 * ترتیب عمدی است: از گرم به سرد، با خنثی‌ها در انتها — همان چیدمانی که
 * کاربر در ابزارهای مشابه انتظار دارد.
 */
export const HB_STICKY_PALETTE: readonly StickySwatch[] = [
  { key: "yellow", nameFa: "زرد", bg: "#FFF9B1", text: "#1A1A1A", accent: "#8A7500" },
  { key: "lime", nameFa: "مغزپسته‌ای", bg: "#D5F692", text: "#1A1A1A", accent: "#4F7A00" },
  { key: "green", nameFa: "سبز", bg: "#C9F2C7", text: "#1A1A1A", accent: "#1E7A3C" },
  { key: "mint", nameFa: "نعنایی", bg: "#B6F2E8", text: "#1A1A1A", accent: "#06705F" },
  { key: "sky", nameFa: "آبی آسمانی", bg: "#B3E5FC", text: "#1A1A1A", accent: "#0B5F8A" },
  { key: "blue", nameFa: "آبی", bg: "#A6CCF5", text: "#1A1A1A", accent: "#14508F" },
  { key: "violet", nameFa: "بنفش", bg: "#D0C6F5", text: "#1A1A1A", accent: "#4B3B9E" },
  { key: "pink", nameFa: "صورتی", bg: "#F5C0DF", text: "#1A1A1A", accent: "#93326B" },
  { key: "red", nameFa: "قرمز", bg: "#F5A9A9", text: "#1A1A1A", accent: "#9E2B2B" },
  { key: "orange", nameFa: "نارنجی", bg: "#FFCC96", text: "#1A1A1A", accent: "#8A4B00" },
  { key: "gray", nameFa: "خاکستری", bg: "#E6E6E6", text: "#1A1A1A", accent: "#4A4A4A" },
  { key: "black", nameFa: "مشکی", bg: "#2C2C2C", text: "#FFFFFF", accent: "#FFFFFF" },
] as const;

/** رنگ پیش‌فرض استیکی جدید. */
export const HB_STICKY_DEFAULT: HbStickyColor = "yellow";

const BY_KEY = new Map<HbStickyColor, StickySwatch>(HB_STICKY_PALETTE.map((s) => [s.key, s]));

/**
 * یک رنگ از پالت. اگر کلید ناشناخته باشد به پیش‌فرض برمی‌گردد، نه `undefined`.
 *
 * دلیل: کلید رنگ در سند ذخیره می‌شود و ممکن است از نسخه‌ای بیاید که رنگی
 * داشته که ما دیگر نداریم. برگرداندن `undefined` یعنی استیکی بدون رنگ رندر شود.
 */
export function getStickySwatch(key: HbStickyColor | string | undefined): StickySwatch {
  const swatch = key === undefined ? undefined : BY_KEY.get(key as HbStickyColor);
  return swatch ?? BY_KEY.get(HB_STICKY_DEFAULT)!;
}

/** کلیدهای پالت، به ترتیب نمایش. */
export const HB_STICKY_KEYS: readonly HbStickyColor[] = HB_STICKY_PALETTE.map((s) => s.key);
