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
        (
          await pool.query<{ amount_rial: number }>(
            "SELECT amount_rial FROM payments WHERE id = $1",
            [paymentId],
          )
        ).rows[0]!.amount_rial,
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

  // ── ۵: ★★ «هنوز پرداخت نشده» نباید ردیف را از دیدِ sweep پنهان کند (یافته‌ی T5) ──
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const inner = new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });
      const { paymentId } = await startCheckout(pool, inner, teamId, userId, planCode);
      // درگاه می‌گوید «پرداخت نشده» (کاربر هنوز روی صفحه‌ی بانک است).
      const failing = slowGateway(
        new MockGateway({ checkoutBaseUrl: "http://localhost/pay", failEveryPayment: true }),
      );
      const out = await settlePayment({ pool, gateway: failing }, { by: "id", id: paymentId });
      const { rows } = await pool.query<{ status: string; failure_code: string | null }>(
        "SELECT status, failure_code FROM payments WHERE id = $1",
        [paymentId],
      );
      const row = rows[0]!;
      const ok = out.kind === "notPaid" && row.status === "pending";
      results.push({
        name: "★★ verdictِ «پرداخت نشد» ردیف را `pending` نگه می‌دارد (sweep بازش می‌بیند)",
        ok,
        detail: ok
          ? `status=${row.status} · failure_code=${String(row.failure_code)} ⇒ ایندکسِ ` +
            "`payments_pending_idx` هنوز می‌بیندش. اگر `failed` می‌شد، پرداختی که کاربر " +
            "لحظه‌ای بعد کامل می‌کرد **برای همیشه نامرئی** می‌ماند."
          : `انتظار: notPaid و status=pending. واقعی: ${out.kind}، status=${row.status}`,
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۶: ★★ ردیفِ `refunded` نباید دوباره فعال شود (یافته‌ی T6) ──────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const inner = new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });
      const gateway = slowGateway(inner);
      const { paymentId, authority } = await startCheckout(pool, inner, teamId, userId, planCode);
      await settlePayment({ pool, gateway }, { by: "authority", authority });
      // پول برگشت داده شد (کارِ M6، ولی وضعیتش امروز هم مجاز است).
      await pool.query("UPDATE payments SET status = 'refunded' WHERE id = $1", [paymentId]);
      await pool.query("DELETE FROM subscriptions WHERE activated_by_payment_id = $1", [paymentId]);

      const again = await settlePayment({ pool, gateway }, { by: "id", id: paymentId });
      const c = await counts(pool, teamId);
      const ok = again.kind === "alreadySettled" && c.subs === 0;
      results.push({
        name: "★★ پرداختِ `refunded` دوباره فعال نمی‌شود",
        ok,
        detail: ok
          ? "نتیجه=alreadySettled و صفر اشتراکِ تازه ⇒ خروجِ زودهنگام روی **هر** وضعیتِ " +
            "غیر-pending است، نه فقط `paid`"
          : `انتظار: alreadySettled و ۰ اشتراک. واقعی: ${again.kind}، اشتراک=${c.subs}`,
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۷: ★★ کوپن با شکستِ checkout نمی‌سوزد (یافته‌ی T2) ─────────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    const code = `PRB${String(Date.now()).slice(-9)}`;
    try {
      await pool.query(
        "INSERT INTO coupons (code, percent_off, max_redemptions) VALUES ($1, 20, 5)",
        [code],
      );
      const gateway = new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });
      // یک checkoutِ کامل با کوپن، که **پرداخت نمی‌شود**.
      const draft = await withTransaction(pool, async (tx) =>
        createCheckout(
          tx,
          {
            teamId,
            userId,
            planCode,
            period: "monthly",
            seats: 1,
            couponCode: code,
            vatPercent: 10,
            gatewayName: gateway.name,
            gatewayMode: gateway.mode,
          },
          `${teamId}:${randomUUID()}`,
        ),
      );
      const burnedEarly = Number(
        (
          await pool.query<{ n: string | number }>(
            "SELECT count(*) n FROM coupon_redemptions WHERE coupon_code = $1",
            [code],
          )
        ).rows[0]!.n,
      );
      // حالا همان کوپن باید هنوز برای یک checkoutِ دیگر قابلِ استفاده باشد.
      let reusable = true;
      try {
        await withTransaction(pool, async (tx) =>
          createCheckout(
            tx,
            {
              teamId,
              userId,
              planCode,
              period: "monthly",
              seats: 1,
              couponCode: code,
              vatPercent: 10,
              gatewayName: gateway.name,
              gatewayMode: gateway.mode,
            },
            `${teamId}:${randomUUID()}`,
          ),
        );
      } catch {
        reusable = false;
      }
      const ok = burnedEarly === 0 && reusable;
      results.push({
        name: "★★ کوپن سرِ checkout **مصرف نمی‌شود** — فقط سرِ فعال‌سازی",
        ok,
        detail: ok
          ? "بعد از checkoutِ پرداخت‌نشده صفر ردیفِ مصرف، و همان کوپن هنوز قابلِ استفاده ⇒ " +
            "یک اختلالِ درگاه دیگر کوپنِ کاربر را برای همیشه نمی‌سوزاند"
          : `انتظار: ۰ مصرف و قابلِ استفاده. واقعی: مصرف=${burnedEarly}، قابلِ استفاده=${reusable}`,
      });
      void draft;
    } finally {
      await pool.query("DELETE FROM coupon_redemptions WHERE coupon_code = $1", [code]);
      await cleanup(pool, teamId, userId);
      await pool.query("DELETE FROM coupons WHERE code = $1", [code]);
    }
  }

  // ── ۸: ★ همان کلیدِ idempotency ⇒ همان پیش‌نویس، نه ۵۰۰ (یافته‌ی T1) ────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });
      const key = `${teamId}:${randomUUID()}`;
      const mk = async () =>
        withTransaction(pool, async (tx) =>
          createCheckout(
            tx,
            {
              teamId,
              userId,
              planCode,
              period: "monthly",
              seats: 2,
              vatPercent: 10,
              gatewayName: gateway.name,
              gatewayMode: gateway.mode,
            },
            key,
          ),
        );
      const first = await mk();
      const second = await mk();
      const invoices = Number(
        (
          await pool.query<{ n: string | number }>(
            "SELECT count(*) n FROM invoices WHERE team_id = $1",
            [teamId],
          )
        ).rows[0]!.n,
      );
      const ok =
        !first.replayed &&
        second.replayed &&
        first.paymentId === second.paymentId &&
        invoices === 1;
      results.push({
        name: "★ همان کلیدِ idempotency ⇒ همان پیش‌نویس برمی‌گردد (نه ۵۰۰ی همیشگی)",
        ok,
        detail: ok
          ? `replayed=${second.replayed} · همان paymentId · تعدادِ فاکتور=${invoices} ⇒ ` +
            "retryِ بعد از خطای درگاه دیگر برای همیشه نمی‌شکند و شماره‌ی فاکتورِ دوم نمی‌سوزد"
          : `انتظار: دومی replayed با همان id و ۱ فاکتور. واقعی: ${JSON.stringify({ f: first.replayed, s: second.replayed, same: first.paymentId === second.paymentId, invoices })}`,
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۹: ★ تمدیدِ همان پلن دوره را **ادامه** می‌دهد، نه از نو (یافته‌ی T8) ─
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const inner = new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });
      const gateway = slowGateway(inner);
      const a = await startCheckout(pool, inner, teamId, userId, planCode);
      await settlePayment({ pool, gateway }, { by: "authority", authority: a.authority });
      const firstEnd = (
        await pool.query<{ current_period_end: Date }>(
          "SELECT current_period_end FROM subscriptions WHERE team_id = $1",
          [teamId],
        )
      ).rows[0]!.current_period_end;

      // تمدیدِ بلافاصله — یعنی مشتری هنوز ~یک ماهِ پرداخت‌شده دارد.
      const b = await startCheckout(pool, inner, teamId, userId, planCode);
      await settlePayment({ pool, gateway }, { by: "authority", authority: b.authority });
      const secondEnd = (
        await pool.query<{ current_period_end: Date }>(
          `SELECT current_period_end FROM subscriptions
            WHERE team_id = $1 AND status = 'active'`,
          [teamId],
        )
      ).rows[0]!.current_period_end;

      const grewByAboutAMonth = secondEnd.getTime() - firstEnd.getTime() > 27 * 86_400_000;
      results.push({
        name: "★ تمدیدِ همان پلن از **پایانِ دوره‌ی فعلی** ادامه می‌دهد، نه از امروز",
        ok: grewByAboutAMonth,
        detail: grewByAboutAMonth
          ? `پایانِ دوره از ${firstEnd.toISOString().slice(0, 10)} به ` +
            `${secondEnd.toISOString().slice(0, 10)} رفت ⇒ روزهای پرداخت‌شده از بین نرفتند`
          : `انتظار: افزایشِ ~یک ماه. واقعی: ${firstEnd.toISOString()} → ${secondEnd.toISOString()}`,
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۹: ★★ **دو نود، یک `Idempotency-Key`** — ممیزیِ M5 گام ۶٫۳ ──────────
  //
  // ⚠️ میان‌افزارِ `idempotency.ts` **حافظه‌ای و تک‌نودی** است، پس با دو نود اصلاً وارد
  //    عمل نمی‌شود. سوال این است: آیا لایه‌ی دیتابیس به‌تنهایی کافی است؟
  //    ★ این‌جا با دو **استخرِ جدا** (شبیه‌سازیِ دو فرایندِ api) و **هم‌زمان** سنجیده می‌شود،
  //    نه با دو فراخوانیِ پشتِ سرِ هم که مسئله را نامرئی می‌کند (درسِ M4).
  {
    const { userId, teamId } = await seedTeam(pool);
    const nodeB = createDbPool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL,
      poolMax: 4,
    });
    try {
      const key = `${teamId}:cross-node`;
      const input = {
        teamId,
        userId,
        planCode,
        period: "monthly" as const,
        seats: 3,
        vatPercent: 10,
        gatewayName: "mock",
        gatewayMode: "sandbox" as const,
      };
      const attempt = (p: pg.Pool) =>
        withTransaction(p, async (tx) => createCheckout(tx, input, key)).then(
          (d) => ({ ok: true as const, id: d.paymentId }),
          (e: unknown) => ({ ok: false as const, message: String((e as Error).message) }),
        );

      const [a, b] = await Promise.all([attempt(pool), attempt(nodeB)]);
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM payments WHERE idempotency_key = $1",
        [key],
      );
      const created = Number(rows[0]?.n ?? 0);
      const succeeded = [a, b].filter((r) => r.ok);

      /**
       * ★★ **و حالا همان کار، این‌بار با هم‌پوشانیِ اجباری.**
       *
       * ⚠️ چکِ بالا سبز شد ولی **اثبات نمی‌کند** دو تراکنش هم‌پوشانی داشته‌اند — همان
       * تله‌ای که در M4 سه بار خورد. `createCheckout` نقطه‌ی تزریقی بینِ `SELECT` و
       * `INSERT` ندارد، پس **شکلش** این‌جا با SQLِ خام بازسازی می‌شود و یک `pg_sleep`
       * واقعی وسطش می‌نشیند تا هر دو نود **قبل از** insertِ یکدیگر جست‌وجو کنند.
       *
       * این چیزی است که به سوالِ ممیزی جواب می‌دهد: بازنده چه می‌بیند؟
       */
      const overlapKey = `${teamId}:cross-node-overlap`;
      const raceShape = async (p: pg.Pool): Promise<string> => {
        const c = await p.connect();
        try {
          await c.query("BEGIN");
          const found = await c.query("SELECT id FROM payments WHERE idempotency_key = $1", [
            overlapKey,
          ]);
          // ★ تاخیرِ **واقعی** داخلِ ناحیه‌ی بحرانی — بدونِ این، دو تراکنش هرگز به هم نمی‌رسند.
          await c.query("SELECT pg_sleep(0.4)");
          if (found.rows.length > 0) {
            await c.query("COMMIT");
            return "replayed";
          }
          await c.query(
            `INSERT INTO payments (id, team_id, initiated_by, gateway, gateway_mode, amount_rial, status, idempotency_key)
             VALUES (gen_random_uuid(), $1, $2, 'mock', 'sandbox', 1000, 'pending', $3)`,
            [teamId, userId, overlapKey],
          );
          await c.query("COMMIT");
          return "inserted";
        } catch (error) {
          await c.query("ROLLBACK").catch(() => undefined);
          return `خطا: ${String((error as { code?: string }).code ?? (error as Error).message)}`;
        } finally {
          c.release();
        }
      };
      const [ra, rb] = await Promise.all([raceShape(pool), raceShape(nodeB)]);
      const overlapRows = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM payments WHERE idempotency_key = $1",
        [overlapKey],
      );

      results.push({
        name: "★★ با هم‌پوشانیِ **اجباری**: یک ردیف می‌مانَد، و بازنده خطای یکتایی می‌گیرد",
        ok: Number(overlapRows.rows[0]?.n ?? 0) === 1,
        detail: `نودِ ۱ ⇒ ${ra} · نودِ ۲ ⇒ ${rb} · ردیف: ${overlapRows.rows[0]?.n ?? "?"}`,
      });

      results.push({
        name: "★★ دو نود با یک Idempotency-Key ⇒ فقط **یک** ردیفِ پرداخت",
        // ادعا فقط **یکتاییِ ردیف** است. اینکه بازنده چه می‌بیند، پایین جدا گزارش می‌شود.
        ok: created === 1,
        detail:
          `ردیف‌های ساخته‌شده: ${String(created)} · موفق: ${String(succeeded.length)} از ۲` +
          (succeeded.length === 2 && a.ok && b.ok
            ? ` · هر دو همان شناسه را گرفتند: ${String(a.id === b.id)}`
            : ` · بازنده: ${[a, b].find((r) => !r.ok)?.message.slice(0, 90) ?? "—"}`),
      });
    } finally {
      await nodeB.end().catch(() => undefined);
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
