/**
 * ★★★ بازیابیِ Object Storage از آینه — M6 فاز ۲٫۳. بستنِ گپی که RUNBOOKِ M5 صادقانه ثبت کرد.
 *
 * ```bash
 * pnpm infra:restore-storage                          # آخرین مانیفست → باکت‌های drill، ۶ چک، بعد پاک‌سازی
 * pnpm infra:restore-storage -- --manifest=storage/manifest-….json
 * pnpm infra:restore-storage -- --bucket=snapshots --prefix=<boardId>/   # فقط یک بورد
 * pnpm infra:restore-storage -- --to-live             # ⚠️ روی باکت‌های زنده می‌نویسد (بازیابیِ واقعی)
 * pnpm infra:restore-storage -- --database=hamboom_restore_drill   # کاتالوگ از دیتابیسِ مشق (بعد از restore-drill --keep)
 * pnpm infra:restore-storage -- --keep                # اشیاءِ drill پاک نشوند (بازرسیِ دستی)
 * pnpm infra:restore-storage -- --self-test           # ★★ هفت سناریو، پنج شکستنِ عمدی
 * ```
 *
 * ── چرا این اسکریپت جدی‌تر از «تصاویرِ آپلودی» است ────────────────────────
 *
 * بعد از فشرده‌سازی، updateهای پیش از snapshot از `board_updates` **حذف** شده‌اند؛ محتوای
 * بورد تا `seq_upto` فقط در باکتِ snapshots است. پشتیبانِ دیتابیس به‌تنهایی بوردِ کامل را
 * برنمی‌گرداند — و مشقِ M5 با باکتِ snapshotsِ **خالی** سبز می‌مانْد (probe ۱٫۸ی M6).
 *
 * ── انضباط، همان مشقِ بازیابی ─────────────────────────────────────────────
 *
 * پیش‌فرض **باکتِ drill** (`<bucket>-restore-drill`) است، نه باکتِ زنده: بازیابی روی باکتِ
 * زنده حینِ آپلودهای جاری همان مسابقه‌ای است که جاروب از آن محافظت می‌کند، و مانیفستِ قدیمی
 * روی باکتِ زنده کلیدهایی را برمی‌گرداند که کاتالوگ فراموش کرده (⇒ بعداً یتیم). `--to-live`
 * صریح است و فقط برای بازیابیِ واقعی.
 *
 * شش چک با idِ ثابت ([`restore-storage-core.ts`](restore-storage-core.ts)) و خودآزمونی که
 * ثابت می‌کند هر شکستنِ عمدی را چکِ **درستش** می‌گیرد — نه فقط «قرمز شد».
 */
import { backupEnvSchema, databaseEnvSchema, loadEnv, s3EnvSchema } from "@hamboom/config";
import { createS3ObjectStore, ensureBucket, type ObjectStore } from "@hamboom/storage";

import { createDbPool } from "../apps/api/src/plugins/db.ts";
import { backupStoreConfig } from "./backup-common.ts";
import { latestStorageManifest, parseStorageManifest, type StorageManifest } from "./backup-run.ts";
import {
  restoreAndVerify,
  selectEntries,
  type SnapshotRow,
  type StorageCheck,
} from "./restore-storage-core.ts";

function argValue(argv: string[], name: string): string | undefined {
  const arg = argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}

function report(label: string, checks: StorageCheck[]): number {
  console.log(`\n── ${label} ──`);
  for (const c of checks) console.log(`${c.ok ? "✔" : "✖"} ${c.name}\n    ${c.detail}`);
  return checks.filter((c) => !c.ok).length;
}

async function snapshotRows(
  databaseUrl: string,
  ssl: boolean,
  prefix: string,
): Promise<SnapshotRow[]> {
  const pool = createDbPool({ connectionString: databaseUrl, ssl, poolMax: 2 });
  try {
    const res = await pool.query<{ storage_key: string; byte_size: number; state_vector: Buffer }>(
      "SELECT storage_key, byte_size, state_vector FROM board_snapshots WHERE storage_key LIKE $1 || '%' ORDER BY storage_key",
      [prefix],
    );
    return res.rows.map((r) => ({
      storageKey: r.storage_key,
      byteSize: r.byte_size,
      stateVector: new Uint8Array(r.state_vector),
    }));
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    const { runSelfTest } = await import("./restore-storage.self-test.ts");
    await runSelfTest();
    return;
  }

  const env = loadEnv(databaseEnvSchema.and(s3EnvSchema).and(backupEnvSchema));
  const toLive = argv.includes("--to-live");
  const keep = argv.includes("--keep");
  const prefix = argValue(argv, "prefix") ?? "";
  const which = argValue(argv, "bucket") ?? "both";
  if (!["snapshots", "assets", "both"].includes(which)) {
    throw new Error("‏[hamboom] --bucket فقط snapshots | assets | both");
  }
  const databaseUrl = (() => {
    const db = argValue(argv, "database");
    if (db === undefined) return env.DATABASE_URL;
    const u = new URL(env.DATABASE_URL);
    u.pathname = `/${db}`;
    return u.toString();
  })();

  const backupsConfig = backupStoreConfig(env);
  const backups = createS3ObjectStore(backupsConfig);

  // ── مانیفست ──────────────────────────────────────────────────────────
  let manifestKey = argValue(argv, "manifest");
  let manifest: StorageManifest;
  if (manifestKey === undefined) {
    const latest = await latestStorageManifest(backups);
    if (latest === null) {
      console.error(
        `✖ هیچ مانیفستِ آینه‌ای در باکتِ «${env.S3_BUCKET_BACKUPS}» نیست.\n    اول یکی بساز:  pnpm infra:backup-all`,
      );
      process.exit(1);
    }
    manifestKey = latest.key;
    manifest = latest.manifest;
    console.log(`آخرین مانیفست: ${manifestKey}`);
  } else {
    const bytes = await backups.getObject(manifestKey);
    if (bytes === null) {
      console.error(`✖ مانیفستِ «${manifestKey}» نیست.`);
      process.exit(1);
    }
    manifest = parseStorageManifest(bytes);
  }
  console.log(
    `مانیفستِ ${manifest.takenAt || "?"}` +
      (manifest.pgBackupKey === undefined
        ? " · ⚠️ بدونِ پیوند به dump (آینه‌ی تکی)"
        : ` · جفتِ ${manifest.pgBackupKey}`),
  );

  // ── باکت‌های مبدأ ↔ مقصد ────────────────────────────────────────────
  const buckets: { name: string; kind: "snapshots" | "assets" }[] = [];
  if (which !== "assets") buckets.push({ name: env.S3_BUCKET_SNAPSHOTS, kind: "snapshots" });
  if (which !== "snapshots") buckets.push({ name: env.S3_BUCKET_ASSETS, kind: "assets" });

  if (toLive) {
    console.log(
      "\n⚠️⚠️ --to-live: روی باکت‌های **زنده** می‌نویسد. کلیدهای موجود بازنویسی می‌شوند.",
    );
  }

  let reds = 0;
  const cleanups: { store: ObjectStore; keys: string[]; bucket: string }[] = [];
  for (const b of buckets) {
    const targetBucket = toLive ? b.name : `${b.name}-restore-drill`;
    const targetConfig = { ...backupsConfig, bucket: targetBucket };
    await ensureBucket(targetConfig);
    const target = createS3ObjectStore(targetConfig);
    const scope = { bucket: b.name, prefix };
    const entries = selectEntries(manifest, scope);
    const snapshots =
      b.kind === "snapshots" ? await snapshotRows(databaseUrl, env.DATABASE_SSL, prefix) : null;

    console.log(
      `\n▶ ${b.name} → ${targetBucket}${prefix === "" ? "" : ` (زیرِ ${prefix})`} · ${String(entries.length)} ورودی` +
        (snapshots === null ? "" : ` · ${String(snapshots.length)} ردیفِ board_snapshots`),
    );
    const checks = await restoreAndVerify({ backups, target, manifest, scope, snapshots });
    reds += report(targetBucket, checks);
    if (!toLive)
      cleanups.push({ store: target, keys: entries.map((e) => e.key), bucket: targetBucket });
  }

  if (keep) {
    console.log("\n    (اشیاءِ باکت‌های drill عمداً نگه داشته شدند — --keep)");
  } else {
    for (const c of cleanups) {
      for (const key of c.keys) await c.store.deleteObject(key);
    }
    if (cleanups.length > 0)
      console.log("\n    (اشیاءِ drill پاک شدند؛ باکت‌های drill خالی می‌مانند)");
  }

  if (reds > 0) {
    console.error(`\n✖ ${String(reds)} چک قرمز شد — این آینه قابلِ اتکا نیست.`);
    process.exit(1);
  }
  console.log(
    toLive
      ? "\n✔ بازیابیِ واقعی روی باکت‌های زنده انجام و راستی‌آزمایی شد."
      : "\n✔ آینه روی باکتِ drill بازیابی شد: هر شیء هم‌اندازه و هم‌hash، هر snapshotِ کاتالوگ بایت دارد و باز می‌شود.",
  );
}

await main();
