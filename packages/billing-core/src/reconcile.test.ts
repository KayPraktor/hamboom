import { describe, expect, it } from "vitest";

import { MockGateway } from "./mock-gateway.ts";
import {
  matchOrphans,
  planSweep,
  supportsUnverifiedList,
  type PendingPaymentSnapshot,
} from "./reconcile.ts";

const NOW = new Date("2026-09-06T12:00:00Z");
const MINUTE = 60_000;

/** ردیفِ pending به سنِ دلخواه (دقیقه). */
const row = (
  id: string,
  ageMinutes: number,
  extra: Partial<PendingPaymentSnapshot> = {},
): PendingPaymentSnapshot => ({
  id,
  authority: `A-${id}`,
  amountRial: 1_990_000,
  requestedAt: new Date(NOW.getTime() - ageMinutes * MINUTE),
  failureCode: null,
  ...extra,
});

const policy = { now: NOW, staleAfterMs: 20 * MINUTE, expireAfterMs: 72 * 60 * MINUTE };

describe("planSweep — نردبانِ تصمیم (ADR-056)", () => {
  it("ردیفِ جوان دست نخورده می‌مانَد — کاربر ممکن است روی صفحه‌ی بانک باشد", () => {
    const decision = planSweep([row("p1", 5)], policy)[0]!;
    expect(decision).toMatchObject({ paymentId: "p1", action: "skip", reason: "tooYoung" });
  });

  it("ردیفِ کهنه از درگاه پرسیده می‌شود", () => {
    const decision = planSweep([row("p2", 30)], policy)[0]!;
    expect(decision).toMatchObject({ action: "verify", reason: "askGateway" });
  });

  it("ردیفِ بدونِ authority یتیم است، نه شکست‌خورده", () => {
    const decision = planSweep([row("p3", 30, { authority: null })], policy)[0]!;
    expect(decision).toMatchObject({ action: "orphan", reason: "noAuthority" });
  });

  it("★★ ردیفِ خیلی کهنه که **هرگز پرسیده نشده** باطل نمی‌شود — باز هم verify", () => {
    // این همان قاعده‌ای است که نبودنش پولِ گرفته‌شده را برای همیشه نامرئی می‌کند.
    const decision = planSweep([row("p4", 200 * 60, { failureCode: null })], policy)[0]!;
    expect(decision.action).toBe("verify");
  });

  it("★ ردیفِ خیلی کهنه که یک‌بار «پرداخت نشده» گرفته، باطل می‌شود", () => {
    const decision = planSweep([row("p5", 200 * 60, { failureCode: "-51" })], policy)[0]!;
    expect(decision).toMatchObject({ action: "expire", reason: "askedAndAged" });
  });

  it("ردیفِ پرسیده‌شده ولی هنوز نه‌چندان کهنه، باطل نمی‌شود", () => {
    const decision = planSweep([row("p6", 30, { failureCode: "-51" })], policy)[0]!;
    expect(decision.action).toBe("verify");
  });

  it("سن در تصمیم گزارش می‌شود (برای لاگِ اجرا)", () => {
    const decision = planSweep([row("p7", 45)], policy)[0]!;
    expect(decision.ageMs).toBe(45 * MINUTE);
  });

  it("مرزِ دقیقِ کهنگی: مساوی یعنی کهنه", () => {
    expect(planSweep([row("p8", 20)], policy)[0]!.action).toBe("verify");
    expect(planSweep([row("p9", 19)], policy)[0]!.action).toBe("skip");
  });

  it("★ انقضای زودتر از کهنگی رد می‌شود — وگرنه بدونِ حتی یک پرسش باطل می‌شد", () => {
    expect(() =>
      planSweep([row("p10", 30)], { now: NOW, staleAfterMs: 20 * MINUTE, expireAfterMs: MINUTE }),
    ).toThrow(RangeError);
  });

  it("آستانه‌ی منفی رد می‌شود", () => {
    expect(() => planSweep([], { now: NOW, staleAfterMs: -1, expireAfterMs: 10 * MINUTE })).toThrow(
      RangeError,
    );
    expect(() => planSweep([], { now: NOW, staleAfterMs: 1, expireAfterMs: -10 })).toThrow(
      RangeError,
    );
  });

  it("فهرستِ خالی ⇒ تصمیمِ خالی", () => {
    expect(planSweep([], policy)).toEqual([]);
  });
});

describe("matchOrphans — فرزندخواندگیِ authorityِ گم‌شده", () => {
  const orphan = (id: string, amountRial: number): PendingPaymentSnapshot => ({
    ...row(id, 60),
    authority: null,
    amountRial,
  });

  it("★ یک یتیم و یک نامزدِ هم‌مبلغ ⇒ فرزندخواندگی", () => {
    const decisions = matchOrphans(
      [orphan("o1", 500_000)],
      [{ authority: "Z1", amountRial: 500_000 }],
      new Set(),
    );
    expect(decisions[0]).toEqual({ paymentId: "o1", action: "adopt", authority: "Z1" });
  });

  it("هیچ نامزدی با آن مبلغ ⇒ رد", () => {
    const decisions = matchOrphans(
      [orphan("o2", 500_000)],
      [{ authority: "Z1", amountRial: 900_000 }],
      new Set(),
    );
    expect(decisions[0]).toMatchObject({ action: "refuse", reason: "noCandidate" });
  });

  it("★★ دو نامزدِ هم‌مبلغ ⇒ رد، نه حدس", () => {
    const decisions = matchOrphans(
      [orphan("o3", 500_000)],
      [
        { authority: "Z1", amountRial: 500_000 },
        { authority: "Z2", amountRial: 500_000 },
      ],
      new Set(),
    );
    expect(decisions[0]).toMatchObject({ action: "refuse", reason: "manyCandidates" });
  });

  it("★★ دو یتیمِ هم‌مبلغ ⇒ هر دو رد می‌شوند، حتی با یک نامزد", () => {
    const decisions = matchOrphans(
      [orphan("o4", 500_000), orphan("o5", 500_000)],
      [{ authority: "Z1", amountRial: 500_000 }],
      new Set(),
    );
    expect(decisions.map((d) => d.action)).toEqual(["refuse", "refuse"]);
    expect(decisions[0]).toMatchObject({ reason: "manyOrphans" });
  });

  it("★ authorityِ صاحب‌دار نامزد نیست — حتی اگر مبلغش بخورد", () => {
    const decisions = matchOrphans(
      [orphan("o6", 500_000)],
      [{ authority: "TAKEN", amountRial: 500_000 }],
      new Set(["TAKEN"]),
    );
    expect(decisions[0]).toMatchObject({ action: "refuse", reason: "noCandidate" });
  });

  it("یتیم‌های با مبلغ‌های متفاوت مستقل تصمیم می‌گیرند", () => {
    const decisions = matchOrphans(
      [orphan("o7", 500_000), orphan("o8", 900_000)],
      [
        { authority: "Z1", amountRial: 500_000 },
        { authority: "Z2", amountRial: 900_000 },
      ],
      new Set(),
    );
    expect(decisions).toEqual([
      { paymentId: "o7", action: "adopt", authority: "Z1" },
      { paymentId: "o8", action: "adopt", authority: "Z2" },
    ]);
  });

  it("★ ردیفِ authorityدار در فهرستِ یتیم‌ها بلند می‌شکند", () => {
    expect(() => matchOrphans([row("nope", 60)], [], new Set())).toThrow(RangeError);
  });
});

describe("supportsUnverifiedList", () => {
  it("درگاهِ ساختگی فهرست می‌دهد", () => {
    expect(supportsUnverifiedList(new MockGateway({ checkoutBaseUrl: "http://x/pay" }))).toBe(true);
  });

  it("درگاهِ بدونِ این متد رد می‌شود", () => {
    const bare = {
      name: "bare",
      mode: "sandbox",
      developmentOnly: true,
      createPayment: async () => ({ authority: "a", redirectUrl: "u" }),
      verifyPayment: async () => ({ status: "gatewayError" as const, code: null, message: "" }),
    };
    expect(supportsUnverifiedList(bare)).toBe(false);
  });
});

describe("MockGateway.listUnverified", () => {
  it("★ پرداختِ verify‌نشده در فهرست است و بعد از verify از آن بیرون می‌رود", async () => {
    const gateway = new MockGateway({ checkoutBaseUrl: "http://x/pay" });
    const created = await gateway.createPayment({
      amountRial: 500_000,
      description: "تست",
      callbackUrl: "http://x/cb",
    });
    expect(await gateway.listUnverified()).toEqual([
      { authority: created.authority, amountRial: 500_000 },
    ]);

    await gateway.verifyPayment({ authority: created.authority, amountRial: 500_000 });
    expect(await gateway.listUnverified()).toEqual([]);
  });
});
