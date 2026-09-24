import { describe, expect, it } from "vitest";

import {
  buildAuditQuery,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  listAuditLogs,
  maskIp,
} from "./audit-log.ts";

/**
 * خواندنِ audit — M6 فاز ۴٫۳. بخش‌های **خالص**: cursor، ماسکِ IP، شکلِ SQL، و منطقِ `limit+1`
 * روی یک dbِ دروغین. رفتارِ واقعیِ keyset روی PG در `sdk:contract` (با ردیف‌های واقعیِ step-up).
 */
describe("cursor — keysetِ (created_at, id)", () => {
  it("رفت‌وبرگشت — متنِ میکروثانیه‌ایِ PG، نه Date (ردیفِ هم‌میلی‌ثانیه بینِ دو صفحه گم نشود)", () => {
    const at = "2026-09-17 10:00:00.123456+00";
    const c = encodeCursor(at, 42);
    expect(decodeCursor(c)).toEqual({ createdAt: at, id: 42 });
  });
  it("★ cursorِ خراب ⇒ null (نه «از اول شروع کن» — آن صفحه‌ی تکراری می‌دهد)", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor(Buffer.from("no-separator").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("garbage|12").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("2026-01-01T00:00:00Z|-1").toString("base64url"))).toBeNull();
  });
});

describe("maskIp — ADR-067 §۳", () => {
  it("v4 دو اکتتِ آخر، v6 همه جز دو گروهِ اول، بقیه null", () => {
    expect(maskIp("203.0.113.77")).toBe("203.0.x.x");
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8::…");
    expect(maskIp("weird")).toBeNull();
    expect(maskIp(null)).toBeNull();
  });
});

describe("buildAuditQuery — SQL خالص", () => {
  it("بدونِ فیلتر: فقط ORDER + LIMIT limit+1", () => {
    const q = buildAuditQuery({ limit: 50 });
    expect(q.text).not.toContain("WHERE");
    expect(q.text).toContain("ORDER BY created_at DESC, id DESC LIMIT $1");
    expect(q.params).toEqual([51]);
  });
  it("همه‌ی فیلترها AND می‌شوند، action پیشوندی با escapeِ LIKE، cursor به شرطِ keyset", () => {
    const cursor = encodeCursor("2026-09-17 00:00:00.000001+00", 7);
    const q = buildAuditQuery({
      actorUserId: "u1",
      action: "user_.%",
      targetType: "user",
      targetId: "t1",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-12-31T00:00:00.000Z",
      limit: 10,
      cursor,
    });
    expect(q.text).toContain("actor_user_id = $1");
    expect(q.text).toContain("action LIKE $2");
    expect(q.params[1]).toBe("user\\_.\\%%");
    expect(q.text).toContain("target_type = $3 AND target_id = $4");
    expect(q.text).toContain("created_at >= $5 AND created_at <= $6");
    expect(q.text).toContain("(created_at, id) < ($7::timestamptz, $8)");
    expect(q.params.slice(6)).toEqual(["2026-09-17 00:00:00.000001+00", 7, 11]);
  });
  it("cursorِ خراب ⇒ InvalidCursorError (مصرف‌کننده ۴۰۰ می‌دهد)", () => {
    expect(() => buildAuditQuery({ limit: 5, cursor: "zzz" })).toThrow(InvalidCursorError);
  });
});

describe("listAuditLogs — limit+1 ⇒ nextCursor", () => {
  const row = (id: number) => ({
    id,
    actor_user_id: null,
    team_id: null,
    action: "staff.grant",
    target_type: null,
    target_id: null,
    ip: null,
    user_agent: null,
    metadata: {},
    created_at: new Date(1_700_000_000_000 + id),
    created_at_cursor: `2023-11-14 22:13:20.00000${String(id)}+00`,
  });
  const dbWith = (rows: unknown[]) => ({ query: () => Promise.resolve({ rows }) });

  it("ردیفِ اضافه هست ⇒ صفحه بریده می‌شود و cursor از **آخرین ردیفِ صفحه** است", async () => {
    const page = await listAuditLogs(dbWith([row(3), row(2), row(1)]) as never, { limit: 2 });
    expect(page.rows.map((r) => r.id)).toEqual([3, 2]);
    expect(decodeCursor(page.nextCursor!)).toEqual({ createdAt: row(2).created_at_cursor, id: 2 });
  });
  it("ردیفِ اضافه نیست ⇒ nextCursor null (پایان)", async () => {
    const page = await listAuditLogs(dbWith([row(2), row(1)]) as never, { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });
});
