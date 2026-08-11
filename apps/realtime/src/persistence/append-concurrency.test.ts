import type pg from "pg";
import { describe, expect, it } from "vitest";

import { createLogger } from "../log.ts";
import { createPostgresUpdateLog } from "./postgres-update-log.ts";

/**
 * ★★ نگهبانِ باگی که سنجه‌ی ۵۰۰ updateِ گام ۴٫۴ پیدا کرد.
 *
 * **۴۳ تا از ۵۰۰** append گم می‌شدند. علتش `READ COMMITTED` است: دو تراکنشِ
 * همزمان ردیفِ commitنشده‌ی هم را **نمی‌بینند**، پس هر دو یک `seq` می‌گیرند؛
 * یکی می‌نشیند و آن یکی به ایندکسِ یکتا می‌خورد. پنج تلاش تمام می‌شود و
 * update **از بین می‌رود** — بی‌صدا، چون کلاینت فقط `unsaved` می‌بیند.
 *
 * ⚠️ **تستِ گام ۴٫۳ هیچ‌وقت این را نمی‌دید: آنجا یک update بود.** همزمانی فقط
 * زیرِ بار دیده می‌شود.
 *
 * ── چرا استخرِ ساختگی، و نه Postgresِ واقعی ────────────────────────────
 *
 * ادعای این تست درباره‌ی **سریالی‌بودنِ تخصیص** است، نه درباره‌ی Postgres. پس
 * استخرِ ساختگی دقیقاً همان چیزی را بازمی‌سازد که باگ را می‌ساخت — «`MAX` را در
 * لحظه‌ی شروع بخوان، بعد از یک وقفه بنویس» — و اگر صف برداشته شود **قرمز
 * می‌شود**. ادعای دوامِ واقعی جای دیگری است
 * ([`scripts/rt-compaction.ts`](../../../../scripts/rt-compaction.ts)).
 */

const UNIQUE_VIOLATION = "23505";

/** استخری که رفتارِ `READ COMMITTED` را بازی می‌کند. */
function racyPool(): pg.Pool {
  const committed = new Map<string, Set<number>>();

  return {
    async query(text: string, params: unknown[]) {
      const boardId = params[0] as string;
      const rows = committed.get(boardId) ?? new Set<number>();
      committed.set(boardId, rows);

      if (!text.includes("INSERT INTO board_updates")) {
        throw new Error(`این استخرِ ساختگی فقط INSERT را می‌فهمد: ${text.slice(0, 40)}`);
      }

      // ★ `MAX` **قبل** از وقفه خوانده می‌شود: همان پنجره‌ای که دو تراکنشِ
      //   همزمان در آن یک عدد می‌گیرند.
      const seq = Math.max(0, ...rows) + 1;
      await new Promise((tick) => setTimeout(tick, 1));

      if (rows.has(seq)) {
        const error = new Error("duplicate key value violates unique constraint") as Error & {
          code: string;
        };
        error.code = UNIQUE_VIOLATION;
        throw error;
      }
      rows.add(seq);
      return { rows: [{ seq: String(seq), created_at: new Date(0) }], rowCount: 1 };
    },
  } as unknown as pg.Pool;
}

describe("★★ تخصیصِ seq زیرِ بار", () => {
  it("۲۰۰ appendِ همزمان روی یک بورد **هیچ‌کدام** گم نمی‌شوند", async () => {
    const log = createPostgresUpdateLog({
      pool: racyPool(),
      logger: createLogger({ level: "fatal" }),
    });

    const results = await Promise.all(
      Array.from({ length: 200 }, () => log.append("brd_hot", new Uint8Array([1]), null)),
    );

    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(200);
    expect(seqs[0]).toBe(1);
    expect(seqs.at(-1)).toBe(200);
  });

  it("★ و بوردهای مختلف همچنان **موازی** می‌مانند — صف به‌ازای بورد است", async () => {
    const log = createPostgresUpdateLog({
      pool: racyPool(),
      logger: createLogger({ level: "fatal" }),
    });

    // ⚠️ اگر صف سراسری بود، این ۱۰۰ نوشتن روی ۱۰۰ بوردِ **جدا** هم پشتِ سر هم
    //    می‌رفتند و کلِ سرور را به سرعتِ یک بورد محدود می‌کرد.
    const started = Date.now();
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        log.append(`brd_${String(i)}`, new Uint8Array([1]), null),
      ),
    );

    // هر نوشتن ۱ms وقفه دارد؛ سریالی یعنی ≥۱۰۰ms.
    expect(Date.now() - started).toBeLessThan(80);
  });

  it("ترتیبِ `seq` همان ترتیبِ صداکردن است", async () => {
    const log = createPostgresUpdateLog({
      pool: racyPool(),
      logger: createLogger({ level: "fatal" }),
    });

    // ★ این فقط زیبایی نیست: `since` با `ORDER BY seq` می‌خواند، پس ترتیبِ
    //   `seq` همان ترتیبی است که بارگذاری updateها را اعمال می‌کند.
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        log.append("brd_order", new Uint8Array([i]), null).then((r) => {
          order.push(r.seq);
        }),
      ),
    );

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("شکستِ یک نوشتن، صفِ همان بورد را نمی‌خواباند", async () => {
    let calls = 0;
    const pool = {
      query: () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("دیتابیس رفت"));
        return Promise.resolve({
          rows: [{ seq: String(calls), created_at: new Date(0) }],
          rowCount: 1,
        });
      },
    } as unknown as pg.Pool;
    const log = createPostgresUpdateLog({ pool, logger: createLogger({ level: "fatal" }) });

    // ⚠️ اگر صف با `then(task)`ِ تنها ساخته شود، اولین شکست همه‌ی نوبت‌های بعدی
    //    را برای همیشه معلق می‌گذارد — یک بورد که دیگر هیچ‌وقت ذخیره نمی‌شود.
    const first = log.append("brd_f", new Uint8Array([1]), null);
    const second = log.append("brd_f", new Uint8Array([2]), null);

    await expect(first).rejects.toThrow("دیتابیس رفت");
    await expect(second).resolves.toMatchObject({ seq: 2 });
  });
});
