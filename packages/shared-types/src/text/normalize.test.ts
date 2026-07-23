import { describe, expect, it } from "vitest";

import { normalizePersian, normalizePersianPreservingLength, persianSearchKey } from "./normalize";

/**
 * مجموعه‌ی نمونه — همان تله‌هایی که spike گام ۱٫۳ب روی ویرایشگر واقعی آزمود.
 * هر رشته‌ای که اینجا اضافه شود، خودبه‌خود در تضمین طول هم آزموده می‌شود.
 */
const CORPUS = [
  "سلام دنیا",
  "كتابي عربي",
  "می‌خواهم نیم‌فاصله",
  "۱۲۳۴۵۶۷۸۹۰",
  "تعداد ۱۲۳ از 456",
  "بِسْمِ اللّٰهِ",
  "بازـــرگانی",
  "هم‌بوم 🎨 است",
  "board برای تیم ماست",
  "The quick brown fox",
  "مصطفى و ة و ؤ",
  "",
];

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

/**
 * ★ این بلوک قاعده‌ی «کجا صدا زده شود» را از یک کامنت به یک تضمین اجرایی
 * تبدیل می‌کند. تا قبل از این، آن قاعده فقط در JSDoc سرِ ماژول بود و
 * هیچ‌چیز جلوی صدا زدنش حین تایپ را نمی‌گرفت.
 */
describe("تضمین طول — چرا نباید حین تایپ صدا زده شود", () => {
  it("★ normalizePersian می‌تواند طول رشته را عوض کند", () => {
    // همین یک خط دلیل کل قاعده است: اگر طول عوض شود و مکان‌نما جابه‌جا نشود،
    // مکان‌نما می‌پرد — دقیقاً باگ U-1 در patches/README.md.
    const withTatweel = "بازـــرگانی";
    expect(normalizePersian(withTatweel).length).toBeLessThan(withTatweel.length);
  });

  it("★ normalizePersianPreservingLength هرگز طول را عوض نمی‌کند", () => {
    for (const text of CORPUS) {
      expect(normalizePersianPreservingLength(text)).toHaveLength(text.length);
    }
  });

  it("نسخه‌ی حافظ طول هم ي/ك عربی را درست تبدیل می‌کند", () => {
    expect(normalizePersianPreservingLength("كتابي")).toBe("کتابی");
    expect(normalizePersianPreservingLength("مصطفى")).toBe("مصطفی");
  });

  it("نسخه‌ی حافظ طول کشیده را دست نمی‌زند — همین باعث می‌شود امن بماند", () => {
    const text = "بازـــرگانی";
    expect(normalizePersianPreservingLength(text)).toBe(text);
  });

  it("روی رشته‌ی حاوی جفت جانشین (emoji) هم طول حفظ می‌شود", () => {
    // `for...of` روی code point پیمایش می‌کند؛ این تست مطمئن می‌شود
    // شمارش code unit به هم نمی‌ریزد.
    const text = "هم‌بوم 🎨 كتابي";
    expect(normalizePersianPreservingLength(text)).toHaveLength(text.length);
  });

  it("هر دو نسخه idempotent اند", () => {
    for (const text of CORPUS) {
      const once = normalizePersian(text);
      expect(normalizePersian(once)).toBe(once);
      const safeOnce = normalizePersianPreservingLength(text);
      expect(normalizePersianPreservingLength(safeOnce)).toBe(safeOnce);
    }
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

  it("★ از نسخه‌ی کامل استفاده می‌کند، نه حافظ طول — کشیده حذف می‌شود", () => {
    // اگر روزی کسی این را به `normalizePersianPreservingLength` عوض کند،
    // «بازـــرگانی» و «بازرگانی» دیگر یک کلید نمی‌دهند و جستجو خاموش می‌شکند.
    expect(persianSearchKey("بازـــرگانی")).toBe(persianSearchKey("بازرگانی"));
    expect(persianSearchKey("بازـــرگانی")).not.toContain("ـ");
  });

  it("کلید جستجو عمداً هم‌طول متن اصلی نیست", () => {
    // قید حفظ طول فقط برای مسیر ویرایش زنده است، نه اینجا.
    const text = "می‌خواهم بازـــرگانی ۱۲۳";
    expect(persianSearchKey(text).length).not.toBe(text.length);
  });
});
