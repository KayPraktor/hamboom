import { describe, expect, it } from "vitest";

import { paymentEnvSchema } from "./sections.ts";

/**
 * گاردِ `WEB_BASE_URL` — M6 ردیفِ ۸٫۷.
 *
 * ★★ **این تست از یک خرابیِ واقعیِ استقرار زاده شد، نه از یک احتیاطِ نظری.**
 * در اولین استقرارِ واقعی (۱۴۰۵/۰۷/۰۳) مقدارِ `https://https://hamboom.ir` در
 * `.env.production` نشست. `z.url()` قبولش کرد چون **واقعاً یک URLِ معتبر است** — فقط
 * میزبانش «https» و مسیرش `//hamboom.ir` می‌شود. هیچ‌چیز نشکست و هیچ لاگی چیزی نگفت؛
 * فقط ریدایرکت‌ها بی‌صدا به جای غلط می‌رفتند. همسایه‌اش `ZARINPAL_CALLBACK_URL` گاردی
 * داشت که بلند می‌شکست؛ این یکی نداشت.
 */

const accepts = (value: string): boolean =>
  paymentEnvSchema.safeParse({ WEB_BASE_URL: value }).success;

describe("WEB_BASE_URL باید یک **مبدأ** باشد", () => {
  it("★★ اسکیمِ دوتایی رد می‌شود — همان چیزی که در استقرار نشست", () => {
    expect(accepts("https://https://hamboom.ir")).toBe(false);
    expect(accepts("http://http://localhost:5173")).toBe(false);
  });

  it("★ مسیرِ ناخالی رد می‌شود — مبدأ مسیر ندارد", () => {
    // ⊕ همین قاعده است که اسکیمِ دوتایی را هم می‌گیرد (مسیرش `//hamboom.ir` می‌شود)،
    //   ولی هر دو جدا assert می‌شوند: اگر روزی یکی برداشته شود، دیگری باید قرمز بماند.
    expect(accepts("https://hamboom.ir/app")).toBe(false);
    expect(accepts("https://hamboom.ir/billing/")).toBe(false);
  });

  it("میزبانِ خالی و پروتکلِ غیرِ http رد می‌شوند", () => {
    expect(accepts("ftp://hamboom.ir")).toBe(false);
    expect(accepts("file:///tmp")).toBe(false);
    expect(accepts("http://")).toBe(false);
    expect(accepts("")).toBe(false);
  });

  it("مبدأهای درست — با و بدونِ اسلشِ پایانی، با پورت، و localhostِ توسعه", () => {
    expect(accepts("https://hamboom.ir")).toBe(true);
    expect(accepts("https://hamboom.ir/")).toBe(true);
    expect(accepts("http://localhost:5173")).toBe(true);
    expect(accepts("http://127.0.0.1:15380")).toBe(true);
    expect(accepts("https://www.hamboom.ir")).toBe(true);
  });

  it("پیش‌فرض بدونِ مقدار همان localhostِ توسعه است (P3)", () => {
    const parsed = paymentEnvSchema.parse({});
    expect(parsed.WEB_BASE_URL).toBe("http://localhost:5173");
  });
});
