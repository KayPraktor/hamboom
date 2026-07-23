/**
 * تشخیص جهت متن — پیاده‌سازی [ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024).
 *
 * **این تنها منبع حقیقت جهت در کل ماژول است.** هر سه مصرف‌کننده باید از همین
 * تابع بخوانند، وگرنه متن هنگام ورود و خروج از حالت ویرایش می‌پرد:
 *
 * 1. `ctx.direction` در مسیر رندر بوم (`engine/canvas-direction.ts`)
 * 2. صفت `dir` روی textarea ویرایشگر inline
 * 3. پیش‌فرض `textAlign` عنصر
 */

/**
 * خط‌های راست‌به‌چپ، با property escape یونیکد.
 *
 * ⚠️ نسخه‌ی اول این فایل از بازه‌ی دستی `U+0600–U+06FF` استفاده می‌کرد و تست
 * یک باگ واقعی گرفت: آن بازه **ارقام فارسی** (`U+06F0–U+06F9`) را هم شامل
 * می‌شود، در حالی که طبق یونیکد رقم‌ها کاراکتر «قوی» نیستند و نباید در
 * رای‌گیری جهت شرکت کنند. شرط `\p{L}` این دسته را خودبه‌خود کنار می‌گذارد.
 */
const RTL_SCRIPT = new RegExp(
  "[" +
    "\\p{Script=Arabic}" +
    "\\p{Script=Hebrew}" +
    "\\p{Script=Syriac}" +
    "\\p{Script=Thaana}" +
    "\\p{Script=Nko}" +
    "\\p{Script=Samaritan}" +
    "\\p{Script=Mandaic}" +
    "]",
  "u",
);

/** فقط «حرف» — رقم، علامت ترکیبی، نشانه‌گذاری و فاصله را کنار می‌گذارد. */
const LETTER = /\p{L}/u;

/**
 * آیا این کاراکتر یک حرف قوی راست‌به‌چپ است؟
 *
 * شرط دوگانه عمدی است: هم باید حرف باشد، هم در یک خط RTL. نتیجه‌ی عملی این
 * است که «۱۲۳ مورد از 456» درست `rtl` تشخیص داده می‌شود — نه به‌خاطر رقم‌ها،
 * بلکه به‌خاطر «مورد» و «از».
 */
export function isRTLChar(char: string): boolean {
  return LETTER.test(char) && RTL_SCRIPT.test(char);
}

/** آیا این کاراکتر یک حرف قوی چپ‌به‌راست است؟ (هر حرفی که RTL نباشد) */
export function isLTRChar(char: string): boolean {
  return LETTER.test(char) && !RTL_SCRIPT.test(char);
}

export type TextDirection = "rtl" | "ltr";

/** شمارش حروف قوی هر جهت. برای تست و اشکال‌زدایی صادر می‌شود. */
export function countStrongChars(text: string): { rtl: number; ltr: number } {
  let rtl = 0;
  let ltr = 0;
  for (const char of text) {
    if (isRTLChar(char)) rtl++;
    else if (isLTRChar(char)) ltr++;
  }
  return { rtl, ltr };
}

/**
 * جهت پایه‌ی یک رشته بر اساس **اکثریت حروف قوی**.
 *
 * عمداً از الگوریتم استاندارد `dir="auto"` (اولین کاراکتر قوی) استفاده
 * **نمی‌کنیم**. spike گام ۱٫۳ب نشان داد آن الگوریتم روی «board برای تیم ماست»
 * جواب `ltr` می‌دهد، و شروع جمله‌ی فارسی با یک اصطلاح انگلیسی در بورد فارسی
 * کاملاً رایج است. جزئیات: ADR-024.
 *
 * @param fallback وقتی هیچ حرف قوی‌ای وجود ندارد (رشته‌ی خالی، فقط عدد،
 *                 فقط emoji) یا تساوی دقیق است. پیش‌فرض `"rtl"` چون هم‌بوم
 *                 یک محصول فارسی است.
 */
export function detectBaseDirection(text: string, fallback: TextDirection = "rtl"): TextDirection {
  const { rtl, ltr } = countStrongChars(text);
  if (rtl === ltr) return fallback;
  return rtl > ltr ? "rtl" : "ltr";
}

/**
 * جهت را از یک مقدار صریح می‌گیرد، و اگر `"auto"` بود از متن استنتاج می‌کند.
 * این تابع همان چیزی است که property `direction` عنصر (PLAN بخش ۷٫۳) را حل می‌کند.
 */
export function resolveDirection(
  text: string,
  explicit: TextDirection | "auto" | undefined,
  fallback: TextDirection = "rtl",
): TextDirection {
  if (explicit === "rtl" || explicit === "ltr") return explicit;
  return detectBaseDirection(text, fallback);
}

/** `textAlign` پیش‌فرض متناسب با جهت — «شروع خط» به زبان فیزیکی canvas. */
export function defaultTextAlignFor(direction: TextDirection): "left" | "right" {
  return direction === "rtl" ? "right" : "left";
}
