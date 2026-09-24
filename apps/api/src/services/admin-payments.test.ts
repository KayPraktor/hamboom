import { describe, expect, it } from "vitest";

import {
  buildPaymentQuery,
  decodePaymentCursor,
  encodePaymentCursor,
  expireBlockedReason,
  InvalidPaymentCursorError,
  listPayments,
  readPaymentDetail,
} from "./admin-payments.ts";

/**
 * پرداخت‌ها در پنل — M6 فاز ۶٫۱. بخش‌های **خالص**: شکلِ SQL، cursor، و نردبانِ انقضای دستی. رفتارِ واقعی روی PG
 * در `sdk:contract` و سنجه‌های billing.
 */
const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("buildPaymentQuery — SQL خالص", () => {
  it("بدونِ فیلتر: فقط ORDER BY keyset و LIMIT limit+1", () => {
    const q = buildPaymentQuery({ limit: 20 });
    expect(q.text).not.toContain("WHERE");
    expect(q.text).toContain("ORDER BY p.requested_at DESC, p.id DESC LIMIT $1");
    expect(q.params).toEqual([21]);
  });
  it("تیم/ref_id تساویِ دقیق؛ authority پیشوندی با فرارِ %/_؛ status تساوی", () => {
    const q = buildPaymentQuery({
      limit: 5,
      teamId: ID,
      refId: "476569601",
      authority: "A0000%_",
      status: "paid",
    });
    expect(q.text).toContain("p.team_id = $1");
    expect(q.text).toContain("p.ref_id = $2");
    expect(q.text).toContain("p.authority LIKE $3");
    expect(q.text).toContain("p.status = $4");
    expect(q.params).toEqual([ID, "476569601", "A0000\\%\\_%", "paid", 6]);
  });
  it("cursor: متنِ میکروثانیه‌ایِ PG (نه Date) و تاپلِ (requested_at, id) < ($n::timestamptz, $n+1::uuid)؛ خراب ⇒ خطا", () => {
    const at = "2026-09-18 10:00:00.123456+00";
    const cursor = encodePaymentCursor(at, ID);
    expect(decodePaymentCursor(cursor)).toEqual({ requestedAt: at, id: ID });
    const q = buildPaymentQuery({ limit: 2, cursor });
    expect(q.text).toContain("(p.requested_at, p.id) < ($1::timestamptz, $2::uuid)");
    expect(q.params).toEqual([at, ID, 3]);
    expect(() => buildPaymentQuery({ limit: 2, cursor: "not-a-cursor" })).toThrow(
      InvalidPaymentCursorError,
    );
    expect(decodePaymentCursor(Buffer.from("2026-09-18T10:00:00Z|nope").toString("base64url"))).toBeNull();
    expect(decodePaymentCursor(Buffer.from(`garbage|${ID}`).toString("base64url"))).toBeNull();
  });
});

describe("listPayments / readPaymentDetail روی dbِ دروغین", () => {
  const row = (i: number) => ({
    id: `${ID.slice(0, -1)}${String(i)}`,
    requested_at: new Date(1_000 * i),
    requested_at_cursor: `1970-01-01 00:00:0${String(i)}.000001+00`,
  });
  it("limit+1 خوانده می‌شود؛ صفحه limit تاست و nextCursor از متنِ PGِ آخرین ردیفِ صفحه", async () => {
    const db = { query: () => Promise.resolve({ rows: [row(3), row(2), row(1)] }) };
    const page = await listPayments(db as never, { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBe(encodePaymentCursor("1970-01-01 00:00:02.000001+00", row(2).id));
  });
  it("کمتر از limit ⇒ nextCursor null", async () => {
    const db = { query: () => Promise.resolve({ rows: [row(1)] }) };
    expect((await listPayments(db as never, { limit: 2 })).nextCursor).toBeNull();
  });
  it("جزئیات: ناموجود ⇒ null با یک کوئری؛ موجود ⇒ فاکتور و اشتراکِ activated_by_payment_id", async () => {
    let calls = 0;
    const missing = {
      query: () => {
        calls += 1;
        return Promise.resolve({ rows: [] });
      },
    };
    expect(await readPaymentDetail(missing as never, ID)).toBeNull();
    expect(calls).toBe(1);

    const seen: string[] = [];
    const db = {
      query: (text: string) => {
        seen.push(text);
        if (text.includes("FROM payments p")) return Promise.resolve({ rows: [{ id: ID, invoice_id: "inv" }] });
        if (text.includes("FROM invoices")) return Promise.resolve({ rows: [{ number: "HB-1" }] });
        return Promise.resolve({ rows: [] });
      },
    };
    const d = await readPaymentDetail(db as never, ID);
    expect(d?.invoice).toEqual({ number: "HB-1" });
    expect(d?.subscription).toBeNull();
    expect(seen.some((t) => t.includes("activated_by_payment_id = $1"))).toBe(true);
  });
});

describe("expireBlockedReason — فقط پله‌ی ۳ی ADR-056 (سقفِ ۷۲h **و** پرسیده)، هرگز یتیم", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const old = new Date("2026-09-10T12:00:00Z");
  const policy = { expireAfterMs: 72 * 3_600_000 };
  it("غیرِ pending ⇒ دلیل", () => {
    expect(
      expireBlockedReason({ status: "paid", authority: "A", failure_code: "-51", requested_at: old }, policy, now),
    ).toContain("paid");
  });
  it("یتیم (بدونِ authority) ⇒ هرگز، حتی کهنه و پرسیده", () => {
    expect(
      expireBlockedReason({ status: "pending", authority: null, failure_code: "-51", requested_at: old }, policy, now),
    ).toContain("یتیم");
  });
  it("★ بدونِ حتی یک پاسخِ درگاه ⇒ هرگز (قاعده‌ی مرکزیِ ADR-056)", () => {
    expect(
      expireBlockedReason({ status: "pending", authority: "A", failure_code: null, requested_at: old }, policy, now),
    ).toContain("ADR-056");
  });
  it("★ جوان‌تر از سقفِ ۷۲ ساعت ⇒ دلیل با ساعت‌های باقی‌مانده (یافته‌ی منتقد: ۲۰ دقیقه کافی نبود)", () => {
    const r = expireBlockedReason(
      { status: "pending", authority: "A", failure_code: "-51", requested_at: new Date(now.getTime() - 21 * 60_000) },
      policy,
      now,
    );
    expect(r).toContain("72 ساعت");
    const r2 = expireBlockedReason(
      { status: "pending", authority: "A", failure_code: "-51", requested_at: new Date(now.getTime() - 70 * 3_600_000) },
      policy,
      now,
    );
    expect(r2).toContain("2 ساعت");
  });
  it("pending + authority + پرسیده + کهنه ⇒ null (مجاز)", () => {
    expect(
      expireBlockedReason({ status: "pending", authority: "A", failure_code: "-51", requested_at: old }, policy, now),
    ).toBeNull();
  });
});
