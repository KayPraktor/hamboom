import { describe, expect, it } from "vitest";

import { normalizeCode, normalizePhone } from "./validate.ts";

describe("normalizePhone", () => {
  it("شماره‌ی ASCIIِ درست را می‌پذیرد", () => {
    expect(normalizePhone("09123456789")).toBe("09123456789");
  });

  it("★ ارقامِ فارسی را به ASCII تبدیل می‌کند", () => {
    expect(normalizePhone("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
  });

  it("فاصله‌ی دور را می‌گیرد", () => {
    expect(normalizePhone("  09123456789  ")).toBe("09123456789");
  });

  it("فرمتِ نادرست → null", () => {
    expect(normalizePhone("0912345678")).toBeNull(); // ۱۰ رقم
    expect(normalizePhone("19123456789")).toBeNull(); // با ۰۹ شروع نمی‌شود
    expect(normalizePhone("abcdefghijk")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("normalizeCode", () => {
  it("کدِ ۶ رقمی را می‌پذیرد و ارقامِ فارسی را تبدیل می‌کند", () => {
    expect(normalizeCode("123456")).toBe("123456");
    expect(normalizeCode("۱۲۳۴۵۶")).toBe("123456");
  });

  it("طولِ نادرست → null", () => {
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("1234567")).toBeNull();
    expect(normalizeCode("12a456")).toBeNull();
  });
});
