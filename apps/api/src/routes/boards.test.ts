import { signAccessToken } from "@hamboom/auth-core";
import type pg from "pg";
import { describe, expect, it } from "vitest";

import { buildApp } from "../app.ts";
import { TEST_CONFIG } from "../test-fixtures.ts";

/**
 * گاردها و wiringِ `GET /boards` — سیم‌کشی، بدونِ DBِ واقعی.
 *
 * ★ رفتارِ کاملِ سطلِ بازیافت (بوردِ حذف‌شده واقعاً برمی‌گردد، فقط برای مالک) روی سرورِ زنده
 *   اثبات می‌شود؛ اینجا فقط قفل می‌کنیم که پرچمِ `trashed` **پیش‌بندِ حذف را برعکس** و گیتِ
 *   دسترسی را به owner می‌بَرد. با کپچرِ متنِ SQL — یعنی برداشتنِ شاخه، این تست را قرمز می‌کند.
 */
const SECRET = new TextEncoder().encode(TEST_CONFIG.JWT_SECRET);
const UID = "33333333-3333-3333-3333-333333333333";
const bearer = async (): Promise<string> => `Bearer ${await signAccessToken(SECRET, UID, 900)}`;

/** fakeDbِ کپچرکننده — متنِ هر کوئری را ثبت می‌کند و ردیفِ خالی می‌دهد. */
function capturingDb(): { pool: pg.Pool; sql: string[] } {
  const sql: string[] = [];
  const pool = {
    query: (text: string) => {
      sql.push(text);
      return Promise.resolve({ rows: [] });
    },
    end: (): Promise<void> => Promise.resolve(),
  } as unknown as pg.Pool;
  return { pool, sql };
}

describe("GET /boards — فیلترِ سطلِ بازیافت (wiring)", () => {
  it("بدونِ توکن → ۴۰۱ (guard پیش از هر کوئری)", async () => {
    const { pool } = capturingDb();
    const app = await buildApp({ config: TEST_CONFIG, db: pool });
    const res = await app.inject({ method: "GET", url: "/boards" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("پیش‌فرض فقط بوردهای زنده را می‌خواهد (deleted_at IS NULL، گیتِ دسترسیِ کامل)", async () => {
    const { pool, sql } = capturingDb();
    const app = await buildApp({ config: TEST_CONFIG, db: pool });
    const res = await app.inject({
      method: "GET",
      url: "/boards",
      headers: { authorization: await bearer() },
    });
    expect(res.statusCode).toBe(200);
    const listSql = sql.find((s) => s.includes("FROM boards b"));
    expect(listSql).toBeDefined();
    expect(listSql!).toContain("b.deleted_at IS NULL");
    expect(listSql!).not.toContain("b.deleted_at IS NOT NULL");
    // گیتِ عضویتِ تیمِ team-access فقط در مسیرِ زنده هست.
    expect(listSql!).toContain("b.access_mode = 'team'");
    await app.close();
  });

  it("★ trashed=true بوردهای حذف‌شده‌ی مالک را می‌خواهد (deleted_at IS NOT NULL + گیتِ owner)", async () => {
    const { pool, sql } = capturingDb();
    const app = await buildApp({ config: TEST_CONFIG, db: pool });
    const res = await app.inject({
      method: "GET",
      url: "/boards?trashed=true",
      headers: { authorization: await bearer() },
    });
    expect(res.statusCode).toBe(200);
    const listSql = sql.find((s) => s.includes("FROM boards b"));
    expect(listSql).toBeDefined();
    expect(listSql!).toContain("b.deleted_at IS NOT NULL");
    expect(listSql!).toContain("bm.role = 'owner'");
    // در سطل، مسیرِ عضویتِ تیم گیت نمی‌کند (فقط مالک بازیابی می‌کند).
    expect(listSql!).not.toContain("b.access_mode = 'team'");
    await app.close();
  });
});
