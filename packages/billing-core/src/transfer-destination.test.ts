import { describe, expect, it } from "vitest";

import {
  InvalidTransferDestinationError,
  luhnOk,
  resolveTransferDestination,
  shebaOk,
} from "./transfer-destination.ts";

const CARD = "6037991234567893";
const SHEBA = "IR840629600000001003242000";
const HOLDER = "مهدی مهدوی";

const problemsOf = (input: Parameters<typeof resolveTransferDestination>[0]): string[] => {
  try {
    resolveTransferDestination(input);
  } catch (error) {
    if (error instanceof InvalidTransferDestinationError) return [...error.problems];
    throw error;
  }
  throw new Error("انتظارِ خطا بود ولی نیامد");
};

describe("luhnOk", () => {
  it("★★ یک رقمِ عوض‌شده را می‌گیرد — همان اشتباهی که پول را به غریبه می‌فرستد", () => {
    expect(luhnOk(CARD)).toBe(true);
    for (let i = 0; i < CARD.length; i += 1) {
      const wrong = `${CARD.slice(0, i)}${String((Number(CARD[i]) + 1) % 10)}${CARD.slice(i + 1)}`;
      expect(luhnOk(wrong), `رقمِ ${String(i)} عوض شد و گرفته نشد`).toBe(false);
    }
  });

  it("★ جابه‌جاییِ دو رقمِ مجاور را هم می‌گیرد (وقتی اختلافشان ۵ نیست)", () => {
    // ⚠️ محدودیتِ شناخته‌شده‌ی Luhn: جابه‌جاییِ «۰۹»↔«۹۰» را نمی‌گیرد. ادعای بیشتری نمی‌کنیم.
    const swapped = `${CARD.slice(0, 2)}${CARD[3] ?? ""}${CARD[2] ?? ""}${CARD.slice(4)}`;
    expect(swapped).not.toBe(CARD);
    expect(luhnOk(swapped)).toBe(false);
  });
});

describe("shebaOk", () => {
  it("★★ mod-97 یک رقمِ عوض‌شده را می‌گیرد", () => {
    expect(shebaOk(SHEBA)).toBe(true);
    expect(shebaOk("IR840629601000001003242000")).toBe(false);
  });

  it("شکلِ غلط رد می‌شود، بدونِ محاسبه", () => {
    expect(shebaOk("IR84")).toBe(false);
    expect(shebaOk("0629600000001003242000")).toBe(false);
    expect(shebaOk(`XX${SHEBA.slice(2)}`)).toBe(false);
  });

  it("⚠️ باقیمانده رقم‌به‌رقم است، نه با Number — وگرنه هر شبایی معتبر می‌شد", () => {
    // ۲۶ کاراکتر از MAX_SAFE_INTEGER بزرگ‌تر است؛ اگر گرد می‌شد، این هم «معتبر» می‌ماند.
    expect(shebaOk("IR000000000000000000000000")).toBe(false);
  });
});

describe("resolveTransferDestination", () => {
  it("کارت و شبا هر دو، نرمال‌شده", () => {
    expect(
      resolveTransferDestination({
        card: "6037-9912 3456 7893",
        sheba: "ir84 0629 6000 0000 1003 2420 00",
        holderName: `  ${HOLDER}  `,
        bankName: "ملی",
      }),
    ).toEqual({ card: CARD, sheba: SHEBA, holderName: HOLDER, bankName: "ملی" });
  });

  it("★ شبای بدونِ پیشوندِ IR پذیرفته می‌شود و پیشوند اضافه می‌گردد", () => {
    const out = resolveTransferDestination({ sheba: SHEBA.slice(2), holderName: HOLDER });
    expect(out.sheba).toBe(SHEBA);
    expect(out.card).toBeNull();
  });

  it("فقط کارت هم کافی است؛ نامِ بانک اختیاری است", () => {
    expect(resolveTransferDestination({ card: CARD, holderName: HOLDER })).toEqual({
      card: CARD,
      sheba: null,
      holderName: HOLDER,
      bankName: null,
    });
  });

  it("★★ بدونِ هیچ مقصدی می‌شکند — وگرنه کاربر یک کادرِ خالی می‌بیند", () => {
    expect(problemsOf({ holderName: HOLDER })).toEqual([
      "دستِ‌کم یکی از CARD_TRANSFER_CARD_NUMBER یا CARD_TRANSFER_SHEBA باید تنظیم شود.",
    ]);
  });

  it("★ بدونِ نامِ صاحبِ حساب می‌شکند — تنها راستی‌آزماییِ سمتِ کاربر است", () => {
    expect(problemsOf({ card: CARD })).toEqual([
      "CARD_TRANSFER_HOLDER_NAME تنظیم نشده — کاربر نمی‌تواند مقصد را تطبیق دهد.",
    ]);
  });

  it("★ همه‌ی ایرادها **با هم** گزارش می‌شوند، نه اولی", () => {
    const problems = problemsOf({ card: "6037991234567890", sheba: "IR99", holderName: "" });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("Luhn");
    expect(problems[1]).toContain("۲۴ رقم");
    expect(problems[2]).toContain("HOLDER_NAME");
  });

  it("کارتِ کوتاه پیامِ طول می‌گیرد، نه پیامِ Luhn", () => {
    expect(problemsOf({ card: "60379912", holderName: HOLDER })[0]).toContain("۱۶ رقم");
  });

  it("⚠️ مقصدِ **نامعتبر** با «تنظیم‌نشده» یکی نیست — پیامِ «هیچ مقصدی» ظاهر نمی‌شود", () => {
    // وگرنه اپراتور دنبالِ متغیرِ خالی می‌گردد در حالی که مقدار هست و فقط یک رقمش غلط است.
    const problems = problemsOf({ card: "6037991234567890", holderName: HOLDER });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Luhn");
  });
});
