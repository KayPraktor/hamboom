/**
 * سنجه‌ی زنده‌ی M6 — **استرداد روی Postgresِ واقعی** (فاز ۶٫۴،
 * [ADR-068](../ARCHITECTURE_DECISIONS.md#adr-068)).
 *
 * ── چرا اسکریپت، نه تستِ واحد ──────────────────────────────────────────
 *
 * ادعای مرکزیِ این فاز این است که **استرداد و تسویه‌ی هم‌زمان یک حقیقت می‌سازند، نه دو تا**. آن را
 * هیچ تستِ واحدی نمی‌سنجد: تست‌های `apps/api` روی `fakeDb` می‌دوند و نه تراکنش دارند نه `FOR UPDATE`.
 * و دو قیدِ دیگر فقط روی دیتابیسِ واقعی دیده می‌شوند — CHECKهای migrationِ `0009` و
 * `subscriptions_active_uq`.
 *
 * نُه چک:
 *   ۱. ★★ استرداد ↔ callbackِ دیرهنگام با هم‌پوشانیِ **اجباری** ⇒ یک حقیقت.
 *   ۲. ★★ ردیفِ `refunded` با کدِ ۱۰۱ دوباره فعال **نمی‌شود** (یافته‌ی T6، این‌بار از مسیرِ واقعی).
 *   ۳. ★★ تمدید: استردادِ پرداختِ نو ⇒ اشتراکِ **قبلی برمی‌گردد**؛ استردادِ پرداختِ قدیم ⇒ اشتراکِ زنده دست‌نخورده.
 *   ۴. مبلغِ استرداد همیشه `payments.amount_rial` است، حتی بعد از تغییرِ `plans.price_*`.
 *   ۵. استردادِ دوباره ⇒ `INVALID_TRANSITION` و هیچ تغییرِ دومی.
 *   ۶. ★★ درگاهِ زرین‌پال ⇒ `REFUND_UNAVAILABLE`، **صفر** تماسِ شبکه، ردیف دست‌نخورده.
 *   ۷. ★ ردیفِ درگاه/حالتِ دیگر ⇒ ۴۰۹ CONFLICT پیش از هر تماس.
 *   ۸. ★★ شکستِ عمدیِ audit **بعد از** UPDATE ⇒ نه استرداد می‌مانَد نه ردیفِ audit (ADR-067 §۱).
 *   ۹. `paid_at` بعد از استرداد می‌مانَد و CHECKِ `0009` ردیفِ ناقص را رد می‌کند.
 *  ۱۰. ★★ **دو استردادِ هم‌زمان** با تاخیرِ اجباری داخلِ ناحیه‌ی بحرانی ⇒ یک استرداد، یک ردیفِ audit.
 *
 * ★ هر بلوک try/catch دارد: شکستِ خودِ سنجه باید یک چکِ **قرمز** باشد، نه crash.
 *
 * ★★ **خودآزمون، و یک سبزِ دروغینِ واقعی که همین‌جا گرفته شد:** با برداشتنِ `FOR UPDATE` از
 * `refundPayment`، چکِ ۱ **سبز مانْد** — چون `settlePayment` خودش زودتر همان ردیف را قفل می‌کند و
 * `UPDATE`ِ استرداد پشتِ آن قفل سریالی می‌شود. یعنی آن چک هرگز قفلِ **استرداد** را نمی‌سنجید.
 * چکِ ۱۰ با دو استردادِ هم‌زمان و درگاهی که **داخلِ** استرداد ۳۰۰ms کُند است دقیقاً همان را می‌سنجد و
 * بدونِ قفل قرمز می‌شود (دو ردیفِ audit، دو لغوِ اشتراک). درسِ سه‌بارتکرارشده‌ی M4، این‌بار روی استرداد.
 *
 * اجرا: `pnpm billing:refund` (بعد از `pnpm db:up && pnpm db:migrate`).
 */
import { randomUUID } from "node:crypto";

import { MockGateway, ZarinpalGateway, type PaymentGateway } from "@hamboom/billing-core";
import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

import { recordAudit } from "../apps/api/src/audit.ts";
import { createDbPool, withTransaction } from "../apps/api/src/plugins/db.ts";
import {
  createCheckout,
  refundPayment,
  settlePayment,
  type RefundSource,
} from "../apps/api/src/services/billing.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}
const results: CheckResult[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
};
const failed = (name: string, error: unknown): void => {
  results.push({ name, ok: false, detail: `خودِ چک شکست: ${String((error as Error).message)}` });
};

/**
 * ★★ درگاهی که **داخلِ** ناحیه‌ی بحرانی کُند است — بدونِ این، چکِ همزمانی یک گیتِ دروغین است.
 *
 * درسِ سه‌بارتکرارشده‌ی M4: یک چکِ «هم‌زمان» که با برداشتنِ `FOR UPDATE` هم سبز بماند، چیزی را ثابت
 * نکرده جز اینکه دو تراکنش هرگز به هم نرسیدند.
 */
function slowGateway(inner: PaymentGateway, ms = 300): PaymentGateway {
  return {
    name: inner.name,
    mode: inner.mode,
    developmentOnly: inner.developmentOnly,
    createPayment: (i) => inner.createPayment(i),
    verifyPayment: async (i) => {
      await new Promise((r) => setTimeout(r, ms));
      return inner.verifyPayment(i);
    },
    refund: inner.refund?.bind(inner),
  };
}

const mock = (): MockGateway => new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });

async function seedTeam(pool: pg.Pool): Promise<{ userId: string; teamId: string }> {
  const userId = randomUUID();
  const teamId = randomUUID();
  await pool.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, $2, $3)", [
    userId,
    "سنجه‌ی استرداد",
    "#3366cc",
  ]);
  await pool.query("INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, $3, $4)", [
    teamId,
    `refund-${teamId.slice(0, 8)}`,
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
  await pool.query(
    "DELETE FROM audit_logs WHERE target_id IN (SELECT id::text FROM payments WHERE team_id = $1)",
    [teamId],
  );
  await pool.query("DELETE FROM subscriptions WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM payments WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM invoices WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

async function ensurePlan(pool: pg.Pool, priceRial = 1_990_000): Promise<string> {
  const code = "probe_refund";
  await pool.query(
    `INSERT INTO plans (code, name, description, price_monthly_rial, price_yearly_rial,
                        max_members, max_boards, max_storage_bytes, features, is_active, sort_order)
     VALUES ($1, 'پلنِ سنجه', 'فقط برای سنجه', $2, $3, 10, -1, 1073741824, '[]'::jsonb, true, 97)
     ON CONFLICT (code) DO UPDATE SET is_active = true, price_monthly_rial = $2`,
    [code, priceRial, priceRial * 10],
  );
  return code;
}

/** یک پرداختِ **تسویه‌شده** می‌سازد — همان مسیرِ محصولی، نه INSERTِ دستی. */
async function paidPayment(
  pool: pg.Pool,
  gateway: PaymentGateway,
  teamId: string,
  userId: string,
  planCode: string,
): Promise<{ paymentId: string; amountRial: number }> {
  const draft = await withTransaction(pool, async (tx) =>
    createCheckout(
      tx,
      {
        teamId,
        userId,
        planCode,
        period: "monthly",
        seats: 1,
        vatPercent: 0,
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
  await pool.query("UPDATE payments SET authority = $2 WHERE id = $1", [
    draft.paymentId,
    created.authority,
  ]);
  await settlePayment({ pool, gateway }, { by: "id", id: draft.paymentId });
  return { paymentId: draft.paymentId, amountRial: draft.amountRial };
}

const refund = (
  pool: pg.Pool,
  gateway: PaymentGateway,
  paymentId: string,
  source: RefundSource = { channel: "manual", refundRef: "REF-PROBE" },
): Promise<{ subscriptionCanceled: string | null; subscriptionRestored: string | null }> =>
  withTransaction(pool, (tx) => refundPayment(tx, { gateway }, paymentId, source));

const rowOf = async (
  pool: pg.Pool,
  paymentId: string,
): Promise<{
  status: string;
  paid_at: Date | null;
  refunded_at: Date | null;
  refund_ref: string | null;
  refund_amount_rial: number | null;
  amount_rial: number;
}> =>
  (
    await pool.query(
      `SELECT status, paid_at, refunded_at, refund_ref, refund_amount_rial, amount_rial
         FROM payments WHERE id = $1`,
      [paymentId],
    )
  ).rows[0]!;

const countSubs = async (pool: pg.Pool, teamId: string, status: string): Promise<number> =>
  Number(
    (
      await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM subscriptions WHERE team_id = $1 AND status = $2",
        [teamId, status],
      )
    ).rows[0]!.n,
  );

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = createDbPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: 8,
  });
  const planCode = await ensurePlan(pool);

  // ── ۱ + ۲: استرداد ↔ تسویه‌ی هم‌زمان، و ردیفِ refunded دوباره فعال نمی‌شود ──
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const inner = mock();
      const gateway = slowGateway(inner);
      const { paymentId } = await paidPayment(pool, inner, teamId, userId, planCode);

      // ★★ هم‌پوشانیِ اجباری: تسویه‌ی دوباره (درگاه ۱۰۱ می‌دهد و **۳۰۰ms** طول می‌کشد) دقیقاً وسطِ
      //    ناحیه‌ی بحرانیِ استرداد می‌رسد. بدونِ قفلِ ردیف، یکی از دو حقیقت گم می‌شود.
      const [settleOut, refundOut] = await Promise.allSettled([
        settlePayment({ pool, gateway }, { by: "id", id: paymentId }),
        refund(pool, inner, paymentId),
      ]);
      const row = await rowOf(pool, paymentId);
      const active = await countSubs(pool, teamId, "active");
      const canceled = await countSubs(pool, teamId, "canceled");
      const ok =
        row.status === "refunded" &&
        row.refunded_at !== null &&
        active === 0 &&
        canceled === 1 &&
        refundOut.status === "fulfilled";
      record(
        "★★ استرداد ↔ تسویه‌ی هم‌زمان (هم‌پوشانیِ اجباری) ⇒ **یک** حقیقت: refunded، صفر اشتراکِ زنده",
        ok,
        ok
          ? `status=${row.status} · اشتراکِ زنده=${String(active)} · لغوشده=${String(canceled)} · ` +
            `تسویه‌ی هم‌زمان=${settleOut.status === "fulfilled" ? settleOut.value.kind : "خطا"} ` +
            "⇒ قفلِ ردیفِ ADR-050 هر دو مسیر را سریالی کرد"
          : `انتظار: refunded/۰ زنده/۱ لغو. واقعی: status=${row.status}، زنده=${String(active)}، لغو=${String(canceled)}`,
      );

      // ۲ — حالا درگاه ۱۰۱ می‌دهد؛ ردیفِ refunded نباید دوباره فعال شود.
      const again = await settlePayment({ pool, gateway: inner }, { by: "id", id: paymentId });
      const activeAfter = await countSubs(pool, teamId, "active");
      const ok2 = again.kind === "alreadySettled" && activeAfter === 0;
      record(
        "★★ ردیفِ `refunded` با کدِ ۱۰۱ **دوباره فعال نمی‌شود** (T6 از مسیرِ واقعی)",
        ok2,
        ok2
          ? `نتیجه=${again.kind} (status=${again.kind === "alreadySettled" ? again.status : "—"}) · اشتراکِ زنده=${String(activeAfter)}`
          : `انتظار: alreadySettled و ۰ زنده. واقعی: ${again.kind}، زنده=${String(activeAfter)}`,
      );
    } catch (error) {
      failed("★★ استرداد ↔ تسویه‌ی هم‌زمان", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۳: تمدید — کدام اشتراک لغو می‌شود، و کدام برمی‌گردد ────────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const first = await paidPayment(pool, gateway, teamId, userId, planCode);
      const second = await paidPayment(pool, gateway, teamId, userId, planCode); // تمدید
      const liveBefore = (
        await pool.query<{ id: string; activated_by_payment_id: string }>(
          "SELECT id, activated_by_payment_id FROM subscriptions WHERE team_id = $1 AND status = 'active'",
          [teamId],
        )
      ).rows[0]!;

      const out = await refund(pool, gateway, second.paymentId);
      const live = (
        await pool.query<{ id: string; activated_by_payment_id: string; status: string }>(
          "SELECT id, activated_by_payment_id, status FROM subscriptions WHERE team_id = $1 AND status = 'active'",
          [teamId],
        )
      ).rows[0];
      const okRestore =
        out.subscriptionCanceled === liveBefore.id &&
        out.subscriptionRestored !== null &&
        live?.id === out.subscriptionRestored &&
        live.activated_by_payment_id === first.paymentId;
      record(
        "★★ استردادِ **تمدید** ⇒ اشتراکِ تمدید لغو و دوره‌ی **قبلیِ پرداخت‌شده برمی‌گردد** (نه سقوط به رایگان)",
        okRestore,
        okRestore
          ? `لغو=${String(out.subscriptionCanceled).slice(0, 8)} · بازگشته=${String(out.subscriptionRestored).slice(0, 8)} ` +
            "⇒ روزهای پرداخت‌شده‌ی دوره‌ی قبل از بین نرفت"
          : `انتظار: لغوِ اشتراکِ تمدید + بازگشتِ قبلی. واقعی: لغو=${String(out.subscriptionCanceled)}، بازگشته=${String(out.subscriptionRestored)}، زنده=${String(live?.activated_by_payment_id)}`,
      );

      // و حالا قرینه‌اش: استردادِ پرداختِ **قدیمی‌تر** نباید به اشتراکِ زنده‌ی دیگری دست بزند.
      const third = await paidPayment(pool, gateway, teamId, userId, planCode);
      const outOld = await refund(pool, gateway, first.paymentId);
      const liveNow = (
        await pool.query<{ activated_by_payment_id: string; status: string }>(
          "SELECT activated_by_payment_id, status FROM subscriptions WHERE team_id = $1 AND status = 'active'",
          [teamId],
        )
      ).rows[0];
      const okOther =
        outOld.subscriptionCanceled === null &&
        outOld.subscriptionRestored === null &&
        liveNow?.activated_by_payment_id === third.paymentId;
      record(
        "★ استردادِ پرداختِ **قدیمی‌تر** اشتراکِ زنده‌ی پرداختِ دیگر را دست نمی‌زند",
        okOther,
        okOther
          ? "هیچ اشتراکی لغو/بازگردانده نشد و اشتراکِ زنده همان پرداختِ سوم مانْد"
          : `انتظار: هیچ. واقعی: لغو=${String(outOld.subscriptionCanceled)}، بازگشته=${String(outOld.subscriptionRestored)}، زنده=${String(liveNow?.activated_by_payment_id)}`,
      );
    } catch (error) {
      failed("★★ تمدید و استرداد", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۴ + ۹: مبلغ از ستون می‌آید (نه بازمحاسبه) و `paid_at` می‌مانَد ─────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const { paymentId, amountRial } = await paidPayment(
        pool,
        gateway,
        teamId,
        userId,
        planCode,
      );
      const paidAtBefore = (await rowOf(pool, paymentId)).paid_at;
      // قیمتِ پلن **بعد از** پرداخت عوض می‌شود — بازمحاسبه از این‌جا به بعد غلط می‌شود.
      await ensurePlan(pool, 9_990_000);
      await refund(pool, gateway, paymentId);
      const row = await rowOf(pool, paymentId);
      await ensurePlan(pool);
      const ok =
        Number(row.refund_amount_rial) === amountRial &&
        row.paid_at !== null &&
        paidAtBefore !== null &&
        row.paid_at.getTime() === paidAtBefore.getTime() &&
        row.refunded_at !== null;
      record(
        "★★ مبلغِ استرداد = `payments.amount_rial` حتی بعد از تغییرِ قیمتِ پلن؛ و `paid_at` **پاک نمی‌شود**",
        ok,
        ok
          ? `استرداد=${String(row.refund_amount_rial)} = پرداخت=${String(amountRial)} (قیمتِ پلن ۵ برابر شد) · ` +
            "paid_at دست‌نخورده ⇒ رکوردِ مالیِ ADR-052 می‌مانَد و CHECKِ ۰۰۰۹ هم همین را می‌خواهد"
          : `انتظار: ${String(amountRial)} و paid_atِ دست‌نخورده. واقعی: ${String(row.refund_amount_rial)}، paid_at=${String(row.paid_at)}`,
      );
    } catch (error) {
      failed("★★ مبلغِ استرداد و paid_at", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۵: استردادِ دوباره ⇒ INVALID_TRANSITION ────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const { paymentId } = await paidPayment(pool, gateway, teamId, userId, planCode);
      await refund(pool, gateway, paymentId, { channel: "manual", refundRef: "REF-1" });
      let code = "—";
      try {
        await refund(pool, gateway, paymentId, { channel: "manual", refundRef: "REF-2" });
      } catch (error) {
        code = (error as { code?: string }).code ?? "—";
      }
      const row = await rowOf(pool, paymentId);
      const ok = code === "INVALID_TRANSITION" && row.refund_ref === "REF-1";
      record(
        "★ استردادِ دوباره ⇒ `INVALID_TRANSITION` و مرجعِ اول دست‌نخورده (idempotency در **دیتابیس**)",
        ok,
        ok
          ? "کدِ خطا INVALID_TRANSITION و refund_ref هنوز REF-1 ⇒ `status='paid'` زیرِ `FOR UPDATE` گیتِ واقعی است"
          : `انتظار: INVALID_TRANSITION و REF-1. واقعی: کد=${code}، refund_ref=${String(row.refund_ref)}`,
      );
    } catch (error) {
      failed("★ استردادِ دوباره", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۶ + ۷: کانالِ زرین‌پال، و ردیفِ درگاه/حالتِ دیگر ───────────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const { paymentId } = await paidPayment(pool, gateway, teamId, userId, planCode);

      let calls = 0;
      const zarinpal = new ZarinpalGateway({
        baseUrl: "https://payment.zarinpal.com",
        merchantId: "11111111-1111-1111-1111-111111111111",
        mode: "sandbox",
        fetchImpl: () => {
          calls += 1;
          return Promise.reject(new Error("این سنجه نباید به شبکه برود"));
        },
      });
      // ردیف را موقتاً به زرین‌پال می‌بریم تا assertِ درگاه از سرِ راه برداشته شود و خودِ **کانال** سنجیده شود.
      await pool.query("UPDATE payments SET gateway = 'zarinpal' WHERE id = $1", [paymentId]);
      let unavailableCode = "—";
      try {
        await refund(pool, zarinpal, paymentId, { channel: "gateway" });
      } catch (error) {
        unavailableCode = (error as { code?: string }).code ?? "—";
      }
      const rowZ = await rowOf(pool, paymentId);
      const ok6 = unavailableCode === "REFUND_UNAVAILABLE" && calls === 0 && rowZ.status === "paid";
      record(
        "★★ کانالِ زرین‌پال ⇒ `REFUND_UNAVAILABLE` با **صفر** تماسِ شبکه، ردیف دست‌نخورده",
        ok6,
        ok6
          ? "کد=REFUND_UNAVAILABLE · fetch=۰ · status هنوز paid ⇒ «ثبتِ استردادِ دستی» تنها مسیرِ اجرایی است (ADR-068 §۲)"
          : `انتظار: REFUND_UNAVAILABLE/۰ تماس/paid. واقعی: کد=${unavailableCode}، تماس=${String(calls)}، status=${rowZ.status}`,
      );

      // ۷ — همان ردیفِ زرین‌پالی، این‌بار با درگاهِ mock ⇒ ۴۰۹ پیش از هر کاری.
      let conflictCode = "—";
      try {
        await refund(pool, gateway, paymentId, { channel: "manual", refundRef: "X" });
      } catch (error) {
        conflictCode = (error as { code?: string }).code ?? "—";
      }
      const rowAfter = await rowOf(pool, paymentId);
      await pool.query("UPDATE payments SET gateway = 'mock' WHERE id = $1", [paymentId]);
      const ok7 = conflictCode === "CONFLICT" && rowAfter.status === "paid";
      record(
        "★★ ردیفِ درگاهِ دیگر ⇒ ۴۰۹ CONFLICT پیش از هر تماس و هر نوشتنی",
        ok7,
        ok7
          ? "کد=CONFLICT و ردیف دست‌نخورده ⇒ درگاهِ ساختگی نمی‌تواند برای پولی که ندیده مرجعِ استرداد بسازد"
          : `انتظار: CONFLICT و paid. واقعی: کد=${conflictCode}، status=${rowAfter.status}`,
      );
    } catch (error) {
      failed("★★ کانالِ زرین‌پال / assertِ درگاه", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۸: شکستِ عمدیِ audit بعد از UPDATE ⇒ هیچ‌کدام نمی‌مانَد ────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const { paymentId } = await paidPayment(pool, gateway, teamId, userId, planCode);
      let threw = false;
      try {
        await withTransaction(pool, async (tx) => {
          await refundPayment(tx, { gateway }, paymentId, {
            channel: "manual",
            refundRef: "REF-AUDIT",
          });
          // ★ همان تراکنش، همان الگوی مسیرِ `/admin` — ولی با عملی که **می‌شکند**: actorی که در
          //   `users` وجود ندارد ⇒ نقضِ FKِ `audit_logs.actor_user_id` (خطای **دیتابیس**، نه JS).
          //   ⚠️ `target_id` عمداً انتخاب نشد: ستونش `text` است و هر رشته‌ای را می‌پذیرد — همان
          //   چیزی که نگارشِ اولِ این چک را **سبزِ دروغین** کرد (پرتاب نشد و استرداد ماند).
          await recordAudit(tx, {
            actor: { userId: randomUUID(), ip: null, userAgent: null },
            action: "payment.refund",
            target: { type: "payment", id: paymentId },
            metadata: {},
          });
        });
      } catch {
        threw = true;
      }
      const row = await rowOf(pool, paymentId);
      const audits = Number(
        (
          await pool.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM audit_logs WHERE target_id = $1",
            [paymentId],
          )
        ).rows[0]!.n,
      );
      const ok = threw && row.status === "paid" && audits === 0;
      record(
        "★★ شکستِ audit **بعد از** UPDATE ⇒ نه استرداد می‌مانَد نه ردیف (ADR-067 §۱)",
        ok,
        ok
          ? "تراکنش rollback شد: status هنوز paid و صفر ردیفِ audit ⇒ «عمل بدونِ audit» ممکن نیست"
          : `انتظار: پرتاب + paid + ۰ ردیف. واقعی: پرتاب=${String(threw)}، status=${row.status}، ردیف=${String(audits)}`,
      );
    } catch (error) {
      failed("★★ اتمیک‌بودنِ audit", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۱۰: ★★ دو استردادِ **هم‌زمان** ⇒ یک استرداد، یک ردیفِ audit ─────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const { paymentId } = await paidPayment(pool, gateway, teamId, userId, planCode);

      // ★ درگاهی که استردادش **داخلِ ناحیه‌ی بحرانی** کُند است — تنها راهِ واداشتنِ دو تراکنش به
      //   هم‌پوشانی. عمداً همیشه «برگرداندم» می‌گوید: نگهبان باید **قفلِ ما** باشد، نه ادبِ درگاه.
      let refundCalls = 0;
      const slowRefunder: PaymentGateway = {
        name: gateway.name,
        mode: gateway.mode,
        developmentOnly: gateway.developmentOnly,
        createPayment: (i) => gateway.createPayment(i),
        verifyPayment: (i) => gateway.verifyPayment(i),
        refund: async () => {
          refundCalls += 1;
          await new Promise((r) => setTimeout(r, 300));
          return { status: "refunded", refundRef: `SLOW${String(refundCalls)}` };
        },
      };

      const both = await Promise.allSettled([
        withTransaction(pool, async (tx) => {
          const out = await refundPayment(tx, { gateway: slowRefunder }, paymentId, {
            channel: "gateway",
          });
          await recordAudit(tx, {
            actor: { userId, ip: null, userAgent: null },
            action: "payment.refund",
            target: { type: "payment", id: paymentId },
            metadata: { n: 1 },
          });
          return out;
        }),
        withTransaction(pool, async (tx) => {
          const out = await refundPayment(tx, { gateway: slowRefunder }, paymentId, {
            channel: "gateway",
          });
          await recordAudit(tx, {
            actor: { userId, ip: null, userAgent: null },
            action: "payment.refund",
            target: { type: "payment", id: paymentId },
            metadata: { n: 2 },
          });
          return out;
        }),
      ]);
      const okCount = both.filter((r) => r.status === "fulfilled").length;
      const audits = Number(
        (
          await pool.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM audit_logs WHERE action = 'payment.refund' AND target_id = $1",
            [paymentId],
          )
        ).rows[0]!.n,
      );
      const canceled = await countSubs(pool, teamId, "canceled");
      const row = await rowOf(pool, paymentId);
      const ok = okCount === 1 && audits === 1 && canceled === 1 && row.status === "refunded";
      record(
        "★★ دو استردادِ **هم‌زمان** (تاخیرِ اجباری داخلِ ناحیه‌ی بحرانی) ⇒ یک استرداد، یک ردیفِ audit",
        ok,
        ok
          ? `موفق=${String(okCount)} از ۲ · ردیفِ audit=${String(audits)} · اشتراکِ لغوشده=${String(canceled)} · ` +
            `تماسِ استرداد با درگاه=${String(refundCalls)} ⇒ \`FOR UPDATE\`ِ خودِ استرداد گیتِ واقعی است`
          : `انتظار: ۱ موفق/۱ audit/۱ لغو. واقعی: موفق=${String(okCount)}، audit=${String(audits)}، لغو=${String(canceled)}، status=${row.status}`,
      );
    } catch (error) {
      failed("★★ دو استردادِ هم‌زمان", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۱۱: ★★ بازگردانی وضعیتِ پرداختِ پشتوانه را **قفل‌شده** می‌خوانَد ───────
  //
  // یافته‌ی بازبینیِ ۶٫۵: شرطِ `p.status = 'paid'` در زیرکوئریِ بازگردانی، بدونِ قفلِ `p`، مقدارِ
  // **commit‌شده‌ی قبلی** را می‌دید. سناریو: استردادِ پرداختِ تمدید (A) هم‌زمان با استردادِ پرداختِ
  // قبلی (B). اگر B هنوز commit نکرده باشد، A پرداختِ B را `paid` می‌بیند و اشتراکش را زنده می‌کند —
  // نتیجه: تیم یک اشتراکِ **زنده** دارد که هیچ پرداختِ تسویه‌شده‌ای پشتش نیست.
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      const gateway = mock();
      const first = await paidPayment(pool, gateway, teamId, userId, planCode);
      const second = await paidPayment(pool, gateway, teamId, userId, planCode); // تمدید

      // B: استردادِ پرداختِ **قدیمی**، با یک تاخیرِ واقعی **داخلِ** تراکنش پیش از commit.
      const slowB = withTransaction(pool, async (tx) => {
        const out = await refundPayment(tx, { gateway }, first.paymentId, {
          channel: "manual",
          refundRef: "REF-OLD",
        });
        await new Promise((r) => setTimeout(r, 600));
        return out;
      });
      // A: کمی بعد شروع می‌شود تا زیرکوئریِ بازگردانی‌اش دقیقاً وسطِ تراکنشِ B بیفتد.
      await new Promise((r) => setTimeout(r, 200));
      const a = await refund(pool, gateway, second.paymentId);
      await slowB;

      const live = await pool.query<{ id: string; activated_by_payment_id: string }>(
        "SELECT id, activated_by_payment_id FROM subscriptions WHERE team_id = $1 AND status = ANY($2::text[])",
        [teamId, ["trialing", "active", "past_due"]],
      );
      const backing =
        live.rows.length === 0
          ? null
          : (
              await pool.query<{ status: string }>("SELECT status FROM payments WHERE id = $1", [
                live.rows[0]!.activated_by_payment_id,
              ])
            ).rows[0]!.status;
      // ★ ادعا: **هیچ** اشتراکِ زنده‌ای بدونِ پرداختِ `paid` نمی‌مانَد.
      const ok = live.rows.length === 0 || backing === "paid";
      record(
        "★★ دو استردادِ هم‌پوشان (تمدید + قبلی) ⇒ هیچ اشتراکِ زنده‌ای بدونِ پرداختِ `paid` نمی‌مانَد",
        ok,
        ok
          ? `اشتراکِ زنده=${String(live.rows.length)}${backing === null ? "" : ` (پشتوانه=${backing})`} · ` +
            `بازگشته در A=${String(a.subscriptionRestored)} ⇒ \`FOR UPDATE OF s, p\` شرطِ پرداخت را واقعی نگه داشت`
          : `اشتراکِ زنده‌ای با پشتوانه‌ی «${String(backing)}» ماند — همان سناریوی بازبینیِ ۶٫۵`,
      );
    } catch (error) {
      failed("★★ دو استردادِ هم‌پوشان (بازگردانی)", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  await pool.query("UPDATE plans SET is_active = false WHERE code = $1", [planCode]);
  await pool.end();

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const bad = results.filter((r) => !r.ok);
  if (bad.length > 0) {
    console.error(`\n✖ ${bad.length} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ استرداد روی Postgresِ زنده اثبات شد (نه ادعا).");
}

await main();
