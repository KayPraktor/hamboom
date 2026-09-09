import { assertSmsProviderAllowed, SmsIrConfigError } from "@hamboom/auth-core";
import { describe, expect, it } from "vitest";

import { createSmsProvider, type SmsConfig } from "./sms.ts";

function cfg(over: Partial<SmsConfig> = {}): SmsConfig {
  return {
    SMS_PROVIDER: "mock",
    SMS_IR_API_KEY: undefined,
    SMS_IR_TEMPLATE_ID: undefined,
    SMS_IR_PARAM_NAME: "CODE",
    SMS_IR_BASE_URL: "https://api.sms.ir",
    SMS_IR_TIMEOUT_MS: 10_000,
    ...over,
  };
}

const noop = (): void => undefined;

describe("createSmsProvider — M5 فازِ ۴٫۵", () => {
  it("پیش‌فرض mock است و کد را به sink می‌دهد", async () => {
    const seen: string[] = [];
    const provider = createSmsProvider(cfg(), (_phone, code) => seen.push(code));
    expect(provider.name).toBe("mock");
    expect(provider.developmentOnly).toBe(true);
    await provider.send("09121234567", "12345");
    expect(seen).toEqual(["12345"]);
  });

  it("★★ با smsir فرستنده‌ی واقعی می‌سازد و گیتِ production بازش می‌گذارد", () => {
    const provider = createSmsProvider(
      cfg({ SMS_PROVIDER: "smsir", SMS_IR_API_KEY: "k".repeat(32), SMS_IR_TEMPLATE_ID: 265_541 }),
      noop,
    );
    expect(provider.name).toBe("sms.ir");
    expect(provider.developmentOnly).toBe(false);
    // ⇒ همان گیتی که از فاز ۴ تا امروز جلوی `APP_ENV=production` را گرفته بود.
    expect(() => {
      assertSmsProviderAllowed(provider, "production");
    }).not.toThrow();
  });

  it("★ smsir با پیکربندیِ ناقص در **ساخت** می‌شکند، نه سرِ اولین ورود", () => {
    expect(() => createSmsProvider(cfg({ SMS_PROVIDER: "smsir" }), noop)).toThrow(SmsIrConfigError);
    expect(() =>
      createSmsProvider(cfg({ SMS_PROVIDER: "smsir", SMS_IR_API_KEY: "k".repeat(32) }), noop),
    ).toThrow(/SMS_IR_TEMPLATE_ID/);
  });

  it("⊕ sink فقط برای mock است — با smsir هیچ کدی به لاگ نمی‌رسد", () => {
    const seen: string[] = [];
    const provider = createSmsProvider(
      cfg({ SMS_PROVIDER: "smsir", SMS_IR_API_KEY: "k".repeat(32), SMS_IR_TEMPLATE_ID: 1 }),
      (_p, c) => seen.push(c),
    );
    // خودِ ساخت هیچ چیزی به sink نمی‌دهد و `send` هم مسیرِ HTTP می‌رود، نه sink.
    expect(seen).toEqual([]);
    expect(provider.name).toBe("sms.ir");
  });
});
