import { describe, expect, it } from "vitest";

import {
  countStrongChars,
  defaultTextAlignFor,
  detectBaseDirection,
  isLTRChar,
  isRTLChar,
  resolveDirection,
} from "./bidi";

describe("تشخیص حرف قوی", () => {
  it("حروف فارسی و عربی را RTL می‌شناسد", () => {
    for (const char of "سلامکگژچپی") expect(isRTLChar(char)).toBe(true);
  });

  it("حروف عبری را هم RTL می‌شناسد", () => {
    expect(isRTLChar("ש")).toBe(true);
  });

  it("حروف لاتین را LTR می‌شناسد", () => {
    for (const char of "abcXYZé") expect(isLTRChar(char)).toBe(true);
  });

  it("رقم، فاصله و نشانه‌گذاری هیچ‌کدام «قوی» نیستند", () => {
    // این همان چیزی است که باعث می‌شود «۱۲۳ مورد از 456» درست rtl شود.
    for (const char of "0123456789۰۱۲۳ ,.!?()-«»") {
      expect(isRTLChar(char)).toBe(false);
      expect(isLTRChar(char)).toBe(false);
    }
  });

  it("emoji و نیم‌فاصله در رای‌گیری شرکت نمی‌کنند", () => {
    expect(countStrongChars("🎨‌")).toEqual({ rtl: 0, ltr: 0 });
  });
});

describe("detectBaseDirection — اکثریت، نه اولین حرف (ADR-024)", () => {
  it("فارسی خالص", () => {
    expect(detectBaseDirection("سلام دنیا")).toBe("rtl");
  });

  it("لاتین خالص", () => {
    expect(detectBaseDirection("The quick brown fox")).toBe("ltr");
  });

  it("★ رشته‌ای که با کلمه‌ی لاتین شروع می‌شود ولی فارسی است", () => {
    // این دقیقاً موردی است که الگوریتم استاندارد dir="auto" اشتباه می‌کند.
    // spike گام ۱٫۳ب: مرورگر برای همین رشته `ltr` می‌دهد.
    expect(detectBaseDirection("board برای تیم ماست")).toBe("rtl");
  });

  it("★ رشته‌ای که با عدد شروع می‌شود", () => {
    expect(detectBaseDirection("۱۲۳ مورد از ۴۵۶")).toBe("rtl");
    expect(detectBaseDirection("456 مورد باقی مانده")).toBe("rtl");
  });

  it("رشته‌ای که با نشانه‌گذاری شروع می‌شود", () => {
    expect(detectBaseDirection("«سلام دنیا»")).toBe("rtl");
  });

  it("جمله‌ی انگلیسی با یک کلمه‌ی فارسی، LTR می‌ماند", () => {
    expect(detectBaseDirection("The board is called هم‌بوم and it works")).toBe("ltr");
  });

  it("بدون هیچ حرف قوی، به fallback برمی‌گردد", () => {
    expect(detectBaseDirection("")).toBe("rtl");
    expect(detectBaseDirection("۱۲۳ ۴۵۶")).toBe("rtl");
    expect(detectBaseDirection("🎨🎨")).toBe("rtl");
    expect(detectBaseDirection("", "ltr")).toBe("ltr");
  });

  it("در تساوی دقیق، به fallback برمی‌گردد", () => {
    const text = "abc سلا"; // ۳ لاتین، ۳ فارسی
    expect(countStrongChars(text)).toEqual({ rtl: 3, ltr: 3 });
    expect(detectBaseDirection(text)).toBe("rtl");
    expect(detectBaseDirection(text, "ltr")).toBe("ltr");
  });

  it("قطعی است — همان ورودی همیشه همان خروجی", () => {
    const text = "این یک board برای team ماست";
    const first = detectBaseDirection(text);
    for (let i = 0; i < 50; i++) expect(detectBaseDirection(text)).toBe(first);
  });
});

describe("resolveDirection — مقدار صریح بر heuristic مقدم است", () => {
  it("مقدار صریح رعایت می‌شود حتی اگر خلاف محتوا باشد", () => {
    expect(resolveDirection("The quick brown fox", "rtl")).toBe("rtl");
    expect(resolveDirection("سلام دنیا", "ltr")).toBe("ltr");
  });

  it("auto و undefined هر دو به heuristic می‌روند", () => {
    expect(resolveDirection("سلام دنیا", "auto")).toBe("rtl");
    expect(resolveDirection("سلام دنیا", undefined)).toBe("rtl");
  });
});

describe("defaultTextAlignFor", () => {
  it("RTL به راست، LTR به چپ", () => {
    expect(defaultTextAlignFor("rtl")).toBe("right");
    expect(defaultTextAlignFor("ltr")).toBe("left");
  });
});
