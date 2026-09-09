import { describe, expect, it } from "vitest";

import { createCheckoutIdempotent } from "./services/billing.ts";

/**
 * ★★ retryِ `23505` — M5 گام ۶٫۳.
 *
 * ⚠️ چرا واحد و نه سنجه‌ی زنده: `createCheckout` هیچ نقطه‌ی تزریقی بینِ `SELECT` و
 * `INSERT` ندارد، پس هم‌پوشانیِ **قطعی** روی دیتابیسِ واقعی ساختنی نیست. سنجه‌ی
 * `billing:settle` رفتارِ خودِ Postgres را اثبات می‌کند (با `pg_sleep`ِ اجباری: ردیف یکی
 * می‌مانَد و بازنده `23505` می‌گیرد)؛ این‌جا **شاخه‌ی تازه** به‌صورت قطعی آزموده می‌شود.
 */
describe("createCheckoutIdempotent", () => {
  /** استخرِ دروغین: تراکنشِ اول `23505` می‌اندازد، تراکنشِ دوم ردیفِ برنده را می‌بیند. */
  function poolThatRacesOnce() {
    let attempt = 0;
    const client = {
      query: (sql: string) => {
        if (typeof sql === "string" && sql.startsWith("SELECT p.id")) {
          // تلاشِ اول: ردیفی نیست ⇒ INSERT می‌رود و می‌شکند. تلاشِ دوم: برنده commit شده.
          return Promise.resolve(
            attempt === 1
              ? { rows: [] }
              : {
                  rows: [{ id: "pay-1", invoice_id: "inv-1", amount_rial: 1000, number: "۱۴۰۵-۱" }],
                },
          );
        }
        if (typeof sql === "string" && sql.startsWith("BEGIN")) attempt += 1;
        if (typeof sql === "string" && sql.includes("SELECT * FROM plans")) {
          return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
        }
        return Promise.resolve({ rows: [] });
      },
      release: () => undefined,
    };
    return { connect: () => Promise.resolve(client) } as never;
  }

  it("★ بعد از 23505 یک بار دوباره تلاش می‌کند و پیش‌نویسِ برنده را برمی‌گردانَد", async () => {
    const draft = await createCheckoutIdempotent(
      poolThatRacesOnce(),
      {
        teamId: "t1",
        userId: "u1",
        planCode: "pro",
        period: "monthly",
        seats: 1,
        vatPercent: 0,
        gatewayName: "mock",
        gatewayMode: "sandbox",
      },
      "k1",
    );
    expect(draft.paymentId).toBe("pay-1");
    expect(draft.replayed).toBe(true);
  });

  it("⚠️ خطای **غیرِ** 23505 دوباره تلاش نمی‌شود (خطای واقعی پنهان نشود)", async () => {
    const boom = { code: "42P01", message: "relation does not exist" };
    const pool = {
      connect: () =>
        Promise.resolve({
          query: (sql: string) =>
            typeof sql === "string" && sql.startsWith("SELECT p.id")
              ? Promise.reject(Object.assign(new Error(boom.message), { code: boom.code }))
              : Promise.resolve({ rows: [] }),
          release: () => undefined,
        }),
    } as never;

    await expect(
      createCheckoutIdempotent(
        pool,
        {
          teamId: "t1",
          userId: "u1",
          planCode: "pro",
          period: "monthly",
          seats: 1,
          vatPercent: 0,
          gatewayName: "mock",
          gatewayMode: "sandbox",
        },
        "k1",
      ),
    ).rejects.toThrow(/relation does not exist/);
  });
});
