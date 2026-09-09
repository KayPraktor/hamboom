/**
 * `pnpm billing:reconcile` — اجرای دستیِ آشتی‌دهی روی دیتابیسِ زنده (M4 فاز ۷ گام ۷٫۲).
 *
 * قرینه‌ی هفت اسکریپتِ `rt:*`: یک ابزارِ **اپراتور** که همان کدی را اجرا می‌کند که پلاگینِ
 * بازه‌ای اجرا می‌کند — نه یک کپیِ دوم. تنها تفاوت، ورودیِ اجراست.
 *
 * ```bash
 * pnpm billing:reconcile                     # با سیاستِ پیش‌فرض
 * pnpm billing:reconcile -- --dry-run        # فقط تصمیم‌ها، بدونِ نوشتن
 * pnpm billing:reconcile -- --stale-minutes=5 --expire-hours=24
 * pnpm billing:reconcile -- --adopt          # ★ فرزندخواندگیِ ردیفِ یتیم (unVerified)
 * ```
 *
 * ★★ **درگاه از همان configی ساخته می‌شود که خودِ api با آن بالا می‌آید.** این عمدی است:
 * آشتی‌دهی باید با **همان** درگاهی حرف بزند که پرداخت را ساخته. اگر این اسکریپت درگاهِ
 * خودش را می‌ساخت، یک اجرای اشتباه می‌توانست ردیف‌های production را از سندباکس بپرسد.
 *
 * ⚠️ **B-3:** استخر با `createDbPool` ساخته می‌شود، نه `new pg.Pool` — وگرنه `amount_rial`
 * رشته می‌شود و بی‌صدا خراب. خودِ `runReconcile` هم قبل از هر کاری این را **می‌سنجد** و
 * روی استخرِ بی‌کوئرس بالا نمی‌آید.
 */
import { loadReconcileConfig } from "../apps/api/src/config.ts";
import { createDbPool } from "../apps/api/src/plugins/db.ts";
import { createPaymentGateway } from "../apps/api/src/plugins/payment.ts";
import {
  DEFAULT_RECONCILE_POLICY,
  runReconcile,
  type ReconcilePolicy,
} from "../apps/api/src/services/reconcile.ts";

/** `--key=value` و `--flag` را می‌خواند. */
function readArgs(argv: readonly string[]): { flags: Set<string>; values: Map<string, string> } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=", 2);
    if (value === undefined) flags.add(key!);
    else values.set(key!, value);
  }
  return { flags, values };
}

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`مقدارِ «${name}» باید عددِ مثبت باشد، نه «${raw}».`);
  }
  return parsed;
}

const { flags, values } = readArgs(process.argv.slice(2));

const policy: ReconcilePolicy = {
  staleAfterMs:
    positiveNumber(
      values.get("stale-minutes"),
      DEFAULT_RECONCILE_POLICY.staleAfterMs / 60_000,
      "stale-minutes",
    ) * 60_000,
  expireAfterMs:
    positiveNumber(
      values.get("expire-hours"),
      DEFAULT_RECONCILE_POLICY.expireAfterMs / 3_600_000,
      "expire-hours",
    ) * 3_600_000,
  batchSize: positiveNumber(values.get("batch"), DEFAULT_RECONCILE_POLICY.batchSize, "batch"),
  adoptOrphans: flags.has("adopt"),
  dryRun: flags.has("dry-run"),
};

// ★ configِ **باریک** — این ابزار `JWT_SECRET` و کلیدهای S3 را نه لازم دارد و نه باید ببیند.
const config = loadReconcileConfig();
const pool = createDbPool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  poolMax: config.DATABASE_POOL_MAX,
});
const gateway = createPaymentGateway(config);

console.log(
  `آشتی‌دهی — درگاه «${gateway.name}/${gateway.mode}» · کهنگی ${policy.staleAfterMs / 60_000} دقیقه · ` +
    `انقضا ${policy.expireAfterMs / 3_600_000} ساعت · دسته ${policy.batchSize}` +
    `${policy.adoptOrphans ? " · با فرزندخواندگی" : ""}${policy.dryRun ? " · آزمایشی" : ""}`,
);

try {
  const report = await runReconcile({ pool, gateway }, policy);

  for (const decision of report.decisions) {
    console.log(
      `  ${decision.action.padEnd(7)} ${decision.paymentId}  (${Math.round(decision.ageMs / 60_000)} دقیقه · ${decision.reason})`,
    );
  }

  console.log(
    [
      "",
      `دیده‌شده: ${report.scanned}`,
      `  زودهنگام (دست‌نخورده): ${report.skipped}`,
      `  ★ فعال‌شده (پولِ گم‌شده پیدا شد): ${report.activated}`,
      `  از قبل تسویه‌شده: ${report.alreadySettled}`,
      `  هنوز پرداخت‌نشده: ${report.stillPending}`,
      `  نامعلوم (درگاه جواب نداد): ${report.unknown}`,
      `  باطل‌شده: ${report.expired}`,
      `  یتیم (بدونِ authority): ${report.orphans}${report.adopted > 0 ? ` · فرزندخوانده: ${report.adopted}` : ""}`,
      `  اشتراکِ پایان‌یافته: ${report.subscriptionsEnded}`,
    ].join("\n"),
  );

  if (report.errors.length > 0) {
    console.error(`\n✖ ${report.errors.length} ردیف خطا داد:`);
    for (const error of report.errors) console.error(`  ${error}`);
    await pool.end();
    process.exit(1);
  }

  console.log("\n✔ آشتی‌دهی تمام شد.");
  await pool.end();
} catch (error) {
  console.error(`✖ آشتی‌دهی اجرا نشد: ${String((error as Error).message)}`);
  await pool.end();
  process.exit(1);
}
