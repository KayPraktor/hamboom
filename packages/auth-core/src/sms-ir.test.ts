import { describe, expect, it, vi } from "vitest";

import { assertSmsProviderAllowed } from "./otp.ts";
import {
  createSmsIrProvider,
  describeFailure,
  normalizeIranianMobile,
  sendVerifyCode,
  SmsIrConfigError,
  SmsIrError,
  type SmsIrConfig,
  type SmsIrSendResult,
} from "./sms-ir.ts";

const PHONE = "09121234567";
const CODE = "48213";

function config(over: Partial<SmsIrConfig> = {}): SmsIrConfig {
  return {
    apiKey: "test-key",
    templateId: 265541,
    parameterName: "CODE",
    baseUrl: "https://api.sms.ir",
    timeoutMs: 5_000,
    ...over,
  };
}

/** یک `fetch`ِ ساختگی که درخواست را نگه می‌دارد و پاسخِ دلخواه می‌دهد. */
function fakeFetch(body: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("normalizeIranianMobile", () => {
  it("چهار شکلِ رایج را به 09XXXXXXXXX می‌بَرد", () => {
    for (const input of ["09121234567", "9121234567", "+989121234567", "00989121234567"]) {
      expect(normalizeIranianMobile(input)).toBe(PHONE);
    }
  });

  it("★ ارقامِ فارسی و عربی را تبدیل می‌کند", () => {
    // ⚠️ کاربرِ ایرانی با کیبوردِ فارسی این را تایپ می‌کند و رشته‌اش با `09…` برابر نیست.
    expect(normalizeIranianMobile("۰۹۱۲۱۲۳۴۵۶۷")).toBe(PHONE);
    expect(normalizeIranianMobile("٠٩١٢١٢٣٤٥٦٧")).toBe(PHONE);
  });

  it("فاصله و خط تیره را نادیده می‌گیرد", () => {
    expect(normalizeIranianMobile(" 0912-123 4567 ")).toBe(PHONE);
  });

  it("شماره‌ی نامعتبر را رد می‌کند، و ★ خودِ شماره را در پیام نمی‌آورد (P7)", () => {
    let message = "";
    try {
      normalizeIranianMobile("021555512");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("معتبر نیست");
    expect(message).not.toContain("021555512");
  });
});

describe("sendVerifyCode — شکلِ درخواست", () => {
  it("به /v1/send/verify با هدرِ X-API-KEY و بدنه‌ی قالب POST می‌کند", async () => {
    const { impl, calls } = fakeFetch(
      JSON.stringify({ status: 1, message: "موفق", data: { messageId: 7, cost: 1 } }),
    );
    const result = await sendVerifyCode(config({ fetchImpl: impl }), PHONE, CODE);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://api.sms.ir/v1/send/verify");
    expect(call?.init.method).toBe("POST");
    expect((call?.init.headers as Record<string, string>)["X-API-KEY"]).toBe("test-key");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      mobile: PHONE,
      templateId: 265541,
      parameters: [{ name: "CODE", value: CODE }],
    });
    expect(result.providerStatus).toBe(1);
    expect(result.messageId).toBe(7);
  });

  it("★ نامِ پارامتر از config می‌آید، نه ثابتِ کد", async () => {
    // ⚠️ یک قالبِ تازه با نامِ دیگر ⇒ پیامک می‌رود ولی جای کد خالی است. پس این باید متغیر بماند.
    const { impl, calls } = fakeFetch(JSON.stringify({ status: 1 }));
    await sendVerifyCode(config({ fetchImpl: impl, parameterName: "OTPCODE" }), PHONE, CODE);
    const body = JSON.parse(String(calls[0]?.init.body)) as { parameters: { name: string }[] };
    expect(body.parameters[0]?.name).toBe("OTPCODE");
  });

  it("شماره را پیش از ارسال نرمال می‌کند", async () => {
    const { impl, calls } = fakeFetch(JSON.stringify({ status: 1 }));
    await sendVerifyCode(config({ fetchImpl: impl }), "+98 912 123 4567", CODE);
    const body = JSON.parse(String(calls[0]?.init.body)) as { mobile: string };
    expect(body.mobile).toBe(PHONE);
  });

  it("قطعیِ شبکه را از خطای کسب‌وکار جدا می‌کند", async () => {
    const impl = vi.fn(() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    await expect(sendVerifyCode(config({ fetchImpl: impl }), PHONE, CODE)).rejects.toThrow(
      SmsIrError,
    );
  });
});

describe("describeFailure — ★ تصمیم از بدنه می‌آید، نه از res.ok", () => {
  const base: SmsIrSendResult = {
    httpStatus: 200,
    providerStatus: 1,
    message: "موفق",
    messageId: 1,
    cost: 1,
    rawBody: "{}",
  };

  it("status=1 یعنی موفق", () => {
    expect(describeFailure(base)).toBeNull();
  });

  it("★ HTTP 200 با status≠1 **شکست** است", () => {
    // ⚠️ درسِ زرین‌پال: شاخه‌زدن روی `res.ok` این را «موفق» می‌شمرد.
    const failure = describeFailure({ ...base, providerStatus: 0, message: "قالب یافت نشد" });
    expect(failure).toContain("status=0");
    expect(failure).toContain("قالب یافت نشد");
  });

  it("بدنه‌ی غیر-JSON هم شکست است و متنش گزارش می‌شود", () => {
    const failure = describeFailure({
      ...base,
      httpStatus: 502,
      providerStatus: undefined,
      rawBody: "<html>gateway</html>",
    });
    expect(failure).toContain("502");
    expect(failure).toContain("gateway");
  });
});

describe("createSmsIrProvider", () => {
  it("★ بدونِ کلید یا شناسه‌ی قالب، در **ساخت** می‌شکند نه سرِ ارسال", () => {
    expect(() => createSmsIrProvider(config({ apiKey: undefined }))).toThrow(SmsIrConfigError);
    expect(() => createSmsIrProvider(config({ apiKey: "   " }))).toThrow(SmsIrConfigError);
    expect(() => createSmsIrProvider(config({ templateId: undefined }))).toThrow(SmsIrConfigError);
  });

  it("★★ developmentOnly=false ⇒ گیتِ ADR-031 در production نمی‌گیردش", () => {
    const provider = createSmsIrProvider(config({ fetchImpl: fakeFetch("{}").impl }));
    expect(provider.name).toBe("sms.ir");
    expect(provider.developmentOnly).toBe(false);
    expect(() => {
      assertSmsProviderAllowed(provider, "production");
    }).not.toThrow();
  });

  it("پاسخِ ناموفق را خطا می‌کند", async () => {
    const { impl } = fakeFetch(JSON.stringify({ status: 0, message: "اعتبار کافی نیست" }));
    const provider = createSmsIrProvider(config({ fetchImpl: impl }));
    await expect(provider.send(PHONE, CODE)).rejects.toThrow(/status=0/);
  });

  it("★★ P7 — پیامِ خطا نه کدِ ورود دارد نه شماره‌ی خام", async () => {
    // این پیام به لاگ می‌رسد؛ همان چیزی که گیتِ فاز ۴ برای جلوگیری‌اش ساخته شد.
    const { impl } = fakeFetch(JSON.stringify({ status: 0, message: "خطا" }));
    const provider = createSmsIrProvider(config({ fetchImpl: impl }));
    let message = "";
    try {
      await provider.send(PHONE, CODE);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(CODE);
    expect(message).not.toContain(PHONE);
    expect(message).toContain("0912***67");
  });
});
