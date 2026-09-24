import { signAccessToken } from "@hamboom/auth-core";
import { adminMe } from "@hamboom/shared-types";
import type pg from "pg";
import { describe, expect, it } from "vitest";

import { makeStaffGuards, stepUpFresh } from "./admin-guard.ts";
import { buildApp } from "./app.ts";
import { audited } from "./audit.ts";
import { TEST_CONFIG } from "./test-fixtures.ts";

/**
 * گیتِ `/admin` — M6 فاز ۳ (ADR-066 §۲/§۳). چهار وضعیتِ معیارِ پذیرشِ ۳٫۲ روی `buildApp`ِ واقعی
 * (مسیریابی + preHandlerها + errorHandler)، با یک dbِ دروغین که **بر اساسِ متنِ SQL** پاسخ می‌دهد.
 *
 * ۴۲۸ یک‌بار روی مسیرِ **عمدی** (با clockِ ثابت، هر سه حالتِ پنجره) و از فاز ۵ روی مسیرِ **واقعیِ** تعلیق
 * (`POST /admin/users/:id/suspend`) اثبات می‌شود؛ خودِ تعلیق (تراکنش، سوزاندنِ نشست‌ها) روی PG در `sdk:contract`.
 */

interface ErrBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

interface UserRowStub {
  is_staff: boolean;
  status: string;
  step_up_verified_at: Date | null;
  deleted: boolean;
  phone: string | null;
}

/** dbِ دروغین که هر کوئریِ `users` را از یک ردیفِ ثابت جواب می‌دهد؛ بقیه خالی. */
function usersDb(row: UserRowStub | null): pg.Pool {
  const query = (sql: string): Promise<{ rows: unknown[] }> => {
    if (row === null || row.deleted) return Promise.resolve({ rows: [] });
    if (sql.includes("SELECT is_staff, status, step_up_verified_at")) {
      return Promise.resolve({
        rows: [
          {
            is_staff: row.is_staff,
            status: row.status,
            step_up_verified_at: row.step_up_verified_at,
          },
        ],
      });
    }
    if (sql.includes("SELECT step_up_verified_at")) {
      return Promise.resolve({ rows: [{ step_up_verified_at: row.step_up_verified_at }] });
    }
    if (sql.includes("SELECT phone")) return Promise.resolve({ rows: [{ phone: row.phone }] });
    return Promise.resolve({ rows: [] });
  };
  return { query, end: () => Promise.resolve() } as unknown as pg.Pool;
}

const SECRET = new TextEncoder().encode(TEST_CONFIG.JWT_SECRET);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const bearer = async (): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await signAccessToken(SECRET, USER_ID, 900)}`,
});

const staffRow = (over: Partial<UserRowStub> = {}): UserRowStub => ({
  is_staff: true,
  status: "active",
  step_up_verified_at: null,
  deleted: false,
  phone: "09120000001",
  ...over,
});

describe("★ requireStaff — چهار وضعیتِ ۳٫۲ روی buildApp", () => {
  it("anon → ۴۰۱ (requireAuth جلوتر از requireStaff)", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: usersDb(staffRow()) });
    const res = await app.inject({ method: "GET", url: "/admin/me" });
    expect(res.statusCode).toBe(401);
    expect((res.json() as ErrBody).error.code).toBe("UNAUTHORIZED");
    await app.close();
  });

  it("کاربرِ عادیِ معتبر → ۴۰۳ FORBIDDEN (توکنِ درست کافی نیست؛ is_staff از DB)", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: usersDb(staffRow({ is_staff: false })) });
    const res = await app.inject({ method: "GET", url: "/admin/me", headers: await bearer() });
    expect(res.statusCode).toBe(403);
    expect((res.json() as ErrBody).error.code).toBe("FORBIDDEN");
    await app.close();
  });

  it("staffِ **معلق** → ۴۰۳ (fail-closed؛ پیامِ یک‌شکل، تعلیق لو نمی‌رود)", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: usersDb(staffRow({ status: "suspended" })),
    });
    const res = await app.inject({ method: "GET", url: "/admin/me", headers: await bearer() });
    expect(res.statusCode).toBe(403);
    expect(res.payload).not.toContain("معلق");
    await app.close();
  });

  it("staffِ حذف‌شده (ردیف نیست) → ۴۰۳، نه ۵۰۰ و نه ۲۰۰", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: usersDb(staffRow({ deleted: true })) });
    const res = await app.inject({ method: "GET", url: "/admin/me", headers: await bearer() });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("staffِ فعال → ۲۰۰ با DTOی adminMe (isStaff literal true، stepUpVerifiedAt null)", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: usersDb(staffRow()) });
    const res = await app.inject({ method: "GET", url: "/admin/me", headers: await bearer() });
    expect(res.statusCode).toBe(200);
    const body = adminMe.parse(res.json());
    expect(body.userId).toBe(USER_ID);
    expect(body.stepUpVerifiedAt).toBeNull();
    await app.close();
  });

  it("★ مسیرِ step-up-گیت‌شده بدونِ OTPِ تازه → ۴۲۸ STEP_UP_REQUIRED؛ با OTPِ تازه → ۲۰۰", async () => {
    const now = Date.UTC(2026, 8, 12, 12, 0, 0);
    const fresh = new Date(now - 30_000); // ۳۰ ثانیه پیش، داخلِ پنجره‌ی ۶۰۰ ثانیه
    const stale = new Date(now - 601_000); // یک ثانیه بیرونِ پنجره
    for (const [at, expected] of [
      [null, 428],
      [stale, 428],
      [fresh, 200],
    ] as const) {
      const pool = usersDb(staffRow({ step_up_verified_at: at }));
      const app = await buildApp({ config: TEST_CONFIG, db: pool });
      // ★ مسیرِ عمدی: همان سه گاردی که فاز ۵ روی تعلیق می‌گذارد، با clockِ ثابت.
      const { requireStaff, requireStepUp } = makeStaffGuards({
        pool,
        stepUpSeconds: TEST_CONFIG.ADMIN_STEP_UP_SECONDS,
        clock: () => now,
      });
      const requireAuth = (await import("./auth-guard.ts")).makeRequireAuth(SECRET);
      app.post(
        "/admin/_destructive",
        {
          preHandler: [requireAuth, requireStaff, requireStepUp],
          config: audited("staff.step_up"),
        },
        () => ({ done: true }),
      );
      const res = await app.inject({
        method: "POST",
        url: "/admin/_destructive",
        headers: await bearer(),
      });
      expect(res.statusCode, `stepUpVerifiedAt=${String(at)}`).toBe(expected);
      if (expected === 428) {
        const body = res.json() as ErrBody;
        expect(body.error.code).toBe("STEP_UP_REQUIRED");
        expect(body.error.details?.stepUpSeconds).toBe(600);
      }
      await app.close();
    }
  });
});

describe("★ فاز ۵ — اولین مسیرهای مخربِ واقعی پشتِ requireStepUp", () => {
  it("POST /admin/users/:id/{suspend,unsuspend} بدونِ step-up → ۴۲۸ پیش از هر چیز (حتی پیش از اعتبارسنجیِ بدنه)", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: usersDb(staffRow()) });
    for (const action of ["suspend", "unsuspend"]) {
      const res = await app.inject({
        method: "POST",
        url: `/admin/users/${USER_ID}/${action}`,
        headers: await bearer(),
        payload: {},
      });
      expect(res.statusCode, action).toBe(428);
      expect((res.json() as ErrBody).error.code).toBe("STEP_UP_REQUIRED");
    }
    await app.close();
  });

  it("phone/reveal بدونِ step-up می‌گذرد (خواندن است) ولی غیرِ staff ۴۰۳ می‌گیرد", async () => {
    const app = await buildApp({ config: TEST_CONFIG, db: usersDb(staffRow({ is_staff: false })) });
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${USER_ID}/phone/reveal`,
      headers: await bearer(),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe("stepUpFresh — پنجره‌ی per-user (خالص)", () => {
  const now = 1_000_000_000_000;
  it("null ⇒ هرگز تازه نیست", () => {
    expect(stepUpFresh(null, 600, now)).toBe(false);
  });
  it("داخلِ پنجره ⇒ تازه؛ دقیقاً روی مرز هم تازه", () => {
    expect(stepUpFresh(new Date(now - 1), 600, now)).toBe(true);
    expect(stepUpFresh(new Date(now - 600_000), 600, now)).toBe(true);
  });
  it("یک میلی‌ثانیه بعد از مرز ⇒ کهنه", () => {
    expect(stepUpFresh(new Date(now - 600_001), 600, now)).toBe(false);
  });
  it("⚠️ زمانِ **آینده** (skewِ ساعت) ⇒ کهنه، نه تازه‌ی همیشگی", () => {
    expect(stepUpFresh(new Date(now + 5_000), 600, now)).toBe(false);
  });
});
