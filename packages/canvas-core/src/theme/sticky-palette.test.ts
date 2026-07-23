import { hbStickyColor } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import {
  WCAG_AA_LARGE,
  WCAG_AA_TEXT,
  contrastRatio,
  parseHex,
  relativeLuminance,
} from "./contrast";
import {
  HB_STICKY_DEFAULT,
  HB_STICKY_KEYS,
  HB_STICKY_PALETTE,
  getStickySwatch,
} from "./sticky-palette";

describe("★ گیت خوانایی — هر دوازده رنگ", () => {
  it.each(HB_STICKY_PALETTE.map((s) => [s.nameFa, s] as const))(
    "%s — متن روی پس‌زمینه به WCAG AA می‌رسد",
    (_name, swatch) => {
      const ratio = contrastRatio(swatch.text, swatch.bg);
      expect(
        ratio,
        `رنگ «${swatch.nameFa}» (${swatch.key}): کنتراست ${ratio.toFixed(2)} کمتر از ${WCAG_AA_TEXT} است. ` +
          `متن ${swatch.text} روی ${swatch.bg} خوانا نیست.`,
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    },
  );

  it.each(HB_STICKY_PALETTE.map((s) => [s.nameFa, s] as const))(
    "%s — نوار انتخاب روی پس‌زمینه دیده می‌شود",
    (_name, swatch) => {
      const ratio = contrastRatio(swatch.accent, swatch.bg);
      expect(
        ratio,
        `رنگ «${swatch.nameFa}»: کنتراست accent ${ratio.toFixed(2)} کمتر از ${WCAG_AA_LARGE} است.`,
      ).toBeGreaterThanOrEqual(WCAG_AA_LARGE);
    },
  );
});

describe("یکپارچگی پالت", () => {
  it("دقیقاً دوازده رنگ دارد", () => {
    expect(HB_STICKY_PALETTE).toHaveLength(12);
  });

  it("کلیدها یکتا هستند", () => {
    expect(new Set(HB_STICKY_KEYS).size).toBe(HB_STICKY_KEYS.length);
  });

  it("★ کلیدها دقیقاً با schema در shared-types می‌خوانند", () => {
    // اگر کسی رنگی به پالت اضافه کند و schema را به‌روز نکند (یا برعکس)،
    // سندهای ذخیره‌شده و رابط از هم جدا می‌شوند.
    const schemaKeys = [...hbStickyColor.options].sort();
    expect([...HB_STICKY_KEYS].sort()).toEqual(schemaKeys);
  });

  it("همه‌ی رنگ‌ها hex معتبرند", () => {
    for (const swatch of HB_STICKY_PALETTE) {
      expect(() => parseHex(swatch.bg)).not.toThrow();
      expect(() => parseHex(swatch.text)).not.toThrow();
      expect(() => parseHex(swatch.accent)).not.toThrow();
    }
  });

  it("پس‌زمینه‌ها از هم متمایزند", () => {
    const backgrounds = HB_STICKY_PALETTE.map((s) => s.bg.toUpperCase());
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
  });

  it("نام فارسی هر رنگ پر است", () => {
    for (const swatch of HB_STICKY_PALETTE) {
      expect(swatch.nameFa.trim().length).toBeGreaterThan(0);
    }
  });

  it("فقط «مشکی» پس‌زمینه‌ی تیره دارد و متن روشن", () => {
    for (const swatch of HB_STICKY_PALETTE) {
      const isDark = relativeLuminance(swatch.bg) < 0.5;
      expect(isDark, `«${swatch.nameFa}»`).toBe(swatch.key === "black");
    }
  });
});

describe("getStickySwatch", () => {
  it("رنگ درست را برمی‌گرداند", () => {
    expect(getStickySwatch("pink").nameFa).toBe("صورتی");
  });

  it("★ کلید ناشناخته به پیش‌فرض برمی‌گردد، نه undefined", () => {
    // کلید رنگ در سند ذخیره می‌شود و ممکن است از نسخه‌ای بیاید که رنگی
    // داشته که ما دیگر نداریم. undefined یعنی استیکی بدون رنگ رندر شود.
    expect(getStickySwatch("chartreuse").key).toBe(HB_STICKY_DEFAULT);
    expect(getStickySwatch(undefined).key).toBe(HB_STICKY_DEFAULT);
  });

  it("پیش‌فرض داخل پالت است", () => {
    expect(HB_STICKY_KEYS).toContain(HB_STICKY_DEFAULT);
  });
});
