import { describe, expect, it } from "vitest";

import { assertGatewayAllowed, GatewayNotAllowedError, type PaymentGateway } from "./gateway.ts";
import { MockGateway } from "./mock-gateway.ts";
import { InvalidChargeError } from "./money.ts";
import { ZarinpalGateway } from "./zarinpal-gateway.ts";

const MERCHANT = "11111111-1111-1111-1111-111111111111";

/** پاسخِ ساختگیِ درگاه با **همان** شکل‌هایی که probeِ زنده اندازه گرفت. */
const reply = (status: number, body: unknown): Response =>
  ({ status, json: () => Promise.resolve(body) }) as unknown as Response;

const zarinpal = (fetchImpl: typeof fetch): ZarinpalGateway =>
  new ZarinpalGateway({
    baseUrl: "https://sandbox.zarinpal.com",
    merchantId: MERCHANT,
    mode: "sandbox",
    fetchImpl,
  });

describe("assertGatewayAllowed — گیتِ production", () => {
  it("★★ mock در production بالا نمی‌آید", () => {
    const mock = new MockGateway({ checkoutBaseUrl: "http://localhost:3000/dev/pay" });
    expect(() => assertGatewayAllowed(mock, "production")).toThrow(GatewayNotAllowedError);
    // ولی در توسعه مشکلی نیست
    expect(() => assertGatewayAllowed(mock, "development")).not.toThrow();
    expect(() => assertGatewayAllowed(mock, "test")).not.toThrow();
  });

  it("زرین‌پال در production مجاز است", () => {
    const gw = zarinpal(() => Promise.resolve(reply(200, {})));
    expect(gw.developmentOnly).toBe(false);
    expect(() => assertGatewayAllowed(gw, "production")).not.toThrow();
  });

  it("پیامِ خطا نامِ درگاه و محیط را می‌گوید", () => {
    const fake = { name: "mock", developmentOnly: true } as PaymentGateway;
    expect(() => assertGatewayAllowed(fake, "production")).toThrow(/mock/);
  });
});

describe("ZarinpalGateway — سه قاعده‌ی اندازه‌گیری‌شده در گام ۱٫۱", () => {
  it("merchantِ غیر-۳۶کاراکتری در **ساخت** می‌شکند، نه سرِ پرداخت", () => {
    expect(() => zarinpal(() => Promise.resolve(reply(200, {}))).createPayment).not.toThrow();
    expect(
      () =>
        new ZarinpalGateway({
          baseUrl: "https://sandbox.zarinpal.com",
          merchantId: "too-short",
          mode: "sandbox",
        }),
    ).toThrow(/۳۶/u);
  });

  it("★ همیشه `currency: \"IRR\"` صریح می‌فرستد (P5 — وگرنه ضریبِ ۱۰)", async () => {
    let sent: Record<string, unknown> = {};
    const gw = zarinpal((_url, init) => {
      sent = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return Promise.resolve(reply(200, { data: { code: 100, authority: "S".padEnd(36, "0") }, errors: [] }));
    });
    await gw.createPayment({ amountRial: 15_000, description: "تست", callbackUrl: "http://x/cb" });
    expect(sent.currency).toBe("IRR");
    expect(sent.amount).toBe(15_000);
    expect(sent.merchant_id).toBe(MERCHANT);
  });

  it("ریدایرکت به `/pg/StartPay/{authority}` می‌سازد", async () => {
    const authority = "S00000000000000000000000000000p7r8py";
    const gw = zarinpal(() =>
      Promise.resolve(reply(200, { data: { code: 100, authority }, errors: [] })),
    );
    const out = await gw.createPayment({
      amountRial: 15_000,
      description: "تست",
      callbackUrl: "http://x/cb",
      orderId: "HB-1405-000001",
    });
    expect(out.authority).toBe(authority);
    expect(out.redirectUrl).toBe(`https://sandbox.zarinpal.com/pg/StartPay/${authority}`);
  });

  it("مبلغِ زیرِ کف حتی به درگاه نمی‌رسد", async () => {
    const gw = zarinpal(() => Promise.reject(new Error("نباید صدا زده شود")));
    await expect(
      gw.createPayment({ amountRial: 100, description: "d", callbackUrl: "http://x/cb" }),
    ).rejects.toThrow(InvalidChargeError);
  });

  // ★★ قاعده ۱ + ۲: خطای کسب‌وکار non-2xx است و `errors` **شیء** می‌شود.
  it("★★ HTTP 422 با `errors`ِ شیء ⇒ «پرداخت نشد»، نه استثنا", async () => {
    const gw = zarinpal(() =>
      Promise.resolve(
        reply(422, { data: {}, errors: { code: -9, message: "The amount must be at least 1000." } }),
      ),
    );
    const out = await gw.verifyPayment({ authority: "S1", amountRial: 15_000 });
    expect(out.status).toBe("notPaid");
    expect(out).toMatchObject({ code: -9 });
  });

  it("★★ HTTP 401 با کدِ `-51` ⇒ «پرداخت نشد» (دقیقاً همان چیزی که probe دید)", async () => {
    const gw = zarinpal(() =>
      Promise.resolve(reply(401, { data: {}, errors: { code: -51, message: "Session is not valid" } })),
    );
    expect((await gw.verifyPayment({ authority: "S1", amountRial: 15_000 })).status).toBe("notPaid");
  });

  // ★★ قاعده ۳ — قلبِ ADR-050.
  it("★★ کدِ ۱۰۰ ⇒ پرداخت‌شده و `alreadyVerified === false` (حق دارد فعال کند)", async () => {
    const gw = zarinpal(() =>
      Promise.resolve(
        reply(200, {
          data: { code: 100, ref_id: 476_569_601, card_pan: "502229******5995", fee: 0 },
          errors: [],
        }),
      ),
    );
    const out = await gw.verifyPayment({ authority: "S1", amountRial: 15_000 });
    expect(out).toMatchObject({
      status: "paid",
      alreadyVerified: false,
      refId: "476569601",
      cardPanMasked: "502229******5995",
      feeRial: 0,
    });
  });

  it("★★ کدِ ۱۰۱ ⇒ **هم** پرداخت‌شده **هم** `alreadyVerified` — فعال‌سازیِ دوباره ممنوع", async () => {
    const gw = zarinpal(() =>
      Promise.resolve(reply(200, { data: { code: 101, ref_id: 476_569_601 }, errors: [] })),
    );
    const out = await gw.verifyPayment({ authority: "S1", amountRial: 15_000 });
    expect(out).toMatchObject({ status: "paid", alreadyVerified: true });
  });

  it("`ref_id`ِ عددی به **رشته** تبدیل می‌شود (ستون varchar، بزرگیِ بیشینه نامستند)", async () => {
    const gw = zarinpal(() =>
      Promise.resolve(reply(200, { data: { code: 100, ref_id: 476_569_601 }, errors: [] })),
    );
    const out = await gw.verifyPayment({ authority: "S1", amountRial: 15_000 });
    expect(out.status === "paid" && typeof out.refId).toBe("string");
  });

  // ⚠️ تفکیکِ «پرداخت نشد» از «نمی‌دانیم» — دو تصمیمِ متفاوت می‌سازند.
  it("⚠️ قطعیِ شبکه ⇒ `gatewayError`، نه `notPaid` (ردیف `pending` می‌مانَد تا sweep)", async () => {
    const gw = zarinpal(() => Promise.reject(new Error("ECONNRESET")));
    const out = await gw.verifyPayment({ authority: "S1", amountRial: 15_000 });
    expect(out.status).toBe("gatewayError");
  });

  it("⚠️ بدنه‌ی غیر-JSON یا بی‌کد هم `gatewayError` است، نه «پرداخت نشد»", async () => {
    const bad = { status: 502, json: () => Promise.reject(new Error("not json")) } as unknown as Response;
    const gw = zarinpal(() => Promise.resolve(bad));
    expect((await gw.verifyPayment({ authority: "S1", amountRial: 1_000 })).status).toBe("gatewayError");
  });

  it("ساختِ پرداختِ ناموفق استثنا می‌دهد (کدِ غیرِ ۱۰۰)", async () => {
    const gw = zarinpal(() =>
      Promise.resolve(reply(422, { data: {}, errors: { code: -10, message: "Invalid merchant_id." } })),
    );
    await expect(
      gw.createPayment({ amountRial: 15_000, description: "d", callbackUrl: "http://x/cb" }),
    ).rejects.toThrow(/-10/);
  });
});

describe("MockGateway — پیش‌فرضِ توسعه (M4-D5)", () => {
  const mock = (over: Partial<ConstructorParameters<typeof MockGateway>[0]> = {}) =>
    new MockGateway({ checkoutBaseUrl: "http://localhost:3000/dev/pay", ...over });

  it("`developmentOnly` است و اسم/حالتش در ستون‌ها می‌نشیند", () => {
    const gw = mock();
    expect(gw.developmentOnly).toBe(true);
    expect(gw.name).toBe("mock");
    expect(gw.mode).toBe("sandbox");
  });

  it("authority ۳۶ کاراکتری و ریدایرکتِ محلی می‌سازد (بدونِ اینترنت — P3)", async () => {
    const out = await mock().createPayment({
      amountRial: 15_000,
      description: "d",
      callbackUrl: "http://x/cb",
    });
    expect(out.authority).toHaveLength(36);
    expect(out.redirectUrl).toBe(`http://localhost:3000/dev/pay/${out.authority}`);
  });

  // ★★ همان گذاری که ADR-050 رویش سوار است — تا مسیرِ idempotency در dev هم واقعاً آزموده شود.
  it("★★ گذارِ ۱۰۰→۱۰۱ را بازتولید می‌کند", async () => {
    const gw = mock();
    const { authority } = await gw.createPayment({
      amountRial: 15_000,
      description: "d",
      callbackUrl: "http://x/cb",
    });
    const first = await gw.verifyPayment({ authority, amountRial: 15_000 });
    const second = await gw.verifyPayment({ authority, amountRial: 15_000 });
    expect(first).toMatchObject({ status: "paid", alreadyVerified: false });
    expect(second).toMatchObject({ status: "paid", alreadyVerified: true });
  });

  it("مبلغِ متفاوت سرِ verify ⇒ کدِ `-50`ِ واقعی", async () => {
    const gw = mock();
    const { authority } = await gw.createPayment({
      amountRial: 15_000,
      description: "d",
      callbackUrl: "http://x/cb",
    });
    expect(await gw.verifyPayment({ authority, amountRial: 15_001 })).toMatchObject({
      status: "notPaid",
      code: -50,
    });
  });

  it("authorityِ ناشناخته ⇒ `-51`", async () => {
    expect(await mock().verifyPayment({ authority: "NOPE", amountRial: 1_000 })).toMatchObject({
      status: "notPaid",
      code: -51,
    });
  });

  it("حالتِ «همیشه ناموفق» برای دیدنِ مسیرِ شکست در توسعه", async () => {
    const gw = mock({ failEveryPayment: true });
    const { authority } = await gw.createPayment({
      amountRial: 15_000,
      description: "d",
      callbackUrl: "http://x/cb",
    });
    expect((await gw.verifyPayment({ authority, amountRial: 15_000 })).status).toBe("notPaid");
  });

  it("همان نگهبانِ مبلغِ درگاهِ واقعی را دارد (پیکربندیِ بد در dev هم دیده شود)", async () => {
    await expect(
      mock().createPayment({ amountRial: 10, description: "d", callbackUrl: "http://x/cb" }),
    ).rejects.toThrow(InvalidChargeError);
  });

  it("`authorityFactory` قابلِ تزریق است (تستِ قطعی)", async () => {
    const gw = mock({ authorityFactory: () => "FIXED".padEnd(36, "0") });
    expect((await gw.createPayment({ amountRial: 1_000, description: "d", callbackUrl: "http://x/cb" })).authority)
      .toBe("FIXED".padEnd(36, "0"));
  });
});
