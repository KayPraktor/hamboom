import { describe, expect, it } from "vitest";

import {
  WCAG_AA_LARGE,
  WCAG_AA_TEXT,
  contrastRatio,
  meetsWcagAA,
  meetsWcagAALarge,
  parseHex,
  relativeLuminance,
} from "./contrast";

/**
 * ★ این فایل **خودِ گیت را می‌آزماید**، نه پالت را.
 *
 * `sticky-palette.test.ts` از این توابع استفاده می‌کند تا مطمئن شود رنگ‌ها
 * خوانا هستند. اگر فرمول اینجا غلط باشد، آن تست بی‌صدا سبز می‌ماند و یک
 * پالت ناخوانا رد می‌شود. پس مقادیر مرجع مستقل از پروژه لازم‌اند.
 */

describe("parseHex", () => {
  it("شکل ۶ رقمی را می‌خواند", () => {
    expect(parseHex("#FFF9B1")).toEqual({ r: 255, g: 249, b: 177 });
  });

  it("شکل ۳ رقمی را باز می‌کند", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#123")).toEqual({ r: 17, g: 34, b: 51 });
  });

  it("بدون # هم کار می‌کند", () => {
    expect(parseHex("2C2C2C")).toEqual({ r: 44, g: 44, b: 44 });
  });

  it("ورودی نامعتبر خطا می‌دهد، نه مقدار غلط", () => {
    expect(() => parseHex("#12345")).toThrow();
    expect(() => parseHex("قرمز")).toThrow();
    expect(() => parseHex("#GGGGGG")).toThrow();
  });
});

describe("relativeLuminance — مقادیر مرجع W3C", () => {
  it("سیاه صفر است", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
  });

  it("سفید یک است", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 6);
  });

  it("قرمز خالص ≈ ۰٫۲۱۲۶", () => {
    expect(relativeLuminance("#FF0000")).toBeCloseTo(0.2126, 4);
  });

  it("سبز خالص ≈ ۰٫۷۱۵۲", () => {
    expect(relativeLuminance("#00FF00")).toBeCloseTo(0.7152, 4);
  });

  it("آبی خالص ≈ ۰٫۰۷۲۲", () => {
    expect(relativeLuminance("#0000FF")).toBeCloseTo(0.0722, 4);
  });
});

describe("contrastRatio — مقادیر مرجع", () => {
  it("★ سیاه روی سفید دقیقاً ۲۱ است — سقف مقیاس", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });

  it("★ رنگ روی خودش دقیقاً ۱ است — کف مقیاس", () => {
    expect(contrastRatio("#FFF9B1", "#FFF9B1")).toBeCloseTo(1, 10);
    expect(contrastRatio("#2C2C2C", "#2C2C2C")).toBeCloseTo(1, 10);
  });

  it("متقارن است — ترتیب آرگومان‌ها مهم نیست", () => {
    expect(contrastRatio("#1a1a1a", "#FFF9B1")).toBeCloseTo(
      contrastRatio("#FFF9B1", "#1a1a1a"),
      10,
    );
  });

  it("خاکستری ۵۰٪ روی سفید ≈ ۳٫۹۵", () => {
    // مقدار شناخته‌شده‌ی #767676 که مرز رایج AA است.
    expect(contrastRatio("#767676", "#FFFFFF")).toBeGreaterThan(4.5);
    expect(contrastRatio("#808080", "#FFFFFF")).toBeLessThan(4.5);
  });
});

describe("آستانه‌ها", () => {
  it("مقادیر WCAG درست‌اند", () => {
    expect(WCAG_AA_TEXT).toBe(4.5);
    expect(WCAG_AA_LARGE).toBe(3);
  });

  it("meetsWcagAA روی جفت خوانا مثبت و روی ناخوانا منفی است", () => {
    expect(meetsWcagAA("#1a1a1a", "#FFFFFF")).toBe(true);
    expect(meetsWcagAA("#CCCCCC", "#FFFFFF")).toBe(false);
  });

  it("آستانه‌ی اجزای رابط سهل‌گیرتر است", () => {
    // رنگی که برای متن رد می‌شود ولی برای یک نوار انتخاب کافی است.
    const borderline = "#949494";
    expect(meetsWcagAA(borderline, "#FFFFFF")).toBe(false);
    expect(meetsWcagAALarge(borderline, "#FFFFFF")).toBe(true);
  });
});
