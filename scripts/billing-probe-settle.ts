/**
 * سنجه‌ی زنده‌ی M4 — **تسویه‌ی پرداخت روی Postgresِ واقعی** (فاز ۵ گام ۵٫۳/۵٫۴).
 *
 * ── چرا اسکریپت، نه تستِ واحد ──────────────────────────────────────────
 *
 * ادعای مرکزیِ [ADR-050](../ARCHITECTURE_DECISIONS.md#adr-050) این است که **دو تسویه‌ی
 * هم‌زمانِ یک پرداخت، یک اشتراک می‌سازند**. این را هیچ تستِ واحدی نمی‌سنجد: تست‌های
 * `apps/api` روی `fakeDb` می‌دوند و اصلاً تراکنش و `FOR UPDATE` ندارند. همان درسی که
 * هفت سنجه‌ی `rt:*`ِ M2 داد — رفتارِ همزمانی فقط روی زیرساختِ واقعی دیده می‌شود.
 *
 * چهار چیز را می‌سنجد:
 *   ۱. جریانِ کامل: checkout → پرداخت → تسویه → اشتراکِ فعال + فاکتورِ paid.
 *   ۲. ★★ **دو تسویه‌ی هم‌زمان ⇒ دقیقاً یک اشتراک، یک فاکتورِ paid، یک ردیفِ paid.**
 *   ۳. ★ تسویه‌ی دوباره بعد از اتمام ⇒ `alreadySettled` **بدونِ** تماسِ دوباره با درگاه.
 *   ۴. ★★ سناریوی «callback گم شد»: ردیفِ ما `pending` ولی درگاه ۱۰۱ می‌دهد ⇒ **باید فعال
 *      شود**. این همان موردی است که بندِ تحت‌اللفظیِ ADR-050 اشتباه می‌گرفت (ADR-055).
 *
 * ★ **خودآزمون** (دستی، چون قفل در خودِ سرویس است نه یک فلگ): `FOR UPDATE` را از
 * `services/billing.ts` بردار و این سنجه را بزن — چکِ اول باید **قرمز** شود (دو اشتراک).
 * ⚠️ عمداً فلگِ `--no-lock` نگذاشتیم: یک فلگ که مسیرِ محصولی را دور بزند، دیگر همان چیزی
 * را نمی‌سنجد که در production اجرا می‌شود.
 *
 * اجرا: `pnpm billing:settle` (بعد از `pnpm db:up && pnpm db:migrate`).
 */
import { randomUUID } from "node:crypto";

import { MockGateway, type PaymentGateway } from "@hamboom/billing-core";
import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

import { createDbPool, withTransaction } from "../apps/api/src/plugins/db.ts";
import { createCheckout, settlePayment } from "../apps/api/src/services/billing.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * ★★ **درگاهِ عمداً کُند — بدونِ این، سنجه یک گیتِ دروغین است.**
 *
 * نگارشِ اول با `MockGateway`ِ معمولی نوشته شد و «سبز» بود؛ ولی وقتی `FOR UPDATE` را عمداً
 * برداشتم **باز هم سبز مانْد**. یعنی دو تسویه هرگز واقعاً هم‌زمان نبودند: چون verifyِ mock
 * همزمان برمی‌گشت، اولی commit می‌کرد پیش از آنکه دومی SELECT بزند.
 *
 * با یک تاخیرِ واقعی داخلِ verify، تراکنشِ دوم **مجبور** می‌شود وسطِ ناحیه‌ی بحرانیِ اولی
 * برسد — و آن‌وقت وجود یا نبودِ قفل تفاوت می‌سازد. همان درسِ «تستِ خودآزمون‌نشده گیت نیست»،
 * این‌بار روی خودِ سنجه.
 */
function slowGateway(inner: MockGateway): PaymentGateway {
  return {
    name: inner.name,
    mode: inner.mode,
    developmentOnly: inner.developmentOnly,
    createPayment: (input) => inner.createPayment(input),
    verifyPayment: async (input) => {
      await new Promise((r) => setTimeout(r, 250));
      return inner.verifyPayment(input);
    },
  };
}

/** یک تیم + کاربرِ تازه — هر اجرا ایزوله. */
async function seedTeam(pool: pg.Pool): Promise<{ userId: string; teamId: string }> {
  const userId = randomUUID();
  const teamId = randomUUID();
  await pool.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, $2, $3)", [
    userId,
    "سنجه‌ی تسویه",
    "#3366cc",
  ]);
  await pool.query("INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, $3, $4)", [
    teamId,
    `settle-${teamId.slice(0, 8)}`,
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

/** یک پلنِ فعالِ آزمایشی می‌سازد (seedِ واقعی `pro` را غیرفعال گذاشته). */
async function ensureProbePlan(pool: pg.Pool): Promise<string> {
  const code = "probe_paid";
  await pool.query(
    `INSERT INTO plans (code, name, description, price_monthly_rial, price_yearly_rial,
                        max_members, max_boards, max_storage_bytes, features, is_active, sort_order)
     VALUES ($1, 'پلنِ سنجه', 'فقط برای سنجه', 1990000, 19900000, 10, -1, 1073741824, '[]'::jsonb, true, 99)
     ON CONFLICT (code) DO UPDATE SET is_active = true`,
    [code],
  );
  return code;
}

/** checkout را می‌سازد و authority را روی ردیف می‌نشاند — همان کاری که route می‌کند. */
async function startCheckout(
  pool: pg.Pool,
  gateway: PaymentGateway,
  teamId: string,
  userId: string,
  planCode: string,
): Promise<{ paymentId: string; authority: string }> {
  const draft = await withTransaction(pool, async (tx) =>
    createCheckout(
      tx,
      {
        teamId,
        userId,
        planCode,
        period: "monthly",
        seats: 3,
        vatPercent: 10,
        gatewayName: gateway.name,
        gatewayMode: gateway.mode,
      },
      `${teamId}:${randomUUID()}`,
    ),
  );
  const created = await gateway.createPayment({
    amountRial: draft.amountRial,
    description: "سنجه",
    callbackUrl: "http://localhost/cb",
  });
  await pool.query(
    "UPDATE payments SET authority = $2, gateway = 'mock', gateway_mode = 'sandbox' WHERE id = $1",
    [draft.paymentId, created.authority],
  );
  return { paymentId: draft.paymentId, authority: created.authority };
}

async function counts(
  pool: pg.Pool,
  teamId: string,
): Promise<{ subs: number; paidInvoices: number; paidPayments: number }> {
  // ⚠️ عمداً `count(*)` و نه `sum()` — `sum` روی bigint نوعِ numeric می‌دهد که کوئرس نمی‌شود (B-2).
  const q = async (sql: string): Promise<number> =>
    Number((await pool.query<{ n: string | number }>(sql, [teamId])).rows[0]!.n);
  return {
    subs: await q("SELECT count(*) n FROM subscriptions WHERE team_id = $1"),
    paidInvoices: await q("SELECT count(*) n FROM invoices WHERE team_id = $1 AND status = 'paid'"),
    paidPayments: await q("SELECT count(*) n FROM payments WHERE team_id = $1 AND status = 'paid'"),
  };
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = createDbPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: 8,
  });

  const results: CheckResult[] = [];
  const planCode = await ensureProbePlan(pool);

  // ── ۱ + ۲: جریانِ کامل و دو تسویه‌ی هم‌زمان ────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const inner = new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });
      const gateway = slowGateway(inner);
      const { authority } = await startCheckout(pool, gateway, teamId, userId, planCode);

      // ★★ دقیقاً سناریوی «کاربر روی صفحه‌ی بازگشت رفرش زد» یا «callback و verifyِ دستی با هم».
      const [a, b] = await Promise.all([
        settlePayment({ pool, gateway }, { by: "authority", authority }),
        settlePayment({ pool, gateway }, { by: "authority", authority }),
      ]);

      const c = await counts(pool, teamId);
      const activated = [a, b].filter((r) => r.kind === "activated").length;
      const already = [a, b].filter((r) => r.kind === "alreadySettled").length;
      const ok = c.subs === 1 && c.paidInvoices === 1 && c.paidPayments === 1 && activated === 1;

      results.push({
        name: "★★ دو تسویه‌ی هم‌زمان ⇒ دقیقاً یک اشتراک، یک فاکتورِ paid، یک پرداختِ paid",
        ok,
        detail: ok
          ? `اشتراک=${c.subs} · فاکتورِ paid=${c.paidInvoices} · پرداختِ paid=${c.paidPayments} · ` +
            `activated=${activated}، alreadySettled=${already} ⇒ قفلِ ردیف کار کرد`
          : `انتظار: ۱/۱/۱ و یک activated. واقعی: اشتراک=${c.subs} فاکتور=${c.paidInvoices} ` +
            `پرداخت=${c.paidPayments} activated=${activated}`,
      });

      // ── ۳: تسویه‌ی سومِ بعد از اتمام ⇒ alreadySettled، بدونِ تماسِ دوباره ──
      const third = await settlePayment({ pool, gateway }, { by: "authority", authority });
      const after = await counts(pool, teamId);
      const okThird = third.kind === "alreadySettled" && after.subs === 1;
      results.push({
        name: "★ تسویه‌ی دوباره‌ی بعدی ⇒ `alreadySettled` و هیچ اشتراکِ تازه‌ای",
        ok: okThird,
        detail: okThird
          ? `نتیجه=${third.kind} و اشتراک هنوز ${after.subs} ⇒ رفرشِ مرورگر بی‌خطر است`
          : `انتظار: alreadySettled و ۱ اشتراک. واقعی: ${third.kind}، اشتراک=${after.subs}`,
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۴: ★★ «callback گم شد» — ردیفِ ما pending، درگاه ۱۰۱ ─────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });
      const { authority, paymentId } = await startCheckout(pool, gateway, teamId, userId, planCode);

      // درگاه یک‌بار verify می‌شود (مثلِ auto-verify یا callbackی که به ما نرسید) ⇒ دفعه‌ی بعد ۱۰۱.
      const amount = Number(
        (await pool.query<{ amount_rial: number }>("SELECT amount_rial FROM payments WHERE id = $1", [
          paymentId,
        ])).rows[0]!.amount_rial,
      );
      const first = await gateway.verifyPayment({ authority, amountRial: amount });
      const gatewaySaysAlready = first.status === "paid" && !first.alreadyVerified;

      // حالا آشتی‌دهی سراغِ ردیفِ `pending`ِ ما می‌آید و درگاه **۱۰۱** می‌دهد.
      const settled = await settlePayment({ pool, gateway }, { by: "id", id: paymentId });
      const c = await counts(pool, teamId);
      const ok = gatewaySaysAlready && settled.kind === "activated" && c.subs === 1;

      results.push({
        name: "★★ «callback گم شد» — ردیفِ ما pending و درگاه ۱۰۱ ⇒ **باید فعال شود**",
        ok,
        detail: ok
          ? "اشتراک فعال شد ⇒ «پول گرفته شد ولی سرویس داده نشد» رخ نمی‌دهد.\n" +
            "    ★ این همان بندی است که ADR-050 تحت‌اللفظی اشتباه می‌گرفت (ADR-055)."
          : `انتظار: activated و ۱ اشتراک. واقعی: ${settled.kind}، اشتراک=${c.subs}`,
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  await pool.query("DELETE FROM plans WHERE code = $1", [planCode]).catch(() => undefined);
  await pool.end();

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ تسویه روی Postgresِ زنده اثبات شد (نه ادعا).");
}

await main();
