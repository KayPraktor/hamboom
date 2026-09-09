/**
 * ★★ پشتیبانِ روزانه‌ی Postgres → باکتِ **جدا** — M5 گام ۷٫۱ (تصمیمِ M5-D7).
 *
 * ```bash
 * pnpm infra:backup                 # dump → آپلود → راستی‌آزمایی
 * pnpm infra:backup -- --prune=14   # + نگهداشتِ ۱۴ تای آخر
 * ```
 *
 * ── ★★ چرا کنارِ dump یک «مانیفست» هم نوشته می‌شود ────────────────────────
 *
 * چون خودِ فایلِ dump **درباره‌ی خودش هیچ ادعای قابلِ‌سنجشی ندارد**. یک فایلِ ۳۰۰
 * کیلوبایتیِ موفق‌آپلودشده، از یک فایلِ ۳۰۰ کیلوبایتیِ **بریده** قابلِ تفکیک نیست تا
 * وقتی کسی بازیابی‌اش کند. پس همان لحظه که dump گرفته می‌شود، چیزی که باید بعداً
 * **برگردد** هم ثبت می‌شود: sha256، اندازه، فهرستِ migrationها، و بازه‌ی شمارشِ ردیفِ
 * هر جدول ([`backup-common.ts`](backup-common.ts) شرحِ بازه را دارد).
 *
 * ⚠️ **و انتظاراتِ مشقِ بازیابی از همین مانیفست می‌آید، نه از دیتابیسِ زنده** — وگرنه
 * مقایسه با دیتابیسی انجام می‌شد که از لحظه‌ی dump جلوتر رفته است.
 *
 * ── ⚠️ سقفی که امروز واقعی است و پنهانش نمی‌کنیم ─────────────────────────
 *
 * `ObjectStore.putObject` یک `Uint8Array` می‌گیرد، نه stream (پورتِ P4،
 * [ADR-013](../ARCHITECTURE_DECISIONS.md#adr-013)) ⇒ کلِ dump باید در حافظه جا شود.
 * برای dumpِ ~۳۰۰KBِ امروز بی‌اهمیت است، ولی عددی هست که از آن به بعد نمی‌شود: بالای
 * `WARN_BYTES` هشدارِ صریح چاپ می‌شود و سقف در TODOی M5 ثبت است.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backupEnvSchema, databaseEnvSchema, loadEnv, s3EnvSchema } from "@hamboom/config";
import { createS3ObjectStore, ensureBucket } from "@hamboom/storage";

import {
  BACKUP_PREFIX,
  backupStoreConfig,
  countRows,
  listTables,
  pruneList,
  rangesFrom,
  readMigrations,
  stampNow,
  type BackupManifest,
} from "./backup-common.ts";
import { parseDatabaseUrl, resolvePgTools } from "./pg-tools.ts";

/** بالای این اندازه، بارگذاریِ کاملِ dump در حافظه دیگر بی‌هزینه نیست. */
const WARN_BYTES = 512 * 1024 * 1024;

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function parsePrune(argv: string[]): number | null {
  const arg = argv.find((a) => a.startsWith("--prune"));
  if (arg === undefined) return null;
  const [, value] = arg.split("=");
  const n = value === undefined ? Number.NaN : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("‏[hamboom] `--prune=N` عددِ صحیحِ ≥۱ می‌خواهد (تعدادِ پشتیبانی که می‌مانَد).");
  }
  return n;
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema.and(s3EnvSchema).and(backupEnvSchema));
  const keep = parsePrune(process.argv.slice(2));
  const connection = parseDatabaseUrl(env.DATABASE_URL);
  const tools = await resolvePgTools({ connection });
  console.log(tools.describe());

  const storeConfig = backupStoreConfig(env);
  const store = createS3ObjectStore(storeConfig);
  // P3: روی ماشینِ تازه باکت هنوز نیست و اولین پشتیبان بی‌دلیل می‌شکست.
  await ensureBucket(storeConfig);

  const dir = await mkdtemp(join(tmpdir(), "hamboom-backup-"));
  const dumpFile = join(dir, "db.dump");

  try {
    const tables = await listTables(tools, connection.database);
    const migrations = await readMigrations(tools, connection.database);
    const before = await countRows(tools, connection.database, tables);

    const stamp = stampNow();
    const started = Date.now();
    // `-Fc` = قالبِ custom (فشرده و قابلِ بازیابیِ گزینشی). `-Z 6` تعادلِ حجم/زمان.
    const run = await tools.dump(["-Fc", "-Z", "6"], dumpFile);
    if (run.code !== 0) {
      console.error(run.stderr.trim());
      throw new Error(`‏[hamboom] pg_dump با کدِ ${String(run.code)} شکست خورد — چیزی آپلود نشد.`);
    }
    const after = await countRows(tools, connection.database, tables);

    const { size } = await stat(dumpFile);
    if (size === 0) throw new Error("‏[hamboom] dumpِ صفر بایتی — پشتیبان نیست.");
    if (size > WARN_BYTES) {
      console.warn(
        `⚠️ dump ${String(Math.round(size / 1024 / 1024))}MB است و برای آپلود کامل در حافظه ` +
          "بارگذاری می‌شود (پورتِ ObjectStore stream ندارد). این سقف در TODOی M5 ثبت است.",
      );
    }

    const sha256 = await sha256Of(dumpFile);
    const key = `${BACKUP_PREFIX}${connection.database}-${stamp}.dump`;
    const manifest: BackupManifest = {
      key,
      takenAt: new Date().toISOString(),
      database: connection.database,
      serverVersion: tools.serverVersion,
      clientVersion: tools.clientVersion,
      toolMode: tools.mode,
      bytes: size,
      sha256,
      migrations,
      rows: rangesFrom(before, after),
    };

    await store.putObject(key, await readFile(dumpFile), {
      contentType: "application/octet-stream",
    });
    await store.putObject(
      key.replace(/\.dump$/, ".json"),
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      { contentType: "application/json" },
    );

    // ★ آپلود ادعا است تا وقتی خوانده نشود. اندازه‌ی سمتِ سرور با اندازه‌ی محلی سنجیده
    //   می‌شود؛ برابریِ **محتوا** کارِ مشقِ بازیابی است، نه این‌جا.
    const head = await store.headObject(key);
    if (head === null || head.size !== size) {
      throw new Error(
        `‏[hamboom] راستی‌آزماییِ آپلود شکست خورد: محلی ${String(size)} بایت، ` +
          `سمتِ سرور ${head === null ? "اصلاً نیست" : String(head.size)}.`,
      );
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `✔ پشتیبان ساخته و راستی‌آزمایی شد — ${key}\n` +
        `    ${String(size)} بایت · sha256 ${sha256.slice(0, 16)}… · ` +
        `${String(Object.keys(migrations).length)} migration · ${String(tables.length)} جدول · ${seconds}s`,
    );

    const existing = await store.listPrefix(BACKUP_PREFIX);
    if (keep === null) {
      console.log(
        `    ⚠️ ${String(existing.filter((k) => k.endsWith(".dump")).length)} پشتیبان در باکت است و ` +
          "چیزی پاک نمی‌شود. برای نگهداشت: `--prune=N`.",
      );
    } else {
      const doomed = pruneList(existing, keep, key.replace(/\.dump$/, ""));
      for (const k of doomed) await store.deleteObject(k);
      console.log(
        doomed.length === 0
          ? `    نگهداشت: ${String(keep)} تای آخر — چیزی برای حذف نبود.`
          : `    نگهداشت: ${String(keep)} تای آخر — ${String(doomed.length)} شیء حذف شد.`,
      );
    }

    console.log("\n⚠️ این هنوز «پشتیبان» نیست — تا وقتی `pnpm infra:restore-drill` سبز نشود.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await main();
