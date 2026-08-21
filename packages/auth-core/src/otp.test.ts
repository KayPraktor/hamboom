import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createMemoryOtpStore,
  createMockSmsProvider,
  maskPhone,
  requestOtp,
  verifyOtp,
  type OtpConfig,
} from "./otp.ts";

const NOW_MS = 1_700_000_000_000;
const PHONE = "09121234567";
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

function cfg(over: Partial<OtpConfig> = {}): OtpConfig {
  return { ttlSeconds: 300, maxAttempts: 3, cooldownSeconds: 60, clock: () => NOW_MS, ...over };
}

describe("OTP", () => {
  it("★ request کد را می‌فرستد و **هش**ش را ذخیره می‌کند — خام نه (P7)", async () => {
    const store = createMemoryOtpStore();
    let sent = "";
    await requestOtp(
      store,
      createMockSmsProvider((_p, code) => {
        sent = code;
      }),
      PHONE,
      cfg({ fixedCode: "123456" }),
    );
    expect(sent).toBe("123456");
    const rec = await store.get(PHONE);
    expect(rec?.codeHash).toBe(sha("123456"));
    expect(JSON.stringify(rec)).not.toContain("123456"); // ★ کدِ خام هیچ‌جای رکورد نیست
  });

  it("verify کدِ درست → ok، و چالش حذف می‌شود", async () => {
    const store = createMemoryOtpStore();
    await requestOtp(store, createMockSmsProvider(() => {}), PHONE, cfg({ fixedCode: "111111" }));
    expect(await verifyOtp(store, PHONE, "111111", cfg())).toEqual({ ok: true });
    expect(await store.get(PHONE)).toBeNull();
  });

  it("verify کدِ غلط → mismatch و attempts++", async () => {
    const store = createMemoryOtpStore();
    await requestOtp(store, createMockSmsProvider(() => {}), PHONE, cfg({ fixedCode: "111111" }));
    expect(await verifyOtp(store, PHONE, "999999", cfg())).toEqual({ ok: false, reason: "mismatch" });
    expect((await store.get(PHONE))?.attempts).toBe(1);
  });

  it("★ بعد از maxAttempts → locked (حتی با کدِ درست)", async () => {
    const store = createMemoryOtpStore();
    const c = cfg({ fixedCode: "111111", maxAttempts: 2 });
    await requestOtp(store, createMockSmsProvider(() => {}), PHONE, c);
    await verifyOtp(store, PHONE, "000000", c);
    await verifyOtp(store, PHONE, "000000", c);
    expect(await verifyOtp(store, PHONE, "111111", c)).toEqual({ ok: false, reason: "locked" });
  });

  it("verify منقضی → expired", async () => {
    const store = createMemoryOtpStore();
    await requestOtp(store, createMockSmsProvider(() => {}), PHONE, cfg({ fixedCode: "111111", ttlSeconds: 10 }));
    expect(await verifyOtp(store, PHONE, "111111", cfg({ clock: () => NOW_MS + 20_000 }))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("verify بدونِ چالش → no_challenge (نه خطای «کاربر نیست»)", async () => {
    const store = createMemoryOtpStore();
    expect(await verifyOtp(store, PHONE, "111111", cfg())).toEqual({
      ok: false,
      reason: "no_challenge",
    });
  });

  it("★ cooldown: request دومِ زودهنگام دوباره نمی‌فرستد — ولی خطا هم نه (ضدِ enumeration)", async () => {
    const store = createMemoryOtpStore();
    let count = 0;
    const sms = createMockSmsProvider(() => {
      count++;
    });
    await requestOtp(store, sms, PHONE, cfg({ fixedCode: "111111" }));
    await requestOtp(store, sms, PHONE, cfg({ fixedCode: "222222" }));
    expect(count).toBe(1);
  });

  it("★ maskPhone (P7): شماره ماسک می‌شود", () => {
    expect(maskPhone("09121234567")).toBe("0912***67");
    expect(maskPhone("12345")).toBe("***");
  });
});
