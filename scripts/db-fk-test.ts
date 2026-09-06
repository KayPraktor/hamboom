/**
 * تستِ واقعیِ رفتارِ FK و اتمیک‌بودنِ تراکنش روی PostgreSQLِ زنده — گام ۵٫۱ M3.
 *
 * ── چرا این تست، و چرا اسکریپت (نه vitest) ─────────────────────────────
 *
 * `\d board_updates` فقط نشان می‌دهد constraint **وجود دارد**؛ ثابت نمی‌کند
 * CASCADE واقعاً **شلیک می‌کند**. مالک درست خواست: «آزمونِ واقعی، نه ادعا».
 * پس اینجا رفتار را روی دیتابیسِ زنده می‌سنجیم:
 *
 *   ۱. **CASCADE** — حذفِ یک بورد، ردیف‌های `board_updates`/`board_snapshots`اش را
 *      واقعاً پاک می‌کند (نه اینکه فقط constraint تعریف شده باشد).
 *   ۲. **SET NULL** — حذفِ کاربرِ نویسنده‌ی یک update، `origin_user_id` را NULL می‌کند
 *      و خودِ update را نگه می‌دارد (داده گم نمی‌شود، فقط «که نوشت»).
 *   ۳. **اتمیک‌بودن** — یک واحدِ چندجمله‌ای (بورد + ردیفِ ناسالم) که وسط بشکند،
 *      **کامل** rollback می‌شود؛ بوردِ بی‌مالک/ناقص نمی‌مانَد. مکانیزمی که ساختِ بورد
 *      (فاز ۵٫۴) رویش سوار می‌شود — اینجا روی schemaی واقعی اثباتش می‌کنیم.
 *
 * مثلِ `db:smoke` به Postgresِ زنده نیاز دارد و skip نمی‌شود (سبزِ دروغین). هر چک
 * در تراکنشِ خودش با ROLLBACK اجرا می‌شود، پس چیزی در دیتابیس نمی‌مانَد و تکرارپذیر است.
 *
 * اجرا: `pnpm db:fk-test` (بعد از `pnpm db:up && pnpm db:migrate`).
 *
 * ★ خودِ تست خودآزمون است: روی دیتابیسی که FK را **ندارد** (مثلاً board_updatesِ
 *   M2 پیش از `0002`)، چک‌های ۱ و ۲ **قرمز** می‌شوند — پس تست واقعاً رفتار را می‌سنجد،
 *   نه صرفِ وجودِ ردیف.
 */
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const BYTES = Buffer.from([0x00, 0x01, 0xff, 0x7f]);

/** یک کاربرِ کمینه با فیلدهای NOT NULL. برمی‌گرداند id. */
async function insertUser(c: pg.Client): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, $2, $3)", [
    id,
    "تستِ FK",
    "#3366cc",
  ]);
  return id;
}

async function insertTeam(c: pg.Client, owner: string): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, $3, $4)", [
    id,
    `t-${id.slice(0, 8)}`,
    "تیمِ تست",
    owner,
  ]);
  return id;
}

async function insertBoard(c: pg.Client, team: string, creator: string): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO boards (id, team_id, created_by) VALUES ($1, $2, $3)", [
    id,
    team,
    creator,
  ]);
  return id;
}

async function count(c: pg.Client, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await c.query<{ n: string }>(sql, params);
  return Number(rows[0]!.n);
}

/** چکِ ۱ — CASCADE: حذفِ بورد ردیف‌های update/snapshot را می‌بَرد. */
async function checkCascade(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);
    const board = await insertBoard(c, team, user);
    await c.query(
      "INSERT INTO board_updates (board_id, seq, payload, byte_size) VALUES ($1, 1, $2, $3)",
      [board, BYTES, BYTES.byteLength],
    );
    await c.query(
      "INSERT INTO board_snapshots (id, board_id, seq_upto, storage_key, state_vector, byte_size) " +
        "VALUES ($1, $2, 1, $3, $4, $5)",
      [randomUUID(), board, `k/${board}`, BYTES, BYTES.byteLength],
    );

    const before =
      (await count(c, "SELECT count(*) n FROM board_updates WHERE board_id = $1", [board])) +
      (await count(c, "SELECT count(*) n FROM board_snapshots WHERE board_id = $1", [board]));

    await c.query("DELETE FROM boards WHERE id = $1", [board]);

    const updatesLeft = await count(c, "SELECT count(*) n FROM board_updates WHERE board_id = $1", [
      board,
    ]);
    const snapsLeft = await count(c, "SELECT count(*) n FROM board_snapshots WHERE board_id = $1", [
      board,
    ]);

    const ok = before === 2 && updatesLeft === 0 && snapsLeft === 0;
    return {
      name: "CASCADE — حذفِ بورد، update/snapshot را می‌بَرد",
      ok,
      detail: ok
        ? "۲ ردیف قبل، ۰ بعد از حذفِ بورد"
        : `انتظار: ۲→۰. واقعی: قبل=${before}، updatesLeft=${updatesLeft}، snapsLeft=${snapsLeft} (FK غایب؟)`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** چکِ ۲ — SET NULL: حذفِ نویسنده، origin را NULL می‌کند، update می‌مانَد. */
async function checkSetNull(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const creator = await insertUser(c);
    const author = await insertUser(c); // نویسنده‌ی update، جدا از سازنده‌ی بورد
    const team = await insertTeam(c, creator);
    const board = await insertBoard(c, team, creator);
    await c.query(
      "INSERT INTO board_updates (board_id, seq, payload, byte_size, origin_user_id) " +
        "VALUES ($1, 1, $2, $3, $4)",
      [board, BYTES, BYTES.byteLength, author],
    );

    await c.query("DELETE FROM users WHERE id = $1", [author]);

    const { rows } = await c.query<{ origin_user_id: string | null }>(
      "SELECT origin_user_id FROM board_updates WHERE board_id = $1 AND seq = 1",
      [board],
    );
    const survived = rows.length === 1;
    const nulled = survived && rows[0]!.origin_user_id === null;

    const ok = survived && nulled;
    return {
      name: "SET NULL — حذفِ نویسنده، origin_user_id را NULL می‌کند",
      ok,
      detail: ok
        ? "update ماند، origin_user_id = NULL"
        : `انتظار: بماند + NULL. واقعی: survived=${survived}، origin=${survived ? String(rows[0]!.origin_user_id) : "—"} (FK غایب؟)`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** چکِ ۳ — اتمیک‌بودن: واحدی که وسط بشکند کامل rollback می‌شود (بوردِ ناقص نمی‌مانَد). */
async function checkAtomicity(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);
    const board = randomUUID();

    // واحدِ «ساختِ بورد»: بورد + یک ردیفِ عضو با نقشِ **نامعتبر** (CHECK می‌شکند).
    let broke = false;
    await c.query("SAVEPOINT unit");
    try {
      await c.query("INSERT INTO boards (id, team_id, created_by) VALUES ($1, $2, $3)", [
        board,
        team,
        user,
      ]);
      await c.query("INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)", [
        board,
        user,
        "NOT_A_ROLE", // نقضِ CHECK — کلِ واحد باید برگردد
      ]);
      await c.query("RELEASE SAVEPOINT unit");
    } catch {
      broke = true;
      await c.query("ROLLBACK TO SAVEPOINT unit");
    }

    const boardsLeft = await count(c, "SELECT count(*) n FROM boards WHERE id = $1", [board]);
    const ok = broke && boardsLeft === 0;
    return {
      name: "اتمیک‌بودن — واحدِ شکسته کامل rollback می‌شود",
      ok,
      detail: ok
        ? "درجِ نامعتبر ردّ شد و بوردِ همان واحد هم نماند (۰ ردیف)"
        : `انتظار: شکست + ۰ بورد. واقعی: broke=${broke}، boardsLeft=${boardsLeft}`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

// ══ سناریوهای billing (M4 فاز ۴، migration 0004) ═══════════════════════════
//
// ★ هر چک یک **نقضِ عمدی** می‌زند و انتظار دارد دیتابیس ردش کند. اگر روزی constraint
//   برداشته شود، این‌ها قرمز می‌شوند — که تعریفِ یک گیتِ واقعی است.

/** آیا این عبارت با خطای دیتابیس رد شد؟ (در savepoint، تا تراکنش زنده بماند) */
async function rejects(c: pg.Client, sql: string, params: unknown[] = []): Promise<boolean> {
  await c.query("SAVEPOINT sp");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT sp");
    return false;
  } catch {
    await c.query("ROLLBACK TO SAVEPOINT sp");
    return true;
  }
}

/** یک فاکتورِ کمینه با ارقامِ دلخواه. */
const INVOICE_SQL =
  "INSERT INTO invoices (id, team_id, number, subtotal_rial, discount_rial, vat_rial, total_rial, status)" +
  " VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";

/** شماره‌ی فاکتورِ یکتا برای هر درجِ آزمایشی. */
let invoiceCounter = 0;
const nextNumber = (): string => `HB-1499-${String(++invoiceCounter).padStart(6, "0")}`;

/** ۱. B-4 — وضعیتِ نامعتبر دیگر تمیز درج نمی‌شود. */
async function checkBillingStatusGuards(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);

    const badSubscription = await rejects(
      c,
      "INSERT INTO subscriptions (id, team_id, plan_code, status, period, current_period_start, current_period_end)" +
        " VALUES ($1, $2, 'free', 'Active', 'monthly', now(), now() + interval '1 month')",
      [randomUUID(), team],
    );
    const badPayment = await rejects(
      c,
      "INSERT INTO payments (id, team_id, initiated_by, gateway, gateway_mode, amount_rial, status, idempotency_key)" +
        " VALUES ($1, $2, $3, 'zarinpal', 'sandbox', 15000, 'Paid', $4)",
      [randomUUID(), team, user, randomUUID()],
    );
    const belowFloor = await rejects(
      c,
      "INSERT INTO payments (id, team_id, initiated_by, gateway, gateway_mode, amount_rial, idempotency_key)" +
        " VALUES ($1, $2, $3, 'mock', 'sandbox', 100, $4)",
      [randomUUID(), team, user, randomUUID()],
    );

    const ok = badSubscription && badPayment && belowFloor;
    return {
      name: "billing — وضعیتِ نامعتبر و مبلغِ زیرِ کف رد می‌شوند (B-4)",
      ok,
      detail: ok
        ? "status='Active' و 'Paid' و مبلغِ ۱۰۰ ریال هر سه ردّ شدند — پیش از ۰۰۰۴ هر سه تمیز درج می‌شدند"
        : `انتظار: هر سه رد. واقعی: sub=${badSubscription}، pay=${badPayment}، floor=${belowFloor}`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** ۲. ★★ رابطه‌ی ADR-052 در سطحِ دیتابیس. */
async function checkInvoiceArithmetic(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);

    // درست: ۱۰۰۰ − ۱۰۰ + ۹۰ = ۹۹۰
    const good = !(await rejects(c, INVOICE_SQL, [
      randomUUID(), team, nextNumber(), 1000, 100, 90, 990, "open",
    ]));
    // ★ یک ریال اختلاف — دقیقاً همان چیزی که «مسیرِ دومِ محاسبه» می‌سازد.
    const offByOne = await rejects(c, INVOICE_SQL, [
      randomUUID(), team, nextNumber(), 1000, 100, 90, 991, "open",
    ]);
    // تخفیفِ بزرگ‌تر از مبلغ ⇒ همان چیزی که probeِ گام ۱٫۵ مبلغِ منفی‌اش را دید.
    const overDiscount = await rejects(c, INVOICE_SQL, [
      randomUUID(), team, nextNumber(), 1000, 5000, 0, -4000, "open",
    ]);

    const ok = good && offByOne && overDiscount;
    return {
      name: "★★ billing — `subtotal − discount + vat = total` را دیتابیس اجبار می‌کند",
      ok,
      detail: ok
        ? "فاکتورِ درست پذیرفته شد؛ اختلافِ **یک ریال** و تخفیفِ بزرگ‌تر از مبلغ هر دو ردّ شدند"
        : `انتظار: درست=قبول، دو نقض=رد. واقعی: good=${good}، off=${offByOne}، over=${overDiscount}`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** ۳. کوپن دوبار خرج نمی‌شود، و شکلِ دوگانه رد می‌شود. */
async function checkCouponRedemption(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);
    const code = `PROBE${String(Date.now()).slice(-8)}`;
    await c.query("INSERT INTO coupons (code, percent_off, max_redemptions) VALUES ($1, 20, 1)", [
      code,
    ]);

    const first = !(await rejects(
      c,
      "INSERT INTO coupon_redemptions (coupon_code, team_id) VALUES ($1, $2)",
      [code, team],
    ));
    const second = await rejects(
      c,
      "INSERT INTO coupon_redemptions (coupon_code, team_id) VALUES ($1, $2)",
      [code, team],
    );
    const bothForms = await rejects(
      c,
      "INSERT INTO coupons (code, percent_off, amount_off_rial) VALUES ($1, 10, 5000)",
      [`${code}X`],
    );

    const ok = first && second && bothForms;
    return {
      name: "billing — کوپن دوبار خرج نمی‌شود و شکلِ دوگانه رد می‌شود",
      ok,
      detail: ok
        ? "redeemِ اول پذیرفته، دومِ همان تیم ردّ (۲۳۵۰۵)، و کوپنِ «هم درصد هم مبلغ» ردّ شد"
        : `انتظار: اول=قبول، دوم=رد، دوشکلی=رد. واقعی: ${first}/${second}/${bothForms}`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** ۴. ★ رکوردِ مالی با حذفِ تیم/کاربر نابود نمی‌شود (گام ۴٫۴). */
async function checkFinancialRecordsSurvive(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);
    await c.query(INVOICE_SQL, [randomUUID(), team, nextNumber(), 1000, 0, 0, 1000, "open"]);
    // فاکتورِ `paid` باید `paid_at` داشته باشد (constraintِ ۰۰۰۴) — پس با هم ست می‌شوند.
    await c.query("UPDATE invoices SET status = 'paid', paid_at = now() WHERE team_id = $1", [team]);

    const teamBlocked = await rejects(c, "DELETE FROM teams WHERE id = $1", [team]);
    const userBlocked = await rejects(c, "DELETE FROM users WHERE id = $1", [user]);

    const ok = teamBlocked && userBlocked;
    return {
      name: "★ billing — حذفِ تیم/کاربرِ دارای رکوردِ مالی **مسدود** است (نه CASCADE)",
      ok,
      detail: ok
        ? "هر دو حذف ردّ شدند ⇒ سوابقِ مالی با حذفِ حساب نابود نمی‌شوند"
        : `انتظار: هر دو مسدود. واقعی: team=${teamBlocked}، user=${userBlocked}`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** ۵. `paid` بدونِ `paid_at` رد می‌شود — و برعکس. */
async function checkPaidAtCoupling(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const user = await insertUser(c);
    const team = await insertTeam(c, user);
    const paidWithoutDate = await rejects(c, INVOICE_SQL, [
      randomUUID(), team, nextNumber(), 1000, 0, 0, 1000, "paid",
    ]);
    return {
      name: "billing — فاکتورِ `paid` بدونِ `paid_at` رد می‌شود",
      ok: paidWithoutDate,
      detail: paidWithoutDate
        ? "«پرداخت‌شده» بدونِ زمانِ پرداخت ناممکن شد ⇒ گزارشِ درآمد سوراخ نمی‌شود"
        : "انتظار: رد. واقعی: پذیرفته شد",
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/** ۶. دنباله‌ی شماره‌ی فاکتور اتمیک است — نه `max()+1`. */
async function checkInvoiceSequence(c: pg.Client): Promise<CheckResult> {
  await c.query("BEGIN");
  try {
    const bump = async (): Promise<number> => {
      const { rows } = await c.query<{ last_seq: number }>(
        "INSERT INTO invoice_sequences (jalali_year, last_seq) VALUES ($1, 1)" +
          " ON CONFLICT (jalali_year) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1," +
          " updated_at = now() RETURNING last_seq",
        [1499], // سالِ آزمایشی، بیرونِ دامنه‌ی واقعی
      );
      return rows[0]!.last_seq;
    };
    const seen = [await bump(), await bump(), await bump()];
    const ok = seen[0] === 1 && seen[1] === 2 && seen[2] === 3;
    return {
      name: "billing — دنباله‌ی شماره‌ی فاکتور اتمیک و یکنواخت است",
      ok,
      detail: ok
        ? `سه فراخوانیِ پیاپی ⇒ ${seen.join("، ")} (بدونِ max()+1 و بدونِ مسابقه)`
        : `انتظار: ۱،۲،۳. واقعی: ${seen.join("، ")}`,
    };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

/**
 * ۷. seedِ پلن‌ها: `free` فعال، بقیه عمداً غیرفعال — **ولی به دو دلیلِ متفاوت**.
 *
 * ⚠️ این چک در فاز ۴ نوشته شد و مجموعه‌ی غیرفعال‌ها را دقیقاً `pro,team` می‌خواست. فاز ۶
 * با migrationِ `0005` پلنِ `personal` را اضافه کرد که آن هم `is_active = false` است —
 * **نه به‌خاطرِ قیمت، بلکه چون اصلاً فروختنی نیست** (به فضای شخصی تخصیص داده می‌شود، خریده
 * نمی‌شود). پس چک از فاز ۶ کهنه بود و اولین اجرای بعدش (فاز ۷) قرمزش کرد.
 *
 * ★ مجموعه **صریح** نگه داشته می‌شود، نه «هرچه غیرفعال بود»: افزودنِ یک پلنِ غیرفعالِ تازه
 * باید همین‌جا دیده شود، نه اینکه بی‌صدا رد شود.
 */
async function checkPlanSeed(c: pg.Client): Promise<CheckResult> {
  const { rows } = await c.query<{ code: string; is_active: boolean; max_boards: number }>(
    "SELECT code, is_active, max_boards FROM plans ORDER BY sort_order",
  );
  const free = rows.find((r) => r.code === "free");
  const inactive = rows
    .filter((r) => !r.is_active)
    .map((r) => r.code)
    .sort()
    .join(",");
  const ok = free?.is_active === true && inactive === "personal,pro,team";
  return {
    name: "billing — `free` فعال؛ `pro`/`team` تا تاییدِ قیمت و `personal` چون فروختنی نیست، **غیرفعال**",
    ok,
    detail: ok
      ? `free فعال (سقفِ بورد ${String(free?.max_boards)})، و ${inactive} غیرفعال ⇒ چیزی که قیمتش تایید نشده قابلِ خرید نیست`
      : `انتظار: free فعال و personal/pro/team غیرفعال. واقعی: ${JSON.stringify(rows)}`,
  };
}


async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      console.error("✖ اتصال به PostgreSQL برقرار نشد.\n  pnpm db:up && pnpm db:migrate");
      process.exit(1);
    }
    throw error;
  }

  try {
    const results = [
      await checkCascade(client),
      await checkSetNull(client),
      await checkAtomicity(client),
      await checkBillingStatusGuards(client),
      await checkInvoiceArithmetic(client),
      await checkCouponRedemption(client),
      await checkFinancialRecordsSurvive(client),
      await checkPaidAtCoupling(client),
      await checkInvoiceSequence(client),
      await checkPlanSeed(client),
    ];

    for (const r of results) {
      console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error(`\n✖ ${failed.length} چک قرمز شد.`);
      process.exit(1);
    }
    console.log("\n✔ رفتارِ FK و اتمیک‌بودن روی Postgresِ زنده اثبات شد (نه ادعا).");
  } finally {
    await client.end();
  }
}

await main();
