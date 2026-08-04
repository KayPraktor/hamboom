/**
 * تستِ دودِ دیتابیس — تاییدِ عملیِ معیارِ پذیرشِ گام ۰٫۳.
 *
 * ── چرا اسکریپت است و نه یک تستِ vitest ────────────────────────────────
 *
 * این بررسی به یک PostgreSQLِ **زنده** نیاز دارد. اگر به‌صورت تستِ عادی نوشته
 * می‌شد، دو انتخابِ بد داشتیم: یا `pnpm test` روی هر ماشینی که داکر بالا ندارد
 * قرمز می‌شد، یا تست خودش را «skip» می‌کرد — که بدتر است، چون یک سبزِ دروغین
 * می‌سازد و کسی متوجه نمی‌شود که هرگز اجرا نشده.
 *
 * پس یک گامِ **عمدی** است: `pnpm db:smoke` (بعد از `pnpm db:up && pnpm db:migrate`).
 *
 * چه چیزی را ثابت می‌کند:
 *   ۱. migration واقعاً اعمال شده و جدول‌ها با ستون‌های درست وجود دارند.
 *   ۲. ★ `bytea` رفت‌وبرگشتِ **بایت‌به‌بایت** دارد — updateهای Yjs باینری‌اند و اگر
 *      جایی به رشته تبدیل شوند، سند خاموش خراب می‌شود.
 *   ۳. ★ ایندکسِ یکتای `(board_id, seq)` واقعاً دو نوشتنِ همزمان را رد می‌کند —
 *      همان چیزی که در گام ۴٫۷ نگهبانِ قفلِ صاحب است.
 */
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      fail(
        "اتصال به PostgreSQL برقرار نشد.\n" +
          "  pnpm db:up      # بالا آوردنِ postgres و redis\n" +
          "  pnpm db:migrate # اعمالِ migrationها",
      );
    }
    throw error;
  }

  const boardId = randomUUID();
  // بایت‌هایی که اگر جایی به رشته تبدیل شوند خراب می‌شوند: صفر، بالای 0x7F، و
  // دنباله‌ی UTF-8ِ نامعتبر.
  const payload = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f, 0x00]);

  try {
    await client.query("BEGIN");

    await client.query(
      "INSERT INTO board_updates (board_id, seq, payload, byte_size) VALUES ($1, $2, $3, $4)",
      [boardId, 1, payload, payload.byteLength],
    );

    const { rows } = await client.query<{ payload: Buffer; byte_size: number }>(
      "SELECT payload, byte_size FROM board_updates WHERE board_id = $1 AND seq = $2",
      [boardId, 1],
    );

    if (rows.length !== 1) fail(`انتظار یک ردیف بود، ${rows.length} ردیف برگشت.`);
    const row = rows[0]!;

    if (!Buffer.isBuffer(row.payload)) {
      fail(`payload به‌صورت Buffer برنگشت (نوعش: ${typeof row.payload}).`);
    }
    if (!row.payload.equals(payload)) {
      fail(
        `payload بایت‌به‌بایت برنگشت.\n  فرستادیم: ${payload.toString("hex")}\n  گرفتیم:   ${row.payload.toString("hex")}`,
      );
    }
    if (row.byte_size !== payload.byteLength) {
      fail(`byte_size اشتباه است: ${row.byte_size} به‌جای ${payload.byteLength}.`);
    }
    console.log(`✔ رفت‌وبرگشتِ bytea سالم است (${payload.byteLength} بایت، بیت‌به‌بیت برابر).`);

    // ── ایندکسِ یکتا: seqِ تکراری در همان بورد باید رد شود ─────────────
    let rejected = false;
    try {
      await client.query("SAVEPOINT dup");
      await client.query(
        "INSERT INTO board_updates (board_id, seq, payload, byte_size) VALUES ($1, $2, $3, $4)",
        [boardId, 1, payload, payload.byteLength],
      );
      await client.query("RELEASE SAVEPOINT dup");
    } catch {
      rejected = true;
      await client.query("ROLLBACK TO SAVEPOINT dup");
    }
    if (!rejected) fail("ایندکسِ یکتای (board_id, seq) ردیفِ تکراری را رد نکرد.");
    console.log("✔ ایندکسِ یکتای (board_id, seq) seqِ تکراری را رد می‌کند.");

    // ── جدولِ snapshot ────────────────────────────────────────────────
    await client.query(
      "INSERT INTO board_snapshots (id, board_id, seq_upto, storage_key, state_vector, byte_size) " +
        "VALUES ($1, $2, $3, $4, $5, $6)",
      [randomUUID(), boardId, 1, `dev/${boardId}.bin`, payload, payload.byteLength],
    );
    console.log("✔ board_snapshots می‌پذیرد.");
  } finally {
    // چیزی از تستِ دود در دیتابیس نمی‌ماند.
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log("\n✔ تستِ دودِ دیتابیس سبز است.");
}

await main();
