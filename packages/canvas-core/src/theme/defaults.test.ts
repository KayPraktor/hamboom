import { describe, expect, it } from "vitest";

import {
  HB_CONNECTOR_DEFAULTS,
  HB_ELEMENT_LOOK,
  HB_SHAPE_DEFAULTS,
  HB_STICKY_DEFAULTS,
  hbBoundTextDefaults,
  hbTextDefaults,
} from "./defaults";
import { HB_LOOK, HB_TYPO } from "./tokens";

describe("★ استایل میرو، نه دست‌نویس", () => {
  it("roughness صفر است — همین یک مقدار خط لرزان را حذف می‌کند", () => {
    expect(HB_LOOK.roughness).toBe(0);
    expect(HB_ELEMENT_LOOK.roughness).toBe(0);
  });

  it("پرکردن یک‌دست است، نه هاشوری", () => {
    expect(HB_ELEMENT_LOOK.fillStyle).toBe("solid");
  });

  it("همه‌ی عناصر از همان سه مقدار ظاهری استفاده می‌کنند", () => {
    for (const defaults of [HB_STICKY_DEFAULTS, HB_SHAPE_DEFAULTS, HB_CONNECTOR_DEFAULTS]) {
      expect(defaults.roughness).toBe(HB_LOOK.roughness);
      expect(defaults.fillStyle).toBe(HB_LOOK.fillStyle);
    }
  });
});

describe("استیکی در برابر شکل", () => {
  it("★ استیکی حاشیه ندارد — تفاوت اصلی‌اش با یک مستطیل رنگی", () => {
    expect(HB_STICKY_DEFAULTS.strokeColor).toBe("transparent");
  });

  it("شکل حاشیه دارد و پس‌زمینه‌اش شفاف است", () => {
    expect(HB_SHAPE_DEFAULTS.strokeColor).not.toBe("transparent");
    expect(HB_SHAPE_DEFAULTS.backgroundColor).toBe("transparent");
  });

  it("استیکی مربع است", () => {
    expect(HB_STICKY_DEFAULTS.width).toBe(HB_STICKY_DEFAULTS.height);
  });
});

describe("پیش‌فرض متن — یک منبع واحد برای جهت (ADR-024)", () => {
  it("★ راست‌چین برای فارسی، چپ‌چین برای لاتین", () => {
    expect(hbTextDefaults("rtl").textAlign).toBe("right");
    expect(hbTextDefaults("ltr").textAlign).toBe("left");
  });

  it("پیش‌فرض بدون آرگومان فارسی است", () => {
    expect(hbTextDefaults().textAlign).toBe("right");
  });

  it("direction روی auto می‌ماند تا از محتوا استنتاج شود", () => {
    // مقدار صریح فقط وقتی ست می‌شود که کاربر خودش انتخاب کند.
    expect(hbTextDefaults().direction).toBe("auto");
  });

  it("lineHeight فارسی ۱٫۶ است نه پیش‌فرض موتور", () => {
    // با ارتفاع کم، زیرنویس‌ها و اعراب خطوط پشت‌سرهم به هم می‌چسبند.
    expect(hbTextDefaults().lineHeight).toBe(1.6);
    expect(HB_TYPO.lineHeight).toBe(1.6);
  });

  it("متن مقید استیکی وسط‌چین است", () => {
    const bound = hbBoundTextDefaults("rtl");
    expect(bound.textAlign).toBe("center");
    expect(bound.verticalAlign).toBe("middle");
  });
});

describe("کانکتور", () => {
  it("پیش‌فرض پله‌ای است، مثل میرو", () => {
    expect(HB_CONNECTOR_DEFAULTS.elbowed).toBe(true);
    expect(HB_CONNECTOR_DEFAULTS.style).toBe("elbow");
  });

  it("فقط یک سرش پیکان دارد", () => {
    expect(HB_CONNECTOR_DEFAULTS.startArrowhead).toBeNull();
    expect(HB_CONNECTOR_DEFAULTS.endArrowhead).toBe("arrow");
  });
});

describe("بازه‌ی اندازه‌ی فونت", () => {
  it("بازه‌ی autoFit معتبر است", () => {
    expect(HB_TYPO.stickyFontRange.min).toBeLessThan(HB_TYPO.stickyFontRange.max);
  });

  it("اندازه‌ی پیش‌فرض داخل بازه است", () => {
    expect(HB_TYPO.defaultFontSize).toBeGreaterThanOrEqual(HB_TYPO.stickyFontRange.min);
    expect(HB_TYPO.defaultFontSize).toBeLessThanOrEqual(HB_TYPO.stickyFontRange.max);
  });

  it("اندازه‌ی پیش‌فرض در فهرست اندازه‌های انتخابی هست", () => {
    expect(HB_TYPO.fontSizes).toContain(HB_TYPO.defaultFontSize);
  });
});
