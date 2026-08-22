/**
 * اجراکننده‌ی migrationهای SQL خام — [ADR-005](../ARCHITECTURE_DECISIONS.md#adr-005).
 *
 * بدون ORM و بدون تولیدِ خودکار: هر تغییرِ schema یک فایلِ `.sql`ِ قابلِ بازبینی است
 * که **دقیقاً** همان چیزی است که روی دیتابیس اجرا می‌شود.
 *
 * ── سه خاصیتی که این اسکریپت تضمین می‌کند ─────────────────────────────
 *
 * ۱. **ترتیب** — فایل‌ها به ترتیبِ نامِ فایل اجرا می‌شوند.
 * ۲. **یک‌بار اجرا** — هر فایل در `schema_migrations` ثبت می‌شود.
 * ۳. ★ **تغییرناپذیری** — checksum هر فایلِ اجراشده ذخیره می‌شود. اگر کسی
 *    migrationـی را که قبلاً اجرا شده **ویرایش** کند، اسکریپت خطا می‌دهد.
 *    بدونِ این، دیتابیسِ توسعه و production بی‌صدا از هم واگرا می‌شوند و هیچ‌جا
 *    معلوم نمی‌شود — که دقیقاً همان چیزی است که ADR-005 می‌خواست جلویش را بگیرد.
 *
 * ── ★ تعمیمِ M3 فاز ۵٫۱ (DP-1، تاییدِ مالک ۱۴۰۵/۰۵/۲۸): یک رانر، دو پوشه ──
 *
 * تا M2 فقط `infra/sql/migrations` بود (جدول‌های realtime). M3 جدول‌های خودش را در
 * `apps/api/migrations` می‌گذارد (PLAN §۶). به‌جای **دو رانرِ** جدا با تنشِ ترتیب،
 * همین یک رانر هر دو پوشه را با **یک `schema_migrations`** اجرا می‌کند، به ترتیبِ
 * **ثابتِ** `infra` سپس `api` — چون FK-ALTERِ `apps/api` (گام ۵٫۱) به
 * `board_updates`/`board_snapshotsِ` infra وابسته است و باید بعد از آن‌ها بیاید.
 *
 * ★ افزایشی است: بلوکِ infra **بی‌تغییر** می‌ماند (همان نام‌ها، همان checksumها)، پس
 *   M2 دست‌نخورده است. ledger با **نامِ فایل** کلید می‌خورد، پس نام‌ها باید بینِ
 *   پوشه‌ها یکتا باشند — گیتی پایین این را می‌گیرد.
 *
 * اجرا: `pnpm db:migrate`
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ★ ترتیبِ پوشه‌ها **ثابت** است، نه بر اساسِ نام: `infra` قبل از `api`.
 * جدول‌های `board_updates`/`board_snapshots` مالِ M2 اند (`infra/sql/migrations`) و
 * FK-ALTERِ `apps/api` به آن‌ها وابسته است — پس روی دیتابیسِ تازه اول infra، بعد api.
 */
const MIGRATION_DIRS = [
  join(REPO_ROOT, "infra", "sql", "migrations"),
  join(REPO_ROOT, "apps", "api", "migrations"),
];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * پیامِ فارسیِ صریح به‌جای stack traceِ گنگ.
 *
 * معیارِ پذیرشِ گام ۰٫۳: بدونِ داکر نباید crashِ نامفهوم بدهد — باید بگوید
 * دقیقاً چه کاری باید بکنی.
 */
function explainConnectionFailure(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code !== "ECONNREFUSED" && code !== "ENOTFOUND" && code !== "ETIMEDOUT") return null;

  return [
    "‏[hamboom] اتصال به PostgreSQL برقرار نشد — به‌احتمالِ زیاد دیتابیس بالا نیست.",
    "",
    "‏  docker compose -f infra/docker/docker-compose.yml --env-file .env up -d",
    "",
    "‏اگر `.env` نداری، از روی `.env.example` بسازش.",
  ].join("\n");
}

/**
 * فایل‌های migration را از همه‌ی پوشه‌ها به ترتیبِ `MIGRATION_DIRS` جمع می‌کند.
 * درونِ هر پوشه به ترتیبِ نام. پوشه‌ی ناموجود (مثلاً قبل از ساختِ `apps/api`) رد می‌شود.
 */
async function collectMigrations(): Promise<{ name: string; dir: string }[]> {
  const collected: { name: string; dir: string }[] = [];
  const seen = new Map<string, string>(); // نامِ فایل → پوشه، برای گیتِ نامِ تکراری

  for (const dir of MIGRATION_DIRS) {
    let names: string[];
    try {
      names = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "ENOENT") continue;
      throw error;
    }

    for (const name of names) {
      const previousDir = seen.get(name);
      if (previousDir !== undefined) {
        throw new Error(
          `‏[hamboom] نامِ migrationِ تکراری «${name}» در دو پوشه: «${previousDir}» و «${dir}».\n` +
            "‏کلیدِ ledger نامِ فایل است، پس نام‌ها باید بینِ همه‌ی پوشه‌ها یکتا باشند — " +
            "شماره‌ی متفاوت یا پیشوندِ ماژول بگذار.",
        );
      }
      seen.set(name, dir);
      collected.push({ name, dir });
    }
  }

  return collected;
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);

  const migrations = await collectMigrations();
  if (migrations.length === 0) {
    console.log("هیچ migrationـی پیدا نشد.");
    return;
  }

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
  } catch (error) {
    const friendly = explainConnectionFailure(error);
    if (friendly) {
      console.error(friendly);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text        PRIMARY KEY,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    let count = 0;
    for (const { name, dir } of migrations) {
      const sql = await readFile(join(dir, name), "utf8");
      const checksum = sha256(sql);
      const previous = applied.get(name);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `‏[hamboom] migrationِ «${name}» بعد از اجرا ویرایش شده است.\n` +
              "‏یک migrationِ اجراشده تغییرناپذیر است — وگرنه دیتابیسِ تو و بقیه بی‌صدا از هم واگرا می‌شوند.\n" +
              "‏به‌جای ویرایش، یک فایلِ جدید با شماره‌ی بعدی بساز.",
          );
        }
        continue;
      }

      // هر migration در تراکنشِ خودش — نیمه‌کاره ماندن یعنی schema نامعلوم.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          name,
          checksum,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`‏[hamboom] migrationِ «${name}» شکست خورد: ${String(error)}`);
      }

      console.log(`✔ ${name}`);
      count += 1;
    }

    console.log(
      count === 0
        ? `همه‌ی migrationها از قبل اعمال شده‌اند (${migrations.length} فایل).`
        : `✔ ${count} migration اعمال شد.`,
    );
  } finally {
    await client.end();
  }
}

await main();
