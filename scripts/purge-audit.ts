/**
 * ★★ نگهداشتِ `audit_logs` — M6 فاز ۴٫۴ ([ADR-067](../ARCHITECTURE_DECISIONS.md#adr-067) §۴).
 *
 * ── چرا جدا از `purge-deleted` ──────────────────────────────────────────
 *
 * آن یکی داده‌ی **کاربر** را با سیاستِ سطل (۳۰ روز) پاک می‌کند؛ این یکی **پرونده‌ی ممیزی** را با
 * سیاستِ خودش (تصمیمِ مالک: ۳۶۵ روز). دو سیاست، دو عدد، دو اسکریپت — تا کسی با یک `--days`ِ
 * اشتباه هر دو را نبرد. و `AUDIT_RETENTION_DAYS` عمداً **بدونِ پیش‌فرض** است (schema): بدونِ عدد
 * این اسکریپت اصلاً بالا نمی‌آید، نه اینکه بی‌صدا با یک حدس پاک کند.
 *
 * ⚠️ مثلِ همه‌ی حذف‌کننده‌های M5: پیش‌فرض **فقط گزارش**، حذفِ واقعی فقط با `--delete` صریح.
 * `--days=N` overrideِ **یک اجرا**ست، نه راهِ عوض‌کردنِ سیاست؛ مقدارِ نامعتبر به سیاست برنمی‌گردد.
 *
 * ★ از داخلِ ایمیجِ api اجرا می‌شود (`PRODUCTION_SCRIPTS`، compose `purge-audit`، cronِ ماهانه در
 * RUNBOOK). خودآزمون (`--self-test`) روی PGِ **زنده** داخلِ تراکنشی که rollback می‌شود: سه ردیف
 * (کهنه/روی مرز/تازه) ⇒ فقط کهنه می‌رود؛ مرزِ `--days`؛ و «بدونِ AUDIT_RETENTION_DAYS ⇒ ConfigError».
 *
 * اجرا: `pnpm infra:purge-audit` (گزارش) · `pnpm infra:purge-audit -- --delete` · `-- --self-test`
 */
import { auditRetentionEnvSchema, ConfigError, databaseEnvSchema, loadEnv } from "@hamboom/config";
import type pg from "pg";

import { createDbPool } from "../apps/api/src/plugins/db.ts";

/** مرزِ نگهداشت از پرچم یا سیاست — `null` = پرچمِ نامعتبر (به سیاست برنمی‌گردد، عمداً). */
export function resolveDays(argv: readonly string[], policyDays: number): number | null {
  const arg = argv.find((a) => a.startsWith("--days="));
  if (arg === undefined) return policyDays;
  const value = Number(arg.split("=")[1]);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

/** ردیف‌های کهنه‌تر از مرز — `created_at < now() - N days`. */
export async function countPurgeable(client: pg.PoolClient, days: number): Promise<number> {
  const r = await client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_logs WHERE created_at < now() - ($1::int * interval '1 day')",
    [days],
  );
  return Number(r.rows[0]?.n ?? "0");
}

export async function purge(client: pg.PoolClient, days: number): Promise<number> {
  const r = await client.query(
    "DELETE FROM audit_logs WHERE created_at < now() - ($1::int * interval '1 day')",
    [days],
  );
  return r.rowCount ?? 0;
}

async function selfTest(pool: pg.Pool): Promise<void> {
  const results: { name: string; ok: boolean; detail: string }[] = [];

  // ★ خالص — سه شاخه‌ی مرزِ نگهداشت.
  results.push({
    name: "resolveDays: سیاست / پرچم / پرچمِ نامعتبر ⇒ null (نه بازگشت به سیاست)",
    ok:
      resolveDays([], 365) === 365 &&
      resolveDays(["--days=30"], 365) === 30 &&
      resolveDays(["--days=0"], 365) === null &&
      resolveDays(["--days=abc"], 365) === null,
    detail: "365 / 30 / null / null",
  });

  // ★ بدونِ عدد بالا نمی‌آید — روی schema، نه روی یک if.
  let refused = false;
  try {
    loadEnv(auditRetentionEnvSchema, {});
  } catch (error) {
    refused = error instanceof ConfigError;
  }
  results.push({
    name: "بدونِ AUDIT_RETENTION_DAYS ⇒ ConfigError (هیچ پیش‌فرضی نیست)",
    ok: refused,
    detail: String(refused),
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // سه ردیف با actor=NULL و یک نشانِ یکتا در metadata تا از بقیه جدا شمرده شوند.
    const tag = `selftest-${String(Date.now())}`;
    const insert = (ageDays: number, label: string): Promise<unknown> =>
      client.query(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, created_at)
         VALUES (NULL, 'staff.grant', 'user', $1, $2::jsonb, now() - ($3::int * interval '1 day'))`,
        [label, JSON.stringify({ tag }), ageDays],
      );
    await insert(400, "old"); // کهنه‌تر از ۳۶۵ ⇒ می‌رود
    await insert(365, "edge"); // دقیقاً روی مرز — `<` است، پس **می‌مانَد** (ثبتِ رفتار)
    await insert(10, "fresh"); // تازه ⇒ می‌مانَد
    const remaining = async (): Promise<string[]> => {
      const r = await client.query<{ target_id: string }>(
        "SELECT target_id FROM audit_logs WHERE metadata->>'tag' = $1 ORDER BY target_id",
        [tag],
      );
      return r.rows.map((x) => x.target_id);
    };

    const countedAll = await countPurgeable(client, 365);
    const deleted = await purge(client, 365);
    const left = await remaining();
    results.push({
      name: "★ مرزِ ۳۶۵: فقط ردیفِ ۴۰۰روزه می‌رود؛ مرزی (۳۶۵) و تازه می‌مانند",
      ok: countedAll >= 1 && deleted >= 1 && left.join(",") === "edge,fresh",
      detail: `purgeable≥1: ${String(countedAll)} · deleted: ${String(deleted)} · باقی: ${left.join(",")}`,
    });

    const deletedAgain = await purge(client, 365);
    results.push({
      name: "اجرای دوباره ⇒ صفر (idempotent)",
      ok: deletedAgain === 0 && (await remaining()).join(",") === "edge,fresh",
      detail: String(deletedAgain),
    });
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }

  console.log("── خودآزمونِ purge-audit (روی تراکنشِ rollback‌شونده) ──");
  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ ${String(reds.length)} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ بدونِ عدد بالا نمی‌آید، مرز روی SQLِ واقعی درست است، و هیچ ردیفی نماند.");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dbEnv = loadEnv(databaseEnvSchema);
  const pool = createDbPool({
    connectionString: dbEnv.DATABASE_URL,
    ssl: dbEnv.DATABASE_SSL,
    poolMax: 2,
  });
  try {
    if (argv.includes("--self-test")) {
      await selfTest(pool);
      return;
    }

    // ★ سیاست **بعد از** انتخابِ حالت خوانده می‌شود ولی **پیش از** هر کوئری — و بدونِ آن می‌شکند.
    const policy = loadEnv(auditRetentionEnvSchema);
    const days = resolveDays(argv, policy.AUDIT_RETENTION_DAYS);
    if (days === null) {
      console.error(
        [
          "✖ `--days=N` باید عددِ صحیحِ ≥۱ باشد.",
          "",
          "‏  بدونِ --days، مرز از سیاست می‌آید (AUDIT_RETENTION_DAYS، تصمیمِ مالک = ۳۶۵ روز).",
          "‏  یک مقدارِ نامعتبر عمداً به سیاست برنمی‌گردد — حذفِ پرونده‌ی ممیزی روی خطای تایپی، نه.",
        ].join("\n"),
      );
      process.exit(1);
    }
    const source = argv.some((a) => a.startsWith("--days=")) ? "پرچمِ --days" : "سیاستِ ADR-067";
    const doDelete = argv.includes("--delete");

    const client = await pool.connect();
    try {
      const n = await countPurgeable(client, days);
      console.log(
        `مرزِ نگهداشتِ ممیزی: ${String(days)} روز (${source}) · حالت: ${doDelete ? "⚠️ حذفِ واقعی" : "فقط گزارش"}`,
      );
      console.log(`  ردیفِ audit کهنه‌تر از مرز: ${String(n)}`);
      if (n === 0) {
        console.log("\n✔ چیزی برای پاک‌سازی نیست.");
        return;
      }
      if (!doDelete) {
        console.log("\n⊘ هیچ چیزی پاک نشد. برای حذفِ واقعی: `-- --delete`");
        console.log("⚠️ حذف برگشت ندارد — این پرونده‌ی تعلیق/استرداد است. اول عدد را بخوان.");
        return;
      }
      await client.query("BEGIN");
      const deleted = await purge(client, days);
      await client.query("COMMIT");
      console.log(`\n✔ ${String(deleted)} ردیفِ audit پاک شد.`);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
