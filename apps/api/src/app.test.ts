import { signAccessToken } from "@hamboom/auth-core";
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
  RATE_LIMIT_MAX: 100,
  RATE_LIMIT_WINDOW_SECONDS: 60,
  RATE_LIMIT_OTP_MAX: 5,
  // S3 — نمونه‌ی S3Client تنبل است (تا درخواستی نیاید اتصال نمی‌خورد)، پس تست شبکه نمی‌زند.
  S3_ENDPOINT: "http://localhost:9999",
  S3_REGION: "ir-thr-at1",
  S3_ACCESS_KEY_ID: "unused",
  S3_SECRET_ACCESS_KEY: "unused",
  S3_FORCE_PATH_STYLE: true,
  S3_PRESIGN_TTL_SECONDS: 900,
  S3_BUCKET_ASSETS: "hamboom-assets",
  S3_BUCKET_SNAPSHOTS: "hamboom-snapshots",
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

/**
 * گاردهای `GET /boards/:id/snapshot` — سیم‌کشیِ سریع (بدونِ DB/MinIO).
 * مسیرِ کاملِ DB+storage (بایت‌های واقعی، شاخه‌های تاب‌آور) روی سرورِ زنده اثبات می‌شود.
 */
describe("GET /boards/:id/snapshot — گاردها", () => {
  const SECRET = new TextEncoder().encode(TEST_CONFIG.JWT_SECRET);
  const VALID_UUID = "11111111-1111-1111-1111-111111111111";
  const bearer = async (sub: string): Promise<string> =>
    `Bearer ${await signAccessToken(SECRET, sub, 900)}`;

  it("بدونِ توکن → ۴۰۱ (guard قبل از هر کوئری)", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
    const res = await app.inject({ method: "GET", url: `/boards/${VALID_UUID}/snapshot` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("★ شناسه‌ی بدشکل (یافته‌ی M2 #۱) → ۴۰۰ BOARD_ID_MALFORMED، نه FORBIDDENِ گنگ", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
    const res = await app.inject({
      method: "GET",
      url: "/boards/not-a-uuid/snapshot",
      headers: { authorization: await bearer(VALID_UUID) },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.code).toBe("BOARD_ID_MALFORMED");
    await app.close();
  });
});
