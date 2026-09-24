import { describe, expect, it } from "vitest";

import { inetOrNull, recordAudit } from "./audit.ts";

/**
 * `recordAudit` — M6 فاز ۴ (ADR-067 §۱/§۳). این‌جا فقط چیزهای **خالص**: با executorِ داده‌شده
 * می‌نویسد (نه چیزِ دیگری)، IP را برای ستونِ `inet` نرمال می‌کند، و شکلِ ردیف. اتمیک‌بودنِ واقعی
 * («عمل شکست می‌خورد ⇒ هیچ ردیفی») روی PGِ زنده در `sdk:contract` اثبات می‌شود، نه با بدل.
 */
describe("inetOrNull — IP برای ستونِ inet", () => {
  it("v4 و v6 معتبر می‌مانند؛ v4-mapped به v4 نرمال می‌شود", () => {
    expect(inetOrNull("203.0.113.7")).toBe("203.0.113.7");
    expect(inetOrNull("2001:db8::1")).toBe("2001:db8::1");
    expect(inetOrNull("::ffff:10.0.0.9")).toBe("10.0.0.9");
  });
  it("★ رشته‌ی نامعتبر ⇒ null، نه throw — forensics نباید عمل را بیندازد", () => {
    expect(inetOrNull("unknown")).toBeNull();
    expect(inetOrNull("")).toBeNull();
    expect(inetOrNull(null)).toBeNull();
    expect(inetOrNull(undefined)).toBeNull();
  });
});

describe("recordAudit — یک INSERT روی همان executor", () => {
  it("دقیقاً یک INSERT روی tx می‌زند و ستون‌ها به ترتیب‌اند", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const tx = {
      query: (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return Promise.resolve({ rows: [] });
      },
    };
    await recordAudit(tx as never, {
      actor: { userId: "u1", ip: "::ffff:198.51.100.4", userAgent: "UA" },
      action: "staff.step_up",
      target: { type: "user", id: "u1" },
      teamId: null,
      metadata: { reason: "test" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/INSERT INTO audit_logs/);
    expect(calls[0]!.params).toEqual([
      "u1",
      null,
      "staff.step_up",
      "user",
      "u1",
      "198.51.100.4",
      "UA",
      JSON.stringify({ reason: "test" }),
    ]);
  });

  it("خطای INSERT بالا می‌رود (بلعیده نمی‌شود) — تا تراکنشِ عمل هم بشکند", async () => {
    const tx = { query: () => Promise.reject(new Error("audit down")) };
    await expect(
      recordAudit(tx as never, {
        actor: { userId: null, ip: null, userAgent: null },
        action: "staff.grant",
      }),
    ).rejects.toThrow("audit down");
  });
});
