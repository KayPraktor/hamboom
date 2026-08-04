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
 * اجرا: `pnpm db:migrate`
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "infra",
  "sql",
  "migrations",
);

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

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
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
    for (const name of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
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
        ? `همه‌ی migrationها از قبل اعمال شده‌اند (${files.length} فایل).`
        : `✔ ${count} migration اعمال شد.`,
    );
  } finally {
    await client.end();
  }
}

await main();
