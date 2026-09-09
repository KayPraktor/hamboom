/**
 * مشترکاتِ پشتیبان و مشقِ بازیابی — M5 فاز ۷.
 *
 * ⚠️ **چرا فایلِ سوم و نه importِ مستقیم:** `backup-db.ts` و `restore-drill.ts` هر دو
 * ورودیِ اجرایی‌اند و در انتها `main()` را صدا می‌زنند. اگر یکی از دیگری import کند،
 * صرفِ خواندنِ یک تایپ باعثِ **اجرای پشتیبان** می‌شود. پس هر چیزی که هر دو لازم دارند
 * این‌جاست و این فایل هیچ اثرِ جانبی ندارد.
 *
 * ★ و مهم‌ترین چیزِ مشترک `backupStoreConfig` است: اگر پشتیبان و مشق به **دو باکتِ
 * متفاوت** نگاه کنند، مشق همیشه سبز می‌شود چون هیچ‌وقت پشتیبانِ واقعی را نمی‌بیند.
 */
import type { BackupEnv, S3Env } from "@hamboom/config";
import type { S3StorageConfig } from "@hamboom/storage";

import type { PgTools } from "./pg-tools.ts";

/** همه‌ی پشتیبان‌های دیتابیس زیرِ همین پیشوند می‌نشینند. */
export const BACKUP_PREFIX = "pg/";

/**
 * شمارشِ ردیفِ یک جدول، به‌صورتِ بازه‌ی [قبل از dump، بعد از dump].
 *
 * ⚠️ **بازه است، نه عدد** — و این عمدی است. `pg_dump` یک snapshot از لحظه‌ای وسطِ
 * کار می‌گیرد؛ روی دیتابیسِ زنده شمارشِ «قبل» و «بعد» می‌توانند فرق کنند و هیچ‌کدام
 * تنهایی درست نیست. روی دیتابیسِ آرام بازه صفر-عرض است ⇒ برابریِ دقیق.
 */
export interface RowRange {
  min: number;
  max: number;
}

/** آنچه باید در بازیابی **برگردد** — نوشته‌شده در همان لحظه‌ی dump. */
export interface BackupManifest {
  key: string;
  takenAt: string;
  database: string;
  serverVersion: string;
  clientVersion: string;
  toolMode: string;
  bytes: number;
  sha256: string;
  /** نامِ فایل → checksumِ ثبت‌شده در `schema_migrations`. */
  migrations: Record<string, string>;
  /** نامِ جدول → بازه‌ی شمارشِ ردیف. */
  rows: Record<string, RowRange>;
}

/** پیکربندیِ `ObjectStore`ِ باکتِ **پشتیبان** (M5-D7: جدا از دارایی‌ها). */
export function backupStoreConfig(env: S3Env & BackupEnv): S3StorageConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    bucket: env.S3_BUCKET_BACKUPS,
    defaultPresignTtl: env.S3_PRESIGN_TTL_SECONDS,
  };
}

/** برچسبِ زمانیِ مرتب‌شدنی و ایمن برای نامِ کلید (`2026-09-09T16-30-00Z`). */
export function stampNow(now = new Date()): string {
  return now
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");
}

/** فهرستِ جدول‌های عمومی — منبعِ فهرستِ شمارش. */
export async function listTables(tools: PgTools, database: string): Promise<string[]> {
  const out = await tools.psql(
    database,
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  return out === ""
    ? []
    : out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s !== "");
}

/**
 * شمارشِ ردیفِ همه‌ی جدول‌ها در **یک** رفت‌وبرگشت.
 *
 * ⚠️ `count(*)` دقیق است ولی کلِ جدول را می‌خوانَد. امروز ارزان است؛ اگر روزی
 * `board_updates` میلیونی شد، این اولین جایی است که باید عوض شود — و آن تغییر دقت را
 * کم می‌کند، پس تصمیمِ آگاهانه می‌خواهد نه یک بهینه‌سازیِ بی‌صدا.
 */
export async function countRows(
  tools: PgTools,
  database: string,
  tables: string[],
): Promise<Record<string, number>> {
  if (tables.length === 0) return {};
  const sql = tables
    .map((t) => `SELECT '${t}' AS t, count(*)::text AS n FROM public."${t}"`)
    .join(" UNION ALL ");
  const out = await tools.psql(database, sql);
  const counts: Record<string, number> = {};
  for (const line of out.split(/\r?\n/)) {
    const [name, n] = line.trim().split("|");
    if (name === undefined || n === undefined || name === "") continue;
    counts[name] = Number(n);
  }
  return counts;
}

/** `schema_migrations` به‌صورتِ نامِ فایل → checksum. */
export async function readMigrations(
  tools: PgTools,
  database: string,
): Promise<Record<string, string>> {
  const out = await tools.psql(
    database,
    "SELECT name || '|' || checksum FROM schema_migrations ORDER BY name",
  );
  const map: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const [name, checksum] = line.trim().split("|");
    if (name === undefined || checksum === undefined || name === "") continue;
    map[name] = checksum;
  }
  return map;
}

/** بازه‌ی [min,max] از دو شمارشِ قبل و بعد. */
export function rangesFrom(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, RowRange> {
  const rows: Record<string, RowRange> = {};
  for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[table] ?? 0;
    const a = after[table] ?? 0;
    rows[table] = { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return rows;
}

/**
 * کلیدهایی که با نگهداشتِ `keep` تای آخر باید حذف شوند.
 *
 * ⚠️ دو محافظ: بدونِ `--prune` اصلاً صدا زده نمی‌شود، و هرگز به پشتیبانی که همین الان
 * ساخته شد (`protectStem`) دست نمی‌زند. حذفِ پشتیبان برگشت ندارد.
 */
export function pruneList(keys: string[], keep: number, protectStem: string): string[] {
  const stems = [...new Set(keys.map((k) => k.replace(/\.(dump|json)$/, "")))].sort();
  const doomed = stems.slice(0, Math.max(0, stems.length - keep)).filter((s) => s !== protectStem);
  return keys.filter((k) => doomed.includes(k.replace(/\.(dump|json)$/, "")));
}
