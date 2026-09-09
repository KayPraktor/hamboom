/**
 * ★★★ پاک‌سازیِ نهاییِ حذفِ نرم — M5 گام ۸٫۱.
 *
 * ```bash
 * pnpm infra:purge -- --days=30              # فقط گزارش
 * pnpm infra:purge -- --days=30 --delete     # ⚠️ واقعاً پاک می‌کند
 * pnpm infra:purge -- --self-test            # روی تراکنشِ rollback‌شونده
 * ```
 *
 * ── ⚠️⚠️ عددِ N این‌جا **پیش‌فرض ندارد**، و این عمدی است ────────────────────
 *
 * «چند روز بعد از حذف، داده واقعاً برود» یک تصمیمِ **سیاستی** است، نه فنی: به انتظارِ
 * کاربر، به تعهدِ ما، و به الزامِ قانونی بسته است (**M5-D9**، هنوز از مالک نیامده).
 * یک پیش‌فرضِ حدسی این‌جا بدترین شکلِ تصمیم‌گیری است — چون بی‌صدا اجرا می‌شود و
 * داده‌ی کسی را طبقِ **حدسِ من** پاک می‌کند. پس بدونِ `--days` اصلاً بالا نمی‌آید.
 *
 * ⊕ همان الگوی `--prune`ِ [`backup-db`](backup-db.ts) و `--delete`ِ
 * [`sweep-orphans`](sweep-orphans.ts): سازوکار آماده است، عمل آگاهانه‌ی اپراتور است.
 *
 * ── ★★ زنجیره‌ی دو گامی ───────────────────────────────────────────────────
 *
 * این اسکریپت فقط **ردیف** پاک می‌کند. بلابِ S3 با CASCADE پاک نمی‌شود — همان نشتیِ
 * ثبت‌شده از M3. پس ترتیبِ درست همیشه این است:
 *
 * ‏   ۱. `infra:purge --days=N --delete`   ردیف‌ها می‌روند ⇒ بلاب‌ها **یتیم** می‌شوند
 * ‏   ۲. `infra:sweep-orphans --delete`     یتیم‌ها پاک می‌شوند
 *
 * ⚠️ برعکسش بی‌اثر است: تا وقتی ردیف هست، جاروب بلاب را «دارای مرجع» می‌بیند و
 * دست نمی‌زند — که همان رفتارِ درست است.
 */
import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import type pg from "pg";

import { createDbPool } from "../apps/api/src/plugins/db.ts";

export interface PurgeCounts {
  boards: number;
  boardUpdates: number;
  boardSnapshots: number;
  files: number;
}

/**
 * شعاعِ انفجار **پیش از** هر حذفی — اپراتور باید ببیند چه چیزی با CASCADE می‌رود،
 * نه فقط تعدادِ بوردها.
 */
export async function countPurgeable(client: pg.PoolClient, days: number): Promise<PurgeCounts> {
  const cutoff = `now() - interval '${String(days)} days'`;
  const boards = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM boards WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`,
  );
  const updates = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM board_updates u
       JOIN boards b ON b.id = u.board_id
      WHERE b.deleted_at IS NOT NULL AND b.deleted_at < ${cutoff}`,
  );
  const snapshots = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM board_snapshots s
       JOIN boards b ON b.id = s.board_id
      WHERE b.deleted_at IS NOT NULL AND b.deleted_at < ${cutoff}`,
  );
  // ⚠️ دو منبع: فایل‌هایی که خودشان حذفِ نرم شده‌اند، و فایل‌هایی که با بوردِ رفتنی
  //    CASCADE می‌شوند. با `OR` شمرده می‌شوند تا دوباره‌شماری نشود.
  const files = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM files f
       LEFT JOIN boards b ON b.id = f.board_id
      WHERE (f.deleted_at IS NOT NULL AND f.deleted_at < ${cutoff})
         OR (b.deleted_at IS NOT NULL AND b.deleted_at < ${cutoff})`,
  );
  return {
    boards: Number(boards.rows[0]?.n ?? "0"),
    boardUpdates: Number(updates.rows[0]?.n ?? "0"),
    boardSnapshots: Number(snapshots.rows[0]?.n ?? "0"),
    files: Number(files.rows[0]?.n ?? "0"),
  };
}

/**
 * حذفِ واقعی — **در یک تراکنش**، طبقِ خط‌قرمزِ ۷ی `apps/api`.
 *
 * ★ ترتیب مهم نیست چون FKها CASCADE دارند؛ ولی تراکنش لازم است: یک purgeِ نیمه‌کاره
 * یعنی بوردی که رفته و فایل‌هایش مانده، بدونِ اینکه کسی بفهمد کجا قطع شد.
 */
export async function purge(client: pg.PoolClient, days: number): Promise<PurgeCounts> {
  const before = await countPurgeable(client, days);
  const cutoff = `now() - interval '${String(days)} days'`;
  await client.query(`DELETE FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`);
  // بوردها آخر: CASCADEشان بقیه‌ی ردیف‌های وابسته را می‌بَرد.
  await client.query(`DELETE FROM boards WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`);
  return before;
}

function daysArg(): number | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--days="));
  if (arg === undefined) return null;
  const value = Number(arg.split("=")[1]);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

async function selfTest(pool: pg.Pool): Promise<void> {
  // ★ روی دیتابیسِ **زنده** ولی داخلِ تراکنشی که rollback می‌شود — همان الگوی
  //   `db:fk-test`. یعنی خودِ SQL آزموده می‌شود، نه یک بدلِ حافظه‌ای از آن.
  const client = await pool.connect();
  const results: { name: string; ok: boolean; detail: string }[] = [];
  try {
    await client.query("BEGIN");
    const { randomUUID } = await import("node:crypto");
    const userId = randomUUID();
    const teamId = randomUUID();
    await client.query(
      "INSERT INTO users (id, display_name, presence_color) VALUES ($1, 'تستِ purge', '#334455')",
      [userId],
    );
    await client.query(
      "INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, 'تیمِ purge', $3)",
      [teamId, `p-${teamId.slice(0, 8)}`, userId],
    );

    const fresh = randomUUID();
    const stale = randomUUID();
    const alive = randomUUID();
    for (const [id, deletedAt] of [
      [fresh, "now() - interval '1 day'"],
      [stale, "now() - interval '40 days'"],
      [alive, "NULL"],
    ] as const) {
      await client.query(
        `INSERT INTO boards (id, team_id, title, created_by, deleted_at)
         VALUES ($1, $2, 'بوردِ purge', $3, ${deletedAt})`,
        [id, teamId, userId],
      );
    }

    const counts = await countPurgeable(client, 30);
    results.push({
      name: "★ فقط حذفِ نرمِ کهنه‌تر از N روز شمرده می‌شود",
      ok: counts.boards === 1,
      detail:
        counts.boards === 1
          ? "۴۰روزه شمرده شد؛ ۱روزه و بوردِ زنده نه"
          : `واقعی: ${String(counts.boards)} بورد`,
    });

    await purge(client, 30);
    const rows = await client.query<{ id: string }>(
      "SELECT id FROM boards WHERE id = ANY($1::uuid[])",
      [[fresh, stale, alive]],
    );
    const remaining = new Set(rows.rows.map((r) => r.id));
    const ok = !remaining.has(stale) && remaining.has(fresh) && remaining.has(alive);
    results.push({
      name: "★★ حذف **فقط** کهنه را می‌بَرد — تازه‌ی سطل و بوردِ زنده می‌مانند",
      ok,
      detail: ok
        ? "۴۰روزه رفت · ۱روزه مانْد · زنده مانْد"
        : `باقی‌مانده: ${[...remaining].map((r) => r.slice(0, 8)).join(",")}`,
    });

    // ★ و اثباتِ اینکه معیارِ روز واقعاً معیار است، نه تزئین.
    const zero = await countPurgeable(client, 0);
    results.push({
      name: "★ با N=0 بوردِ ۱روزه هم نامزد می‌شود ⇒ پس N بود که نگهش داشت",
      ok: zero.boards >= 1,
      detail: zero.boards >= 1 ? "معیارِ سن واقعاً اعمال می‌شود" : "با N=0 هم چیزی انتخاب نشد!",
    });
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }

  console.log("── خودآزمونِ purge (روی تراکنشِ rollback‌شونده) ──");
  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ ${String(reds.length)} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ معیارِ سن روی SQLِ واقعی اثبات شد، و هیچ ردیفی در دیتابیس نماند.");
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = createDbPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: 4,
  });

  try {
    if (process.argv.slice(2).includes("--self-test")) {
      await selfTest(pool);
      return;
    }

    const days = daysArg();
    if (days === null) {
      console.error(
        [
          "✖ `--days=N` لازم است و **پیش‌فرض ندارد**.",
          "",
          "‏  «چند روز بعد از حذف، داده واقعاً برود» یک تصمیمِ سیاستی است، نه فنی —",
          "‏  به انتظارِ کاربر، تعهدِ ما، و الزامِ قانونی بسته است (M5-D9).",
          "‏  یک پیش‌فرضِ حدسی این‌جا یعنی داده‌ی کسی طبقِ حدس پاک شود.",
          "",
          "‏  مثال:  pnpm infra:purge -- --days=30",
        ].join("\n"),
      );
      process.exit(1);
    }

    const doDelete = process.argv.slice(2).includes("--delete");
    const client = await pool.connect();
    try {
      const counts = await countPurgeable(client, days);
      console.log(
        `مرزِ نگهداشت: ${String(days)} روز · حالت: ${doDelete ? "⚠️ حذفِ واقعی" : "فقط گزارش"}`,
      );
      console.log(`  بورد           : ${String(counts.boards)}`);
      console.log(`  updateِ بورد    : ${String(counts.boardUpdates)}  (با CASCADE)`);
      console.log(`  snapshotِ بورد  : ${String(counts.boardSnapshots)}  (با CASCADE)`);
      console.log(`  فایل           : ${String(counts.files)}  (با CASCADE یا حذفِ نرمِ خودش)`);

      if (counts.boards === 0 && counts.files === 0) {
        console.log("\n✔ چیزی برای پاک‌سازی نیست.");
        return;
      }

      if (!doDelete) {
        console.log("\n⊘ هیچ چیزی پاک نشد. برای حذفِ واقعی: `-- --delete`");
        console.log("⚠️ حذف برگشت ندارد. اول همین اعداد را بخوان.");
        return;
      }

      await client.query("BEGIN");
      await purge(client, days);
      await client.query("COMMIT");
      console.log("\n✔ ردیف‌ها پاک شدند.");
      console.log(
        "★★ حالا بلاب‌هایشان **یتیم**اند و هنوز در باکت‌اند — گامِ دوم:\n" +
          "     pnpm infra:sweep-orphans -- --delete",
      );
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
