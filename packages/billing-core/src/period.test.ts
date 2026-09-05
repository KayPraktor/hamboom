import { describe, expect, it } from "vitest";

import {
  addUtcMonths,
  computePeriod,
  formatInvoiceNumber,
  isStalePending,
  jalaliYearOf,
} from "./period.ts";

const at = (iso: string): Date => new Date(iso);

describe("jalaliYearOf — سالِ جلالی به وقتِ تهران (ADR-018)", () => {
  it("سالِ میانه‌ی سال درست است", () => {
    expect(jalaliYearOf(at("2026-09-05T12:00:00Z"))).toBe(1405);
  });

  // ★★ همان مرزی که probeِ گام ۱٫۵ پیدا کرد: تهران از قبل واردِ سالِ نو شده ولی روزِ UTC نه.
  it("★★ سرِ مرزِ نوروز، یک ساعت سالِ جلالی را عوض می‌کند در حالی که سالِ UTC ثابت است", () => {
    const before = at("2027-03-20T20:00:00Z");
    const after = at("2027-03-20T21:00:00Z");
    expect(jalaliYearOf(before)).toBe(1405);
    expect(jalaliYearOf(after)).toBe(1406);
    expect(before.getUTCFullYear()).toBe(after.getUTCFullYear()); // هر دو ۲۰۲۷
  });
});

describe("formatInvoiceNumber — `HB-1405-000123`", () => {
  it("قالب و padding درست است", () => {
    expect(formatInvoiceNumber(at("2026-09-05T12:00:00Z"), 123)).toBe("HB-1405-000123");
    expect(formatInvoiceNumber(at("2026-09-05T12:00:00Z"), 1)).toBe("HB-1405-000001");
    expect(formatInvoiceNumber(at("2026-09-05T12:00:00Z"), 999_999)).toBe("HB-1405-999999");
  });

  // ★ همان لحظه‌ای که به تابع داده می‌شود، سال را تعیین می‌کند — نه ساعتِ سیستم.
  it("★ سالِ شماره از **همان لحظه‌ی** پاس‌شده می‌آید، پس با `issued_at` هم‌راستا می‌مانَد", () => {
    expect(formatInvoiceNumber(at("2027-03-20T20:00:00Z"), 7)).toBe("HB-1405-000007");
    expect(formatInvoiceNumber(at("2027-03-20T21:00:00Z"), 7)).toBe("HB-1406-000007");
  });

  it("دنباله‌ی نامعتبر رد می‌شود", () => {
    expect(() => formatInvoiceNumber(at("2026-09-05T12:00:00Z"), 0)).toThrow(RangeError);
    expect(() => formatInvoiceNumber(at("2026-09-05T12:00:00Z"), 1.5)).toThrow(RangeError);
  });
});

describe("addUtcMonths — clampِ صریحِ آخرِ ماه", () => {
  it("ماهِ ساده جلو می‌رود و ساعت حفظ می‌شود", () => {
    expect(addUtcMonths(at("2026-01-15T10:30:00Z"), 1).toISOString()).toBe(
      "2026-02-15T10:30:00.000Z",
    );
  });

  // ⚠️ حسابِ ساده اینجا به ۳ مارس سُر می‌خورد و بی‌صدا سه روز به مشتری هدیه می‌دهد.
  it("⚠️ ۳۱ ژانویه + یک ماه ⇒ ۲۸ فوریه، نه ۳ مارس", () => {
    expect(addUtcMonths(at("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("سالِ کبیسه: ۳۱ ژانویه‌ی ۲۰۲۸ + یک ماه ⇒ ۲۹ فوریه", () => {
    expect(addUtcMonths(at("2028-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("عبور از مرزِ سال درست است", () => {
    expect(addUtcMonths(at("2026-12-15T00:00:00Z"), 1).toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
    expect(addUtcMonths(at("2026-03-31T00:00:00Z"), 12).toISOString()).toBe(
      "2027-03-31T00:00:00.000Z",
    );
  });
});

describe("computePeriod — لنگر، لحظه‌ی پرداخت است نه now()", () => {
  it("ماهانه یک ماه، سالانه دوازده ماه", () => {
    const anchor = at("2026-09-05T08:00:00Z");
    expect(computePeriod(anchor, "monthly").end.toISOString()).toBe("2026-10-05T08:00:00.000Z");
    expect(computePeriod(anchor, "yearly").end.toISOString()).toBe("2027-09-05T08:00:00.000Z");
  });

  // ★ اگر آشتی‌دهی دیر فعال کند، دوره باز هم از لحظه‌ی **پرداخت** شروع می‌شود.
  it("★ شروعِ دوره دقیقاً همان لنگر است، نه لحظه‌ی فعال‌سازی", () => {
    const paidAt = at("2026-09-05T08:00:00Z");
    expect(computePeriod(paidAt, "monthly").start.toISOString()).toBe(paidAt.toISOString());
  });

  it("لنگر را جهش نمی‌دهد (کپی برمی‌گرداند)", () => {
    const anchor = at("2026-09-05T08:00:00Z");
    computePeriod(anchor, "yearly");
    expect(anchor.toISOString()).toBe("2026-09-05T08:00:00.000Z");
  });
});

describe("isStalePending — ورودیِ sweepِ فاز ۷", () => {
  const requested = at("2026-09-05T08:00:00Z");
  it("تازه‌تر از آستانه، کهنه نیست", () => {
    expect(isStalePending(requested, at("2026-09-05T08:05:00Z"), 15 * 60_000)).toBe(false);
  });
  it("دقیقاً روی آستانه و بعدش، کهنه است", () => {
    expect(isStalePending(requested, at("2026-09-05T08:15:00Z"), 15 * 60_000)).toBe(true);
    expect(isStalePending(requested, at("2026-09-05T09:00:00Z"), 15 * 60_000)).toBe(true);
  });
});
