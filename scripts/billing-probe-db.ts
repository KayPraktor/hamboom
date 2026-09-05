/**
 * probeِ فاز ۱ی M4 — گام‌های ۱٫۲ و ۱٫۴ روی PostgreSQLِ **زنده**.
 *
 * ── چرا probe، و چرا قبل از هر کدِ محصولی ──────────────────────────────
 *
 * دو ادعا در برنامه‌ریزیِ M4 هست که اگر غلط باشند، کلِ لایه‌ی پول را بی‌صدا خراب
 * می‌کنند. هیچ‌کدام از خواندنِ کد قطعی نیست — باید روی دیتابیسِ واقعی **دیده** شوند:
 *
 *   ۱٫۲ (**B-2**) — کوئرسِ `int8→number` در [`plugins/db.ts`](../apps/api/src/plugins/db.ts)
 *       فقط OIDِ **۲۰** را ثبت می‌کند. ولی `SUM()` روی `bigint` نوعِ `numeric`
 *       (OID **۱۷۰۰**) برمی‌گرداند. اگر فرضیه درست باشد، جمعِ مبالغ **رشته** است و
 *       `sum + vat` می‌شود الحاقِ رشته و `sum > limit` مقایسه‌ی الفبایی
 *       (`"9" > "10000"` درست است!). گاردِ `RangeError` هرگز شلیک نمی‌کند چون
 *       اصلاً چیزی پارس نشده. `count(*)` هم که `int8` است **درست** برمی‌گردد و
 *       همین شباهت، خرابی را پنهان می‌کند.
 *
 *   ۱٫۴ — [ADR-050](../ARCHITECTURE_DECISIONS.md#adr-050) کلِ یگانگیِ پرداخت را روی
 *       `SELECT … FOR UPDATE` گذاشته. پس باید ثابت شود این قفل واقعاً **مسدود**
 *       می‌کند، نه اینکه فقط در SQL نوشته شده باشد.
 *
 * ★ هر دو چک **خودآزمون**‌اند: هرکدام یک اجرای «شکسته» هم دارد (بدونِ ثبتِ parser،
 *   و بدونِ `FOR UPDATE`) که باید رفتارِ بد را نشان دهد. اگر نسخه‌ی شکسته هم سالم
 *   دربیاید، یعنی probe چیزی را که ادعا می‌کند نمی‌سنجد.
 *
 * مثلِ `db:fk-test` به Postgresِ زنده نیاز دارد و skip نمی‌شود (سبزِ دروغین).
 * همه‌چیز در تراکنش با ROLLBACK اجرا می‌شود، پس چیزی در دیتابیس نمی‌مانَد.
 *
 * اجرا: `pnpm billing:probe-db` (بعد از `pnpm db:up && pnpm db:migrate`).
 */
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const INT8_OID = 20;
const NUMERIC_OID = 1700;
const AMOUNT_A = 1_500_000;
const AMOUNT_B = 2_500_000;

/** یک تیم + کاربرِ کمینه می‌سازد و شناسه‌هایشان را می‌دهد. */
async function seedTeam(c: pg.Client): Promise<{ userId: string; teamId: string }> {
  const userId = randomUUID();
  await c.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, $2, $3)", [
    userId,
    "probeِ billing",
    "#3366cc",
  ]);
  const teamId = randomUUID();
  await c.query("INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, $3, $4)", [
    teamId,
    `t-${teamId.slice(0, 8)}`,
    "تیمِ probe",
    userId,
  ]);
  return { userId, teamId };
}

/** یک ردیفِ `payments` با مبلغِ داده‌شده درج می‌کند و id را می‌دهد. */
async function seedPayment(
  c: pg.Client,
  team: string,
  user: string,
  amount: number,
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO payments (id, team_id, initiated_by, gateway, gateway_mode, amount_rial, idempotency_key)
     VALUES ($1, $2, $3, 'mock', 'sandbox', $4, $5)`,
    [id, team, user, amount, `probe-${id}`],
  );
  return id;
}

// ── ۱٫۲ — آیا SUM() روی bigint رشته برمی‌گرداند؟ ────────────────────────

interface MoneyTypes {
  sum: unknown;
  count: unknown;
  column: unknown;
}

/** همان سه شکلِ خواندنِ پول را یک‌جا می‌گیرد: `sum()`، `count(*)` و ستونِ خام. */
async function readMoneyTypes(c: pg.Client): Promise<MoneyTypes> {
  await c.query("BEGIN");
  try {
    const { userId, teamId } = await seedTeam(c);
    await seedPayment(c, teamId, userId, AMOUNT_A);
    await seedPayment(c, teamId, userId, AMOUNT_B);

    const { rows } = await c.query<MoneyTypes>(
      `SELECT sum(amount_rial) AS sum, count(*) AS count,
              (SELECT amount_rial FROM payments WHERE team_id = $1 LIMIT 1) AS column
         FROM payments WHERE team_id = $1`,
      [teamId],
    );
    return rows[0]!;
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

const shape = (t: MoneyTypes): string =>
  `sum ⇒ ${typeof t.sum} · count(*) ⇒ ${typeof t.count} · ستونِ خام ⇒ ${typeof t.column}`;

/**
 * ★★ سه حالتِ واقعیِ خواندنِ پول در این ریپو را کنارِ هم می‌گذارد. همین جدول کلِ
 * B-2 و B-3 است:
 *
 * | کجا | چه parserی ثبت شده | نتیجه |
 * |---|---|---|
 * | اسکریپت/worker با `new pg.Pool` | **هیچ** | **همه‌چیز رشته** — حتی ستونِ خام (B-3) |
 * | `apps/api` (از راهِ `createDbPool`) | فقط OIDِ ۲۰ | ستون و count درست، ولی **`sum()` رشته** (B-2) |
 * | با ثبتِ OIDِ ۱۷۰۰ هم | ۲۰ + ۱۷۰۰ | همه درست |
 *
 * حالتِ میانی خطرناک‌ترین است، چون **بیشترِ کد سالم به‌نظر می‌رسد** و فقط جمع‌ها
 * خراب‌اند — و گاردِ `RangeError` هم شلیک نمی‌کند چون اصلاً چیزی پارس نشده.
 */
async function checkMoneyTypes(conn: pg.ClientConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ── حالت ۱: هیچ parserی — همان کاری که scripts/rt-*.ts و apps/realtime می‌کنند
  const bare = new pg.Client(conn);
  await bare.connect();
  const bareTypes = await readMoneyTypes(bare).finally(() => bare.end());
  const allString =
    typeof bareTypes.sum === "string" &&
    typeof bareTypes.count === "string" &&
    typeof bareTypes.column === "string";
  results.push({
    name: "۱٫۲ (B-3) — کلاینتِ خام (اسکریپت/worker): **همه‌ی** مقادیرِ bigint رشته‌اند",
    ok: allString,
    detail: allString
      ? `${shape(bareTypes)}\n    ★ یعنی هر اسکریپتی که از روی scripts/rt-*.ts کپی شود، «${String(bareTypes.column)}» را به‌جای عدد می‌خواند — بی‌هیچ خطایی`
      : `انتظار: هر سه string. واقعی: ${shape(bareTypes)}`,
  });

  // ── حالت ۲: فقط OIDِ ۲۰ — دقیقاً وضعِ امروزِ apps/api
  pg.types.setTypeParser(INT8_OID, (v: string) => Number(v));
  const int8Only = new pg.Client(conn);
  await int8Only.connect();
  const apiTypes = await readMoneyTypes(int8Only).finally(() => int8Only.end());

  // ★ خودِ خرابی، نه توصیفش.
  const arithmetic = (apiTypes.sum as number) + 1;
  const comparison = (apiTypes.sum as number) > 9_000_000; // "4000000" > 9000000 ؟
  const asymmetric = typeof apiTypes.sum === "string" && typeof apiTypes.column === "number";
  results.push({
    name: "۱٫۲ (B-2) ★ — داخلِ `apps/api`: ستون درست است ولی `sum()` **رشته** می‌مانَد",
    ok: asymmetric,
    detail: asymmetric
      ? `${shape(apiTypes)}\n` +
        `    ★ اثرِ واقعی: sum+۱ = «${String(arithmetic)}» (الحاق، نه جمع) · sum > ۹٬۰۰۰٬۰۰۰ ⇒ ${comparison} (مقایسه‌ی الفبایی)\n` +
        `    ⚠️ چون ستون و count **درست**‌اند، کدِ اطرافش سالم به‌نظر می‌رسد — این همان چیزی است که خرابی را پنهان می‌کند`
      : `انتظار: sum=string ولی column=number. واقعی: ${shape(apiTypes)}`,
  });

  // ── حالت ۳: با OIDِ ۱۷۰۰ هم — رفعِ پیشنهادی
  pg.types.setTypeParser(NUMERIC_OID, (v: string) => Number(v));
  const fixed = new pg.Client(conn);
  await fixed.connect();
  const fixedTypes = await readMoneyTypes(fixed).finally(() => fixed.end());
  const okFixed = typeof fixedTypes.sum === "number" && fixedTypes.sum === AMOUNT_A + AMOUNT_B;
  results.push({
    name: "۱٫۲ خودآزمون — با ثبتِ OIDِ ۱۷۰۰ همان کوئری درست می‌شود",
    ok: okFixed,
    detail: okFixed
      ? `${shape(fixedTypes)} — مقدار ${String(fixedTypes.sum)}. پس رفع واقعاً کار می‌کند`
      : `انتظار: number = ${AMOUNT_A + AMOUNT_B}. واقعی: ${shape(fixedTypes)}`,
  });

  return results;
}

// ── ۱٫۴ — آیا SELECT … FOR UPDATE واقعاً مسدود می‌کند؟ ──────────────────

interface LockOutcome {
  /** آیا تراکنشِ دوم تا commitِ اولی منتظر ماند؟ */
  blocked: boolean;
  /** وضعیتی که تراکنشِ دوم بعد از آزادشدن دید. */
  seenBySecond: string;
  waitedMs: number;
}

/**
 * دو تراکنشِ **هم‌زمانِ واقعی** روی یک ردیفِ `payments` اجرا می‌کند — دقیقاً سناریوی
 * «callbackِ مرورگر و verifyِ دستی با هم».
 *
 * @param lock وقتی `false` است، `FOR UPDATE` برداشته می‌شود (شکستنِ عمدی).
 */
async function raceOnPayment(
  pool: pg.Pool,
  paymentId: string,
  lock: boolean,
): Promise<LockOutcome> {
  const a = await pool.connect();
  const b = await pool.connect();
  const suffix = lock ? " FOR UPDATE" : "";
  const startedAt = process.hrtime.bigint();
  let secondResolvedAt: bigint | null = null;

  try {
    await a.query("BEGIN");
    await a.query(`SELECT status FROM payments WHERE id = $1${suffix}`, [paymentId]);

    // B همان ردیف را می‌خواهد. با قفل باید منتظر بماند؛ بدونِ قفل بی‌درنگ می‌خواند.
    await b.query("BEGIN");
    const bRead = b
      .query<{ status: string }>(`SELECT status FROM payments WHERE id = $1${suffix}`, [paymentId])
      .then((r) => {
        secondResolvedAt = process.hrtime.bigint();
        return r.rows[0]!.status;
      });

    // به B فرصتِ واقعی می‌دهیم تا اگر قرار است رد شود، رد شود.
    await new Promise((r) => setTimeout(r, 300));
    const resolvedEarly = secondResolvedAt !== null;

    // حالا A پرداخت را «paid» می‌کند و commit می‌زند — مثلِ فعال‌سازیِ اشتراک.
    await a.query("UPDATE payments SET status = 'paid', paid_at = now() WHERE id = $1", [
      paymentId,
    ]);
    await a.query("COMMIT");

    const seenBySecond = await bRead;
    await b.query("ROLLBACK");

    return {
      blocked: !resolvedEarly,
      seenBySecond,
      waitedMs: Number((secondResolvedAt! - startedAt) / 1_000_000n),
    };
  } finally {
    a.release();
    b.release();
  }
}

async function checkRowLock(pool: pg.Pool): Promise<CheckResult[]> {
  const setup = await pool.connect();
  let teamId: string;
  let userId: string;
  try {
    await setup.query("BEGIN");
    const seeded = await seedTeam(setup as unknown as pg.Client);
    teamId = seeded.teamId;
    userId = seeded.userId;
    await setup.query("COMMIT"); // باید commit شود تا کلاینت‌های دیگر ببینندش
  } finally {
    setup.release();
  }

  const results: CheckResult[] = [];
  try {
    const locked = await raceOnPayment(
      pool,
      await withClient(pool, (c) => seedPayment(c, teamId, userId, AMOUNT_A)),
      true,
    );
    const okLocked = locked.blocked && locked.seenBySecond === "paid";
    results.push({
      name: "۱٫۴ — `SELECT … FOR UPDATE` تراکنشِ دوم را واقعاً مسدود می‌کند",
      ok: okLocked,
      detail: okLocked
        ? `دومی ${locked.waitedMs}ms منتظر ماند و بعد وضعیتِ **به‌روز** («${locked.seenBySecond}») را دید`
        : `انتظار: blocked=true و seen=paid. واقعی: blocked=${locked.blocked}، seen=${locked.seenBySecond}`,
    });

    // ★ شکستنِ عمدی: بدونِ FOR UPDATE هر دو «pending» می‌بینند ⇒ دو فعال‌سازی.
    const unlocked = await raceOnPayment(
      pool,
      await withClient(pool, (c) => seedPayment(c, teamId, userId, AMOUNT_B)),
      false,
    );
    const okBroken = !unlocked.blocked && unlocked.seenBySecond === "pending";
    results.push({
      name: "۱٫۴ خودآزمون — بدونِ `FOR UPDATE` هر دو «pending» می‌بینند",
      ok: okBroken,
      detail: okBroken
        ? `دومی بدونِ انتظار «${unlocked.seenBySecond}» دید ⇒ اشتراک **دوبار** فعال می‌شد. قفل چیزِ واقعی‌ای می‌خرد.`
        : `انتظار: blocked=false و seen=pending. واقعی: blocked=${unlocked.blocked}، seen=${unlocked.seenBySecond}`,
    });
  } finally {
    // ⚠️ ترتیب اجباری است: `teams.owner_user_id` و `payments.initiated_by` هیچ‌کدام
    // `ON DELETE` ندارند، پس حذفِ کاربر قبل از تیم با ۲۳۵۰۳ می‌افتد. (خودش یکی از
    // موارد migrationِ ۰۰۰۴ است — فاز ۴ گام ۴٫۴.)
    await withClient(pool, async (c) => {
      await c.query("DELETE FROM payments WHERE team_id = $1", [teamId]);
      await c.query("DELETE FROM teams WHERE id = $1", [teamId]);
      await c.query("DELETE FROM users WHERE id = $1", [userId]);
    });
  }
  return results;
}

async function withClient<T>(pool: pg.Pool, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c as unknown as pg.Client);
  } finally {
    c.release();
  }
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const conn = {
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  };

  // بررسیِ اتصال، قبل از هر چک — تا خطای شبکه با شکستِ probe اشتباه نشود.
  const ping = new pg.Client(conn);
  try {
    await ping.connect();
    await ping.end();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      console.error("✖ اتصال به PostgreSQL برقرار نشد.\n  pnpm db:up && pnpm db:migrate");
      process.exit(1);
    }
    throw error;
  }

  const results: CheckResult[] = [];
  results.push(...(await checkMoneyTypes(conn)));

  const pool = new pg.Pool({ ...conn, max: 4 });
  try {
    results.push(...(await checkRowLock(pool)));
  } finally {
    await pool.end();
  }

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ ۱٫۲ و ۱٫۴ روی Postgresِ زنده اثبات شدند (نه ادعا).");
}

await main();
