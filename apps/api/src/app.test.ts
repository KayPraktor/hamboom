import { signAccessToken } from "@hamboom/auth-core";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";
import { HttpError } from "./errors.ts";
import { fakeDb, TEST_CONFIG } from "./test-fixtures.ts";

interface ErrBody {
  error: { code: string; message: string; requestId: string };
}

describe("buildApp", () => {
  it("healthz → ۲۰۰ {status:ok} (بدونِ نیاز به db)", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
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
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
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
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    app.get("/nope", () => {
      throw new HttpError(404, "BOARD_NOT_FOUND", "بورد نیست");
    });
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrBody).error.code).toBe("BOARD_NOT_FOUND");
    await app.close();
  });

  it("مسیرِ ناموجود → ۴۰۴ NOT_FOUNDِ یکسان", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
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
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    const res = await app.inject({ method: "GET", url: `/boards/${VALID_UUID}/snapshot` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("★ شناسه‌ی بدشکل (یافته‌ی M2 #۱) → ۴۰۰ BOARD_ID_MALFORMED، نه FORBIDDENِ گنگ", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
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

/**
 * گاردهای endpointهای دارایی — سیم‌کشیِ سریع (بدونِ DB/MinIO).
 * جریانِ کاملِ presign→upload→commit→GET (بایت‌های واقعی، دی‌دوپ، sha غلط) روی سرورِ زنده اثبات شد.
 */
describe("asset endpoints — گاردها", () => {
  const SECRET = new TextEncoder().encode(TEST_CONFIG.JWT_SECRET);
  const UID = "22222222-2222-2222-2222-222222222222";
  const bearer = async (sub: string): Promise<string> =>
    `Bearer ${await signAccessToken(SECRET, sub, 900)}`;

  it("presign بدونِ توکن → ۴۰۱", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    const res = await app.inject({
      method: "POST",
      url: `/boards/${UID}/assets/presign`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("★ presign با boardId بدشکل → ۴۰۰ BOARD_ID_MALFORMED (قبل از parse بدنه)", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    const res = await app.inject({
      method: "POST",
      url: "/boards/not-a-uuid/assets/presign",
      headers: { authorization: await bearer(UID) },
      payload: { mimeType: "image/png", sizeBytes: 10, sha256: "0".repeat(64) },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.code).toBe("BOARD_ID_MALFORMED");
    await app.close();
  });

  it("GET /assets/بدشکل → ۴۰۴ NOT_FOUND (بدونِ لوِ وجود)", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    const res = await app.inject({
      method: "GET",
      url: "/assets/not-a-uuid",
      headers: { authorization: await bearer(UID) },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrBody).error.code).toBe("NOT_FOUND");
    await app.close();
  });
});

describe("گاردِ بوتِ آدرسِ بازگشت از درگاه (M4 فاز ۹)", () => {
  const db = () => fakeDb(() => Promise.resolve({ rows: [] }));

  it("★★ آدرسی که به مسیرِ ثبت‌شده نمی‌خورد ⇒ اپ **بالا نمی‌آید**", async () => {
    // ⚠️ همان پیش‌فرضِ غلطِ واقعی: پیشوندِ `/api/v1` هیچ‌جا ثبت نمی‌شود، پس درگاه کاربر را
    //    بعد از پرداخت به ۴۰۴ می‌فرستاد و تسویه فقط با آشتی‌دهی نجات پیدا می‌کرد.
    await expect(
      buildApp({
        config: {
          ...TEST_CONFIG,
          ZARINPAL_CALLBACK_URL: "http://localhost:3002/api/v1/billing/zarinpal/callback",
        },
        db: db(),
      }),
    ).rejects.toThrow(/ZARINPAL_CALLBACK_URL/);
  });

  it("آدرسِ درست بالا می‌آید و مسیرِ callback ثبت شده است", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: db() });
    expect(app.registeredRoutes).toContain("GET /billing/zarinpal/callback");
    await app.close();
  });
});

/**
 * گاردهای بوتِ production — M5 فاز ۴.
 *
 * ⚠️ هر سه از یک اجرای **واقعی** آمدند، نه از بازبینیِ کد: در فاز ۲ کلِ استک با
 * `APP_ENV=production` بالا آمد و کدِ OTP از **لاگِ سرور** خوانده شد.
 */
describe("گاردهای بوتِ production (M5 فاز ۴)", () => {
  const db = () => fakeDb(() => Promise.resolve({ rows: [] }));
  /** کمترین تغییرِ لازم تا configِ تست «شبیهِ production» شود. */
  const prod = (over: Partial<typeof TEST_CONFIG> = {}) => ({
    ...TEST_CONFIG,
    APP_ENV: "production" as const,
    JWT_SECRET: "9f3a7c1e4b8d2065af13ce97b402d85f",
    PAYMENT_PROVIDER: "zarinpal" as const,
    ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000",
    ...over,
  });

  it("★★ پیامکِ ساختگی در production ⇒ اپ **بالا نمی‌آید**", async () => {
    await expect(buildApp({ config: prod(), db: db() })).rejects.toThrow(
      /SmsProviderNotAllowedError|پیامک/,
    );
  });

  it("رازِ ضعیف در production ⇒ اپ **بالا نمی‌آید**", async () => {
    // ★ همان پیش‌فرضِ **واقعیِ** `.env.example` — چیزی که یک اپراتور کپی می‌کند.
    await expect(
      buildApp({
        config: prod({ JWT_SECRET: "change_me_dev_only_jwt_secret_at_least_32_chars_long" }),
        db: db(),
      }),
    ).rejects.toThrow(/JWT_SECRET/);
    // و رازِ خودِ فیکسچرِ تست هم نباید از گیت رد شود.
    await expect(
      buildApp({ config: prod({ JWT_SECRET: TEST_CONFIG.JWT_SECRET }), db: db() }),
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it("★ دیتابیسِ دور بدونِ SSL در production ⇒ اپ **بالا نمی‌آید**", async () => {
    await expect(
      buildApp({
        config: prod({ DATABASE_URL: "postgres://u:p@db.example.ir:5432/x", DATABASE_SSL: false }),
        db: db(),
      }),
    ).rejects.toThrow(/DATABASE_SSL/);
  });

  it("⚠️ همان configِ production با `APP_ENV=staging` **بالا می‌آید** (mock مجاز است)", async () => {
    const app = await buildApp({
      config: { ...prod(), APP_ENV: "staging", PAYMENT_PROVIDER: "mock" },
      db: db(),
    });
    expect(app.registeredRoutes.length).toBeGreaterThan(0);
    await app.close();
  });
});
