import { describe, expect, it } from "vitest";

import {
  CARD_TRANSFER_ABANDONED,
  CardTransferGateway,
  decideTransfer,
  maskLast4,
  type TransferApprovalReader,
  type TransferRecord,
} from "./card-transfer-gateway.ts";
import { assertGatewayAllowed, type PaymentGateway } from "./gateway.ts";
import { InvalidChargeError } from "./money.ts";

const HOUR = 3_600_000;
const WINDOW = 24 * HOUR;
const T0 = 1_700_000_000_000;

/** رکوردِ پایه: ساخته شده، بی‌ادعا، داخلِ پنجره. */
const record = (patch: Partial<TransferRecord> = {}): TransferRecord => ({
  approvedAtMs: null,
  transferRef: null,
  senderLast4: null,
  claimedAtMs: null,
  requestedAtMs: T0,
  nowMs: T0 + HOUR,
  ...patch,
});

const readerOf = (value: TransferRecord | null): TransferApprovalReader => ({
  read: () => Promise.resolve(value),
});

const gatewayWith = (value: TransferRecord | null): CardTransferGateway =>
  new CardTransferGateway({
    checkoutBaseUrl: "https://hamboom.ir/billing/transfer/",
    mode: "sandbox",
    reader: readerOf(value),
    claimWindowMs: WINDOW,
    authorityFactory: () => "CTdeadbeef",
  });

describe("decideTransfer — نگاشتِ سه‌حالتی", () => {
  it("★★ تاییدِ staff ⇒ paid با شماره‌ی **staff**، نه ادعای کاربر", () => {
    const outcome = decideTransfer(
      record({ approvedAtMs: T0 + HOUR, transferRef: "REF-STAFF", senderLast4: "4821" }),
      WINDOW,
    );
    expect(outcome).toEqual({
      status: "paid",
      alreadyVerified: false,
      refId: "REF-STAFF",
      cardPanMasked: "****4821",
      cardHash: null,
      feeRial: null,
    });
  });

  it("تاییدشده بدونِ ۴ رقم ⇒ ماسک null، نه رشته‌ی جعلی", () => {
    const outcome = decideTransfer(
      record({ approvedAtMs: T0, transferRef: "R", senderLast4: null }),
      WINDOW,
    );
    expect(outcome).toMatchObject({ status: "paid", cardPanMasked: null });
  });

  it("★★ ادعای کاربر ⇒ gatewayError، نه notPaid — این ستونِ `failure_code` را نگه می‌دارد", () => {
    // ⚠️ اگر این روزی به `notPaid` تغییر کند، sweep ردیفی را باطل می‌کند که پولش در راهِ پایا است.
    const outcome = decideTransfer(record({ claimedAtMs: T0 + HOUR }), WINDOW);
    expect(outcome.status).toBe("gatewayError");
  });

  it("★★ ادعا حتی وقتی ردیف **خیلی** کهنه است هم gatewayError می‌مانَد", () => {
    const outcome = decideTransfer(
      record({ claimedAtMs: T0 + HOUR, nowMs: T0 + 365 * 24 * HOUR }),
      WINDOW,
    );
    expect(outcome.status).toBe("gatewayError");
  });

  it("بی‌ادعا و داخلِ پنجره ⇒ gatewayError (هنوز قضاوت نمی‌کنیم)", () => {
    expect(decideTransfer(record({ nowMs: T0 + WINDOW - 1 }), WINDOW).status).toBe("gatewayError");
  });

  it("بی‌ادعا و بیرونِ پنجره ⇒ notPaid با کدِ رهاشدگی", () => {
    const outcome = decideTransfer(record({ nowMs: T0 + WINDOW }), WINDOW);
    expect(outcome).toMatchObject({ status: "notPaid", code: CARD_TRANSFER_ABANDONED });
  });

  it("★ ردیفِ ناموجود ⇒ gatewayError، نه notPaid", () => {
    // «نمی‌دانیم» با «پرداخت نشد» یکی نیست — دومی ردیف را در معرضِ ابطال می‌گذارد.
    expect(decideTransfer(null, WINDOW).status).toBe("gatewayError");
  });

  it("★ تاییدِ بی‌شماره (فقط از خواننده‌ی بدلی ممکن است) ⇒ gatewayError، نه paid", () => {
    const outcome = decideTransfer(record({ approvedAtMs: T0, transferRef: null }), WINDOW);
    expect(outcome.status).toBe("gatewayError");
  });

  it("⚠️ تایید بر ادعا **مقدم** است — ردیفی که هم ادعا دارد هم تایید، تسویه می‌شود", () => {
    const outcome = decideTransfer(
      record({ claimedAtMs: T0, approvedAtMs: T0 + HOUR, transferRef: "R" }),
      WINDOW,
    );
    expect(outcome.status).toBe("paid");
  });
});

describe("maskLast4", () => {
  it("فقط چیزی را نشان می‌دهد که می‌دانیم", () => {
    expect(maskLast4("1234")).toBe("****1234");
    expect(maskLast4(null)).toBeNull();
    // ⊕ هیچ PANِ ۱۶رقمیِ جعلی ساخته نمی‌شود؛ شبا اصلاً کارت ندارد.
    expect(maskLast4("1234")).not.toMatch(/\d{6}/);
  });
});

describe("CardTransferGateway", () => {
  it("★★ در production بالا می‌آید — برخلافِ mock", () => {
    const gw = gatewayWith(null);
    expect(() => assertGatewayAllowed(gw, "production")).not.toThrow();
    expect(gw.name).toBe("card_transfer");
    expect(gw.developmentOnly).toBe(false);
  });

  it("★ سه متدِ اختیاری عمداً پیاده نشده‌اند ⇒ مسیرِ REFUND_UNAVAILABLEی ADR-068", () => {
    // ★ از راهِ **پورت** دیده می‌شود، نه کلاس: مصرف‌کننده (reconcile/refund) هم همین‌طور می‌بیندش.
    const gw: PaymentGateway = gatewayWith(null);
    expect(gw.refund).toBeUndefined();
    expect(gw.reverse).toBeUndefined();
    expect(gw.listUnverified).toBeUndefined();
  });

  it("createPayment یک authority می‌سازد و به صفحه‌ی **خودمان** می‌فرستد", async () => {
    const result = await gatewayWith(null).createPayment({
      amountRial: 1_990_000,
      description: "پلنِ حرفه‌ای",
      callbackUrl: "https://hamboom.ir/billing/callback",
    });
    expect(result).toEqual({
      authority: "CTdeadbeef",
      redirectUrl: "https://hamboom.ir/billing/transfer/CTdeadbeef",
    });
  });

  it("★ نگهبانِ مبلغ همان نگهبانِ درگاهِ واقعی است", async () => {
    await expect(
      gatewayWith(null).createPayment({
        amountRial: 100,
        description: "x",
        callbackUrl: "https://hamboom.ir/cb",
      }),
    ).rejects.toThrow(InvalidChargeError);
  });

  it("★★ authorityِ پیش‌فرض قابلِ‌حدس نیست و دو بار یکی نمی‌شود", async () => {
    // این توکن URLِ صفحه‌ای است که شماره‌ی کارت و مبلغ را نشان می‌دهد؛ شمارنده کافی نیست.
    const gw = new CardTransferGateway({
      checkoutBaseUrl: "https://hamboom.ir/p",
      mode: "production",
      reader: readerOf(null),
      claimWindowMs: WINDOW,
    });
    const input = { amountRial: 1_990_000, description: "x", callbackUrl: "https://hamboom.ir/cb" };
    const a = await gw.createPayment(input);
    const b = await gw.createPayment(input);
    expect(a.authority).not.toBe(b.authority);
    expect(a.authority).toMatch(/^CT[0-9a-f]{32}$/);
  });

  it("verifyPayment از خواننده می‌خواند، نه از حافظه‌ی خودش", async () => {
    const gw = gatewayWith(record({ approvedAtMs: T0, transferRef: "R9", senderLast4: "1111" }));
    const outcome = await gw.verifyPayment({ authority: "CTdeadbeef", amountRial: 1_990_000 });
    expect(outcome).toMatchObject({ status: "paid", refId: "R9" });
  });

  it("★ درگاه هیچ حالتی نگه نمی‌دارد — createPayment روی verify اثر ندارد", async () => {
    const gw = gatewayWith(record());
    await gw.createPayment({
      amountRial: 1_990_000,
      description: "x",
      callbackUrl: "https://hamboom.ir/cb",
    });
    const outcome = await gw.verifyPayment({ authority: "CTdeadbeef", amountRial: 1_990_000 });
    expect(outcome.status).toBe("gatewayError");
  });

  it("mode از پیکربندی می‌آید و در ستونِ gateway_mode می‌نشیند", () => {
    expect(gatewayWith(null).mode).toBe("sandbox");
  });
});
