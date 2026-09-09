/**
 * ★★★ جاروبِ بلابِ یتیم — M5 گام ۸٫۲. **خطرناک‌ترین اسکریپتِ این ریپو.**
 *
 * ```bash
 * pnpm infra:sweep-orphans                 # ★ فقط گزارش — هیچ چیزی پاک نمی‌شود
 * pnpm infra:sweep-orphans -- --delete     # ⚠️ واقعاً پاک می‌کند
 * pnpm infra:sweep-orphans -- --self-test  # ★★ چهار سناریو
 * ```
 *
 * ── نشتی‌ای که از M3 ثبت شده بود ──────────────────────────────────────────
 *
 * حذفِ یک بورد ردیف‌های `board_snapshots`/`files` را CASCADE می‌کند ولی **بلابِ S3 را
 * پاک نمی‌کند**. هیچ‌کس هم بعداً پیدایش نمی‌کند، چون تنها فهرستِ کلیدها همان ردیف‌هایی
 * بودند که رفتند. این اسکریپت آن نشتی را می‌بندد.
 *
 * ── ⚠️⚠️ چرا این اسکریپت با بقیه فرق دارد ────────────────────────────────
 *
 * بقیه‌ی سنجه‌های این ریپو بدترین حالتشان یک گزارشِ غلط است. این یکی **داده‌ی کاربر را
 * پاک می‌کند** و برگشتی ندارد. پس چهار محافظ دارد و هیچ‌کدام اختیاری نیستند:
 *
 * ۱. **پیش‌فرض هیچ چیزی پاک نمی‌شود.** حذف فقط با `--delete`ِ صریح.
 * ۲. ★★ **دوره‌ی مهلت** (`--min-age-hours`، پیش‌فرض ۲۴). یک شیء بدونِ ردیف، دو چیزِ
 *    کاملاً متفاوت می‌تواند باشد: زباله‌ی ماه‌ها پیش، یا آپلودی که **همین حالا** تمام
 *    شده و ردیفش هنوز commit نشده. تنها چیزی که این دو را جدا می‌کند سنِ شیء است —
 *    و به همین دلیل [`ObjectHead.lastModified`](../packages/storage/src/object-store.ts)
 *    در همین فاز به پورت اضافه شد. بدونِ آن، جاروبِ ایمن **قابلِ نوشتن نبود**.
 * ۳. ★ **هیچ چیزی روی ابهام پاک نمی‌شود** ([ADR-056](../ARCHITECTURE_DECISIONS.md#adr-056)):
 *    اگر سنِ شیء معلوم نباشد، رد می‌شود و **گزارش** می‌شود.
 * ۴. ★ **مرجعِ ردیف‌ها پیش از فهرستِ اشیاء خوانده می‌شود.** برعکسش یک پنجره‌ی مسابقه
 *    می‌سازد: شیئی که بعد از خواندنِ ردیف‌ها ساخته شده در فهرست می‌آید، ولی ردیفش در
 *    مرجع نیست ⇒ یتیمِ کاذب. با این ترتیب، هر ردیفی که بعداً ساخته شود، شیئش هم
 *    **بعد** از فهرست می‌آید و اصلاً دیده نمی‌شود.
 *
 * ⚠️ **و ردیفِ حذف‌نرم‌شده یتیم نیست.** `files.deleted_at` و `boards.deleted_at` هنوز
 * ردیف‌اند، پس بلابشان مرجع دارد. تبدیلشان به یتیم کارِ **گام ۸٫۱** است (purge)، که
 * عددش تصمیمِ مالک است (M5-D9). این دو گام عمداً به همین ترتیب زنجیر شده‌اند.
 */
import { backupEnvSchema, databaseEnvSchema, loadEnv, s3EnvSchema } from "@hamboom/config";
import { createS3ObjectStore } from "@hamboom/storage";
import pg from "pg";

import { createDbPool } from "../apps/api/src/plugins/db.ts";
import { deleteOrphans, planSweep, WARN_OBJECTS, type SweepPlan } from "./sweep-orphans-core.ts";

/** همه‌ی کلیدهایی که دیتابیس می‌شناسد — **شاملِ ردیف‌های حذف‌نرم‌شده**. */
async function referencedKeys(
  pool: pg.Pool,
): Promise<{ assets: Set<string>; snapshots: Set<string> }> {
  // ⚠️ بدونِ `deleted_at IS NULL`: ردیفِ در سطلِ بازیافت هنوز ردیف است و بلابش
  //    باید بمانَد. پاک‌کردنش کارِ گام ۸٫۱ است، نه این.
  const assets = await pool.query<{ storage_key: string }>("SELECT storage_key FROM files");
  const snapshots = await pool.query<{ storage_key: string }>(
    "SELECT storage_key FROM board_snapshots",
  );
  return {
    assets: new Set(assets.rows.map((r) => r.storage_key)),
    snapshots: new Set(snapshots.rows.map((r) => r.storage_key)),
  };
}

function numberArg(name: string, fallback: number): number {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (arg === undefined) return fallback;
  const value = Number(arg.split("=")[1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`‏[hamboom] --${name} باید عددی نامنفی باشد.`);
  }
  return value;
}

function report(plan: SweepPlan): void {
  const bytes = plan.orphans.reduce((n, o) => n + o.bytes, 0);
  console.log(`\n── ${plan.bucket} ──`);
  console.log(`  دارای مرجع        : ${String(plan.referenced)}`);
  console.log(`  جوان‌تر از مهلت    : ${String(plan.tooYoung.length)}  (دست‌نخورده)`);
  if (plan.unknownAge.length > 0) {
    console.log(`  ⚠️ سنِ نامعلوم     : ${String(plan.unknownAge.length)}  (دست‌نخورده — ابهام)`);
    for (const k of plan.unknownAge.slice(0, 5)) console.log(`      ${k}`);
  }
  console.log(
    `  ★ یتیم            : ${String(plan.orphans.length)}` +
      (plan.orphans.length === 0 ? "" : `  (${String(Math.round(bytes / 1024))}KB)`),
  );
  for (const o of plan.orphans.slice(0, 10)) {
    console.log(`      ${o.key}  ·  ${o.ageHours.toFixed(1)} ساعت  ·  ${String(o.bytes)}B`);
  }
  if (plan.orphans.length > 10)
    console.log(`      … و ${String(plan.orphans.length - 10)} تای دیگر`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    const { runSelfTest } = await import("./sweep-orphans.self-test.ts");
    await runSelfTest();
    return;
  }

  const env = loadEnv(databaseEnvSchema.and(s3EnvSchema).and(backupEnvSchema));
  const doDelete = argv.includes("--delete");
  const minAgeHours = numberArg("min-age-hours", 24);

  const pool = createDbPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: 4,
  });

  try {
    // ★ محافظِ ۴: **اول** مرجع، بعد فهرستِ اشیاء. برعکسش یتیمِ کاذب می‌سازد.
    const refs = await referencedKeys(pool);
    const base = {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      defaultPresignTtl: env.S3_PRESIGN_TTL_SECONDS,
    };
    const now = Date.now();

    console.log(
      `مهلت: ${String(minAgeHours)} ساعت · حالت: ${doDelete ? "⚠️ حذفِ واقعی" : "فقط گزارش"}`,
    );

    const plans: SweepPlan[] = [];
    for (const [bucket, keys] of [
      [env.S3_BUCKET_ASSETS, refs.assets],
      [env.S3_BUCKET_SNAPSHOTS, refs.snapshots],
    ] as const) {
      const store = createS3ObjectStore({ ...base, bucket });
      const plan = await planSweep(store, bucket, keys, now, minAgeHours);
      plans.push(plan);
      report(plan);

      if (doDelete) {
        const removed = await deleteOrphans(store, plan);
        if (removed.length > 0) {
          console.log(`  ✔ ${String(removed.length)} شیء از «${bucket}» پاک شد.`);
        }
      }
    }

    const totalObjects = plans.reduce(
      (n, p) => n + p.referenced + p.tooYoung.length + p.unknownAge.length + p.orphans.length,
      0,
    );
    if (totalObjects > WARN_OBJECTS) {
      console.warn(
        `\n⚠️ ${String(totalObjects)} شیء فهرست شد و همه در حافظه نگه داشته شدند. ` +
          "بالای این مقیاس باید صفحه‌به‌صفحه شود — سقف در TODOی M5 ثبت است.",
      );
    }

    const totalOrphans = plans.reduce((n, p) => n + p.orphans.length, 0);
    if (!doDelete && totalOrphans > 0) {
      console.log(
        `\n⊘ هیچ چیزی پاک نشد. برای حذفِ واقعیِ این ${String(totalOrphans)} شیء: \`-- --delete\`` +
          "\n⚠️ اول همین فهرست را بخوان. حذف برگشت ندارد.",
      );
    } else if (totalOrphans === 0) {
      console.log("\n✔ هیچ بلابِ یتیمی پیدا نشد.");
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
