/**
 * سنجه‌ی زنده‌ی M6 — **کارت‌به‌کارت با تاییدِ دستی روی Postgresِ واقعی**
 * ([ADR-070](../ARCHITECTURE_DECISIONS.md#adr-070)).
 *
 * ── چرا اسکریپت، نه تستِ واحد ──────────────────────────────────────────
 *
 * ادعای مرکزیِ ADR-070 این است که **ردیفی که کاربر رویش ادعای پرداخت ثبت کرده هرگز خودکار
 * باطل نمی‌شود**. آن ادعا از برخوردِ سه چیز می‌آید که هیچ‌کدام در تستِ واحد وجود ندارند:
 * پاسخِ `gatewayError`ِ درگاه، ستونِ `failure_code` که `settleLocked` دست نمی‌زند، و نردبانِ
 * `planSweep`. و دو نگهبانِ دیگر فقط در دیتابیس‌اند: `payments_transfer_ref_uq` و CHECKهای ۰۰۱۰.
 *
 * هفت چک:
 *   ۱. ★★ دو تاییدِ هم‌زمان با هم‌پوشانیِ **اجباری** ⇒ یک اشتراک، یک ردیفِ ممیزی.
 *   ۲. ★★ ردیفِ **ادعاشده** هرچقدر هم کهنه، با sweep باطل **نمی‌شود**.
 *   ۳. ★★ بازپخشِ شماره‌ی مرجع ⇒ `TRANSFER_REF_TAKEN`، و پرداختِ دوم دست‌نخورده.
 *   ۴. مبلغِ ناهم‌خوان ⇒ `TRANSFER_AMOUNT_MISMATCH` و **هیچ** ستونی نوشته نمی‌شود.
 *   ۵. ★★ شکستِ عمدیِ audit ⇒ نه تایید می‌مانَد، نه اشتراک (ADR-067 §۱).
 *   ۶. ★ ردیفِ **بی‌ادعا**ی کهنه **باطل می‌شود** — نردبان هنوز کار می‌کند، فقط کورکورانه نه.
 *   ۷. sweepِ درگاهِ دیگر ردیفِ `card_transfer` را **نمی‌بیند**.
 *   ۸. ★★ دو تاییدِ **هم‌زمان** با یک شماره روی دو پرداختِ متفاوت ⇒ ایندکسِ یکتا یکی را رد می‌کند.
 *
 * ⚠️⚠️ **چکِ ۸ از یک سبزِ دروغینِ گرفته‌شده زاده شد.** نگارشِ اول فقط چکِ ۳ را داشت؛ با
 * `DROP INDEX payments_transfer_ref_uq` روی دیتابیسِ زنده **سبز مانْد** — چون پیش‌چکِ
 * برنامه‌ایِ `approveTransfer` زودتر می‌گیردش و ایندکس هرگز آزموده نمی‌شد. یعنی چکِ ۳ ادعای
 * «نگهبان در دیتابیس است» را **اثبات نمی‌کرد**، فقط ادعای «پیام روشن است» را. چکِ ۸ عمداً
 * طوری چیده شده که **هر دو پیش‌چک پاس شوند** (هیچ‌کدام نوشته‌ی commit‌نشده‌ی دیگری را
 * نمی‌بیند) و تنها چیزی که می‌مانَد خودِ ایندکس باشد.
 *
 * ★ هر بلوک try/catch دارد: شکستِ خودِ سنجه باید یک چکِ **قرمز** باشد، نه crash.
 *
 * ★★ **هم‌پوشانی اجباری است، نه امیدوارانه** (درسِ سه‌بارتکرارشده‌ی M4): چکِ ۱ پس از
 * `approveTransfer` و **پیش از commit** یک `pg_sleep` داخلِ همان تراکنش می‌زند، پس قفلِ ردیف
 * واقعاً نگه داشته می‌شود و تراکنشِ دوم مجبور است وسطِ ناحیه‌ی بحرانی برسد. ⊕ این‌طوری هیچ
 * درزِ تستی در کدِ محصول باز نمی‌شود.
 *
 * اجرا: `pnpm billing:transfer` (بعد از `pnpm db:up && pnpm db:migrate`).
 */
import { randomUUID } from "node:crypto";

import { MockGateway, type PaymentGateway } from "@hamboom/billing-core";
import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

import type { AuditActor } from "../apps/api/src/audit.ts";
import { createDbPool, withTransaction } from "../apps/api/src/plugins/db.ts";
import { createCheckout } from "../apps/api/src/services/billing.ts";
import {
  approveTransfer,
  claimTransfer,
  createCardTransferGatewayOn,
  type CardTransferSettings,
} from "../apps/api/src/services/card-transfer.ts";
import { runReconcile } from "../apps/api/src/services/reconcile.ts";

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

const HOUR = 3_600_000;

/**
 * ★ شناسه‌ی یکتای این اجرا — در هر شماره‌ی مرجع می‌نشیند.
 *
 * ⚠️ بدونِ این، شماره‌های ثابت بینِ اجراها تصادم می‌کردند و یک اجرای **شکسته** اجرای بعدی را
 * هم می‌شکست: پیش‌چک ردیفِ جامانده را می‌دید و `TRANSFER_REF_TAKEN` می‌داد پیش از آنکه اصلاً
 * به چیزی که می‌سنجیم برسیم. سنجه‌ای که به دیتابیسِ تمیز وابسته باشد، گیت نیست.
 */
const RUN = randomUUID().slice(0, 8);
const ref = (label: string): string => `${label}-${RUN}`;

/** بقایای اجراهای شکسته‌ی قبلی — همان قاعده: سنجه نباید به حالتِ قبلی تکیه کند. */
async function purgeLeftovers(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ id: string; owner_user_id: string }>(
    "SELECT id, owner_user_id FROM teams WHERE slug LIKE 'transfer-%'",
  );
  for (const row of rows) await cleanup(pool, row.id, row.owner_user_id);
}

const SETTINGS: CardTransferSettings = {
  destination: {
    card: "6037991234567893",
    sheba: null,
    holderName: "سنجه‌ی کارت‌به‌کارت",
    bankName: null,
  },
  claimWindowMs: 24 * HOUR,
  checkoutBaseUrl: "http://localhost:5173/billing/transfer",
  mode: "sandbox",
};

const actorFor = (userId: string | null): AuditActor => ({ userId, ip: null, userAgent: null });

async function seedTeam(pool: pg.Pool, label: string): Promise<{ userId: string; teamId: string }> {
  const userId = randomUUID();
  const teamId = randomUUID();
  await pool.query("INSERT INTO users (id, display_name, presence_color) VALUES ($1, $2, $3)", [
    userId,
    label,
    "#3366cc",
  ]);
  await pool.query("INSERT INTO teams (id, slug, name, owner_user_id) VALUES ($1, $2, $3, $4)", [
    teamId,
    `transfer-${teamId.slice(0, 8)}`,
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
  // ⚠️ و ردیف‌هایی که این کاربر **عاملشان** بوده — `audit_logs_actor_user_id_fkey` وگرنه
  //    حذفِ کاربر را می‌شکند. (پاک‌کردن فقط بر اساسِ `target_id` کافی نیست: تاییدِ انتقال
  //    هم هدف دارد هم عامل، و عاملش همین کاربرِ سنجه است.)
  await pool.query("DELETE FROM audit_logs WHERE actor_user_id = $1", [userId]);
  await pool.query("DELETE FROM subscriptions WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM payments WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM invoices WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

async function ensurePlan(pool: pg.Pool): Promise<string> {
  const code = "probe_transfer";
  await pool.query(
    `INSERT INTO plans (code, name, description, price_monthly_rial, price_yearly_rial,
                        max_members, max_boards, max_storage_bytes, features, is_active, sort_order)
     VALUES ($1, 'پلنِ سنجه', 'فقط برای سنجه', 1990000, 19900000, 10, -1, 1073741824, '[]'::jsonb, true, 96)
     ON CONFLICT (code) DO UPDATE SET is_active = true`,
    [code],
  );
  return code;
}

/** یک ردیفِ `pending`ِ کارت‌به‌کارت از **مسیرِ محصولی** — نه INSERTِ دستی. */
async function pendingTransfer(
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
      randomUUID(),
    ),
  );
  // ★ authority از خودِ درگاه می‌آید، مثلِ مسیرِ واقعیِ checkout.
  const created = await gateway.createPayment({
    amountRial: draft.amountRial,
    description: "سنجه",
    callbackUrl: "http://localhost/cb",
  });
  await pool.query("UPDATE payments SET authority = $2 WHERE id = $1", [
    draft.paymentId,
    created.authority,
  ]);
  return { paymentId: draft.paymentId, amountRial: draft.amountRial };
}

/** سن را عقب می‌برد تا نردبان بتواند رویش تصمیم بگیرد — بدونِ انتظارِ واقعی. */
async function ageBy(pool: pg.Pool, paymentId: string, ms: number): Promise<void> {
  await pool.query("UPDATE payments SET requested_at = now() - ($2::bigint || ' ms')::interval WHERE id = $1", [
    paymentId,
    String(ms),
  ]);
}

const statusOf = async (pool: pg.Pool, id: string): Promise<string> =>
  (await pool.query<{ status: string }>("SELECT status FROM payments WHERE id = $1", [id])).rows[0]
    ?.status ?? "?";

const auditCount = async (pool: pg.Pool, id: string): Promise<number> =>
  Number(
    (
      await pool.query<{ n: string }>(
        "SELECT count(*)::bigint AS n FROM audit_logs WHERE target_id = $1 AND action = 'payment.approveTransfer'",
        [id],
      )
    ).rows[0]?.n ?? "0",
  );

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = createDbPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: env.DATABASE_POOL_MAX,
  });
  await purgeLeftovers(pool);
  const planCode = await ensurePlan(pool);
  const gateway = createCardTransferGatewayOn(SETTINGS, pool);

  // ── ۱) دو تاییدِ هم‌زمان با هم‌پوشانیِ اجباری ────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, "سنجه‌ی تایید");
    try {
      const p = await pendingTransfer(pool, gateway, teamId, userId, planCode);
      const deps = { settings: SETTINGS, actor: actorFor(userId) };

      const run = async (ref: string, holdMs: number): Promise<string> => {
        try {
          return await withTransaction(pool, async (tx) => {
            const outcome = await approveTransfer(tx, deps, {
              paymentId: p.paymentId,
              ref,
              last4: null,
              observedAmountRial: p.amountRial,
              note: null,
            });
            // ★★ قفل **هنوز نگه داشته شده** — این خطِ چیزی است که چک را واقعی می‌کند.
            if (holdMs > 0) await tx.query("SELECT pg_sleep($1)", [holdMs / 1000]);
            return outcome.kind;
          });
        } catch (error) {
          return `خطا:${String((error as { code?: string }).code ?? (error as Error).message)}`;
        }
      };

      const [a, b] = await Promise.all([run(ref("REF-A"), 400), run(ref("REF-B"), 0)]);
      const subs = await pool.query<{ n: string }>(
        "SELECT count(*)::bigint AS n FROM subscriptions WHERE team_id = $1",
        [teamId],
      );
      const audits = await auditCount(pool, p.paymentId);
      const ok = Number(subs.rows[0]?.n ?? "1") === 1 && audits === 1;
      record(
        "★★ دو تاییدِ هم‌زمان (هم‌پوشانیِ اجباری) ⇒ یک اشتراک و یک ردیفِ ممیزی",
        ok,
        `نتیجه‌ها: ${a} / ${b} · اشتراک=${String(subs.rows[0]?.n)} · ممیزی=${String(audits)}` +
          (ok ? " ⇒ قفلِ ردیفِ `lockPaymentForSettle` بازنده را سریالی کرد" : " ⇒ دو حقیقت ساخته شد"),
      );
    } catch (error) {
      failed("★★ دو تاییدِ هم‌زمان", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۲) ردیفِ ادعاشده هرگز باطل نمی‌شود ───────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, "سنجه‌ی ادعا");
    try {
      const p = await pendingTransfer(pool, gateway, teamId, userId, planCode);
      await withTransaction(pool, async (tx) =>
        claimTransfer(tx, { paymentId: p.paymentId, ref: "ادعای کاربر", last4: "4821" }),
      );
      // ★ **خیلی** کهنه‌اش می‌کنیم — یک سال. اگر ابطال زمانی بود، این حتماً می‌رفت.
      await ageBy(pool, p.paymentId, 365 * 24 * HOUR);

      const policy = { staleAfterMs: 1, expireAfterMs: 2, batchSize: 10, adoptOrphans: false, dryRun: false };
      await runReconcile({ pool, gateway }, policy);
      await runReconcile({ pool, gateway }, policy); // دو بار، تا «یک پرسش شده» هم پوشش داده شود

      const row = await pool.query<{ status: string; failure_code: string | null }>(
        "SELECT status, failure_code FROM payments WHERE id = $1",
        [p.paymentId],
      );
      const ok = row.rows[0]?.status === "pending" && row.rows[0].failure_code === null;
      record(
        "★★ ردیفِ ادعاشده‌ی یک‌ساله با دو sweep هم باطل نمی‌شود",
        ok,
        `وضعیت=${String(row.rows[0]?.status)} · failure_code=${String(row.rows[0]?.failure_code)}` +
          (ok
            ? " ⇒ پاسخِ `gatewayError` ستون را دست‌نخورده گذاشت و پله ۳ی ADR-056 شلیک نکرد"
            : " ⇒ پولِ پایا که فردا می‌نشیند، ردیفش را باطل‌شده پیدا می‌کرد"),
      );
    } catch (error) {
      failed("★★ ردیفِ ادعاشده", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۳) بازپخشِ شماره‌ی مرجع ──────────────────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, "سنجه‌ی بازپخش");
    try {
      const a = await pendingTransfer(pool, gateway, teamId, userId, planCode);
      const b = await pendingTransfer(pool, gateway, teamId, userId, planCode);
      const deps = { settings: SETTINGS, actor: actorFor(userId) };
      const approve = async (id: string): Promise<string> => {
        try {
          await withTransaction(pool, async (tx) =>
            approveTransfer(tx, deps, {
              paymentId: id,
              ref: ref("همان-شماره"),
              last4: null,
              observedAmountRial: a.amountRial,
              note: null,
            }),
          );
          return "ok";
        } catch (error) {
          return String((error as { code?: string }).code ?? (error as Error).message);
        }
      };
      const first = await approve(a.paymentId);
      const second = await approve(b.paymentId);
      const ok = first === "ok" && second === "TRANSFER_REF_TAKEN" && (await statusOf(pool, b.paymentId)) === "pending";
      record(
        "★★ همان شماره‌ی مرجع برای پرداختِ دوم ⇒ TRANSFER_REF_TAKEN و ردیفِ دوم دست‌نخورده",
        ok,
        `اول=${first} · دوم=${second} · وضعیتِ دوم=${await statusOf(pool, b.paymentId)}` +
          (ok ? " ⇒ یک واریز نمی‌تواند دو اشتراک بخرد" : ""),
      );
    } catch (error) {
      failed("★★ بازپخشِ شماره‌ی مرجع", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۴) مبلغِ ناهم‌خوان ────────────────────────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, "سنجه‌ی مبلغ");
    try {
      const p = await pendingTransfer(pool, gateway, teamId, userId, planCode);
      let code = "بدونِ خطا";
      try {
        await withTransaction(pool, async (tx) =>
          approveTransfer(
            tx,
            { settings: SETTINGS, actor: actorFor(userId) },
            { paymentId: p.paymentId, ref: ref("R"), last4: null, observedAmountRial: 100_000, note: null },
          ),
        );
      } catch (error) {
        code = String((error as { code?: string }).code ?? (error as Error).message);
      }
      const row = await pool.query<{ status: string; transfer_ref: string | null }>(
        "SELECT status, transfer_ref FROM payments WHERE id = $1",
        [p.paymentId],
      );
      const ok =
        code === "TRANSFER_AMOUNT_MISMATCH" &&
        row.rows[0]?.status === "pending" &&
        row.rows[0].transfer_ref === null;
      record(
        "مبلغِ مشاهده‌شده ≠ مبلغِ فاکتور ⇒ رد، و هیچ ستونی نوشته نمی‌شود",
        ok,
        `کد=${code} · وضعیت=${String(row.rows[0]?.status)} · transfer_ref=${String(row.rows[0]?.transfer_ref)}`,
      );
    } catch (error) {
      failed("مبلغِ ناهم‌خوان", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۵) شکستِ عمدیِ audit ─────────────────────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, "سنجه‌ی ممیزی");
    try {
      const p = await pendingTransfer(pool, gateway, teamId, userId, planCode);
      let threw = false;
      try {
        await withTransaction(pool, async (tx) =>
          // ★ actorِ ناموجود ⇒ FKی `audit_logs.actor_user_id` می‌شکند — یک شکستِ **واقعی**
          //   در همان تراکنش، نه یک mockِ ساختگی.
          approveTransfer(
            tx,
            { settings: SETTINGS, actor: actorFor(randomUUID()) },
            {
              paymentId: p.paymentId,
              ref: ref("R-AUDIT"),
              last4: null,
              observedAmountRial: p.amountRial,
              note: null,
            },
          ),
        );
      } catch {
        threw = true;
      }
      const row = await pool.query<{ status: string; transfer_approved_at: Date | null }>(
        "SELECT status, transfer_approved_at FROM payments WHERE id = $1",
        [p.paymentId],
      );
      const subs = await pool.query<{ n: string }>(
        "SELECT count(*)::bigint AS n FROM subscriptions WHERE team_id = $1",
        [teamId],
      );
      const ok =
        threw &&
        row.rows[0]?.status === "pending" &&
        row.rows[0].transfer_approved_at === null &&
        Number(subs.rows[0]?.n ?? "1") === 0;
      record(
        "★★ شکستِ ممیزی ⇒ نه تایید می‌مانَد، نه اشتراک (همان تراکنش)",
        ok,
        `پرتاب=${String(threw)} · وضعیت=${String(row.rows[0]?.status)} · اشتراک=${String(subs.rows[0]?.n)}`,
      );
    } catch (error) {
      failed("★★ شکستِ ممیزی", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۶) ردیفِ بی‌ادعای کهنه **باید** باطل شود ─────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, "سنجه‌ی رهاشده");
    try {
      const p = await pendingTransfer(pool, gateway, teamId, userId, planCode);
      await ageBy(pool, p.paymentId, 48 * HOUR); // > claimWindow (۲۴ ساعت)

      const policy = { staleAfterMs: 1, expireAfterMs: 2, batchSize: 10, adoptOrphans: false, dryRun: false };
      await runReconcile({ pool, gateway }, policy); // پرسشِ اول ⇒ notPaid ⇒ failure_code
      const mid = await pool.query<{ status: string; failure_code: string | null }>(
        "SELECT status, failure_code FROM payments WHERE id = $1",
        [p.paymentId],
      );
      await runReconcile({ pool, gateway }, policy); // حالا پله ۳ برقرار است
      const end = await statusOf(pool, p.paymentId);

      // ★ **دو** sweep لازم است و این عمدی است: نردبان بدونِ «دستِ‌کم یک پاسخ» باطل نمی‌کند.
      const ok = mid.rows[0]?.status === "pending" && mid.rows[0].failure_code !== null && end !== "pending";
      record(
        "★ ردیفِ بی‌ادعای کهنه با **دو** sweep باطل می‌شود (نردبان هنوز کار می‌کند)",
        ok,
        `بعد از sweepِ اول: ${String(mid.rows[0]?.status)}/${String(mid.rows[0]?.failure_code)} · بعد از دوم: ${end}`,
      );
    } catch (error) {
      failed("★ ردیفِ بی‌ادعای کهنه", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۷) sweepِ درگاهِ دیگر این ردیف را نمی‌بیند ────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, "سنجه‌ی فیلترِ درگاه");
    try {
      const p = await pendingTransfer(pool, gateway, teamId, userId, planCode);
      await ageBy(pool, p.paymentId, 48 * HOUR);
      const other = new MockGateway({ checkoutBaseUrl: "http://localhost/pay" });
      const report = await runReconcile(
        { pool, gateway: other },
        { staleAfterMs: 1, expireAfterMs: 2, batchSize: 10, adoptOrphans: false, dryRun: false },
      );
      const touched = report.decisions.some((d) => d.paymentId === p.paymentId);
      const ok = !touched && (await statusOf(pool, p.paymentId)) === "pending";
      record(
        "sweepِ درگاهِ دیگر ردیفِ card_transfer را نمی‌بیند",
        ok,
        `دیده‌شده=${String(report.scanned)} · لمس‌شده=${String(touched)}` +
          (ok ? " ⇒ فیلترِ درگاهِ ADR-056 برقرار است" : " ⇒ MockGateway به هر authority «پرداخت شد» می‌گوید"),
      );
    } catch (error) {
      failed("فیلترِ درگاه", error);
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۸) بازپخشِ هم‌زمان — تنها چیزی که پیش‌چک نمی‌گیردش ───────────────
  {
    // ⚠️⚠️ **دو تیمِ جدا، و این هم از یک سبزِ دروغینِ گرفته‌شده آمد.** نگارشِ قبلی هر دو پرداخت
    //    را برای **یک تیم** می‌ساخت؛ آن‌وقت `23505`ی که می‌دیدیم از `subscriptions_active_uq`
    //    می‌آمد نه از ایندکسِ مرجع، و چک با ایندکسِ **حذف‌شده** هم سبز می‌مانْد. یعنی چیزی را
    //    «اثبات» می‌کرد که اصلاً نمی‌سنجید.
    const one = await seedTeam(pool, "سنجه‌ی بازپخشِ هم‌زمان ۱");
    const two = await seedTeam(pool, "سنجه‌ی بازپخشِ هم‌زمان ۲");
    try {
      const a = await pendingTransfer(pool, gateway, one.teamId, one.userId, planCode);
      const b = await pendingTransfer(pool, gateway, two.teamId, two.userId, planCode);
      const deps = { settings: SETTINGS, actor: actorFor(one.userId) };
      const run = async (id: string, holdMs: number, onWritten?: () => void): Promise<string> => {
        try {
          return await withTransaction(pool, async (tx) => {
            const outcome = await approveTransfer(tx, deps, {
              paymentId: id,
              ref: ref("مسابقه"),
              last4: null,
              observedAmountRial: a.amountRial,
              note: null,
            });
            // ★ نوشته شد ولی **commit نشده** ⇒ پیش‌چکِ تراکنشِ رقیب چیزی نمی‌بیند.
            onWritten?.();
            if (holdMs > 0) await tx.query("SELECT pg_sleep($1)", [holdMs / 1000]);
            return outcome.kind;
          });
        } catch (error) {
          return `خطا:${String((error as { code?: string }).code ?? (error as Error).message)}`;
        } finally {
          // ⚠️ سدّ **همیشه** باز می‌شود، حتی وقتی A پرتاب کرده — وگرنه شکستِ A به یک قفلِ
          //    بی‌پایانِ خودِ سنجه تبدیل می‌شود، و سنجه‌ای که هنگ می‌کند از شکستِ چیزی که
          //    می‌سنجد قابلِ تفکیک نیست (درسِ سومِ M4).
          onWritten?.();
        }
      };
      // ★★ سدِّ صریح — بدونِ این، هم‌پوشانی **رخ نمی‌داد**: تراکنشِ دوم کاملاً پس از اولی
      //    تمام می‌شد، پیش‌چکش ردیفِ commit‌شده را می‌دید، و چک با ایندکسِ **حذف‌شده** هم سبز
      //    می‌مانْد. (گرفته‌شده با `DROP INDEX` روی دیتابیسِ زنده.)
      let released = (): void => {};
      const aHasWritten = new Promise<void>((r) => {
        released = r;
      });
      const pA = run(a.paymentId, 700, released);
      await aHasWritten; // A نوشته ولی **commit نکرده**
      const y = await run(b.paymentId, 0);
      const x = await pA;
      const withRef = await pool.query<{ n: string }>(
        "SELECT count(*)::bigint AS n FROM payments WHERE team_id = ANY($1) AND transfer_ref IS NOT NULL",
        [[one.teamId, two.teamId]],
      );
      const paid = await pool.query<{ n: string }>(
        "SELECT count(*)::bigint AS n FROM payments WHERE team_id = ANY($1) AND status = 'paid'",
        [[one.teamId, two.teamId]],
      );
      const ok = Number(withRef.rows[0]?.n ?? "9") === 1 && Number(paid.rows[0]?.n ?? "9") === 1;
      record(
        "★★ دو تاییدِ هم‌زمان با **یک شماره** روی دو پرداخت ⇒ ایندکسِ یکتا یکی را رد می‌کند",
        ok,
        `نتیجه‌ها: ${x} / ${y} · ردیفِ دارای شماره=${String(withRef.rows[0]?.n)} · تسویه‌شده=${String(paid.rows[0]?.n)}` +
          (ok
            ? " ⇒ پیش‌چک TOCTOU دارد و این‌جا بی‌اثر است؛ نگهبانِ واقعی `payments_transfer_ref_uq` بود"
            : " ⇒ یک واریز دو اشتراک خرید"),
      );
    } catch (error) {
      failed("★★ بازپخشِ هم‌زمان", error);
    } finally {
      // ⚠️ **ترتیب اجباری است:** actorِ هر دو تایید کاربرِ تیمِ یک است، پس تا وقتی پرداختِ تیمِ
      //    دو زنده است، حذفِ آن کاربر روی `payments_transfer_approved_by_fkey` می‌شکند.
      await cleanup(pool, two.teamId, two.userId);
      await cleanup(pool, one.teamId, one.userId);
    }
  }

  await pool.query("UPDATE plans SET is_active = false WHERE code = $1", [planCode]);
  await pool.end();

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const bad = results.filter((r) => !r.ok);
  if (bad.length > 0) {
    console.error(`\n✖ ${String(bad.length)} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ کارت‌به‌کارت روی Postgresِ زنده اثبات شد (نه ادعا).");
}

await main();
