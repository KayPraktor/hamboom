import { describe, expect, it } from "vitest";

import { parseBigintColumn } from "./db.ts";

/**
 * P5 (ADR-015): `int8` باید `number` شود، نه رشته — ولی **نه** با گم‌شدنِ خاموشِ دقت.
 */
describe("parseBigintColumn — کوئرسِ int8→number (P5)", () => {
  it("رشته‌ی عددی را به number تبدیل می‌کند", () => {
    expect(parseBigintColumn("0")).toBe(0);
    expect(parseBigintColumn("1500000")).toBe(1_500_000); // ۱۵۰ هزار تومان به ریال
    expect(parseBigintColumn(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("★ روی سرریزِ محدوده‌ی امن **خطا** می‌دهد، نه تبدیلِ خاموش", () => {
    // MAX_SAFE_INTEGER + 2: number نمی‌تواند دقیق نگهش دارد → باید بترکد، نه بی‌صدا گرد شود.
    expect(() => parseBigintColumn("9007199254740993")).toThrow(RangeError);
  });
});
