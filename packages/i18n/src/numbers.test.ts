import { describe, expect, it } from "vitest";

import { formatNumber, formatRial, formatToman, toLatinDigits, toPersianDigits } from "./numbers";

/** ارقام فارسیِ یک رشته را جدا می‌کند — برای بررسیِ مقدار مستقل از جداکننده. */
const digitsOnly = (s: string) => s.replace(/[^۰-۹]/g, "");

describe("toPersianDigits / toLatinDigits", () => {
  it("★ همه‌ی ارقام لاتین به فارسی", () => {
    expect(toPersianDigits("0123456789")).toBe("۰۱۲۳۴۵۶۷۸۹");
  });

  it("عدد هم ورودی می‌گیرد", () => {
    expect(toPersianDigits(42)).toBe("۴۲");
  });

  it("نویسه‌های غیرعددی دست‌نخورده می‌مانند", () => {
    expect(toPersianDigits("خط ۱ از 3")).toBe("خط ۱ از ۳");
  });

  it("★ فارسی به لاتین", () => {
    expect(toLatinDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });

  it("ارقام عربی (۰۶۶۰) هم به لاتین", () => {
    expect(toLatinDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("★ رفت‌وبرگشت بدون تغییر", () => {
    expect(toLatinDigits(toPersianDigits("2026/05/03"))).toBe("2026/05/03");
  });
});

describe("formatNumber", () => {
  it("★ ارقام فارسی با جداکننده‌ی هزارگان", () => {
    const s = formatNumber(1234567);
    expect(digitsOnly(s)).toBe("۱۲۳۴۵۶۷");
    expect(s.length).toBeGreaterThan(7); // جداکننده دارد
  });

  it("bigint هم قالب می‌شود", () => {
    expect(digitsOnly(formatNumber(1000000n))).toBe("۱۰۰۰۰۰۰");
  });

  it("عددِ کوچک بدون جداکننده", () => {
    expect(formatNumber(42)).toBe("۴۲");
  });
});

describe("formatRial / formatToman (P5)", () => {
  it("★ ریال بدون تبدیل نمایش داده می‌شود", () => {
    const s = formatRial(50000n);
    expect(s).toMatch(/ریال$/);
    expect(digitsOnly(s)).toBe("۵۰۰۰۰");
  });

  it("★ تومان = ریال ÷ ۱۰ (تبدیل فقط در نمایش)", () => {
    const s = formatToman(500000n);
    expect(s).toMatch(/تومان$/);
    expect(digitsOnly(s)).toBe("۵۰۰۰۰"); // ۵۰۰٬۰۰۰ ریال = ۵۰٬۰۰۰ تومان
  });

  it("ریالِ غیرمضربِ ۱۰ در نمایشِ تومان کوتاه می‌شود", () => {
    expect(digitsOnly(formatToman(12345))).toBe("۱۲۳۴"); // ۱۲۳۴٫۵ → ۱۲۳۴
  });
});

/**
 * ★ self-test پول (P5): «پول همیشه ریال است؛ تومان فقط تبدیلِ نمایشیِ ÷۱۰».
 *
 * تومانِ هر ردیف **دستی** حساب شده (نه با خودِ `formatToman`) تا مرجع مستقل باشد
 * — الگوی همان self-testهای پروژه (license/contrast/connector). این ناوردا را در
 * *لایه‌ی نمایش* می‌بندد؛ اعمالِ «هیچ تومانی در ذخیره‌سازی» کارِ M3/بک‌اند است
 * (تایپِ برندشده‌ی Rial در shared-types — پیشنهادِ باز).
 */
describe("self-test پول (P5) — مقادیرِ دست‌محاسبه", () => {
  // [ریال، رقم‌های تومانِ نمایشی (÷۱۰ کوتاه‌شده)، رقم‌های ریالِ نمایشی]
  const cases: Array<[bigint, string, string]> = [
    [0n, "۰", "۰"],
    [10n, "۱", "۱۰"],
    [500_000n, "۵۰۰۰۰", "۵۰۰۰۰۰"], // ۵۰۰٬۰۰۰ ریال = ۵۰٬۰۰۰ تومان
    [1_000_000n, "۱۰۰۰۰۰", "۱۰۰۰۰۰۰"], // = ۱۰۰٬۰۰۰ تومان
    [12_345n, "۱۲۳۴", "۱۲۳۴۵"], // ۱۲۳۴۵ ریال = ۱۲۳۴٫۵ → ۱۲۳۴ تومان
    [999_999n, "۹۹۹۹۹", "۹۹۹۹۹۹"], // = ۹۹۹۹۹٫۹ → ۹۹۹۹۹ تومان
    [50_000_000n, "۵۰۰۰۰۰۰", "۵۰۰۰۰۰۰۰"], // ۵۰ میلیون ریال = ۵ میلیون تومان
  ];

  for (const [rial, tomanDigits, rialDigits] of cases) {
    it(`★ ${rial} ریال → تومان «${tomanDigits}» · ریال «${rialDigits}»`, () => {
      expect(formatToman(rial)).toMatch(/تومان$/);
      expect(digitsOnly(formatToman(rial))).toBe(tomanDigits);
      expect(formatRial(rial)).toMatch(/ریال$/); // ریال هیچ تقسیمی ندارد
      expect(digitsOnly(formatRial(rial))).toBe(rialDigits);
    });
  }

  it("★ number و bigint یک نتیجه می‌دهند (بدون خطای اعشارِ float)", () => {
    expect(formatToman(500_000)).toBe(formatToman(500_000n));
    expect(formatRial(500_000)).toBe(formatRial(500_000n));
  });
});
