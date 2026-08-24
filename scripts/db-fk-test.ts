/**
 * تستِ واقعیِ رفتارِ FK و اتمیک‌بودنِ تراکنش روی PostgreSQLِ زنده — گام ۵٫۱ M3.
 *
 * ── چرا این تست، و چرا اسکریپت (نه vitest) ─────────────────────────────
 *
 * `\d board_updates` فقط نشان می‌دهد constraint **وجود دارد**؛ ثابت نمی‌کند
 * CASCADE واقعاً **شلیک می‌کند**. مالک درست خواست: «آزمونِ واقعی، نه ادعا».
 * پس اینجا رفتار را روی دیتابیسِ زنده می‌سنجیم:
 *
 *   ۱. **CASCADE** — حذفِ یک بورد، ردیف‌های `board_updates`/`board_snapshots`اش را
 *      واقعاً پاک می‌کند (نه اینکه فقط constraint تعریف شده باشد).
 *   ۲. **SET NULL** — حذفِ کاربرِ نویسنده‌ی یک update، `origin_user_id` را NULL می‌کند
 *      و خودِ update را نگه می‌دارد (داده گم نمی‌شود، فقط «که نوشت»).
 *   ۳. **اتمیک‌بودن** — یک واحدِ چندجمله‌ای (بورد + ردیفِ ناسالم) که وسط بشکند،
 *      **کامل** rollback می‌شود؛ بوردِ بی‌مالک/ناقص نمی‌مانَد. مکانیزمی که ساختِ بورد
 *      (فاز ۵٫۴) رویش سوار می‌شود — اینجا روی schemaی واقعی اثباتش می‌کنیم.
 *
 * مثلِ `db:smoke` به Postgresِ زنده نیاز دارد و skip نمی‌شود (سبزِ دروغین). هر چک
 * در تراکنشِ خودش با ROLLBACK اجرا می‌شود، پس چیزی در دیتابیس نمی‌مانَد و تکرارپذیر است.
 *
 * اجرا: `pnpm db:fk-test` (بعد از `pnpm db:up && pnpm db:migrate`).
 *
 * ★ خودِ تست خودآزمون است: روی دیتابیسی که FK را **ندارد** (مثلاً board_updatesِ
 *   M2 پیش از `0002`)، چک‌های ۱ و ۲ **قرمز** می‌شوند — پس تست واقعاً رفتار را می‌سنجد،
 *   نه صرفِ وجودِ ردیف.
 */
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const BYTES = Buffer.from([0x00, 0x01, 0xff, 0x7f]);

/** یک کاربرِ کمینه با فیلدهای NOT NULL. برمی‌گرداند id. */
async function insertUser(c: pg.Client): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, $2, $3)", [
    id,
    "تستِ FK",
    "#3366cc",
  ]);
  return id;
}

async function insertTeam(c: pg.Client, owner: string): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, $3, $4)", [
    id,
    `t-${id.slice(0, 8)}`,
    "تیمِ تست",
    owner,
  ]);
  return id;
}

async function insertBoard(c: pg.Client, team: string, creator: string): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO boards (id, team_id, created_by) VALUES ($1, $2, $3)", [
    id,
    team,
    creator,
  ]);
  return id;
}

async function count(c: pg.Client, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await c.query<{ n: string }>(sql, params);
  return Number(rows[0]!.n);
}

/** چکِ ۱ — CASCADE: حذفِ بورد ردیف‌های update/snapshot را می‌بَرد. */
async function checkCascade(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);
    const board = await insertBoard(c, team, user);
    await c.query(
      "INSERT INTO board_updates (board_id, seq, payload, byte_size) VALUES ($1, 1, $2, $3)",
      [board, BYTES, BYTES.byteLength],
    );
    await c.query(
      "INSERT INTO board_snapshots (id, board_id, seq_upto, storage_key, state_vector, byte_size) " +
        "VALUES ($1, $2, 1, $3, $4, $5)",
      [randomUUID(), board, `k/${board}`, BYTES, BYTES.byteLength],
    );

    const before =
      (await count(c, "SELECT count(*) n FROM board_updates WHERE board_id = $1", [board])) +
      (await count(c, "SELECT count(*) n FROM board_snapshots WHERE board_id = $1", [board]));

    await c.query("DELETE FROM boards WHERE id = $1", [board]);

    const updatesLeft = await count(c, "SELECT count(*) n FROM board_updates WHERE board_id = $1", [
      board,
    ]);
    const snapsLeft = await count(c, "SELECT count(*) n FROM board_snapshots WHERE board_id = $1", [
      board,
    ]);

    const ok = before === 2 && updatesLeft === 0 && snapsLeft === 0;
    return {
      name: "CASCADE — حذفِ بورد، update/snapshot را می‌بَرد",
      ok,
      detail: ok
        ? "۲ ردیف قبل، ۰ بعد از حذفِ بورد"
        : `انتظار: ۲→۰. واقعی: قبل=${before}، updatesLeft=${updatesLeft}، snapsLeft=${snapsLeft} (FK غایب؟)`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** چکِ ۲ — SET NULL: حذفِ نویسنده، origin را NULL می‌کند، update می‌مانَد. */
async function checkSetNull(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const creator = await insertUser(c);
    const author = await insertUser(c); // نویسنده‌ی update، جدا از سازنده‌ی بورد
    const team = await insertTeam(c, creator);
    const board = await insertBoard(c, team, creator);
    await c.query(
      "INSERT INTO board_updates (board_id, seq, payload, byte_size, origin_user_id) " +
        "VALUES ($1, 1, $2, $3, $4)",
      [board, BYTES, BYTES.byteLength, author],
    );

    await c.query("DELETE FROM users WHERE id = $1", [author]);

    const { rows } = await c.query<{ origin_user_id: string | null }>(
      "SELECT origin_user_id FROM board_updates WHERE board_id = $1 AND seq = 1",
      [board],
    );
    const survived = rows.length === 1;
    const nulled = survived && rows[0]!.origin_user_id === null;

    const ok = survived && nulled;
    return {
      name: "SET NULL — حذفِ نویسنده، origin_user_id را NULL می‌کند",
      ok,
      detail: ok
        ? "update ماند، origin_user_id = NULL"
        : `انتظار: بماند + NULL. واقعی: survived=${survived}، origin=${survived ? String(rows[0]!.origin_user_id) : "—"} (FK غایب؟)`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** چکِ ۳ — اتمیک‌بودن: واحدی که وسط بشکند کامل rollback می‌شود (بوردِ ناقص نمی‌مانَد). */
async function checkAtomicity(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);
    const board = randomUUID();

    // واحدِ «ساختِ بورد»: بورد + یک ردیفِ عضو با نقشِ **نامعتبر** (CHECK می‌شکند).
    let broke = false;
    await c.query("SAVEPOINT unit");
    try {
      await c.query("INSERT INTO boards (id, team_id, created_by) VALUES ($1, $2, $3)", [
        board,
        team,
        user,
      ]);
      await c.query("INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)", [
        board,
        user,
        "NOT_A_ROLE", // نقضِ CHECK — کلِ واحد باید برگردد
      ]);
      await c.query("RELEASE SAVEPOINT unit");
    } catch {
      broke = true;
      await c.query("ROLLBACK TO SAVEPOINT unit");
    }

    const boardsLeft = await count(c, "SELECT count(*) n FROM boards WHERE id = $1", [board]);
    const ok = broke && boardsLeft === 0;
    return {
      name: "اتمیک‌بودن — واحدِ شکسته کامل rollback می‌شود",
      ok,
      detail: ok
        ? "درجِ نامعتبر ردّ شد و بوردِ همان واحد هم نماند (۰ ردیف)"
        : `انتظار: شکست + ۰ بورد. واقعی: broke=${broke}، boardsLeft=${boardsLeft}`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
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
      console.error("✖ اتصال به PostgreSQL برقرار نشد.\n  pnpm db:up && pnpm db:migrate");
      process.exit(1);
    }
    throw error;
  }

  try {
    const results = [
      await checkCascade(client),
      await checkSetNull(client),
      await checkAtomicity(client),
    ];

    for (const r of results) {
      console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error(`\n✖ ${failed.length} چک قرمز شد.`);
      process.exit(1);
    }
    console.log("\n✔ رفتارِ FK و اتمیک‌بودن روی Postgresِ زنده اثبات شد (نه ادعا).");
  } finally {
    await client.end();
  }
}

await main();
