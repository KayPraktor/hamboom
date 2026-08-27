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
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
    const res = await app.inject({ method: "POST", url: `/boards/${UID}/assets/presign`, payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("★ presign با boardId بدشکل → ۴۰۰ BOARD_ID_MALFORMED (قبل از parse بدنه)", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
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
    const app = await buildApp({ config: TEST_CONFIG, db: fakeDb(() => Promise.resolve({ rows: [] })) });
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
