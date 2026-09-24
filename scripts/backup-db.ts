/**
 * ★★ پشتیبانِ روزانه‌ی Postgres → باکتِ **جدا** — M5 گام ۷٫۱ (تصمیمِ M5-D7).
 *
 * ```bash
 * pnpm infra:backup                 # dump → آپلود (استریمی) → راستی‌آزمایی
 * pnpm infra:backup -- --prune=14   # + نگهداشتِ ۱۴ تای آخر
 * pnpm infra:backup-all             # ★ M6: dump + آینه‌ی Object Storage در یک اجرا، جفت‌شده
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
 * ★ M6 فاز ۲: منطق در [`backup-run.ts`](backup-run.ts) است (بدونِ اثرِ جانبی) و آپلود
 * **استریمی** با hashِ حینِ عبور ([ADR-069](../ARCHITECTURE_DECISIONS.md#adr-069)) —
 * سقفِ «کلِ dump در حافظه»ی M5 دیگر وجود ندارد.
 */
import { backupEnvSchema, databaseEnvSchema, loadEnv, s3EnvSchema } from "@hamboom/config";

import { parsePrune, runDbBackup } from "./backup-run.ts";

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema.and(s3EnvSchema).and(backupEnvSchema));
  await runDbBackup(env, { keep: parsePrune(process.argv.slice(2)) });
  console.log("\n⚠️ این هنوز «پشتیبان» نیست — تا وقتی `pnpm infra:restore-drill` سبز نشود.");
}

await main();
