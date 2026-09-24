/**
 * ★ پشتیبانِ Object Storage (اسنپ‌شات‌ها و دارایی‌ها) — M5 گام ۷٫۴، بازنویسی در M6 فاز ۲٫۲.
 *
 * ```bash
 * pnpm infra:backup-storage              # آینه‌کردنِ افزایشی + مانیفستِ امروز (با sha256)
 * pnpm infra:backup-storage -- --dry-run # فقط بگو چه می‌کردی
 * pnpm infra:backup-storage -- --self-test # ★ پنج سناریو روی انبارِ حافظه‌ای
 * ```
 *
 * ── ⚠️ چرا پشتیبانِ دیتابیس به‌تنهایی کافی نیست ───────────────────────────
 *
 * `board_snapshots` در دیتابیس فقط **اشاره‌گر** است؛ خودِ بایت‌های سند در باکتِ
 * `snapshots` است و تصویرهای کاربر در `assets`. یک بازیابیِ کاملِ دیتابیس با باکتِ
 * از‌دست‌رفته یعنی بوردهایی که ردیف دارند و محتوا ندارند — و آن حالت **از نبودِ
 * پشتیبان بدتر** است، چون شبیهِ سالم به‌نظر می‌رسد. و بعد از فشرده‌سازی، updateهای پیش
 * از snapshot از `board_updates` **حذف** شده‌اند — محتوای بورد تا `seq_upto` فقط این‌جاست.
 *
 * ── شکلِ آینه: مسیرِ **پایدار** + مانیفستِ **تاریخ‌دار** ────────────────────
 *
 * هر شیء **یک بار** به `storage/<bucket>/<key>` کپی می‌شود و «وضعیتِ آن لحظه» با
 * `{key,size,sha256}` در `storage/manifest-<زمان>.json` ثبت می‌شود. ⚠️ شیئی که کاربر
 * **حذف** کرده از آینه پاک نمی‌شود؛ عمدی است — پشتیبان باید از حذفِ اشتباهی هم محافظت
 * کند. نگهداشتِ آینه یک عددِ سیاستی است که هنوز تصمیمِ مالک نشده (TODO-M6 §عددها).
 *
 * ★ سقفِ M5 («هر شیء کامل در حافظه») برداشته شد: استریم + hashِ حینِ عبور
 * ([`backup-run.ts`](backup-run.ts)). ⛔ **Redis عمداً پشتیبان نمی‌گیرد** — حالتِ گذراست.
 */
import { backupEnvSchema, loadEnv, s3EnvSchema } from "@hamboom/config";

import { runStorageMirror } from "./backup-run.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    const { runSelfTest } = await import("./backup-storage.self-test.ts");
    await runSelfTest();
    return;
  }
  const env = loadEnv(s3EnvSchema.and(backupEnvSchema));
  const { results } = await runStorageMirror(env, { dryRun: argv.includes("--dry-run") });

  const failed = results.reduce((n, r) => n + r.failed.length, 0);
  if (failed > 0) {
    console.error(`\n✖ ${String(failed)} شیء آینه نشد — این پشتیبان کامل نیست.`);
    process.exit(1);
  }
  const total = results.reduce((n, r) => n + r.entries.length, 0);
  console.log(
    total === 0
      ? "\n⚠️ هیچ شیئی در باکت‌های مبدأ نبود — پس این اجرا چیزی را اثبات نکرد."
      : `\n✔ ${String(total)} شیء در آینه هست، اندازه‌ی هرکدام سمتِ مقصد خوانده شد و sha256ش در مانیفست است.` +
          "\n⚠️ این هنوز «پشتیبان» نیست — تا وقتی `pnpm infra:restore-storage` سبز نشود.",
  );
}

await main();
