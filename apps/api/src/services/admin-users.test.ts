import { describe, expect, it } from "vitest";

import {
  buildTeamSearch,
  buildUserSearch,
  classifyQuery,
  latinDigits,
  listUserBoards,
  readUserDetail,
  searchTeams,
} from "./admin-users.ts";

/**
 * جست‌وجو و جزئیات — M6 فاز ۵٫۱. بخش‌های **خالص**: تشخیصِ نوعِ جست‌وجو، شکلِ SQL، و شمارش‌ها روی dbِ
 * دروغین. رفتارِ واقعی روی PG در `sdk:contract`.
 */
describe("classifyQuery — شکلِ ورودی → نوعِ جست‌وجو", () => {
  it("ارقامِ فارسی/عربی نرمال می‌شوند و شماره‌ی **کامل** تطبیقِ دقیق است", () => {
    expect(latinDigits("۰۹۱۲٣٤")).toBe("091234");
    expect(classifyQuery(" ۰۹۱۲۱۰۰۰۰۰۲ ")).toEqual({ kind: "phone", phone: "09121000002" });
    expect(classifyQuery("09121000002")).toEqual({ kind: "phone", phone: "09121000002" });
  });
  it("★ پیشوندِ ناقص (۴–۱۰ رقم) شماره نیست ⇒ متن (بازسازیِ رقم‌به‌رقمِ ماسک بسته است)", () => {
    expect(classifyQuery("0912")).toEqual({ kind: "text", text: "0912" });
    expect(classifyQuery("0912100000")).toEqual({ kind: "text", text: "0912100000" });
    expect(classifyQuery("09")).toEqual({ kind: "text", text: "09" });
    expect(classifyQuery("091210000021")).toEqual({ kind: "text", text: "091210000021" });
  });
  it("UUID شناسه است (حروفِ کوچک)", () => {
    expect(classifyQuery("7C9E6679-7425-40DE-944B-E07FC1F90AE7")).toEqual({
      kind: "id",
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    });
  });
  it("متن، و ورودیِ خالی null", () => {
    expect(classifyQuery("علی")).toEqual({ kind: "text", text: "علی" });
    expect(classifyQuery("   ")).toBeNull();
  });
});

describe("buildUserSearch / buildTeamSearch — SQL خالص", () => {
  it("شماره: تساویِ دقیق (نه LIKE)؛ تیم برای شماره null", () => {
    const q = buildUserSearch({ kind: "phone", phone: "09121000002" }, 20);
    expect(q.text).toContain("u.phone = $1");
    expect(q.text).not.toContain("LIKE");
    expect(q.params).toEqual(["09121000002", 20]);
    expect(buildTeamSearch({ kind: "phone", phone: "09121000002" }, 20)).toBeNull();
  });
  it("متن: ILIKE با فرارِ %/_ و ترتیبِ شباهت (trgm)؛ تیم slug را هم پیشوندی می‌گیرد", () => {
    const u = buildUserSearch({ kind: "text", text: "50%_x" }, 5);
    expect(u.params[0]).toBe("%50\\%\\_x%");
    expect(u.text).toContain("similarity(u.display_name, $2)");
    const t = buildTeamSearch({ kind: "text", text: "Acme" }, 5)!;
    expect(t.params).toEqual(["%Acme%", "acme%", "Acme", 5]);
    expect(t.text).toContain("lower(t.slug) LIKE $2");
  });
  it("شناسه: تساویِ مستقیم؛ هر دو `deleted_at IS NULL` دارند", () => {
    const u = buildUserSearch({ kind: "id", id: "abc" }, 1);
    expect(u.text).toContain("u.id = $1");
    expect(u.text).toContain("u.deleted_at IS NULL");
    expect(buildTeamSearch({ kind: "id", id: "abc" }, 1)!.text).toContain("t.deleted_at IS NULL");
  });
});

describe("readUserDetail / listUserBoards روی dbِ دروغین", () => {
  it("کاربرِ ناموجود ⇒ null بدونِ کوئری‌های بعدی", async () => {
    let calls = 0;
    const db = {
      query: () => {
        calls += 1;
        return Promise.resolve({ rows: [] });
      },
    };
    expect(await readUserDetail(db as never, "u1")).toBeNull();
    expect(calls).toBe(1);
  });
  it("شمارش‌ها به number تبدیل می‌شوند (count(*) ممکن است رشته بیاید — B-2)", async () => {
    const user = { id: "u1", display_name: "x", phone: null, status: "active", is_staff: false };
    const db = {
      query: (text: string) => {
        if (text.includes("FROM users u")) return Promise.resolve({ rows: [user] });
        if (text.includes("FROM team_members tm")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM boards")) return Promise.resolve({ rows: [{ n: "3" }] });
        return Promise.resolve({ rows: [{ n: 2 }] });
      },
    };
    const d = await readUserDetail(db as never, "u1");
    expect(d?.boardCount).toBe(3);
    expect(d?.activeSessions).toBe(2);
  });
  it("searchTeams با پیشوندِ شماره هیچ کوئری نمی‌زند", async () => {
    let calls = 0;
    const db = {
      query: () => {
        calls += 1;
        return Promise.resolve({ rows: [] });
      },
    };
    expect(await searchTeams(db as never, { kind: "phone", phone: "09121000002" }, 5)).toEqual([]);
    expect(calls).toBe(0);
  });
  it("listUserBoards: سه منبع در WHERE، لینک نه، حذف‌شده‌ها هم می‌آیند", async () => {
    let seen = "";
    const db = {
      query: (text: string) => {
        seen = text;
        return Promise.resolve({ rows: [] });
      },
    };
    await listUserBoards(db as never, "u1");
    expect(seen).toContain("b.created_by = $1");
    expect(seen).toContain("bm.user_id IS NOT NULL");
    expect(seen).toContain("b.access_mode = 'team' AND tm.user_id IS NOT NULL");
    expect(seen).not.toContain("board_link_grants");
    expect(seen).not.toContain("b.deleted_at IS NULL");
  });
});
