import type pg from "pg";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";
import type { ApiConfig } from "./config.ts";
import { HttpError } from "./errors.ts";

const TEST_CONFIG: ApiConfig = {
  NODE_ENV: "test",
  APP_ENV: "local",
  LOG_LEVEL: "fatal", // آرام در تست
  DATABASE_URL: "postgres://unused@localhost/none", // db تزریق می‌شود، اتصال نمی‌خورد
  DATABASE_SSL: false,
  DATABASE_POOL_MAX: 1,
  JWT_SECRET: "test_secret_at_least_thirty_two_chars_long",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  RT_TOKEN_TTL_SECONDS: 60,
  OTP_TTL_SECONDS: 120,
  OTP_MAX_ATTEMPTS: 5,
  OTP_COOLDOWN_SECONDS: 60,
  OTP_DEV_FIXED_CODE: undefined,
  PORT: 3002,
};

/** استخرِ دروغینِ db — فقط `query`/`end`. تست بدونِ Postgres. */
function fakeDb(queryImpl: () => Promise<{ rows: unknown[] }>): pg.Pool {
  return { query: queryImpl, end: (): Promise<void> => Promise.resolve() } as unknown as pg.Pool;
}

interface ErrBody {
  error: { code: string; message: string; requestId: string };
}

describe("buildApp", () => {
  it("healthz → ۲۰۰ {status:ok} (بدونِ نیاز به db)", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("readyz → ۲۰۰ وقتی db سالم، ۵۰۳ وقتی db می‌ترکد", async () => {
    const ok = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [{ ok: 1 }] })),
    });
    expect((await ok.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    await ok.close();

    const bad = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.reject(new Error("db down"))),
    });
    const res = await bad.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    await bad.close();
  });

  it("★ خطای ناشناخته → ۵۰۰ INTERNALِ یکسان، با requestId، **بدونِ لو**", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
    app.get("/boom", () => {
      throw new Error("جزئیاتِ داخلیِ محرمانه");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json() as ErrBody;
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.requestId).toBeTruthy();
    expect(res.payload).not.toContain("جزئیاتِ داخلیِ محرمانه");
    await app.close();
  });

  it("HttpError → کد/وضعیتِ نگاشته‌شده", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
    app.get("/nope", () => {
      throw new HttpError(404, "BOARD_NOT_FOUND", "بورد نیست");
    });
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrBody).error.code).toBe("BOARD_NOT_FOUND");
    await app.close();
  });

  it("مسیرِ ناموجود → ۴۰۴ NOT_FOUNDِ یکسان", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
    const res = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrBody).error.code).toBe("NOT_FOUND");
    await app.close();
  });
});
