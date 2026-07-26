import { describe, expect, it } from "vitest";

import {
  formatJalaliDate,
  formatJalaliDateTime,
  formatJalaliShort,
  jalaliParts,
  jalaliYear,
} from "./dates";

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

/**
 * ★ self-test مرزهای کبیسه‌ی جلالی — با مقادیرِ مرجعِ **دست‌محاسبه** (نه یک نمونه).
 *
 * هدف: اثباتِ اینکه تبدیلِ ما (Intl/ICU) دقیقاً سرِ مرزِ اسفند/فروردین درست
 * می‌شکند و کبیسه را جا نمی‌اندازد. مرجع‌ها از تقویمِ رسمی‌اند و مستقل از خروجیِ
 * تابع: نوروزِ رسمی، و سالِ به‌خوبی‌مستندِ ۱۳۹۹ (کبیسه). هر تاریخ نیم‌روزِ UTC
 * گرفته می‌شود تا مرزِ روزِ تهران قطعی باشد.
 *
 * سالِ کبیسه = اسفندِ ۳۰ روزه؛ سالِ عادی = اسفندِ ۲۹ روزه (بعدش مستقیم نوروز).
 */
describe("مرزهای کبیسه (مقادیر مرجع)", () => {
  const noon = (iso: string) => new Date(`${iso}T09:00:00Z`);

  const cases: Array<[string, string, { year: number; month: number; day: number }]> = [
    // ۱۳۹۹ کبیسه — اسفند ۳۰
    ["۳۰ اسفند ۱۳۹۹ (کبیسه)", "2021-03-20", { year: 1399, month: 12, day: 30 }],
    ["۱ فروردین ۱۴۰۰", "2021-03-21", { year: 1400, month: 1, day: 1 }],
    // ۱۳۹۸ عادی — اسفند ۲۹، بدون ۳۰
    ["۲۹ اسفند ۱۳۹۸ (عادی)", "2020-03-19", { year: 1398, month: 12, day: 29 }],
    ["۱ فروردین ۱۳۹۹", "2020-03-20", { year: 1399, month: 1, day: 1 }],
    // ۱۴۰۳ کبیسه — اسفند ۳۰
    ["۳۰ اسفند ۱۴۰۳ (کبیسه)", "2025-03-20", { year: 1403, month: 12, day: 30 }],
    ["۱ فروردین ۱۴۰۴", "2025-03-21", { year: 1404, month: 1, day: 1 }],
    // ۱۴۰۴ عادی — اسفند ۲۹، پرش مستقیم به نوروز ۱۴۰۵
    ["۲۹ اسفند ۱۴۰۴ (عادی)", "2026-03-20", { year: 1404, month: 12, day: 29 }],
    ["۱ فروردین ۱۴۰۵", "2026-03-21", { year: 1405, month: 1, day: 1 }],
  ];

  for (const [name, iso, expected] of cases) {
    it(`★ ${name} = ${iso}`, () => {
      expect(jalaliParts(noon(iso))).toEqual(expected);
    });
  }

  it("★ سالِ کبیسه اسفندِ ۳۰ دارد، سالِ عادی ندارد", () => {
    // آخرین روزِ ۱۴۰۳ (کبیسه) = ۳۰ اسفند
    expect(jalaliParts(noon("2025-03-20"))).toMatchObject({ month: 12, day: 30 });
    // آخرین روزِ ۱۴۰۴ (عادی) = ۲۹ اسفند — روزِ بعد نوروز است، نه ۳۰ اسفند
    expect(jalaliParts(noon("2026-03-20"))).toMatchObject({ month: 12, day: 29 });
    expect(jalaliParts(noon("2026-03-21"))).toMatchObject({ month: 1, day: 1 });
  });

  it("خروجیِ نمایشیِ روزِ کبیسه هم درست است", () => {
    expect(formatJalaliShort(noon("2025-03-20"))).toBe("۱۴۰۳/۱۲/۳۰");
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
