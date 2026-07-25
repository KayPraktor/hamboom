import { describe, expect, it } from "vitest";

import { formatJalaliDate, formatJalaliDateTime, formatJalaliShort, jalaliYear } from "./dates";

// ۲۰۲۶-۰۷-۲۵ در تهران = ۳ مرداد ۱۴۰۵ (نوروزِ ۱۴۰۵ = ۲۰۲۶-۰۳-۲۱).
const MORDAD = new Date("2026-07-25T06:00:00Z");
// پیش از نوروز → هنوز سالِ ۱۴۰۴.
const BEFORE_NOWRUZ = new Date("2026-01-15T06:00:00Z");

describe("formatJalaliDate", () => {
  it("★ روز/ماه/سالِ جلالی با ارقام فارسی", () => {
    const s = formatJalaliDate(MORDAD);
    expect(s).toContain("۱۴۰۵");
    expect(s).toContain("مرداد");
    expect(s).toContain("۳");
    expect(s).toMatch(/[۰-۹]/); // ارقام فارسی
    expect(s).not.toMatch(/[0-9]/); // نه لاتین
  });
});

describe("jalaliYear (عدد، نه رشته — برای شماره‌ی فاکتور)", () => {
  it("★ سالِ جلالیِ یک تاریخِ تابستانی", () => {
    expect(jalaliYear(MORDAD)).toBe(1405);
  });

  it("★ پیش از نوروز، سالِ قبل است", () => {
    expect(jalaliYear(BEFORE_NOWRUZ)).toBe(1404);
  });
});

describe("formatJalaliShort / DateTime", () => {
  it("فشرده شاملِ سال و اسلش است", () => {
    const s = formatJalaliShort(MORDAD);
    expect(s).toContain("۱۴۰۵");
    expect(s).toContain("/");
  });

  it("تاریخ‌وزمان از تاریخِ تنها بلندتر است و ساعت دارد", () => {
    const dt = formatJalaliDateTime(MORDAD);
    expect(dt).toContain("مرداد");
    expect(dt.length).toBeGreaterThan(formatJalaliDate(MORDAD).length);
  });
});
