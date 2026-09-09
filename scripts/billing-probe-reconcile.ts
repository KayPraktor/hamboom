/**
 * سنجه‌ی زنده‌ی M4 — **آشتی‌دهی روی Postgresِ واقعی** (فاز ۷ گام ۷٫۳).
 *
 * ── چرا اسکریپت، نه تستِ واحد ──────────────────────────────────────────
 *
 * ادعای این فاز این است که «کاربر پول داد و مرورگر را بست» **بازیابی می‌شود**. آن سناریو
 * سه چیزِ واقعی لازم دارد که هیچ‌کدام در تستِ واحد وجود ندارند: یک ردیفِ `pending`ِ واقعی
 * با سنِ گذشته، یک تراکنشِ واقعی با `FOR UPDATE`، و یک درگاه که بینِ دو تسویه **کُند** باشد.
 *
 * نُه چک:
 *   ۱. ★★ callbackِ گم‌شده ⇒ sweep اشتراک را فعال می‌کند.
 *   ۲. ★ **خودآزمونِ درجا:** همان صحنه **بدونِ** sweep ⇒ باید `pending` بمانَد. بدونِ این
 *      چک، چکِ ۱ می‌توانست از خودِ صحنه‌آرایی سبز شده باشد، نه از sweep.
 *   ۳. ردیفِ جوان دست نمی‌خورد (کاربر ممکن است هنوز روی صفحه‌ی بانک باشد).
 *   ۴. ★★ **B-3:** `runReconcile` روی استخرِ خامِ `new pg.Pool` **بالا نمی‌آید**.
 *   ۵. ردیفِ یتیم گزارش می‌شود و **هرگز خودکار failed نمی‌شود**.
 *   ۶. ★ فرزندخواندگی: پنجره‌ی سقوطِ authority بسته می‌شود — و ابهام **رد** می‌شود.
 *   ۷. ★★ ردیفی که هرگز پرسیده نشده باطل نمی‌شود؛ بعد از **یک** پرسش، بله.
 *   ۸. ★★ دو sweepِ هم‌زمان ⇒ دقیقاً **یک** اشتراک.
 *   ۹. اشتراکِ تمام‌شده بسته می‌شود — لغوشده `canceled`، تمدیدنشده `expired`.
 *
 * ★ **هر بلوک try/catch دارد**: شکستِ خودِ سنجه باید یک چکِ **قرمز** باشد، نه یک crash —
 * وگرنه از شکستِ چیزی که می‌سنجد قابلِ تفکیک نیست (درسِ فاز ۶).
 *
 * اجرا: `pnpm billing:probe-reconcile` (بعد از `pnpm db:up && pnpm db:migrate`).
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { MockGateway, type PaymentGateway } from "@hamboom/billing-core";
import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

import { createDbPool, withTransaction } from "../apps/api/src/plugins/db.ts";
import { createCheckout } from "../apps/api/src/services/billing.ts";
import { runReconcile, type ReconcilePolicy } from "../apps/api/src/services/reconcile.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const policy = (over: Partial<ReconcilePolicy> = {}): ReconcilePolicy => ({
  staleAfterMs: 20 * MINUTE,
  expireAfterMs: 72 * HOUR,
  batchSize: 50,
  adoptOrphans: false,
  dryRun: false,
  ...over,
});

/**
 * ★★ درگاهِ عمداً کُند — بدونِ این، چکِ همزمانی یک گیتِ دروغین است.
 *
 * درسِ گران‌قیمتِ این ماژول: **سه بار** یک چکِ «همزمانی» سبز بود و با برداشتنِ عمدیِ
 * `FOR UPDATE` هم سبز مانْد، چون دو تراکنش هرگز هم‌پوشانی نداشتند. یک تاخیرِ واقعی
 * داخلِ ناحیه‌ی بحرانی تنها راهِ اثبات است.
 */
function slowGateway(inner: PaymentGateway, ms = 250): PaymentGateway {
  return {
    name: inner.name,
    mode: inner.mode,
    developmentOnly: inner.developmentOnly,
    createPayment: (input) => inner.createPayment(input),
    verifyPayment: async (input) => {
      await new Promise((r) => setTimeout(r, ms));
      return inner.verifyPayment(input);
    },
    listUnverified: inner.listUnverified?.bind(inner),
  };
}

const mock = (over: { failEveryPayment?: boolean } = {}): MockGateway =>
  new MockGateway({ checkoutBaseUrl: "http://localhost/pay", ...over });

async function seedTeam(pool: pg.Pool): Promise<{ userId: string; teamId: string }> {
  const userId = randomUUID();
  const teamId = randomUUID();
  await pool.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, $2, $3)", [
    userId,
    "سنجه‌ی آشتی‌دهی",
    "#3366cc",
  ]);
  await pool.query("INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, $3, $4)", [
    teamId,
    `recon-${teamId.slice(0, 8)}`,
    "تیمِ سنجه",
    userId,
  ]);
  await pool.query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [
    teamId,
    userId,
  ]);
  return { userId, teamId };
}

async function cleanup(pool: pg.Pool, teamId: string, userId: string): Promise<void> {
  await pool.query("DELETE FROM subscriptions WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM payments WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM invoices WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

async function ensureProbePlan(pool: pg.Pool): Promise<string> {
  const code = "probe_recon";
  await pool.query(
    `INSERT INTO plans (code, name, description, price_monthly_rial, price_yearly_rial,
                        max_members, max_boards, max_storage_bytes, features, is_active, sort_order)
     VALUES ($1, 'پلنِ سنجه', 'فقط برای سنجه', 1990000, 19900000, 10, -1, 1073741824, '[]'::jsonb, true, 98)
     ON CONFLICT (code) DO UPDATE SET is_active = true`,
    [code],
  );
  return code;
}

/** یک ردیفِ `pending` می‌سازد — دقیقاً همان کاری که route می‌کند، با کنترل روی authority. */
async function startCheckout(
  pool: pg.Pool,
  gateway: PaymentGateway,
  teamId: string,
  userId: string,
  planCode: string,
  options: { storeAuthority?: boolean; seats?: number } = {},
): Promise<{ paymentId: string; amountRial: number; authority: string | null }> {
  const draft = await withTransaction(pool, async (tx) =>
    createCheckout(
      tx,
      {
        teamId,
        userId,
        planCode,
        period: "monthly",
        seats: options.seats ?? 1,
        vatPercent: 0,
        gatewayName: gateway.name,
        gatewayMode: gateway.mode,
      },
      `${teamId}:${randomUUID()}`,
    ),
  );
  const created = await gateway.createPayment({
    amountRial: draft.amountRial,
    description: `سنجه ${draft.invoiceNumber}`,
    callbackUrl: "http://localhost/cb",
    orderId: draft.invoiceNumber,
  });

  // ★ `storeAuthority: false` = **بازتولیدِ پنجره‌ی سقوط**: درگاه authority را ساخت،
  //   ما پیش از ذخیره‌اش مردیم.
  if (options.storeAuthority !== false) {
    await pool.query("UPDATE payments SET authority = $2 WHERE id = $1", [
      draft.paymentId,
      created.authority,
    ]);
  }
  return {
    paymentId: draft.paymentId,
    amountRial: draft.amountRial,
    authority: options.storeAuthority === false ? null : created.authority,
  };
}

/** ردیف را به گذشته می‌برد — «کاربر یک ساعت پیش پرداخت کرد و مرورگر را بست». */
async function agePayment(pool: pg.Pool, paymentId: string, minutes: number): Promise<void> {
  await pool.query(
    `UPDATE payments SET requested_at = now() - ($2 || ' minutes')::interval WHERE id = $1`,
    [paymentId, String(minutes)],
  );
}

/**
 * ★★ تصمیمِ **همین** پرداخت در گزارش.
 *
 * ⚠️ نگارشِ اول چک‌ها روی شمارنده‌های سراسریِ گزارش می‌نشستند (`report.skipped === 1`) و
 * اولین باری که دیتابیس ردیف‌های billingِ **دیگری** داشت (از `pnpm sdk:contract`) قرمز
 * شدند — بی‌آنکه چیزی در محصول خراب باشد. یک چک باید **ادعای خودش** را بسنجد، نه وضعیتِ
 * کلِ دیتابیس؛ در production همیشه ردیف‌های دیگری هست.
 */
const decisionFor = (
  report: { decisions: { paymentId: string; action: string; reason: string }[] },
  paymentId: string,
) => report.decisions.find((d) => d.paymentId === paymentId);

const statusOf = async (pool: pg.Pool, paymentId: string): Promise<string> =>
  (await pool.query<{ status: string }>("SELECT status FROM payments WHERE id = $1", [paymentId]))
    .rows[0]!.status;

const subCount = async (pool: pg.Pool, teamId: string, status = "active"): Promise<number> =>
  Number(
    (
      await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM subscriptions WHERE team_id = $1 AND status = $2",
        [teamId, status],
      )
    ).rows[0]!.n,
  );

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = createDbPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: 10,
  });
  const planCode = await ensureProbePlan(pool);
  const results: CheckResult[] = [];

  const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });
  };
  const failed = (name: string, error: unknown): void => {
    record(name, false, `خودِ چک شکست: ${String((error as Error).message)}`);
  };

  // ── ۱: ★★ callbackِ گم‌شده ⇒ آشتی‌دهی اشتراک را فعال می‌کند ────────────
  {
    const name = "★★ کاربر پول داد و مرورگر را بست ⇒ sweep اشتراک را فعال می‌کند";
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const payment = await startCheckout(pool, gateway, teamId, userId, planCode);
      await agePayment(pool, payment.paymentId, 60);

      const report = await runReconcile({ pool, gateway }, policy());
      const status = await statusOf(pool, payment.paymentId);
      const subs = await subCount(pool, teamId);
      const invoice = (
        await pool.query<{ status: string }>(
          "SELECT status FROM invoices WHERE team_id = $1 LIMIT 1",
          [teamId],
        )
      ).rows[0]!.status;

      const ok =
        decisionFor(report, payment.paymentId)?.action === "verify" &&
        report.activated >= 1 &&
        status === "paid" &&
        subs === 1 &&
        invoice === "paid";
      record(
        name,
        ok,
        ok
          ? `activated=۱ · پرداخت=paid · اشتراکِ فعال=۱ · فاکتور=paid ⇒ «پول گرفته شد، سرویس داده نشد» بسته شد`
          : `انتظار: activated=1/paid/1/paid. واقعی: ${JSON.stringify({ activated: report.activated, status, subs, invoice, errors: report.errors })}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۲: ★ خودآزمونِ درجا — همان صحنه، **بدونِ** sweep ─────────────────
  {
    const name = "★ خودآزمون: همان صحنه بدونِ sweep ⇒ pending می‌مانَد و اشتراکی نیست";
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const payment = await startCheckout(pool, gateway, teamId, userId, planCode);
      await agePayment(pool, payment.paymentId, 60);
      // ← عمداً هیچ runReconcileی صدا زده نمی‌شود.

      const status = await statusOf(pool, payment.paymentId);
      const subs = await subCount(pool, teamId);
      const ok = status === "pending" && subs === 0;
      record(
        name,
        ok,
        ok
          ? "pending و بدونِ اشتراک ⇒ سبزیِ چکِ ۱ از خودِ sweep می‌آید، نه از صحنه‌آرایی"
          : `انتظار: pending/۰. واقعی: ${status}/${subs}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۳: ردیفِ جوان دست نمی‌خورد ────────────────────────────────────────
  {
    const name = "ردیفِ جوان دست نمی‌خورد — کاربر ممکن است هنوز روی صفحه‌ی بانک باشد";
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const payment = await startCheckout(pool, gateway, teamId, userId, planCode);
      // بدونِ agePayment ⇒ سنِ ~صفر

      const report = await runReconcile({ pool, gateway }, policy());
      const status = await statusOf(pool, payment.paymentId);
      const mine = decisionFor(report, payment.paymentId);
      const ok = mine?.action === "skip" && mine.reason === "tooYoung" && status === "pending";
      record(
        name,
        ok,
        ok
          ? "تصمیمِ همین ردیف skip/tooYoung بود و هنوز pending است"
          : `انتظار: skip/tooYoung/pending. واقعی: ${JSON.stringify({ mine, status })}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۴: ★★ B-3 — پروسه‌ی بی‌کوئرس رد می‌شود ────────────────────────────
  //
  // ⚠️ **نگارشِ اولِ این چک غلط بود و خودش این را نشان داد:** یک `new pg.Pool` در همین
  //    پروسه هم عدد می‌داد. علتش این است که `registerInt8Parser` روی `pg.types`ِ **سراسری**
  //    می‌نشیند، نه روی استخر — پس به‌محضِ اینکه یک `createDbPool` جایی اجرا شود، همه‌ی
  //    استخرهای آن پروسه کوئرس می‌گیرند. یعنی B-3 خطرِ **پروسه** است، نه خطرِ استخر:
  //    اسکریپتی که هرگز `createDbPool` را صدا نمی‌زند. پس چک در یک پروسه‌ی **جدا** اجرا
  //    می‌شود — همان‌جایی که خطر واقعاً هست.
  {
    const name = "★★ B-3: پروسه‌ای که createDbPool ندارد، آشتی‌دهی را اجرا نمی‌کند";
    try {
      const moduleUrl = new URL("../apps/api/src/services/reconcile.ts", import.meta.url).href;
      const child = `
import pg from "pg";
import { runReconcile } from ${JSON.stringify(moduleUrl)};
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const probe = await pool.query("SELECT 1000::bigint AS probe");
console.log("TYPE:" + typeof probe.rows[0].probe);
const gateway = {
  name: "mock", mode: "sandbox", developmentOnly: true,
  createPayment: async () => ({ authority: "x", redirectUrl: "y" }),
  verifyPayment: async () => ({ status: "gatewayError", code: null, message: "" }),
};
try {
  await runReconcile({ pool, gateway }, { staleAfterMs: 1, expireAfterMs: 2, batchSize: 1, adoptOrphans: false, dryRun: true });
  console.log("RESULT:RAN");
} catch {
  console.log("RESULT:REFUSED");
}
await pool.end();
`;
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
        env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
        encoding: "utf8",
      });
      const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
      const sawString = out.includes("TYPE:string");
      const refused = out.includes("RESULT:REFUSED");
      const goodType = typeof (await pool.query<{ probe: unknown }>("SELECT 1000::bigint AS probe"))
        .rows[0]!.probe;

      const ok = sawString && refused && goodType === "number";
      record(
        name,
        ok,
        ok
          ? "پروسه‌ی خام bigint را «string» می‌دهد و آشتی‌دهی همان‌جا رد شد · این پروسه (createDbPool) «number»"
          : `انتظار: TYPE:string + RESULT:REFUSED + number. واقعی: ${JSON.stringify({ out: out.trim().slice(0, 200), goodType })}`,
      );
    } catch (error) {
      failed(name, error);
    }
  }

  // ── ۵: ردیفِ یتیم گزارش می‌شود، نه failed ────────────────────────────
  {
    const name = "★ ردیفِ بدونِ authority یتیم است — گزارش می‌شود و هرگز خودکار failed نمی‌شود";
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const payment = await startCheckout(pool, gateway, teamId, userId, planCode, {
        storeAuthority: false,
      });
      await agePayment(pool, payment.paymentId, 200 * 60); // خیلی کهنه

      const report = await runReconcile({ pool, gateway }, policy());
      const status = await statusOf(pool, payment.paymentId);
      const mine = decisionFor(report, payment.paymentId);
      const ok = mine?.action === "orphan" && report.expired === 0 && status === "pending";
      record(
        name,
        ok,
        ok
          ? "تصمیم orphan بود · هیچ‌چیز باطل نشد · هنوز pending ⇒ پولِ احتمالاً گرفته‌شده نامرئی نمی‌شود"
          : `انتظار: orphan/expired=0/pending. واقعی: ${JSON.stringify({ mine, expired: report.expired, status })}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۶: ★ فرزندخواندگی، و ردِ ابهام ───────────────────────────────────
  {
    const name = "★ فرزندخواندگی پنجره‌ی سقوطِ authority را می‌بندد — و ابهام را رد می‌کند";
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      // یتیم: درگاه authority ساخت، ما پیش از ذخیره‌اش مردیم.
      const orphan = await startCheckout(pool, gateway, teamId, userId, planCode, {
        storeAuthority: false,
      });
      await agePayment(pool, orphan.paymentId, 60);

      const adopted = await runReconcile({ pool, gateway }, policy({ adoptOrphans: true }));
      const status = await statusOf(pool, orphan.paymentId);
      const subs = await subCount(pool, teamId);

      // حالا ابهام: **دو** یتیمِ هم‌مبلغ ⇒ هیچ‌کدام نباید فرزندخوانده شوند.
      const a = await startCheckout(pool, gateway, teamId, userId, planCode, {
        storeAuthority: false,
        seats: 2,
      });
      const b = await startCheckout(pool, gateway, teamId, userId, planCode, {
        storeAuthority: false,
        seats: 2,
      });
      await agePayment(pool, a.paymentId, 60);
      await agePayment(pool, b.paymentId, 60);
      const ambiguous = await runReconcile({ pool, gateway }, policy({ adoptOrphans: true }));

      // ★ ادعا روی **ردیفِ خودمان**: authority نشست و تسویه شد؛ و دو یتیمِ هم‌مبلغ
      //   هنوز authority ندارند (یعنی واقعاً رد شدند، نه اینکه اتفاقی pending مانده باشند).
      const authorityOf = async (id: string): Promise<string | null> =>
        (
          await pool.query<{ authority: string | null }>(
            "SELECT authority FROM payments WHERE id = $1",
            [id],
          )
        ).rows[0]!.authority;
      const ok =
        adopted.adopted >= 1 &&
        (await authorityOf(orphan.paymentId)) !== null &&
        status === "paid" &&
        subs === 1 &&
        (await authorityOf(a.paymentId)) === null &&
        (await authorityOf(b.paymentId)) === null &&
        (await statusOf(pool, a.paymentId)) === "pending" &&
        (await statusOf(pool, b.paymentId)) === "pending";
      record(
        name,
        ok,
        ok
          ? "یک یتیم + یک نامزد ⇒ فرزندخوانده و فعال شد · دو یتیمِ هم‌مبلغ ⇒ هیچ‌کدام (ابهام رد شد)"
          : `واقعی: ${JSON.stringify({ adopted: adopted.adopted, status, subs, ambiguousAdopted: ambiguous.adopted })}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۷: ★★ نردبانِ دو-پله‌ای — اول بپرس، بعد باطل کن ──────────────────
  {
    const name = "★★ ردیفی که هرگز پرسیده نشده باطل نمی‌شود؛ بعد از یک پرسش، بله";
    const { userId, teamId } = await seedTeam(pool);
    try {
      // درگاهی که همیشه «پرداخت نشد» می‌گوید — یعنی کاربر واقعاً پولی نداد.
      const gateway = mock({ failEveryPayment: true });
      const payment = await startCheckout(pool, gateway, teamId, userId, planCode);
      await agePayment(pool, payment.paymentId, 200 * 60); // بالای سقفِ انقضا

      const first = await runReconcile({ pool, gateway }, policy());
      const afterFirst = await statusOf(pool, payment.paymentId);
      const code = (
        await pool.query<{ failure_code: string | null }>(
          "SELECT failure_code FROM payments WHERE id = $1",
          [payment.paymentId],
        )
      ).rows[0]!.failure_code;

      const second = await runReconcile({ pool, gateway }, policy());
      const afterSecond = await statusOf(pool, payment.paymentId);
      const invoice = (
        await pool.query<{ status: string }>(
          "SELECT status FROM invoices WHERE team_id = $1 LIMIT 1",
          [teamId],
        )
      ).rows[0]!.status;

      const ok =
        decisionFor(first, payment.paymentId)?.action === "verify" &&
        afterFirst === "pending" &&
        code !== null &&
        decisionFor(second, payment.paymentId)?.action === "expire" &&
        afterSecond === "canceled" &&
        invoice === "void";
      record(
        name,
        ok,
        ok
          ? `اجرای اول: پرسید و کدِ «${code}» را ثبت کرد (هنوز pending) · اجرای دوم: canceled + فاکتورِ void`
          : `واقعی: ${JSON.stringify({ first: decisionFor(first, payment.paymentId), afterFirst, code, second: decisionFor(second, payment.paymentId), afterSecond, invoice })}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۸: ★★ دو sweepِ هم‌زمان ⇒ یک اشتراک ─────────────────────────────
  {
    const name = "★★ دو آشتی‌دهیِ هم‌زمان روی یک پرداخت ⇒ دقیقاً یک اشتراک";
    const { userId, teamId } = await seedTeam(pool);
    try {
      const inner = mock();
      const gateway = slowGateway(inner); // ← بدونِ این، دو تراکنش هرگز هم‌پوشانی ندارند
      const payment = await startCheckout(pool, inner, teamId, userId, planCode);
      await agePayment(pool, payment.paymentId, 60);

      const [left, right] = await Promise.all([
        runReconcile({ pool, gateway }, policy()),
        runReconcile({ pool, gateway }, policy()),
      ]);

      const active = await subCount(pool, teamId);
      const total = Number(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM subscriptions WHERE team_id = $1",
            [teamId],
          )
        ).rows[0]!.n,
      );
      const activations = left.activated + right.activated;
      const ok = active === 1 && total === 1 && activations === 1;
      record(
        name,
        ok,
        ok
          ? `یک اشتراک (کل=۱) و فقط یک activation بینِ دو اجرا ⇒ قفلِ ردیف کار می‌کند`
          : `انتظار: ۱/۱/۱. واقعی: active=${active} total=${total} activations=${activations}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۹: اشتراکِ تمام‌شده بسته می‌شود ──────────────────────────────────
  {
    const name = "★ اشتراکِ تمام‌شده بسته می‌شود — لغوشده canceled، تمدیدنشده expired";
    const ended = await seedTeam(pool);
    const canceled = await seedTeam(pool);
    const alive = await seedTeam(pool);
    try {
      const insert = async (
        teamId: string,
        cancelAtPeriodEnd: boolean,
        endsInDays: number,
      ): Promise<void> => {
        await pool.query(
          `INSERT INTO subscriptions (id, team_id, plan_code, status, period, seats,
                                      current_period_start, current_period_end, cancel_at_period_end)
           VALUES ($1, $2, $3, 'active', 'monthly', 1,
                   now() - interval '40 days', now() + ($4 || ' days')::interval, $5)`,
          [randomUUID(), teamId, planCode, String(endsInDays), cancelAtPeriodEnd],
        );
      };
      await insert(ended.teamId, false, -10);
      await insert(canceled.teamId, true, -10);
      await insert(alive.teamId, false, 10);

      const report = await runReconcile({ pool, gateway: mock() }, policy());
      const statusFor = async (teamId: string): Promise<string> =>
        (
          await pool.query<{ status: string }>(
            "SELECT status FROM subscriptions WHERE team_id = $1",
            [teamId],
          )
        ).rows[0]!.status;

      const [a, b, c] = [
        await statusFor(ended.teamId),
        await statusFor(canceled.teamId),
        await statusFor(alive.teamId),
      ];
      const ok =
        a === "expired" && b === "canceled" && c === "active" && report.subscriptionsEnded >= 2;
      record(
        name,
        ok,
        ok
          ? "تمدیدنشده ⇒ expired · لغوشده ⇒ canceled · دوره‌ی زنده دست‌نخورده active"
          : `انتظار: expired/canceled/active. واقعی: ${a}/${b}/${c} (ended=${report.subscriptionsEnded})`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      for (const t of [ended, canceled, alive]) await cleanup(pool, t.teamId, t.userId);
    }
  }

  await pool.query("DELETE FROM plans WHERE code = $1", [planCode]).catch(() => undefined);
  await pool.end();

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ ${reds.length} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ آشتی‌دهی روی Postgresِ زنده اثبات شد (نه ادعا).");
}

await main();
