import { describe, expect, it } from "vitest";

import { clampZoom, formatZoomPercent, zoomAroundCenter, zoomStep } from "./zoom";

describe("clampZoom", () => {
  it("★ به بازه‌ی مجاز محدود می‌شود", () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(100)).toBe(30);
    expect(clampZoom(1)).toBe(1);
  });
});

describe("zoomStep", () => {
  it("★ بزرگ‌نمایی ×۱٫۲، کوچک‌نمایی ÷۱٫۲", () => {
    expect(zoomStep(1, 1)).toBeCloseTo(1.2, 5);
    expect(zoomStep(1, -1)).toBeCloseTo(1 / 1.2, 5);
  });
});

describe("zoomAroundCenter", () => {
  it("★ بزرگ‌نماییِ ۱→۲، وسطِ نما را ثابت نگه می‌دارد", () => {
    const view = { zoom: 1, scrollX: 0, scrollY: 0, width: 800, height: 600 };
    const next = zoomAroundCenter(view, 2);
    // scrollX' = 0 + 400·(1/2 − 1/1) = −200 ؛ scrollY' = 0 + 300·(−0.5) = −150
    expect(next.zoom).toBe(2);
    expect(next.scrollX).toBeCloseTo(-200, 5);
    expect(next.scrollY).toBeCloseTo(-150, 5);
  });

  it("★ نقطه‌ی وسط قبل و بعد یکی است (ناوردا)", () => {
    const view = { zoom: 1, scrollX: 40, scrollY: 10, width: 800, height: 600 };
    const centerScene = (v: { zoom: number; scrollX: number; width: number }) =>
      v.width / 2 / v.zoom - v.scrollX;
    const before = centerScene(view);
    const next = zoomAroundCenter(view, 2.5);
    const after = centerScene({ zoom: next.zoom, scrollX: next.scrollX, width: view.width });
    expect(after).toBeCloseTo(before, 5);
  });

  it("zoom را به بازه محدود می‌کند", () => {
    const view = { zoom: 1, scrollX: 0, scrollY: 0, width: 800, height: 600 };
    expect(zoomAroundCenter(view, 999).zoom).toBe(30);
  });
});

describe("formatZoomPercent", () => {
  it("★ درصد با ارقامِ فارسی", () => {
    expect(formatZoomPercent(1)).toBe("۱۰۰٪");
    expect(formatZoomPercent(0.5)).toBe("۵۰٪");
    expect(formatZoomPercent(2.5)).toBe("۲۵۰٪");
  });
});
