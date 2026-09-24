/**
 * منطقِ **بدونِ اثرِ جانبیِ** پشتیبان — M6 فاز ۲ (گام‌های ۲٫۲ و ۲٫۵)، جداشده از دو ورودیِ M5.
 *
 * ⚠️ چرا فایلِ جدا (بارِ سوم، بعد از `backup-common` و `sweep-orphans-core`): `backup-db.ts` و
 * `backup-storage.ts` هر دو ورودیِ اجرایی‌اند و در انتها `await main()` دارند؛ `backup-all.ts`
 * می‌خواهد هر دو را در **یک** پروسه پشتِ هم اجرا کند و خودآزمونِ آینه می‌خواهد `mirrorBucket`
 * را با انبارِ حافظه‌ای بسنجد. importِ یک ورودی یعنی اجرای ناخواسته‌ی آن.
 *
 * ── ★ سه تغییرِ M6 نسبت به M5 ─────────────────────────────────────────────
 *
 * ۱. **`sha256` در مانیفستِ آینه.** تا M5 مانیفست فقط `{key,size}` داشت و skip فقط با اندازه
 *    بود ⇒ یک شیءِ خراب‌شده‌ی هم‌اندازه هرگز دیده نمی‌شد. حالا هر شیء **حینِ کپی** hash
 *    می‌شود (بایت‌ها همان‌جا رد می‌شوند، هزینه‌ی اضافه صفر) و `restore-storage` با همان sha
 *    راستی‌آزمایی می‌کند. skip = هم‌اندازه **و** shaی شناخته‌شده از مانیفستِ قبلی؛ مانیفستِ
 *    قدیمیِ بی‌sha یعنی «نمی‌دانم» ⇒ یک‌بار دوباره کپی و hash می‌شود.
 *    ⚠️ آینه خودش هر روز بایت‌های مقصد را **دوباره نمی‌خوانَد** (O(bytes)); خرابیِ درجا را
 *    `restore-storage` می‌گیرد، همان‌طور که خرابیِ dump را مشقِ بازیابی می‌گیرد.
 * ۲. **استریم** ([ADR-069](../ARCHITECTURE_DECISIONS.md#adr-069)): هیچ شیئی کامل در حافظه
 *    نمی‌نشیند — اندازه‌گیریِ فاز ۱ی M6: مسیرِ Buffer روی ۲۰۰MB لحظه‌ای ≈۳× شیء بود.
 * ۳. **پیوندِ dump ↔ آینه:** `backup-all` هر دو را با یک `stamp` می‌گیرد و هر مانیفست کلیدِ
 *    دیگری را دارد. این پنجره‌ی بینِ dump و آینه را **کوتاه** می‌کند نه بسته — compactor
 *    فایلِ قدیمی را همان لحظه پاک می‌کند ([`compactor.ts`](../apps/realtime/src/persistence/compactor.ts)
 *    مرحله‌ی ۵)؛ اگر بینِ dump و آینه فشرده‌سازی رخ دهد، کلیدِ ارجاع‌شده‌ی dump در آینه نیست و
 *    چکِ `catalog`ِ `restore-storage` همان را **قرمز** می‌کند. بستنِ کامل = تاخیرِ حذف در
 *    compactor (M2، تصمیمِ باز در PROGRESS-M6).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";

import type { BackupEnv, DatabaseEnv, S3Env } from "@hamboom/config";
import type { ObjectStore } from "@hamboom/storage";
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

export const MIRROR_PREFIX = "storage/";
export const STORAGE_MANIFEST_PREFIX = `${MIRROR_PREFIX}manifest-`;

/** بالای این اندازه‌ی dump هشدار می‌دهیم — نه به‌خاطرِ حافظه (استریم است)، به‌خاطرِ زمانِ بازیابی. */
export const WARN_DUMP_BYTES = 512 * 1024 * 1024;

export interface MirrorEntry {
  key: string;
  size: number;
  /** ★ M6: hash حینِ کپی. `undefined` فقط در `--dry-run` یا ورودیِ مانیفستِ قدیمی. */
  sha256?: string;
}

export interface MirrorResult {
  bucket: string;
  copied: number;
  skipped: number;
  failed: string[];
  entries: MirrorEntry[];
}

/** مانیفستِ آینه — `storage/manifest-<stamp>.json`. */
export interface StorageManifest {
  takenAt: string;
  buckets: Record<string, MirrorEntry[]>;
  /** ★ M6 فاز ۲٫۵: کلیدِ dumpِ هم‌زمان (وقتی با `backup-all` گرفته شده). */
  pgBackupKey?: string;
}

/** کلیدِ آینه‌ی یک شیءِ مبدأ. ⚠️ نامِ باکت همان نامِ لحظه‌ی گرفتن است. */
export const mirrorKeyOf = (bucketName: string, key: string): string =>
  `${MIRROR_PREFIX}${bucketName}/${key}`;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Transformی که بایت‌ها را عبور می‌دهد و همزمان hash می‌گیرد. */
function hashingTap(): { tap: Transform; digest: () => string } {
  const hash = createHash("sha256");
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  return { tap, digest: () => hash.digest("hex") };
}

/** آخرین مانیفستِ آینه در باکتِ پشتیبان (یا `null`). فقط مانیفست‌ها پیمایش می‌شوند، نه آینه. */
export async function latestStorageManifest(
  target: ObjectStore,
): Promise<{ key: string; manifest: StorageManifest } | null> {
  let latest: string | undefined;
  for await (const key of target.iteratePrefix(STORAGE_MANIFEST_PREFIX)) {
    if (key.endsWith(".json") && (latest === undefined || key > latest)) latest = key;
  }
  if (latest === undefined) return null;
  const bytes = await target.getObject(latest);
  if (bytes === null) return null;
  return { key: latest, manifest: parseStorageManifest(bytes) };
}

/** مانیفستِ قدیمی (`{key,size}`ِ M5) هم پذیرفته می‌شود — sha ندارد ⇒ «نمی‌دانم». */
export function parseStorageManifest(bytes: Uint8Array): StorageManifest {
  const raw = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
    takenAt?: string;
    buckets?: Record<string, { key: string; size: number; sha256?: string }[]>;
    pgBackupKey?: string;
  };
  return {
    takenAt: raw.takenAt ?? "",
    buckets: raw.buckets ?? {},
    ...(raw.pgBackupKey === undefined ? {} : { pgBackupKey: raw.pgBackupKey }),
  };
}

/**
 * یک باکت را به `storage/<bucket>/…` آینه می‌کند — استریمی، با sha256.
 *
 * ★ هر کپی بلافاصله با `headObject` خوانده می‌شود، وگرنه «آپلود شد» فقط یک ادعاست.
 * `previous` = ورودی‌های همین باکت در مانیفستِ قبلی؛ skip فقط وقتی اندازه برابر **و** sha
 * شناخته باشد.
 */
export async function mirrorBucket(
  source: ObjectStore,
  target: ObjectStore,
  bucketName: string,
  dryRun: boolean,
  previous: ReadonlyMap<string, MirrorEntry> = new Map(),
): Promise<MirrorResult> {
  const result: MirrorResult = {
    bucket: bucketName,
    copied: 0,
    skipped: 0,
    failed: [],
    entries: [],
  };

  for await (const key of source.iteratePrefix("")) {
    const sourceHead = await source.headObject(key);
    if (sourceHead === null) continue; // بینِ list و head حذف شده — عادی است

    const mirrorKey = mirrorKeyOf(bucketName, key);
    const known = previous.get(key);
    const existing = await target.headObject(mirrorKey);
    if (
      existing !== null &&
      existing.size === sourceHead.size &&
      known?.sha256 !== undefined &&
      known.size === sourceHead.size
    ) {
      result.skipped += 1;
      result.entries.push({ key, size: sourceHead.size, sha256: known.sha256 });
      continue;
    }
    if (dryRun) {
      result.copied += 1;
      result.entries.push({ key, size: sourceHead.size });
      continue;
    }

    const body = await source.getObjectStream(key);
    if (body === null) {
      result.failed.push(`${key} (بینِ head و get ناپدید شد)`);
      continue;
    }
    const { tap, digest } = hashingTap();
    body.once("error", (e) => tap.destroy(e));
    try {
      await target.putObjectStream(mirrorKey, body.pipe(tap), {
        contentLength: sourceHead.size,
        contentType: sourceHead.contentType ?? "application/octet-stream",
      });
    } catch (e) {
      result.failed.push(`${key} (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const check = await target.headObject(mirrorKey);
    if (check === null || check.size !== sourceHead.size) {
      result.failed.push(
        `${key} (اندازه‌ی آینه ${check === null ? "نیست" : String(check.size)} ≠ ${String(sourceHead.size)})`,
      );
      continue;
    }
    result.copied += 1;
    result.entries.push({ key, size: sourceHead.size, sha256: digest() });
  }

  return result;
}

export interface StorageMirrorOptions {
  dryRun: boolean;
  /** برچسبِ مشترک با dump (backup-all)؛ پیش‌فرض همین لحظه. */
  stamp?: string;
  /** کلیدِ dumpِ هم‌زمان — در مانیفست ثبت می‌شود. */
  pgBackupKey?: string;
  log?: (line: string) => void;
}

/** آینه‌ی هر دو باکتِ مبدأ + نوشتنِ مانیفست. کلیدِ مانیفست را برمی‌گرداند (`null` در dry-run). */
export async function runStorageMirror(
  env: S3Env & BackupEnv,
  opts: StorageMirrorOptions,
): Promise<{ manifestKey: string | null; results: MirrorResult[] }> {
  const log = opts.log ?? console.log;
  const targetConfig = backupStoreConfig(env);
  const target = createS3ObjectStore(targetConfig);
  await ensureBucket(targetConfig);

  const prior = await latestStorageManifest(target);
  if (prior !== null) log(`مانیفستِ قبلی: ${prior.key}`);

  const sources = [env.S3_BUCKET_SNAPSHOTS, env.S3_BUCKET_ASSETS].map((bucket) => ({
    name: bucket,
    store: createS3ObjectStore({ ...targetConfig, bucket }),
  }));
  if (opts.dryRun) log("⊘ --dry-run: چیزی نوشته نمی‌شود.\n");

  const results: MirrorResult[] = [];
  for (const { name, store } of sources) {
    const previous = new Map((prior?.manifest.buckets[name] ?? []).map((e) => [e.key, e]));
    const result = await mirrorBucket(store, target, name, opts.dryRun, previous);
    results.push(result);
    log(
      `${result.failed.length === 0 ? "✔" : "✖"} ${name} — ${String(result.entries.length)} شیء · ` +
        `${String(result.copied)} کپی · ${String(result.skipped)} از قبل بود` +
        (result.failed.length === 0 ? "" : ` · ${String(result.failed.length)} شکست`),
    );
    for (const f of result.failed.slice(0, 5)) console.error(`    ✖ ${f}`);
  }

  let manifestKey: string | null = null;
  if (!opts.dryRun) {
    manifestKey = `${STORAGE_MANIFEST_PREFIX}${opts.stamp ?? stampNow()}.json`;
    const manifest: StorageManifest = {
      takenAt: new Date().toISOString(),
      buckets: Object.fromEntries(results.map((r) => [r.bucket, r.entries])),
      ...(opts.pgBackupKey === undefined ? {} : { pgBackupKey: opts.pgBackupKey }),
    };
    await target.putObject(manifestKey, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), {
      contentType: "application/json",
    });
    log(`\nمانیفستِ این لحظه: ${manifestKey}`);
  }
  return { manifestKey, results };
}

export interface DbBackupOptions {
  /** `--prune=N` — بدونِ آن هیچ پشتیبانی پاک نمی‌شود. */
  keep: number | null;
  stamp?: string;
  /** کلیدِ مانیفستِ آینه‌ی هم‌زمان (backup-all) — در مانیفستِ dump ثبت می‌شود. */
  storageManifestKey?: string;
  log?: (line: string) => void;
}

/** dump → آپلودِ استریمی → مانیفست → راستی‌آزماییِ اندازه. کلیدِ dump را برمی‌گرداند. */
export async function runDbBackup(
  env: DatabaseEnv & S3Env & BackupEnv,
  opts: DbBackupOptions,
): Promise<{ key: string; manifest: BackupManifest }> {
  const log = opts.log ?? console.log;
  const connection = parseDatabaseUrl(env.DATABASE_URL);
  const tools = await resolvePgTools({ connection });
  log(tools.describe());

  const storeConfig = backupStoreConfig(env);
  const store = createS3ObjectStore(storeConfig);
  await ensureBucket(storeConfig); // P3: روی ماشینِ تازه باکت هنوز نیست

  const dir = await mkdtemp(join(tmpdir(), "hamboom-backup-"));
  const dumpFile = join(dir, "db.dump");
  try {
    const tables = await listTables(tools, connection.database);
    const migrations = await readMigrations(tools, connection.database);
    const before = await countRows(tools, connection.database, tables);

    const stamp = opts.stamp ?? stampNow();
    const started = Date.now();
    const run = await tools.dump(["-Fc", "-Z", "6"], dumpFile);
    if (run.code !== 0) {
      console.error(run.stderr.trim());
      throw new Error(`‏[hamboom] pg_dump با کدِ ${String(run.code)} شکست خورد — چیزی آپلود نشد.`);
    }
    const after = await countRows(tools, connection.database, tables);

    const { size } = await stat(dumpFile);
    if (size === 0) throw new Error("‏[hamboom] dumpِ صفر بایتی — پشتیبان نیست.");
    if (size > WARN_DUMP_BYTES) {
      console.warn(
        `⚠️ dump ${String(Math.round(size / 1024 / 1024))}MB است — آپلود استریمی است، ولی زمانِ ` +
          "بازیابی‌اش را در مشق اندازه بگیر.",
      );
    }

    // ★ hash حینِ آپلود (استریم) — نه یک بار خواندنِ فایل برای sha و یک بار برای آپلود.
    const { tap, digest } = hashingTap();
    const file = createReadStream(dumpFile);
    file.once("error", (e) => tap.destroy(e));
    const key = `${BACKUP_PREFIX}${connection.database}-${stamp}.dump`;
    await store.putObjectStream(key, file.pipe(tap), {
      contentLength: size,
      contentType: "application/octet-stream",
    });
    const sha256 = digest();

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
      ...(opts.storageManifestKey === undefined
        ? {}
        : { storageManifestKey: opts.storageManifestKey }),
    };
    await store.putObject(
      key.replace(/\.dump$/, ".json"),
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      { contentType: "application/json" },
    );

    // ★ آپلود ادعا است تا وقتی خوانده نشود. برابریِ **محتوا** کارِ مشقِ بازیابی است.
    const head = await store.headObject(key);
    if (head === null || head.size !== size) {
      throw new Error(
        `‏[hamboom] راستی‌آزماییِ آپلود شکست خورد: محلی ${String(size)} بایت، ` +
          `سمتِ سرور ${head === null ? "اصلاً نیست" : String(head.size)}.`,
      );
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    log(
      `✔ پشتیبان ساخته و راستی‌آزمایی شد — ${key}\n` +
        `    ${String(size)} بایت · sha256 ${sha256.slice(0, 16)}… · ` +
        `${String(Object.keys(migrations).length)} migration · ${String(tables.length)} جدول · ${seconds}s`,
    );

    const existing = await store.listPrefix(BACKUP_PREFIX);
    if (opts.keep === null) {
      log(
        `    ⚠️ ${String(existing.filter((k) => k.endsWith(".dump")).length)} پشتیبان در باکت است و ` +
          "چیزی پاک نمی‌شود. برای نگهداشت: `--prune=N`.",
      );
    } else {
      const doomed = pruneList(existing, opts.keep, key.replace(/\.dump$/, ""));
      for (const k of doomed) await store.deleteObject(k);
      log(
        doomed.length === 0
          ? `    نگهداشت: ${String(opts.keep)} تای آخر — چیزی برای حذف نبود.`
          : `    نگهداشت: ${String(opts.keep)} تای آخر — ${String(doomed.length)} شیء حذف شد.`,
      );
    }
    return { key, manifest };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function parsePrune(argv: string[]): number | null {
  const arg = argv.find((a) => a.startsWith("--prune"));
  if (arg === undefined) return null;
  const [, value] = arg.split("=");
  const n = value === undefined ? Number.NaN : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("‏[hamboom] `--prune=N` عددِ صحیحِ ≥۱ می‌خواهد (تعدادِ پشتیبانی که می‌مانَد).");
  }
  return n;
}

/** برای خودآزمونِ آینه — hashِ مرجعِ بایت‌های مبدأ. */
export { sha256Hex };
