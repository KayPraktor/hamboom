/**
 * ★★ پشتیبانِ **جفت**: dump + آینه‌ی Object Storage در **یک** اجرا — M6 فاز ۲٫۵.
 *
 * ```bash
 * pnpm infra:backup-all                # dump → آینه، با یک stamp و دو مانیفستِ به‌هم‌پیوندخورده
 * pnpm infra:backup-all -- --prune=14  # + نگهداشتِ dumpها (آینه پاک نمی‌شود)
 * ```
 *
 * ── چرا یک اجرا و نه دو خطِ cron ──────────────────────────────────────────
 *
 * cronِ M5 dump را ۰۳:۱۰ و آینه را ۰۳:۳۰ می‌گرفت. compactor بعد از نوشتنِ snapshotِ نو
 * فایلِ قدیمی را **همان لحظه** پاک می‌کند؛ بوردی که بینِ آن دو زمان فشرده شود، در dump به
 * کلیدی اشاره می‌کند که آینه دیگر ندیدش — و ردیف‌های بازیابی‌شده به بایت‌های غایب اشاره
 * می‌کنند (realtime روی همین throw می‌کند). این اسکریپت پنجره را از بیست دقیقه به چند ثانیه
 * **کوتاه** می‌کند و دو مانیفست را به هم **پیوند** می‌زند (`storageManifestKey` ↔
 * `pgBackupKey`) تا `restore-storage` جفتِ درست را پیدا کند و چکِ `catalog`ش هر کلیدِ
 * ارجاع‌شده‌ی بی‌بایت را **قرمز** کند.
 *
 * ⚠️ **بسته نمی‌شود** — همان ثانیه‌ها هم پنجره‌اند. بستنِ کامل یعنی compactor فایلِ قدیمی را با
 * تاخیر پاک کند (M2، ADR) — تصمیمِ باز در PROGRESS-M6. تا آن روز، یک `catalog`ِ قرمز یعنی
 * «همین حالا دوباره بگیر»، نه «پشتیبان خراب است».
 */
import { backupEnvSchema, databaseEnvSchema, loadEnv, s3EnvSchema } from "@hamboom/config";

import {
  parsePrune,
  runDbBackup,
  runStorageMirror,
  STORAGE_MANIFEST_PREFIX,
} from "./backup-run.ts";
import { stampNow } from "./backup-common.ts";

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema.and(s3EnvSchema).and(backupEnvSchema));
  const keep = parsePrune(process.argv.slice(2));
  const stamp = stampNow();
  const storageManifestKey = `${STORAGE_MANIFEST_PREFIX}${stamp}.json`;

  console.log(`▶ پشتیبانِ جفت — stamp ${stamp}\n`);
  // ★ ترتیب: اول dump (کاتالوگ)، بعد آینه (بایت‌ها). اگر آینه بعد از dump باشد، هر snapshotی که
  //   dump به آن اشاره می‌کند یا در آینه هست یا در همین فاصله فشرده شده — و دومی را catalog می‌گیرد.
  const db = await runDbBackup(env, { keep, stamp, storageManifestKey });
  console.log("");
  const mirror = await runStorageMirror(env, { dryRun: false, stamp, pgBackupKey: db.key });

  const failed = mirror.results.reduce((n, r) => n + r.failed.length, 0);
  if (failed > 0) {
    console.error(`\n✖ ${String(failed)} شیء آینه نشد — این جفت کامل نیست.`);
    process.exit(1);
  }
  console.log(
    `\n✔ جفتِ پیوندخورده: ${db.key} ↔ ${mirror.manifestKey ?? "?"}` +
      "\n⚠️ این هنوز «پشتیبان» نیست — تا وقتی `infra:restore-drill` و `infra:restore-storage` سبز نشوند.",
  );
}

await main();
