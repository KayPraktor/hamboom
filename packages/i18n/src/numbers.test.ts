import { describe, expect, it } from "vitest";

import {
  formatNumber,
  formatRial,
  formatToman,
  toLatinDigits,
  toPersianDigits,
} from "./numbers";

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
