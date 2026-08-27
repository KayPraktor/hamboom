import { describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";
import { fakeDb, TEST_CONFIG } from "./test-fixtures.ts";

/**
 * Idempotency-Key — با یک routeِ آزمایشیِ شمارنده روی همان appِ ساخته‌شده تست می‌شود (هوکِ سراسری
 * روی هر POSTِ احرازشده‌ی دارای کلید اعمال می‌شود، پس routeِ محلی هم پوشش داده می‌شود).
 */
describe("Idempotency-Key", () => {
  async function appWithProbe(): Promise<{
    app: Awaited<ReturnType<typeof buildApp>>;
    calls: () => number;
  }> {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    let n = 0;
    app.post("/__idem_probe", () => {
      n += 1;
      return { n };
    });
    return { app, calls: () => n };
  }

  const AUTH = { authorization: "Bearer probe-token" };

  it("★ همان کلید دوباره → پاسخِ کش‌شده و handler فقط یک‌بار اجرا می‌شود", async () => {
    const { app, calls } = await appWithProbe();
    const key = { "idempotency-key": "abc-123" };

    const r1 = await app.inject({ method: "POST", url: "/__idem_probe", headers: { ...AUTH, ...key } });
    const r2 = await app.inject({ method: "POST", url: "/__idem_probe", headers: { ...AUTH, ...key } });

    expect(r1.json()).toEqual({ n: 1 });
    expect(r2.json()).toEqual({ n: 1 }); // ★ همان بدنه، نه n:2
    expect(r2.headers["idempotent-replay"]).toBe("true");
    expect(r1.headers["idempotent-replay"]).toBeUndefined();
    expect(calls()).toBe(1); // handler دقیقاً یک‌بار
    await app.close();
  });

  it("کلیدِ متفاوت → handler دوباره اجرا می‌شود", async () => {
    const { app, calls } = await appWithProbe();
    await app.inject({ method: "POST", url: "/__idem_probe", headers: { ...AUTH, "idempotency-key": "k1" } });
    await app.inject({ method: "POST", url: "/__idem_probe", headers: { ...AUTH, "idempotency-key": "k2" } });
    expect(calls()).toBe(2);
    await app.close();
  });

  it("بدونِ هدرِ کلید → کش نمی‌شود (handler هر بار)", async () => {
    const { app, calls } = await appWithProbe();
    await app.inject({ method: "POST", url: "/__idem_probe", headers: AUTH });
    await app.inject({ method: "POST", url: "/__idem_probe", headers: AUTH });
    expect(calls()).toBe(2);
    await app.close();
  });

  it("درخواست‌های هم‌زمانِ همان کلید → یک اجرا، هر دو یک نتیجه", async () => {
    const { app, calls } = await appWithProbe();
    const key = { ...AUTH, "idempotency-key": "concurrent-1" };
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/__idem_probe", headers: key }),
      app.inject({ method: "POST", url: "/__idem_probe", headers: key }),
    ]);
    expect(a.json()).toEqual({ n: 1 });
    expect(b.json()).toEqual({ n: 1 });
    expect(calls()).toBe(1); // ★ حتی هم‌زمان، فقط یک اجرا
    await app.close();
  });
});
