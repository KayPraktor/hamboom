import { describe, expect, it } from "vitest";

import { sceneToOverlayPixel } from "./presence-projection";

/**
 * مقادیرِ مرجع همان‌هایی‌اند که در تاییدِ مرورگرِ Q1 (گام ۴٫۴) دست‌محاسبه شدند —
 * پس این تست هم‌زمان نگهبانِ رگرسیونِ ترنسفورمِ موتور است: اگر روزی موتور فرمولِ
 * scene→viewport را عوض کند، اینجا قرمز می‌شود.
 */
describe("sceneToOverlayPixel — منبعِ واحدِ پروجکشنِ حضور", () => {
  it("★ panِ خالص: scene(500,300) با scroll(-60,-120)، zoom 1 → (440,180)", () => {
    expect(
      sceneToOverlayPixel(
        { x: 500, y: 300 },
        { scrollX: -60, scrollY: -120, zoom: 1 },
        { offsetLeft: 0, offsetTop: 0 },
        { left: 0, top: 0 },
      ),
    ).toEqual({ x: 440, y: 180 });
  });

  it("★ zoom حولِ نما: همان عددِ تاییدِ مرورگر (404.1، 201.847)", () => {
    const p = sceneToOverlayPixel(
      { x: 500, y: 300 },
      { scrollX: -132.63636363636374, scrollY: -116.5028409090909, zoom: 1.1 },
      { offsetLeft: 0, offsetTop: 0 },
      { left: 0, top: 0 },
    );
    expect(p.x).toBeCloseTo(404.1, 3);
    expect(p.y).toBeCloseTo(201.847, 3);
  });

  it("offsetِ canvas و originِ لایه هر دو کم می‌شوند", () => {
    // x: (500+0)*1 + offsetLeft(30) − overlayLeft(10) = 520
    // y: (300+0)*1 + offsetTop(20)  − overlayTop(5)   = 315
    expect(
      sceneToOverlayPixel(
        { x: 500, y: 300 },
        { scrollX: 0, scrollY: 0, zoom: 1 },
        { offsetLeft: 30, offsetTop: 20 },
        { left: 10, top: 5 },
      ),
    ).toEqual({ x: 520, y: 315 });
  });

  it("viewport ورودیِ صریح است — تابع هیچ حالتِ کهنه‌ای نمی‌خواند (مبنای ضدِ باگِ Q1)", () => {
    const at = (v: { scrollX: number; scrollY: number; zoom: number }) =>
      sceneToOverlayPixel(
        { x: 100, y: 100 },
        v,
        { offsetLeft: 0, offsetTop: 0 },
        { left: 0, top: 0 },
      );
    // دو viewportِ متفاوت → دو خروجیِ متفاوت، فقط از روی ورودی.
    expect(at({ scrollX: 0, scrollY: 0, zoom: 1 })).toEqual({ x: 100, y: 100 });
    expect(at({ scrollX: -50, scrollY: -50, zoom: 1 })).toEqual({ x: 50, y: 50 });
  });
});
