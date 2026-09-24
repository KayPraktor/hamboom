/**
 * ★★ اعطا/سلبِ staff — M6 فاز ۳٫۴ ([ADR-066](../ARCHITECTURE_DECISIONS.md#adr-066) §۲).
 *
 * ── چرا اسکریپت، نه SQL و نه env ─────────────────────────────────────────
 *
 * `is_staff` تنها پرچمی است که کلِ پنلِ ادمین را باز می‌کند، و **هیچ نویسنده‌ای نداشت** (واقعیتِ
 * فاز ۰). یک `UPDATE`ِ دستی نه ردی می‌گذارد نه قابلِ تکرار است؛ یک `ADMIN_PHONES` در env یعنی
 * راز/سیاست در فایلِ پیکربندی و دوباره‌بوت برای هر تغییر. این اسکریپت **یک** کار می‌کند و همان
 * را در **یک تراکنش** با ردیفِ `audit_logs` می‌نویسد: عمل شکست بخورد ⇒ هیچ ردیفی؛ ردیف نوشته
 * نشود ⇒ هیچ عملی (خودآزمون همین را با شکستِ عمدیِ INSERTِ audit اثبات می‌کند).
 *
 * ★ از **داخلِ ایمیجِ api** اجرا می‌شود (ADR-062؛ `PRODUCTION_SCRIPTS` + compose `grant-staff`):
 *     docker compose -f infra/docker/docker-compose.prod.yml --profile ops run --rm grant-staff \
 *       node scripts/admin-grant-staff.ts --phone=09XXXXXXXXX [--revoke]
 * لوکال: `pnpm admin:grant-staff -- --phone=09XXXXXXXXX`
 *
 * ⚠️ بدونِ `--phone` بالا نمی‌آید. `actor_user_id` عمداً `NULL` است: اپراتورِ CLI کاربرِ محصول
 * نیست؛ `metadata.source` می‌گوید از کجا آمده. P7: شماره فقط **ماسک** چاپ می‌شود.
 * سلب، `step_up_verified_at` را هم پاک می‌کند — staffِ سابق نباید پنجره‌ی بازی به ارث ببرد.
 *
 * ★ خودآزمون (`--self-test`) روی دیتابیسِ **زنده** داخلِ تراکنشی که rollback می‌شود (الگوی
 * `db:fk-test`): اعطا ⇒ ردیفِ `staff.grant` · تکرار ⇒ بی‌اثر و بی‌ردیف · سلب ⇒ `staff.revoke` +
 * پاک‌شدنِ step-up · و ★ شکستِ عمدیِ نوشتنِ audit ⇒ پرچم **برنمی‌گردد** (اتمیک).
 */
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import type pg from "pg";

import { createDbPool } from "../apps/api/src/plugins/db.ts";

export type StaffChange = "granted" | "revoked" | "unchanged" | "not_found";

/** ارقامِ فارسی/عربی → لاتین (اپراتور ممکن است شماره را فارسی تایپ کند). بدونِ وابستگی به i18n. */
export function normalizePhone(input: string): string | null {
  const latin = input
    .trim()
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return /^09\d{9}$/.test(latin) ? latin : null;
}

/** P7 — همان ماسکِ auth-core: چهار رقمِ اول، دو رقمِ آخر. */
const maskPhone = (phone: string): string => `${phone.slice(0, 4)}***${phone.slice(-2)}`;

export interface GrantArgs {
  phone: string;
  revoke: boolean;
}

export function parseArgs(argv: readonly string[]): GrantArgs | { error: string } {
  const phoneArg = argv.find((a) => a.startsWith("--phone="));
  if (phoneArg === undefined) {
    return { error: "`--phone=09XXXXXXXXX` لازم است — این اسکریپت بدونِ هدفِ صریح بالا نمی‌آید." };
  }
  const phone = normalizePhone(phoneArg.slice("--phone=".length));
  if (phone === null) return { error: "شماره باید ۱۱ رقم و با ۰۹ آغاز شود." };
  return { phone, revoke: argv.includes("--revoke") };
}

/**
 * پرچم + ردیفِ audit در **همان** تراکنش (client باید داخلِ BEGIN باشد).
 * `action` فقط برای خودآزمون قابلِ override است (شکستِ عمدی با نامِ بیش از ۶۰ کاراکتر).
 */
export async function setStaff(
  client: pg.PoolClient,
  phone: string,
  grant: boolean,
  action?: string,
): Promise<StaffChange> {
  const user = await client.query<{ id: string; is_staff: boolean }>(
    "SELECT id, is_staff FROM users WHERE phone = $1 AND deleted_at IS NULL FOR UPDATE",
    [phone],
  );
  const row = user.rows[0];
  if (row === undefined) return "not_found";
  if (row.is_staff === grant) return "unchanged";

  await client.query(
    `UPDATE users
        SET is_staff = $2,
            step_up_verified_at = CASE WHEN $2 THEN step_up_verified_at ELSE NULL END,
            updated_at = now()
      WHERE id = $1`,
    [row.id, grant],
  );
  // ★ ADR-067 §۱: همان تراکنش. actor NULL = اپراتورِ CLI (کاربرِ محصول نیست).
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
     VALUES (NULL, $1, 'user', $2, $3::jsonb)`,
    [
      action ?? (grant ? "staff.grant" : "staff.revoke"),
      row.id,
      JSON.stringify({ source: "admin-grant-staff", phone: maskPhone(phone) }),
    ],
  );
  return grant ? "granted" : "revoked";
}

async function selfTest(pool: pg.Pool): Promise<void> {
  const results: { name: string; ok: boolean; detail: string }[] = [];

  // ★ خالص — بدونِ دیتابیس.
  const noPhone = parseArgs([]);
  const badPhone = parseArgs(["--phone=12345"]);
  const persian = parseArgs(["--phone=۰۹۱۲۰۰۰۰۰۰۱", "--revoke"]);
  results.push({
    name: "بدونِ --phone و با شماره‌ی بد بالا نمی‌آید؛ ارقامِ فارسی نرمال می‌شوند",
    ok:
      "error" in noPhone &&
      "error" in badPhone &&
      !("error" in persian) &&
      persian.phone === "09120000001" &&
      persian.revoke,
    detail: JSON.stringify({ noPhone, badPhone, persian }),
  });

  const client = await pool.connect();
  const phone = `0999${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  try {
    await client.query("BEGIN");
    const userId = randomUUID();
    await client.query(
      `INSERT INTO users (id, phone, phone_verified_at, display_name, presence_color, step_up_verified_at)
       VALUES ($1, $2, now(), 'selftest-staff', '#123456', now())`,
      [userId, phone],
    );
    const auditCount = async (): Promise<{ n: number; actions: string[] }> => {
      const r = await client.query<{ action: string }>(
        "SELECT action FROM audit_logs WHERE target_type = 'user' AND target_id = $1 ORDER BY id",
        [userId],
      );
      return { n: r.rows.length, actions: r.rows.map((x) => x.action) };
    };
    const flag = async (): Promise<{ is_staff: boolean; step_up: boolean }> => {
      const r = await client.query<{ is_staff: boolean; step_up_verified_at: Date | null }>(
        "SELECT is_staff, step_up_verified_at FROM users WHERE id = $1",
        [userId],
      );
      return { is_staff: r.rows[0]!.is_staff, step_up: r.rows[0]!.step_up_verified_at !== null };
    };

    const missing = await setStaff(client, "09990000000", true);
    results.push({
      name: "شماره‌ی ناشناخته ⇒ not_found، بدونِ ردیف",
      ok: missing === "not_found",
      detail: missing,
    });

    const granted = await setStaff(client, phone, true);
    const a1 = await auditCount();
    const f1 = await flag();
    results.push({
      name: "اعطا ⇒ is_staff=true + دقیقاً یک ردیفِ staff.grant",
      ok: granted === "granted" && f1.is_staff && a1.n === 1 && a1.actions[0] === "staff.grant",
      detail: `${granted} · ${JSON.stringify(a1)}`,
    });

    const again = await setStaff(client, phone, true);
    const a2 = await auditCount();
    results.push({
      name: "اعطای دوباره ⇒ unchanged و **بدونِ** ردیفِ دوم (بی‌عمل = بی‌ردیف)",
      ok: again === "unchanged" && a2.n === 1,
      detail: `${again} · ${String(a2.n)} ردیف`,
    });

    // ★★ اتمیک: INSERTِ audit عمداً می‌شکند (action > varchar(60)) ⇒ پرچم نباید عوض شده باشد.
    await client.query("SAVEPOINT atomic");
    let threw = false;
    try {
      await setStaff(client, phone, false, "x".repeat(61));
    } catch {
      threw = true;
    }
    await client.query("ROLLBACK TO SAVEPOINT atomic");
    const f3 = await flag();
    const a3 = await auditCount();
    results.push({
      name: "★★ شکستِ نوشتنِ audit ⇒ خطا، و پرچم دست‌نخورده (همان تراکنش)",
      ok: threw && f3.is_staff && a3.n === 1,
      detail: `threw=${String(threw)} is_staff=${String(f3.is_staff)} audit=${String(a3.n)}`,
    });

    const revoked = await setStaff(client, phone, false);
    const f4 = await flag();
    const a4 = await auditCount();
    results.push({
      name: "سلب ⇒ is_staff=false، step_up_verified_at پاک، ردیفِ staff.revoke",
      ok:
        revoked === "revoked" &&
        !f4.is_staff &&
        !f4.step_up &&
        a4.n === 2 &&
        a4.actions[1] === "staff.revoke",
      detail: `${revoked} · ${JSON.stringify(f4)} · ${JSON.stringify(a4)}`,
    });
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }

  console.log("── خودآزمونِ admin-grant-staff (روی تراکنشِ rollback‌شونده) ──");
  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ ${String(reds.length)} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ اعطا/سلب با ردیفِ audit در همان تراکنش، و شکستِ audit پرچم را برنمی‌گردانَد.");
}

async function main(): Promise<void> {
  // ★ آرگومان‌ها **پیش از** env: «بدونِ --phone بالا نمی‌آید» نباید به دیتابیس وابسته باشد —
  //   images.yml همین را از داخلِ ایمیجِ بدونِ DATABASE_URL می‌سنجد (exit 1 با پیامِ --phone).
  const argv = process.argv.slice(2);
  const args = argv.includes("--self-test") ? null : parseArgs(argv);
  if (args !== null && "error" in args) {
    console.error(
      `✖ ${args.error}\n\n‏  node scripts/admin-grant-staff.ts --phone=09XXXXXXXXX [--revoke]`,
    );
    process.exit(1);
  }

  const env = loadEnv(databaseEnvSchema);
  const pool = createDbPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: 2,
  });
  try {
    if (args === null) {
      await selfTest(pool);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const change = await setStaff(client, args.phone, !args.revoke);
      await client.query("COMMIT");
      const who = maskPhone(args.phone);
      switch (change) {
        case "not_found":
          console.error(
            `✖ کاربری با شماره‌ی ${who} نیست (یا حذف شده). اول باید یک‌بار وارد شده باشد.`,
          );
          process.exit(1);
        // eslint-disable-next-line no-fallthrough -- exit
        case "unchanged":
          console.log(
            `⊘ ${who} از قبل ${args.revoke ? "staff نبود" : "staff بود"} — هیچ ردیفی نوشته نشد.`,
          );
          return;
        case "granted":
          console.log(
            `✔ ${who} staff شد (audit: staff.grant). از درخواستِ بعدی، /admin برایش باز است.`,
          );
          return;
        case "revoked":
          console.log(
            `✔ staff از ${who} گرفته شد (audit: staff.revoke؛ step-up پاک شد). از درخواستِ بعدی ۴۰۳.`,
          );
          return;
      }
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
