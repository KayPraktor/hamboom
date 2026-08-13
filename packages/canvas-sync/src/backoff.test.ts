import { describe, expect, it } from "vitest";

import { backoffCeilingMs, backoffDelayMs, RECONNECT_BACKOFF } from "./backoff.ts";

/**
 * تست‌های گام ۵٫۱ — زمان‌بندیِ تلاشِ دوباره.
 *
 * ★ **خودآزمونِ این فایل: `jitter: 0` را روی آزمونِ «پخش‌شدگی» بگذار و باید
 * قرمز شود.** یک تستِ backoff که با برداشتنِ jitter هم سبز بماند، دقیقاً همان
 * کلاسِ تستی است که گام ۴٫۷ یک بار سرش کلاه گذاشت.
 */

describe("رشدِ نمایی و سقف", () => {
  it("سقفِ هر تلاش دو برابرِ قبلی است", () => {
    expect(backoffCeilingMs(1)).toBe(500);
    expect(backoffCeilingMs(2)).toBe(1_000);
    expect(backoffCeilingMs(3)).toBe(2_000);
    expect(backoffCeilingMs(4)).toBe(4_000);
  });

  it("از سقف بالاتر نمی‌رود — وگرنه تلاشِ بیستم ماه‌ها بعد است", () => {
    expect(backoffCeilingMs(7)).toBe(30_000);
    expect(backoffCeilingMs(50)).toBe(RECONNECT_BACKOFF.maxMs);
    // ⚠️ `2 ** 999` برابرِ Infinity است؛ نباید به NaN تبدیل شود.
    expect(backoffCeilingMs(1_000)).toBe(RECONNECT_BACKOFF.maxMs);
    expect(backoffDelayMs(1_000, { random: () => 0 })).toBe(RECONNECT_BACKOFF.maxMs);
  });

  it("شماره‌ی تلاشِ بی‌معنی به تلاشِ اول برمی‌گردد، نه به فاصله‌ی منفی", () => {
    for (const attempt of [0, -5, 0.4, Number.NaN]) {
      expect(backoffCeilingMs(attempt)).toBe(500);
    }
  });
});

describe("★ jitter", () => {
  it("فاصله همیشه بینِ نصفِ سقف و خودِ سقف است", () => {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const ceiling = backoffCeilingMs(attempt);
      for (let sample = 0; sample < 200; sample++) {
        const delay = backoffDelayMs(attempt);
        expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("★★ دو کلاینت در یک لحظه **یک** فاصله نمی‌گیرند", () => {
    // سناریوی واقعیِ ADR-006: یک نود می‌رود و همه‌ی کلاینت‌هایش هم‌زمان قطع
    // می‌شوند. اگر همه یک عدد بگیرند، همه با هم برمی‌گردند و نودِ تازه را
    // می‌کشند. این تست با `jitter: 0` **می‌افتد** — که کلِ نکته‌اش است.
    const delays = new Set(Array.from({ length: 100 }, () => backoffDelayMs(5)));
    expect(delays.size).toBeGreaterThan(50);
  });

  it("کفِ فاصله صفر نمی‌شود — نودی که تازه بالا آمده مهلت می‌خواهد", () => {
    // jitterِ کامل (تصادفی در `[۰، سقف]`) این ادعا را می‌شکند؛ jitterِ نیمه نه.
    expect(backoffDelayMs(3, { random: () => 0.999_999 })).toBe(1_000);
    expect(backoffDelayMs(3, { random: () => 1 })).toBe(1_000);
  });

  it("`random`ِ بدرفتار به فاصله‌ی منفی یا غول‌آسا تبدیل نمی‌شود", () => {
    expect(backoffDelayMs(2, { random: () => 5 })).toBe(500);
    expect(backoffDelayMs(2, { random: () => -3 })).toBe(1_000);
  });

  it("با `jitter: 0` فاصله دقیقاً سقف است — همان چیزی که نباید در تولید باشد", () => {
    expect(backoffDelayMs(4, { jitter: 0 })).toBe(4_000);
  });
});

describe("گزینه‌های تزریقی", () => {
  it("پایه، ضریب و سقفِ سفارشی رعایت می‌شوند", () => {
    const options = { baseMs: 100, factor: 3, maxMs: 5_000, jitter: 0, random: () => 0 };
    expect(backoffDelayMs(1, options)).toBe(100);
    expect(backoffDelayMs(2, options)).toBe(300);
    expect(backoffDelayMs(3, options)).toBe(900);
    expect(backoffDelayMs(9, options)).toBe(5_000);
  });
});
