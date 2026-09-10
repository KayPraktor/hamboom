/**
 * ★★★ پاک‌سازیِ نهاییِ حذفِ نرم — M5 گام ۸٫۱.
 *
 * ```bash
 * pnpm infra:purge                           # فقط گزارش، با مرزِ سیاست (۳۰ روز)
 * pnpm infra:purge -- --delete               # ⚠️ واقعاً پاک می‌کند
 * pnpm infra:purge -- --days=7               # یک‌بارمصرف: مرزِ دیگر (فقط گزارش)
 * pnpm infra:purge -- --self-test            # روی تراکنشِ rollback‌شونده
 * ```
 *
 * ── ★ عددِ N: تصمیمِ M5-D9 — **۳۰ روز** (مالک، ۱۴۰۵/۰۶/۱۹) ─────────────────
 *
 * «چند روز بعد از حذف، داده واقعاً برود» یک تصمیمِ **سیاستی** است، نه فنی: به انتظارِ
 * کاربر و تعهدِ ما بسته است. تا پیش از این تاریخ همین اسکریپت **هیچ پیش‌فرضی نداشت** و
 * بدونِ `--days` بالا نمی‌آمد — چون پیش‌فرضِ حدسی این‌جا یعنی حذفِ داده‌ی کسی طبقِ حدسِ
 * من. حالا پیش‌فرض از `TRASH_RETENTION_DAYS` می‌آید ([`retentionEnvSchema`](../packages/config/src/sections.ts))
 * که مقدارِ پیش‌فرضش همان تصمیم است. `--days=N` **override**ِ صریح برای یک اجراست،
 * نه راهی برای عوض‌کردنِ سیاست.
 *
 * ⊕ همان الگوی `--prune`ِ [`backup-db`](backup-db.ts) و `--delete`ِ
 * [`sweep-orphans`](sweep-orphans.ts): سازوکار آماده است، **حذف** عملِ آگاهانه‌ی اپراتور است.
 *
 * ── ★★ زنجیره‌ی دو گامی ───────────────────────────────────────────────────
 *
 * این اسکریپت فقط **ردیف** پاک می‌کند. بلابِ S3 با CASCADE پاک نمی‌شود — همان نشتیِ
 * ثبت‌شده از M3. پس ترتیبِ درست همیشه این است:
 *
 * ‏   ۱. `infra:purge --delete`             ردیف‌ها می‌روند ⇒ بلاب‌ها **یتیم** می‌شوند
 * ‏   ۲. `infra:sweep-orphans --delete`     یتیم‌ها پاک می‌شوند
 *
 * ⚠️ برعکسش بی‌اثر است: تا وقتی ردیف هست، جاروب بلاب را «دارای مرجع» می‌بیند و
 * دست نمی‌زند — که همان رفتارِ درست است.
 */
import { databaseEnvSchema, loadEnv, retentionEnvSchema } from "@hamboom/config";
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

/**
 * مرزِ نگهداشت: `--days=N` اگر آمده، وگرنه سیاست (`TRASH_RETENTION_DAYS`).
 *
 * ★ تابعِ خالص است تا خودآزمون بتواند **هر سه** شاخه را بسنجد — بدونِ آن، «پیش‌فرض
 * از سیاست می‌آید» فقط یک ادعا در کامنت بود.
 *
 * @returns `null` یعنی `--days` آمده ولی معتبر نیست — صریحاً می‌شکنیم، بی‌صدا به
 *   سیاست برنمی‌گردیم (یک `--days=abc` نباید ۳۰ روز داده پاک کند).
 */
export function resolveDays(argv: readonly string[], policyDays: number): number | null {
  const arg = argv.find((a) => a.startsWith("--days="));
  if (arg === undefined) return policyDays;
  const value = Number(arg.split("=")[1]);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

async function selfTest(pool: pg.Pool): Promise<void> {
  // ★ روی دیتابیسِ **زنده** ولی داخلِ تراکنشی که rollback می‌شود — همان الگوی
  //   `db:fk-test`. یعنی خودِ SQL آزموده می‌شود، نه یک بدلِ حافظه‌ای از آن.
  const results: { name: string; ok: boolean; detail: string }[] = [];

  // ★ سه شاخه‌ی مرزِ نگهداشت — بدونِ دیتابیس.
  const fromPolicy = resolveDays([], 30);
  const fromFlag = resolveDays(["--days=7"], 30);
  const bad = [resolveDays(["--days=abc"], 30), resolveDays(["--days=0"], 30)];
  results.push({
    name: "★ بدونِ --days، مرز از سیاست (M5-D9) می‌آید؛ با --days، از پرچم",
    ok: fromPolicy === 30 && fromFlag === 7,
    detail: `سیاست→${String(fromPolicy)} · پرچم→${String(fromFlag)}`,
  });
  results.push({
    name: "★ --daysِ نامعتبر می‌شکند، بی‌صدا به سیاست برنمی‌گردد",
    ok: bad.every((b) => b === null),
    detail: bad.every((b) => b === null) ? "abc و 0 هر دو رد شدند" : `واقعی: ${bad.join(",")}`,
  });

  const client = await pool.connect();
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
  console.log(
    "\n✔ مرزِ نگهداشت درست resolve می‌شود، معیارِ سن روی SQLِ واقعی اثبات شد، و هیچ ردیفی نماند.",
  );
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema.and(retentionEnvSchema));
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

    const days = resolveDays(process.argv.slice(2), env.TRASH_RETENTION_DAYS);
    if (days === null) {
      console.error(
        [
          "✖ `--days=N` باید عددِ صحیحِ ≥۱ باشد.",
          "",
          "‏  بدونِ --days، مرز از سیاست می‌آید (TRASH_RETENTION_DAYS، تصمیمِ M5-D9 = ۳۰ روز).",
          "‏  یک مقدارِ نامعتبر عمداً به سیاست برنمی‌گردد — حذفِ داده روی خطای تایپی، نه.",
        ].join("\n"),
      );
      process.exit(1);
    }
    const source = process.argv.slice(2).some((a) => a.startsWith("--days="))
      ? "پرچمِ --days"
      : "سیاستِ M5-D9";

    const doDelete = process.argv.slice(2).includes("--delete");
    const client = await pool.connect();
    try {
      const counts = await countPurgeable(client, days);
      console.log(
        `مرزِ نگهداشت: ${String(days)} روز (${source}) · حالت: ${doDelete ? "⚠️ حذفِ واقعی" : "فقط گزارش"}`,
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
