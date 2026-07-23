import { describe, expect, it } from "vitest";

import { normalizePersian, persianSearchKey } from "./normalize";

describe("normalizePersian — تبدیل حروف عربی", () => {
  it("ي عربی را به ی فارسی تبدیل می‌کند", () => {
    // spike گام ۱٫۳ب: موتور این کار را نمی‌کند، پس وظیفه‌ی ماست.
    expect(normalizePersian("كتابي")).toBe("کتابی");
  });

  it("ك عربی را به ک فارسی تبدیل می‌کند", () => {
    expect(normalizePersian("كتاب")).toBe("کتاب");
  });

  it("الف مقصوره را به ی تبدیل می‌کند", () => {
    expect(normalizePersian("مصطفى")).toBe("مصطفی");
  });

  it("متن از قبل فارسی را دست نمی‌زند", () => {
    const text = "سلام دنیا، این متن فارسی است.";
    expect(normalizePersian(text)).toBe(text);
  });

  it("کشیده را حذف می‌کند", () => {
    expect(normalizePersian("بازـــرگانی")).toBe("بازرگانی");
  });
});

describe("normalizePersian — آنچه عمداً دست نمی‌زند", () => {
  it("نیم‌فاصله را حفظ می‌کند", () => {
    // ZWNJ بخشی از املای درست فارسی است، نه نویز.
    expect(normalizePersian("می‌خواهم")).toBe("می‌خواهم");
    expect(normalizePersian("هم‌بوم")).toContain("‌");
  });

  it("اعراب را حذف نمی‌کند", () => {
    const text = "بِسْمِ";
    expect(normalizePersian(text)).toBe(text);
  });

  it("ارقام را به‌صورت پیش‌فرض تبدیل نمی‌کند", () => {
    expect(normalizePersian("تعداد ۱۲۳ از 456")).toBe("تعداد ۱۲۳ از 456");
  });

  it("فاصله‌های تکراری را جمع نمی‌کند", () => {
    expect(normalizePersian("سلام   دنیا")).toBe("سلام   دنیا");
  });

  it("emoji را حفظ می‌کند", () => {
    expect(normalizePersian("هم‌بوم 🎨")).toContain("🎨");
  });

  it("با گزینه‌های خاموش، هیچ کاری نمی‌کند", () => {
    const text = "كتابي ـــ";
    expect(normalizePersian(text, { arabicLetters: false, tatweel: false })).toBe(text);
  });

  it("idempotent است — دوبار اجرا همان نتیجه را می‌دهد", () => {
    const text = "كتابي بازـــرگانی می‌خواهم";
    const once = normalizePersian(text);
    expect(normalizePersian(once)).toBe(once);
  });
});

describe("persianSearchKey — تهاجمی، فقط برای جستجو", () => {
  it("املای عربی و فارسی یک کلید می‌دهند", () => {
    expect(persianSearchKey("كتابي")).toBe(persianSearchKey("کتابی"));
  });

  it("با و بدون اعراب یک کلید می‌دهند", () => {
    expect(persianSearchKey("کِتاب")).toBe(persianSearchKey("کتاب"));
  });

  it("ارقام فارسی و لاتین یک کلید می‌دهند", () => {
    expect(persianSearchKey("۱۲۳")).toBe("123");
    expect(persianSearchKey("تعداد ۱۲۳")).toBe(persianSearchKey("تعداد 123"));
  });

  it("نیم‌فاصله و فاصله یک کلید می‌دهند", () => {
    expect(persianSearchKey("می‌خواهم")).toBe(persianSearchKey("می خواهم"));
  });

  it("فاصله‌های اضافه را جمع می‌کند", () => {
    expect(persianSearchKey("  سلام   دنیا  ")).toBe("سلام دنیا");
  });

  it("حروف لاتین را کوچک می‌کند", () => {
    expect(persianSearchKey("Board")).toBe("board");
  });
});
