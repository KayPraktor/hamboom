import { describe, expect, it } from "vitest";

import { touchLastSeen } from "./auth.ts";

/**
 * ★ M6 ۷٫۱ — «آخرین‌بار دیده‌شده». بخشِ **خالص**: شکلِ SQL و گلویِ ۱۵ دقیقه.
 *
 * رفتارِ همزمانیِ واقعی (بن‌بستِ `40P01` وقتی همین UPDATE **داخلِ** تراکنشِ `FOR SHARE` برود)
 * روی PGِ زنده اندازه گرفته شد و این‌جا قابلِ بازتولید نیست — آن‌جا جایش probe است، نه تستِ واحد.
 */
const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

interface Seen {
  text: string;
  params: unknown[];
}

function fakeDb(
  rowCount: number | null,
  seen: Seen[],
): { query: (t: string, p: unknown[]) => Promise<{ rows: never[]; rowCount: number | null }> } {
  return {
    query: (text: string, params: unknown[]) => {
      seen.push({ text, params });
      return Promise.resolve({ rows: [] as never[], rowCount });
    },
  };
}

describe("touchLastSeen — SQL خالص (M6 ۷٫۱)", () => {
  it("یک UPDATE با گلویِ ۱۵ دقیقه در خودِ WHERE — نه در کد", async () => {
    const seen: Seen[] = [];
    await touchLastSeen(fakeDb(1, seen) as never, ID);

    expect(seen).toHaveLength(1);
    const q = seen[0]!;
    expect(q.text).toContain("UPDATE users SET last_seen_at = now()");
    // ★ اگر این شرط برداشته شود، هر refresh یک نوشتن است — تست باید همان‌جا قرمز شود.
    expect(q.text).toContain("last_seen_at IS NULL OR last_seen_at < now() - $2::interval");
    expect(q.params).toEqual([ID, "15 minutes"]);
  });

  it("کاربرِ حذف‌شده را هم کنار می‌گذارد (deleted_at IS NULL)", async () => {
    const seen: Seen[] = [];
    await touchLastSeen(fakeDb(0, seen) as never, ID);
    expect(seen[0]!.text).toContain("deleted_at IS NULL");
  });

  it("۱ یعنی نوشت، ۰ یعنی گلو گرفتش، و rowCountِ null هم ۰ است", async () => {
    expect(await touchLastSeen(fakeDb(1, []) as never, ID)).toBe(1);
    expect(await touchLastSeen(fakeDb(0, []) as never, ID)).toBe(0);
    expect(await touchLastSeen(fakeDb(null, []) as never, ID)).toBe(0);
  });
});
