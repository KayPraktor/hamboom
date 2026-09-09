/**
 * ★★★ مشقِ بازیابی — M5 گام ۷٫۲. **گیتِ اصلیِ فاز ۷.**
 *
 * ```bash
 * pnpm infra:restore-drill              # آخرین پشتیبانِ باکت را واقعاً برمی‌گرداند
 * pnpm infra:restore-drill -- --key=pg/hamboom-….dump
 * pnpm infra:restore-drill -- --self-test   # ★★ پنج سناریو، چهار شکستنِ عمدی
 * ```
 *
 * ── قاعده‌ی این گام ───────────────────────────────────────────────────────
 *
 * **یک پشتیبانِ بازیابی‌نشده پشتیبان نیست.** پس این اسکریپت ادعا نمی‌کند «فایل هست»؛
 * فایل را روی یک دیتابیسِ **خالی** برمی‌گرداند و بعد رویش کار می‌کند.
 *
 * ── ⚠️⚠️ اندازه‌گیری‌ای که شکلِ این گیت را عوض کرد ────────────────────────
 *
 * پیشِ نوشتنِ این فایل، یک dumpِ واقعی عمداً **بریده** شد و بازیابی‌اش امتحان شد.
 * نتیجه: `pg_restore` با کدِ **۱** برگشت — ولی **هر ۳۱ جدول ساخته شده بودند.** یعنی
 * schema کامل بود و فقط داده کم بود.
 *
 * ⇒ گیتی که فقط `db:fk-test` را روی دیتابیسِ بازیابی‌شده اجرا کند، روی یک پشتیبانِ
 * **بریده سبز می‌شود** — چون آن تست ردیف‌های خودش را می‌سازد و rollback می‌کند و به
 * داده‌ی موجود کاری ندارد. پس این‌جا **پنج** چک هست، نه یکی، و خودآزمون ثابت می‌کند هر
 * شکست را چکِ **درست** می‌گیرد (درسِ گیتِ ایمیج در فاز ۴: چکی که هر شکستی را «اثبات»
 * بشمارد، سبزِ دروغین است).
 *
 * ── ★ پنج سناریوی خودآزمون، و برای هر شکست **کدام چک باید بگیردش** ──────
 *
 * | سناریو | انتظار | چکِ مسئول |
 * |---|---|---|
 * | پشتیبانِ سالم | **سبز** | — (وگرنه یک گیتِ «همیشه قرمز» هم خودآزمون را پاس می‌کرد) |
 * | یک بایتِ عوض‌شده | قرمز | `sha256` — خرابی پس از آپلود |
 * | بریده، با مانیفستِ هماهنگ | قرمز | کدِ خروجِ `pg_restore` — دیسکِ پرشده حینِ dump |
 * | ★★ داده‌ی **یک جدول** جا مانده | قرمز | **فقط شمارشِ ردیف** — چهار چکِ دیگر سبز می‌مانند |
 * | ‏`--schema-only` | قرمز | شمارشِ ردیف |
 *
 * ⚠️ سناریوی چهارم هسته‌ی این گیت است: `pg_restore` کدِ **صفر** می‌دهد، ledgerِ
 * migration درست است، و `db:fk-test` **سبز** می‌شود — و پشتیبان یک جدول را
 * کامل از دست داده. هیچ چکِ دیگری نمی‌گیردش.
 *
 * ⚠️ **و یک یافته‌ی خودِ خودآزمون:** انتظارِ اولیه این بود که در سناریوی
 * `--schema-only` هم `db:fk-test` سبز بمانَد. نماند — چون آن اسکریپت یک چکِ
 * صریح دارد که `free`/`pro`/`team` باید فعال باشند، یعنی به **seedِ جدولِ `plans`**
 * تکیه می‌کند. پس اتفاقی یک چکِ داده هم هست، ولی فقط برای یک جدول؛
 * خالی‌بودنِ `boards`/`payments` را نمی‌بیند. برای همین سناریوی چهارم لازم است.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appEnvSchema,
  backupEnvSchema,
  databaseEnvSchema,
  loadEnv,
  s3EnvSchema,
} from "@hamboom/config";
import { createS3ObjectStore } from "@hamboom/storage";

import {
  BACKUP_PREFIX,
  backupStoreConfig,
  countRows,
  listTables,
  rangesFrom,
  readMigrations,
  type BackupManifest,
} from "./backup-common.ts";
import { parseDatabaseUrl, resolvePgTools, type PgConnection, type PgTools } from "./pg-tools.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** شناسه‌ی هر چک — خودآزمون با همین می‌گوید «کدام چک گرفتش». */
export type CheckId = "sha256" | "restore" | "migrations" | "rows" | "fk";

interface Check extends CheckResult {
  id: CheckId;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `DATABASE_URL` با دیتابیسِ عوض‌شده — برای اجرای `db:fk-test` روی مشق. */
export function urlForDatabase(databaseUrl: string, database: string): string {
  const u = new URL(databaseUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * `db:fk-test` را روی دیتابیسِ بازیابی‌شده اجرا می‌کند.
 *
 * ★ چرا همان اسکریپت و نه یک چکِ تازه: آن اسکریپت از M3 رفتارِ **واقعیِ**
 * CASCADE/SET NULL و اتمیک‌بودنِ تراکنش را روی Postgresِ زنده می‌سنجد. اگر بازیابی
 * constraintها را نیاورده باشد، همان‌جا قرمز می‌شود — بدونِ نوشتنِ ادعای دوم.
 */
async function runFkTest(databaseUrl: string): Promise<{ code: number; tail: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS_DIR, "db-fk-test.ts")], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.setEncoding("utf8").on("data", (c: string) => (output += c));
    child.stderr?.setEncoding("utf8").on("data", (c: string) => (output += c));
    child.on("error", reject);
    child.on("close", (code) => {
      const lines = output.trim().split(/\r?\n/);
      resolve({ code: code ?? -1, tail: lines.slice(-3).join(" · ").slice(0, 300) });
    });
  });
}

export interface DrillInput {
  tools: PgTools;
  connection: PgConnection;
  databaseUrl: string;
  /** فایلِ محلیِ dump. */
  dumpFile: string;
  manifest: BackupManifest;
  /** نگه‌داشتنِ دیتابیسِ مشق برای بازرسیِ دستی. */
  keep: boolean;
}

/**
 * پشتیبان را روی یک دیتابیسِ **خالی** برمی‌گرداند و پنج ادعا را می‌سنجد.
 *
 * ⚠️ هیچ چکی زودتر از موعد `return` نمی‌کند: اگر بازیابی بشکند هم بقیه‌ی چک‌ها اجرا و
 * گزارش می‌شوند، وگرنه هر بار فقط **یک** خطا دیده می‌شود و اپراتور چند دور می‌چرخد.
 */
export async function runDrill(input: DrillInput): Promise<Check[]> {
  const { tools, connection, manifest } = input;
  const drillDb = `${connection.database}_restore_drill`;
  if (drillDb === connection.database) {
    throw new Error("‏[hamboom] نامِ دیتابیسِ مشق با دیتابیسِ مبدأ یکی شد — متوقف شد.");
  }

  const checks: Check[] = [];
  const add = (id: CheckId, name: string, ok: boolean, detail: string): void => {
    checks.push({ id, name, ok, detail });
  };

  // ── ۱: تمامیتِ بایت‌ها ────────────────────────────────────────────────
  const bytes = await readFile(input.dumpFile);
  const actualSha = sha256(bytes);
  add(
    "sha256",
    "بایت‌های پشتیبان با مانیفست می‌خوانند (sha256)",
    actualSha === manifest.sha256 && bytes.length === manifest.bytes,
    actualSha === manifest.sha256 && bytes.length === manifest.bytes
      ? `${String(bytes.length)} بایت · ${actualSha.slice(0, 16)}…`
      : `مانیفست: ${String(manifest.bytes)}B/${manifest.sha256.slice(0, 16)}… · ` +
          `واقعی: ${String(bytes.length)}B/${actualSha.slice(0, 16)}…`,
  );

  // ── دیتابیسِ خالی ─────────────────────────────────────────────────────
  // ⚠️ `WITH (FORCE)` اتصالِ باقی‌مانده‌ی یک اجرای نیمه‌تمام را قطع می‌کند؛ بدونش
  //    دومین اجرا با «database is being accessed by other users» می‌مُرد.
  await tools.psql("postgres", `DROP DATABASE IF EXISTS "${drillDb}" WITH (FORCE)`);
  await tools.psql("postgres", `CREATE DATABASE "${drillDb}"`);

  try {
    // ── ۲: خودِ بازیابی ────────────────────────────────────────────────
    const restore = await tools.restore(
      drillDb,
      ["--no-owner", "--no-privileges", "--exit-on-error"],
      input.dumpFile,
    );
    add(
      "restore",
      "‏pg_restore با کدِ صفر تمام می‌شود",
      restore.code === 0,
      restore.code === 0
        ? `دیتابیسِ «${drillDb}» از پشتیبان ساخته شد`
        : `کدِ ${String(restore.code)} · ${restore.stderr.trim().split(/\r?\n/).slice(-2).join(" · ").slice(0, 260)}`,
    );

    // ── ۳: همان نقطه‌ی migration ───────────────────────────────────────
    let restoredMigrations: Record<string, string> = {};
    try {
      restoredMigrations = await readMigrations(tools, drillDb);
    } catch (error) {
      restoredMigrations = {};
      void error;
    }
    const expectedNames = Object.keys(manifest.migrations).sort();
    const actualNames = Object.keys(restoredMigrations).sort();
    const sameLedger =
      expectedNames.length === actualNames.length &&
      expectedNames.every(
        (n, i) => actualNames[i] === n && restoredMigrations[n] === manifest.migrations[n],
      );
    add(
      "migrations",
      "‏schema_migrations دقیقاً همان نقطه‌ی زمانِ dump است (نام + checksum)",
      sameLedger,
      sameLedger
        ? `${String(expectedNames.length)} migration، هم‌نام و هم‌checksum`
        : `انتظار ${String(expectedNames.length)} · واقعی ${String(actualNames.length)}` +
            (actualNames.length === 0 ? " (جدول اصلاً بازیابی نشد)" : ""),
    );

    // ── ۴: ★★ داده، نه فقط شکل ─────────────────────────────────────────
    const tables = Object.keys(manifest.rows).sort();
    let restoredCounts: Record<string, number> = {};
    try {
      const present = await listTables(tools, drillDb);
      restoredCounts = await countRows(
        tools,
        drillDb,
        tables.filter((t) => present.includes(t)),
      );
    } catch (error) {
      restoredCounts = {};
      void error;
    }
    const mismatches: string[] = [];
    for (const table of tables) {
      const range = manifest.rows[table];
      if (range === undefined) continue;
      const actual = restoredCounts[table];
      if (actual === undefined) {
        mismatches.push(`${table}: جدول نیست (انتظار ${String(range.min)})`);
      } else if (actual < range.min || actual > range.max) {
        const want =
          range.min === range.max ? String(range.min) : `${String(range.min)}…${String(range.max)}`;
        mismatches.push(`${table}: ${String(actual)} ≠ ${want}`);
      }
    }
    const nonEmpty = tables.filter((t) => (manifest.rows[t]?.max ?? 0) > 0).length;
    // ⚠️ پشتیبانِ یک دیتابیسِ خالی هیچ چیزی را اثبات نمی‌کند — مشق روی آن **بی‌معنا** است.
    const vacuous = nonEmpty === 0;
    add(
      "rows",
      "★★ شمارشِ ردیفِ هر جدول داخلِ بازه‌ی مانیفست است (داده واقعاً برگشته)",
      mismatches.length === 0 && !vacuous,
      vacuous
        ? "همه‌ی جدول‌های مانیفست خالی‌اند — پشتیبانِ دیتابیسِ خالی چیزی را اثبات نمی‌کند"
        : mismatches.length === 0
          ? `${String(tables.length)} جدول · ${String(nonEmpty)} جدولِ دارای داده، همه در بازه`
          : `${String(mismatches.length)} ناهم‌خوانی: ${mismatches.slice(0, 4).join(" · ")}`,
    );

    // ── ۵: رفتارِ واقعیِ schemaی بازیابی‌شده ────────────────────────────
    const fk = await runFkTest(urlForDatabase(input.databaseUrl, drillDb));
    add(
      "fk",
      "‏db:fk-test روی دیتابیسِ بازیابی‌شده سبز است (CASCADE/SET NULL/اتمیک)",
      fk.code === 0,
      fk.code === 0
        ? "هر ۱۰ چکِ FK روی نسخه‌ی بازیابی‌شده سبز"
        : `کدِ ${String(fk.code)} · ${fk.tail}`,
    );

    return checks;
  } finally {
    if (input.keep) {
      console.log(`    (دیتابیسِ «${drillDb}» عمداً نگه داشته شد — --keep)`);
    } else {
      await tools
        .psqlRaw("postgres", `DROP DATABASE IF EXISTS "${drillDb}" WITH (FORCE)`)
        .catch(() => undefined);
    }
  }
}

function report(checks: Check[]): number {
  for (const c of checks) console.log(`${c.ok ? "✔" : "✖"} ${c.name}\n    ${c.detail}`);
  return checks.filter((c) => !c.ok).length;
}

/** مانیفستی که خودِ فایل را توصیف می‌کند — برای سناریوهای خودآزمون. */
async function manifestFor(
  tools: PgTools,
  connection: PgConnection,
  file: string,
  base: BackupManifest,
): Promise<BackupManifest> {
  const bytes = await readFile(file);
  void tools;
  void connection;
  return { ...base, bytes: bytes.length, sha256: sha256(bytes) };
}

/**
 * ★★ خودآزمون: چهار سناریو، و برای هر شکست **کدام چک** باید بگیردش.
 *
 * ⚠️ صرفِ «قرمز شد» کافی نیست. اگر پشتیبانِ `--schema-only` به‌خاطرِ sha256 قرمز شود،
 * چکِ شمارشِ ردیف هنوز اثبات نشده — همان اشتباهی که فاز ۴ در گیتِ ایمیج گرفت.
 */
async function selfTest(
  tools: PgTools,
  connection: PgConnection,
  databaseUrl: string,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "hamboom-drill-selftest-"));
  const results: CheckResult[] = [];

  try {
    const tables = await listTables(tools, connection.database);
    const migrations = await readMigrations(tools, connection.database);
    const before = await countRows(tools, connection.database, tables);

    const intact = join(dir, "intact.dump");
    const dumpRun = await tools.dump(["-Fc", "-Z", "6"], intact);
    if (dumpRun.code !== 0) throw new Error(`pg_dump شکست خورد: ${dumpRun.stderr.trim()}`);
    const after = await countRows(tools, connection.database, tables);

    const baseManifest: BackupManifest = {
      key: "self-test",
      takenAt: new Date().toISOString(),
      database: connection.database,
      serverVersion: tools.serverVersion,
      clientVersion: tools.clientVersion,
      toolMode: tools.mode,
      bytes: 0,
      sha256: "",
      migrations,
      rows: rangesFrom(before, after),
    };
    const intactManifest = await manifestFor(tools, connection, intact, baseManifest);

    // ── سناریوی ۱: سالم ⇒ باید سبز شود ──────────────────────────────
    {
      const checks = await runDrill({
        tools,
        connection,
        databaseUrl,
        dumpFile: intact,
        manifest: intactManifest,
        keep: false,
      });
      const reds = checks.filter((c) => !c.ok);
      results.push({
        name: "پشتیبانِ سالم ⇒ مشق **سبز** می‌شود",
        ok: reds.length === 0,
        detail:
          reds.length === 0
            ? `هر ${String(checks.length)} چک سبز ⇒ گیت «همیشه قرمز» نیست`
            : `قرمزها: ${reds.map((c) => c.id).join(", ")} — ${reds[0]?.detail ?? ""}`,
      });
    }

    // ── سناریوی ۲: یک بایتِ عوض‌شده ⇒ باید sha256 بگیردش ────────────
    {
      const corrupt = join(dir, "corrupt.dump");
      const bytes = await readFile(intact);
      const middle = Math.floor(bytes.length / 2);
      bytes[middle] = (bytes[middle] ?? 0) ^ 0xff;
      await writeFile(corrupt, bytes);
      const checks = await runDrill({
        tools,
        connection,
        databaseUrl,
        dumpFile: corrupt,
        manifest: intactManifest, // مانیفستِ فایلِ سالم — یعنی «خرابی بعد از آپلود»
        keep: false,
      });
      const caught = checks.find((c) => !c.ok)?.id;
      results.push({
        name: "★ یک بایتِ عوض‌شده ⇒ چکِ **sha256** می‌گیردش",
        ok: checks.some((c) => c.id === "sha256" && !c.ok),
        detail: checks.some((c) => c.id === "sha256" && !c.ok)
          ? "خرابیِ حینِ انتقال/نگهداری پیش از هر تلاشی برای بازیابی دیده شد"
          : `اولین قرمز: ${caught ?? "هیچ — مشق سبز مانْد!"}`,
      });
    }

    // ── سناریوی ۳: بریده، با مانیفستِ هماهنگ ⇒ باید pg_restore بگیردش ─
    {
      const cut = join(dir, "cut.dump");
      await writeFile(cut, await readFile(intact));
      const { size } = await stat(cut);
      await truncate(cut, Math.floor(size * 0.55));
      const cutManifest = await manifestFor(tools, connection, cut, baseManifest);
      const checks = await runDrill({
        tools,
        connection,
        databaseUrl,
        dumpFile: cut,
        manifest: cutManifest,
        keep: false,
      });
      const shaOk = checks.find((c) => c.id === "sha256")?.ok === true;
      const restoreRed = checks.some((c) => c.id === "restore" && !c.ok);
      results.push({
        name: "★ پشتیبانِ بریده (مانیفستِ هماهنگ) ⇒ چکِ **کدِ خروجِ pg_restore** می‌گیردش",
        ok: shaOk && restoreRed,
        detail:
          shaOk && restoreRed
            ? "sha256 سبز مانْد (مثلِ دیسکِ پرشده حینِ dump) و بازیابی قرمز شد"
            : `sha256=${String(shaOk)} · restoreقرمز=${String(restoreRed)}`,
      });
    }

    // ── سناریوی ۴: ★★ داده‌ی **یک جدول** بی‌صدا جا مانده ────────────────
    //
    // این تنها سناریویی است که **فقط** چکِ شمارشِ ردیف می‌گیردش: بازیابی کدِ صفر
    // می‌دهد، ledgerِ migration درست است، و `db:fk-test` هم سبز است. دقیقاً همان
    // چیزی که یک گیتِ ساده‌لوح از دستش می‌داد.
    //
    // ⚠️ جدولِ هدف `otp_challenges` است و انتخابش دلیل دارد: **برگ** است (نه FKی
    //    به آن، نه از آن) پس نبودِ داده‌اش بازیابی را نمی‌شکند. اگر مثلاً `users`
    //    را خالی می‌کردیم، ساختِ FKهای `boards`/`teams` می‌شکست و چکِ `restore`
    //    قرمز می‌شد — یعنی سناریو دیگر «فقط rows» را اثبات نمی‌کرد.
    {
      const sentinelId = randomUUID();
      await tools.psql(
        connection.database,
        "INSERT INTO otp_challenges (id, purpose, channel, destination, code_hash, expires_at) " +
          `VALUES ('${sentinelId}', 'restore-drill', 'sms', 'self-test', 'x', now() + interval '1 hour')`,
      );
      try {
        const partial = join(dir, "partial.dump");
        const run = await tools.dump(
          ["-Fc", "-Z", "6", "--exclude-table-data=otp_challenges"],
          partial,
        );
        if (run.code !== 0)
          throw new Error(`pg_dump --exclude-table-data شکست خورد: ${run.stderr.trim()}`);
        // مانیفست از دیتابیسِ **کامل** خوانده می‌شود — همان کاری که backup-db می‌کند.
        const tablesNow = await listTables(tools, connection.database);
        const countsNow = await countRows(tools, connection.database, tablesNow);
        const partialManifest = await manifestFor(tools, connection, partial, {
          ...baseManifest,
          migrations: await readMigrations(tools, connection.database),
          rows: rangesFrom(countsNow, countsNow),
        });
        const checks = await runDrill({
          tools,
          connection,
          databaseUrl,
          dumpFile: partial,
          manifest: partialManifest,
          keep: false,
        });
        const restoreOk = checks.find((c) => c.id === "restore")?.ok === true;
        const fkOk = checks.find((c) => c.id === "fk")?.ok === true;
        const migrationsOk = checks.find((c) => c.id === "migrations")?.ok === true;
        const rowsRed = checks.some((c) => c.id === "rows" && !c.ok);
        const ok = restoreOk && fkOk && migrationsOk && rowsRed;
        results.push({
          name: "★★ داده‌ی یک جدول جا مانده ⇒ **فقط** چکِ شمارشِ ردیف می‌گیردش",
          ok,
          detail: ok
            ? "pg_restore کدِ صفر داد، ledger درست بود و db:fk-test سبز شد — و مشق باز قرمز است ⇒ چکِ ردیف لازم است، نه تزئینی"
            : `restoreسبز=${String(restoreOk)} · migrationsسبز=${String(migrationsOk)} · ` +
              `fkسبز=${String(fkOk)} · rowsقرمز=${String(rowsRed)}`,
        });
      } finally {
        await tools
          .psqlRaw(connection.database, `DELETE FROM otp_challenges WHERE id = '${sentinelId}'`)
          .catch(() => undefined);
      }
    }

    // ── سناریوی ۵: فقط schema ⇒ هیچ داده‌ای برنمی‌گردد ──────────────────
    //
    // ⚠️ **یافته‌ی این خودآزمون:** این‌جا `db:fk-test` هم قرمز می‌شود، و انتظارِ اولیه‌ی
    //    من غلط بود. علتش هم اتفاقی نیست: آن اسکریپت یک چکِ صریح دارد که
    //    `free`/`pro`/`team` باید **فعال** باشند — یعنی به seedِ جدولِ `plans` تکیه
    //    می‌کند. پس تصادفاً یک چکِ داده هم هست، ولی **فقط برای `plans`**؛ خالی‌بودنِ
    //    `boards`/`payments` را نمی‌بیند. برای همین سناریوی ۴ لازم است.
    {
      const schemaOnly = join(dir, "schema-only.dump");
      const run = await tools.dump(["-Fc", "-Z", "6", "--schema-only"], schemaOnly);
      if (run.code !== 0) throw new Error(`pg_dump --schema-only شکست خورد: ${run.stderr.trim()}`);
      const soManifest = await manifestFor(tools, connection, schemaOnly, baseManifest);
      const checks = await runDrill({
        tools,
        connection,
        databaseUrl,
        dumpFile: schemaOnly,
        manifest: soManifest,
        keep: false,
      });
      const restoreOk = checks.find((c) => c.id === "restore")?.ok === true;
      const rowsRed = checks.some((c) => c.id === "rows" && !c.ok);
      results.push({
        name: "پشتیبانِ فقط-schema ⇒ بازیابی کدِ صفر می‌دهد ولی مشق قرمز است",
        ok: restoreOk && rowsRed,
        detail:
          restoreOk && rowsRed
            ? "pg_restore موفق بود و schema بی‌نقص — سبزِ دروغینی که فقط چکِ داده می‌گیردش"
            : `restoreسبز=${String(restoreOk)} · rowsقرمز=${String(rowsRed)}`,
      });
    }

    console.log("\n── خودآزمونِ مشقِ بازیابی ──");
    for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
    const reds = results.filter((r) => !r.ok);
    if (reds.length > 0) {
      console.error(`\n✖ خودآزمون شکست: ${String(reds.length)} سناریو — این گیت قابلِ اتکا نیست.`);
      process.exit(1);
    }
    console.log("\n✔ هر چهار شکستِ عمدی را چکِ **درست** گرفت، و پشتیبانِ سالم سبز مانْد.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function argValue(argv: string[], name: string): string | undefined {
  const arg = argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const env = loadEnv(appEnvSchema.and(databaseEnvSchema).and(s3EnvSchema).and(backupEnvSchema));
  const connection = parseDatabaseUrl(env.DATABASE_URL);
  const tools = await resolvePgTools({ connection });
  console.log(tools.describe());

  if (argv.includes("--self-test")) {
    // ⚠️ خودآزمون یک ردیفِ سنتینل در `otp_challenges`ِ **مبدأ** می‌نویسد (و پاکش
    //    می‌کند). روی دیتابیسِ واقعی این کار انجام نمی‌شود — گیتِ خودِ گیت.
    if (env.APP_ENV === "production") {
      console.error(
        "✖ `--self-test` روی `APP_ENV=production` اجرا نمی‌شود: در دیتابیسِ مبدأ می‌نویسد.\n" +
          "    روی production فقط خودِ مشق را بزن:  pnpm infra:restore-drill",
      );
      process.exit(1);
    }
    await selfTest(tools, connection, env.DATABASE_URL);
    return;
  }

  const store = createS3ObjectStore(backupStoreConfig(env));
  let key = argValue(argv, "key");
  if (key === undefined) {
    const keys = (await store.listPrefix(BACKUP_PREFIX)).filter((k) => k.endsWith(".dump")).sort();
    key = keys.at(-1);
    if (key === undefined) {
      console.error(
        `✖ هیچ پشتیبانی زیرِ «${BACKUP_PREFIX}» در باکتِ «${env.S3_BUCKET_BACKUPS}» نیست.\n` +
          "    اول یکی بساز:  pnpm infra:backup",
      );
      process.exit(1);
    }
    console.log(`آخرین پشتیبان: ${key}  (از ${String(keys.length)} تا)`);
  }

  const manifestKey = key.replace(/\.dump$/, ".json");
  const manifestBytes = await store.getObject(manifestKey);
  if (manifestBytes === null) {
    console.error(
      `✖ مانیفستِ «${manifestKey}» نیست. بدونِ آن انتظاراتِ مشق از کجا بیاید؟\n` +
        "    یک پشتیبانِ بی‌مانیفست، پشتیبانی است که هیچ ادعایی درباره‌ی خودش ندارد.",
    );
    process.exit(1);
  }
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as BackupManifest;

  const dumpBytes = await store.getObject(key);
  if (dumpBytes === null) {
    console.error(`✖ خودِ فایلِ «${key}» خوانده نشد.`);
    process.exit(1);
  }

  const dir = await mkdtemp(join(tmpdir(), "hamboom-drill-"));
  const dumpFile = join(dir, "restore.dump");
  try {
    await writeFile(dumpFile, Buffer.from(dumpBytes));
    console.log(
      `پشتیبانِ ${manifest.takenAt} · ${String(manifest.bytes)} بایت · ` +
        `سرورِ مبدأ ${manifest.serverVersion}`,
    );

    const checks = await runDrill({
      tools,
      connection,
      databaseUrl: env.DATABASE_URL,
      dumpFile,
      manifest,
      keep: argv.includes("--keep"),
    });
    const reds = report(checks);
    if (reds > 0) {
      console.error(`\n✖ ${String(reds)} چک قرمز شد — این پشتیبان قابلِ اتکا نیست.`);
      process.exit(1);
    }
    console.log("\n✔ پشتیبان روی یک دیتابیسِ خالی بازیابی شد و رفتارِ واقعی‌اش اثبات شد.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await main();
