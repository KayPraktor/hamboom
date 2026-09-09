/**
 * ★ پشتیبانِ Object Storage (اسنپ‌شات‌ها و دارایی‌ها) — M5 گام ۷٫۴.
 *
 * ```bash
 * pnpm infra:backup-storage              # آینه‌کردنِ افزایشی + مانیفستِ امروز
 * pnpm infra:backup-storage -- --dry-run # فقط بگو چه می‌کردی
 * ```
 *
 * ── ⚠️ چرا پشتیبانِ دیتابیس به‌تنهایی کافی نیست ───────────────────────────
 *
 * `board_snapshots` در دیتابیس فقط **اشاره‌گر** است؛ خودِ بایت‌های سند در باکتِ
 * `snapshots` است و تصویرهای کاربر در `assets`. یک بازیابیِ کاملِ دیتابیس با باکتِ
 * از‌دست‌رفته یعنی بوردهایی که ردیف دارند و محتوا ندارند — و آن حالت **از نبودِ
 * پشتیبان بدتر** است، چون شبیهِ سالم به‌نظر می‌رسد.
 *
 * ── شکلِ آینه: مسیرِ **پایدار** + مانیفستِ **تاریخ‌دار** ────────────────────
 *
 * کپیِ کاملِ روزانه یعنی هزینه‌ی خطی در تعدادِ روزها، و چون کلیدها تغییرناپذیرند
 * بیشترش تکرارِ همان بایت‌هاست. پس:
 *
 * ‏  • هر شیء **یک بار** به `storage/<bucket>/<key>` کپی می‌شود (اگر با همان اندازه
 *     آن‌جا باشد، رد می‌شود)،
 * ‏  • و «وضعیتِ آن لحظه» در `storage/manifest-<زمان>.json` ثبت می‌شود.
 *
 * ⇒ بازیابیِ «به‌حالتِ روزِ X» یعنی خواندنِ مانیفستِ آن روز و برداشتنِ همان کلیدها از
 * آینه. ⚠️ شیئی که کاربر **حذف** کرده از آینه پاک نمی‌شود؛ عمدی است — پشتیبان باید از
 * حذفِ اشتباهی هم محافظت کند. پاک‌سازیِ آینه کارِ سیاستِ نگهداشت است (فاز ۸، M5-D9).
 *
 * ── ⚠️ سقف، همان سقفِ `backup-db` ────────────────────────────────────────
 *
 * پورتِ `ObjectStore` نه stream دارد نه کپیِ سمتِ سرور، پس هر شیء از این فرایند رد
 * می‌شود (get سپس put). برای اسنپ‌شات‌ها و تصویرهای ≤۱۰MB امروز درست است؛ سقفش در
 * TODOی M5 ثبت است، نه پنهان.
 *
 * ⛔ **Redis عمداً پشتیبان نمی‌گیرد** — حالتِ گذراست (حضور، pub/sub). از دست رفتنش
 * یعنی کاربران یک بار دوباره وصل می‌شوند، نه اینکه چیزی گم شود.
 */
import { backupEnvSchema, loadEnv, s3EnvSchema } from "@hamboom/config";
import type { ObjectStore } from "@hamboom/storage";
import { createS3ObjectStore, ensureBucket } from "@hamboom/storage";

import { backupStoreConfig, stampNow } from "./backup-common.ts";

export const MIRROR_PREFIX = "storage/";

interface MirrorEntry {
  key: string;
  size: number;
}

interface MirrorResult {
  bucket: string;
  copied: number;
  skipped: number;
  failed: string[];
  entries: MirrorEntry[];
}

/**
 * یک باکت را به `storage/<bucket>/…` آینه می‌کند.
 *
 * ★ **هر کپی بلافاصله خوانده می‌شود** (`headObject`)، وگرنه «آپلود شد» فقط یک ادعاست —
 * همان قاعده‌ای که `backup-db` روی dump اجرا می‌کند.
 */
export async function mirrorBucket(
  source: ObjectStore,
  target: ObjectStore,
  bucketName: string,
  dryRun: boolean,
): Promise<MirrorResult> {
  const keys = await source.listPrefix("");
  const result: MirrorResult = {
    bucket: bucketName,
    copied: 0,
    skipped: 0,
    failed: [],
    entries: [],
  };

  for (const key of keys) {
    const sourceHead = await source.headObject(key);
    if (sourceHead === null) continue; // بینِ list و head حذف شده — عادی است
    result.entries.push({ key, size: sourceHead.size });

    const mirrorKey = `${MIRROR_PREFIX}${bucketName}/${key}`;
    const existing = await target.headObject(mirrorKey);
    if (existing !== null && existing.size === sourceHead.size) {
      result.skipped += 1;
      continue;
    }
    if (dryRun) {
      result.copied += 1;
      continue;
    }

    const body = await source.getObject(key);
    if (body === null) {
      result.failed.push(`${key} (بینِ head و get ناپدید شد)`);
      continue;
    }
    await target.putObject(mirrorKey, body, {
      contentType: sourceHead.contentType ?? "application/octet-stream",
    });
    const check = await target.headObject(mirrorKey);
    if (check === null || check.size !== sourceHead.size) {
      result.failed.push(
        `${key} (اندازه‌ی آینه ${check === null ? "نیست" : String(check.size)} ≠ ${String(sourceHead.size)})`,
      );
      continue;
    }
    result.copied += 1;
  }

  return result;
}

async function main(): Promise<void> {
  const env = loadEnv(s3EnvSchema.and(backupEnvSchema));
  const dryRun = process.argv.slice(2).includes("--dry-run");

  const targetConfig = backupStoreConfig(env);
  const target = createS3ObjectStore(targetConfig);
  await ensureBucket(targetConfig);

  const sources: { name: string; store: ObjectStore }[] = [
    env.S3_BUCKET_SNAPSHOTS,
    env.S3_BUCKET_ASSETS,
  ].map((bucket) => ({
    name: bucket,
    store: createS3ObjectStore({ ...targetConfig, bucket }),
  }));

  if (dryRun) console.log("⊘ --dry-run: چیزی نوشته نمی‌شود.\n");

  const results: MirrorResult[] = [];
  for (const { name, store } of sources) {
    const result = await mirrorBucket(store, target, name, dryRun);
    results.push(result);
    console.log(
      `${result.failed.length === 0 ? "✔" : "✖"} ${name} — ${String(result.entries.length)} شیء · ` +
        `${String(result.copied)} کپی · ${String(result.skipped)} از قبل بود` +
        (result.failed.length === 0 ? "" : ` · ${String(result.failed.length)} شکست`),
    );
    for (const f of result.failed.slice(0, 5)) console.error(`    ✖ ${f}`);
  }

  if (!dryRun) {
    const manifestKey = `${MIRROR_PREFIX}manifest-${stampNow()}.json`;
    await target.putObject(
      manifestKey,
      Buffer.from(
        JSON.stringify(
          {
            takenAt: new Date().toISOString(),
            buckets: Object.fromEntries(results.map((r) => [r.bucket, r.entries])),
          },
          null,
          2,
        ),
        "utf8",
      ),
      { contentType: "application/json" },
    );
    console.log(`\nمانیفستِ این لحظه: ${manifestKey}`);
  }

  const failed = results.reduce((n, r) => n + r.failed.length, 0);
  if (failed > 0) {
    console.error(`\n✖ ${String(failed)} شیء آینه نشد — این پشتیبان کامل نیست.`);
    process.exit(1);
  }
  const total = results.reduce((n, r) => n + r.entries.length, 0);
  console.log(
    total === 0
      ? "\n⚠️ هیچ شیئی در باکت‌های مبدأ نبود — پس این اجرا چیزی را اثبات نکرد."
      : `\n✔ ${String(total)} شیء در آینه هست و اندازه‌ی هرکدام سمتِ مقصد خوانده شد.`,
  );
}

await main();
