import { describe, expect, it } from "vitest";

import {
  assertGatewayAmount,
  computeCharge,
  GATEWAY_MAX_RIAL,
  GATEWAY_MIN_RIAL,
  InvalidChargeError,
  percentOfRial,
  unitPriceRial,
  type ChargeInput,
} from "./money.ts";

const PLAN = {
  code: "pro",
  name: "حرفه‌ای",
  priceMonthlyRial: 1_990_000,
  priceYearlyRial: 19_900_000,
};

const charge = (over: Partial<ChargeInput> = {}) =>
  computeCharge({ plan: PLAN, period: "monthly", seats: 1, coupon: null, vatPercent: 0, ...over });

describe("computeCharge — ریاضیِ ریالِ صحیح (ADR-052)", () => {
  it("قیمتِ واحد از دوره می‌آید", () => {
    expect(unitPriceRial(PLAN, "monthly")).toBe(1_990_000);
    expect(unitPriceRial(PLAN, "yearly")).toBe(19_900_000);
  });

  it("subtotal = قیمتِ واحد × صندلی؛ سطرِ فاکتور همان را می‌گوید", () => {
    const c = charge({ seats: 7 });
    expect(c.subtotalRial).toBe(13_930_000);
    expect(c.lineItems).toEqual([
      { title: "حرفه‌ای — ماهانه", qty: 7, unitPriceRial: 1_990_000, totalRial: 13_930_000 },
    ]);
    expect(charge({ period: "yearly" }).lineItems[0]!.title).toBe("حرفه‌ای — سالانه");
  });

  // ★★ ادعای مرکزیِ ADR-052 — روی هر ترکیبی برقرار است، نه روی نمونه‌های دستچین.
  it("★★ `subtotal − discount + vat === total` روی ۹۶ ترکیب دقیق است", () => {
    const offenders: string[] = [];
    for (const seats of [1, 2, 7, 50]) {
      for (const vatPercent of [0, 9, 10]) {
        for (const coupon of [
          null,
          { kind: "percent" as const, percentOff: 33 },
          { kind: "percent" as const, percentOff: 15 },
          { kind: "amount" as const, amountOffRial: 137 },
        ]) {
          for (const period of ["monthly", "yearly"] as const) {
            const c = charge({ seats, vatPercent, coupon, period });
            if (c.subtotalRial - c.discountRial + c.vatRial !== c.totalRial) {
              offenders.push(`seats=${seats} vat=${vatPercent} period=${period}`);
            }
            for (const [k, v] of Object.entries(c)) {
              if (typeof v === "number" && !Number.isSafeInteger(v)) offenders.push(`${k} اعشاری`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("گِردکردن: ضرب قبل از تقسیم، و `round` نه `floor`", () => {
    expect(percentOfRial(1_000_005, 10)).toBe(100_001); // ۱۰۰۰۰۰٫۵ → بالا
    expect(percentOfRial(1_000_004, 10)).toBe(100_000);
    expect(percentOfRial(0, 10)).toBe(0);
  });

  // ★★ یافته‌ی probeِ گام ۱٫۵ — بدونِ clamp، مبلغِ **منفی** به درگاه می‌رفت.
  it("★★ کوپنِ بزرگ‌تر از مبلغ، مبلغ را صفر می‌کند — نه منفی", () => {
    const c = charge({
      plan: { ...PLAN, priceMonthlyRial: 500_000 },
      coupon: { kind: "amount", amountOffRial: 900_000 },
      vatPercent: 10,
    });
    expect(c.discountRial).toBe(500_000);
    expect(c.totalRial).toBe(0);
    expect(c.totalRial).toBeGreaterThanOrEqual(0);
  });

  it("کوپنِ درصدیِ بالای ۱۰۰ و کوپنِ منفی هم clamp می‌شوند", () => {
    expect(charge({ coupon: { kind: "percent", percentOff: 250 } }).totalRial).toBe(0);
    expect(charge({ coupon: { kind: "amount", amountOffRial: -5_000 } }).discountRial).toBe(0);
  });

  it("VATِ صفر مجاز است (پیش‌فرضِ M4-D6)", () => {
    const c = charge({ seats: 3, vatPercent: 0 });
    expect(c.vatRial).toBe(0);
    expect(c.vatPercent).toBe(0);
    expect(c.totalRial).toBe(c.subtotalRial);
  });

  it("نرخِ VAT روی خروجی برمی‌گردد تا در فاکتور **منجمد** شود", () => {
    expect(charge({ vatPercent: 10 }).vatPercent).toBe(10);
  });

  it.each([
    ["صندلیِ صفر", { seats: 0 }],
    ["صندلیِ اعشاری", { seats: 1.5 }],
    ["VATِ منفی", { vatPercent: -1 }],
    ["VATِ اعشاری", { vatPercent: 9.5 }],
  ])("ورودیِ نامعتبر رد می‌شود: %s", (_label, over) => {
    expect(() => charge(over as Partial<ChargeInput>)).toThrow(InvalidChargeError);
  });

  it("قیمتِ پلنِ نامعتبر رد می‌شود", () => {
    expect(() => charge({ plan: { ...PLAN, priceMonthlyRial: 1234.5 } })).toThrow(
      InvalidChargeError,
    );
  });
});

describe("assertGatewayAmount — کف و سقفِ اندازه‌گیری‌شده‌ی درگاه (گام ۱٫۱)", () => {
  it("مبلغِ معتبر می‌گذرد", () => {
    expect(() => assertGatewayAmount(GATEWAY_MIN_RIAL)).not.toThrow();
    expect(() => assertGatewayAmount(1_990_000)).not.toThrow();
    expect(() => assertGatewayAmount(GATEWAY_MAX_RIAL)).not.toThrow();
  });

  // ★ عددِ ۱۰۰۰ از حدس نیامده: probe با `amount:100` خطای `-9`ِ واقعی گرفت.
  it("زیرِ کف رد می‌شود — همان چیزی که درگاه با `-9` رد می‌کرد", () => {
    expect(() => assertGatewayAmount(999)).toThrow(InvalidChargeError);
    expect(() => assertGatewayAmount(0)).toThrow(InvalidChargeError);
  });

  it("بالای سقف رد می‌شود (کدِ `-41`ِ درگاه)", () => {
    expect(() => assertGatewayAmount(GATEWAY_MAX_RIAL + 1)).toThrow(InvalidChargeError);
  });

  it("مبلغِ اعشاری یا ناامن رد می‌شود (P5)", () => {
    expect(() => assertGatewayAmount(1234.5)).toThrow(InvalidChargeError);
    expect(() => assertGatewayAmount(Number.MAX_SAFE_INTEGER + 2)).toThrow(InvalidChargeError);
  });
});
