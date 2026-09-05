/**
 * سنجه‌ی زنده‌ی M4 فاز ۶ — **اعمالِ ظرفیتِ پلن روی Postgresِ واقعی**
 * ([ADR-053](../ARCHITECTURE_DECISIONS.md#adr-053)).
 *
 * ── چرا اسکریپت، نه تستِ واحد ──────────────────────────────────────────
 *
 * تا امروز هیچ سقفی اعمال نمی‌شد و `usage_counters` همیشه صفر بود (B-5)، یعنی هر ادعای
 * «سقف اعمال شد» **اثبات‌ناپذیر** بود. و مهم‌ترین خاصیتِ این گیت — اتمیک‌بودن زیرِ دو
 * درخواستِ هم‌زمان — اصلاً روی `fakeDb` دیده نمی‌شود.
 *
 * شش چک:
 *   ۱. سقف واقعاً می‌بندد (بوردِ چهارمِ پلنِ سه‌تایی رد می‌شود).
 *   ۲. ★★ دو ساختِ **هم‌زمان** روی آخرین ظرفیت ⇒ فقط **یکی** رد می‌شود.
 *   ۳. ★★ سنتینلِ `-1` یعنی نامحدود — نه «همه‌چیز بسته».
 *   ۴. ★★ فضای شخصی سقفِ بورد ندارد ولی سقفِ **فضا** دارد (تصمیمِ مالک ۱۴۰۵/۰۶/۱۵).
 *   ۵. ★ تنزلِ فقط‌خواندنی: تیمِ بالای سقف داده از دست نمی‌دهد، فقط ساختِ جدید بسته است.
 *   ۶. ★★ کاربرِ `is_staff` از گیت رد **نمی‌شود**.
 *
 * ★ خودآزمون‌ها (دستی، چون گیت در خودِ سرویس است):
 *   • `FOR UPDATE` را از `lockTeamAndReadLimits` بردار ⇒ چکِ ۲ باید **قرمز** شود.
 *   • شرطِ `limit === UNLIMITED` را بردار ⇒ چکِ ۳ باید **قرمز** شود.
 *
 * اجرا: `pnpm billing:quota`
 */
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import type pg from "pg";

import { createDbPool, withTransaction } from "../apps/api/src/plugins/db.ts";
import { assertQuota } from "../apps/api/src/services/quota.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** یک پلنِ آزمایشی با سقف‌های دلخواه. */
async function ensurePlan(
  pool: pg.Pool,
  code: string,
  boards: number,
  members: number,
  storage: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO plans (code, name, description, price_monthly_rial, price_yearly_rial,
                        max_members, max_boards, max_storage_bytes, features, is_active, sort_order)
     VALUES ($1, $1, 'سنجه', 0, 0, $3, $2, $4, '[]'::jsonb, false, 98)
     ON CONFLICT (code) DO UPDATE
       SET max_boards = $2, max_members = $3, max_storage_bytes = $4`,
    [code, boards, members, storage],
  );
}

async function seedTeam(
  pool: pg.Pool,
  opts: { personal?: boolean; staff?: boolean } = {},
): Promise<{ userId: string; teamId: string }> {
  const userId = randomUUID();
  const teamId = randomUUID();
  await pool.query(
    "INSERT INTO users (id, display_name, presence_color, is_staff) VALUES ($1, $2, $3, $4)",
    [userId, "سنجه‌ی ظرفیت", "#3366cc", opts.staff ?? false],
  );
  await pool.query(
    "INSERT INTO teams (id, slug, name, owner_user_id, is_personal) VALUES ($1, $2, $3, $4, $5)",
    [teamId, `q-${teamId.slice(0, 8)}`, "تیمِ سنجه", userId, opts.personal ?? false],
  );
  await pool.query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [
    teamId,
    userId,
  ]);
  return { userId, teamId };
}

/** اشتراکِ فعالِ یک پلن به تیم می‌چسبانَد (تا رزولوشنِ پلن آن را بردارد). */
async function attachPlan(pool: pg.Pool, teamId: string, planCode: string): Promise<void> {
  await pool.query(
    `INSERT INTO subscriptions (id, team_id, plan_code, status, period, seats,
                                current_period_start, current_period_end)
     VALUES ($1, $2, $3, 'active', 'monthly', 1, now(), now() + interval '1 month')`,
    [randomUUID(), teamId, planCode],
  );
}

/**
 * @param holdMs اگر داده شود، بینِ شمردن و درج **مکث** می‌کند.
 *
 * ★★ **بدونِ این مکث، چکِ همزمانی یک گیتِ دروغین است.** نگارشِ اول بدونش نوشته شد و سبز
 * بود — ولی با برداشتنِ عمدیِ `FOR UPDATE` **باز هم سبز مانْد**، چون شمارش آن‌قدر سریع
 * است که تراکنشِ اول پیش از خواندنِ دومی commit می‌کند و دو درخواست هرگز واقعاً هم‌پوشانی
 * نمی‌کنند. با یک `pg_sleep` هر دو مجبور می‌شوند داخلِ ناحیه‌ی بحرانی بمانند، و آن‌وقت
 * وجود یا نبودِ قفل تفاوت می‌سازد. (همان درسِ سنجه‌ی تسویه، دوباره.)
 */
async function addBoard(
  pool: pg.Pool,
  teamId: string,
  userId: string,
  holdMs = 0,
): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await assertQuota(tx, teamId, "boards");
    if (holdMs > 0) await tx.query("SELECT pg_sleep($1)", [holdMs / 1000]);
    await tx.query("INSERT INTO boards (id, team_id, created_by) VALUES ($1, $2, $3)", [
      randomUUID(),
      teamId,
      userId,
    ]);
  });
}

const blocked = async (fn: () => Promise<unknown>): Promise<boolean> => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

async function cleanup(pool: pg.Pool, teamId: string, userId: string): Promise<void> {
  await pool.query("DELETE FROM files WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM boards WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM subscriptions WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = createDbPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    poolMax: 8,
  });
  const results: CheckResult[] = [];

  await ensurePlan(pool, "q_small", 3, 2, 1_000_000);
  await ensurePlan(pool, "q_unlimited", -1, -1, -1);

  // ── ۱ + ۲: سقف می‌بندد، و دو ساختِ هم‌زمان فقط یکی را رد می‌کنند ───────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      await attachPlan(pool, teamId, "q_small");
      await addBoard(pool, teamId, userId);
      await addBoard(pool, teamId, userId);
      const fourthBlocked = await blocked(async () => {
        await addBoard(pool, teamId, userId); // سومی (ظرفیت پر می‌شود)
        await addBoard(pool, teamId, userId); // چهارمی باید رد شود
      });
      const n1 = Number(
        (
          await pool.query<{ n: string | number }>(
            "SELECT count(*) n FROM boards WHERE team_id = $1",
            [teamId],
          )
        ).rows[0]!.n,
      );
      results.push({
        name: "۶٫۲ — سقفِ بورد واقعاً می‌بندد",
        ok: fourthBlocked && n1 === 3,
        detail:
          fourthBlocked && n1 === 3
            ? `سه بورد ساخته شد و چهارمی ردّ شد (${n1} ردیف) ⇒ سقف دیگر تزئینی نیست`
            : `انتظار: رد + ۳ بورد. واقعی: blocked=${fourthBlocked}، بورد=${n1}`,
      });
    } catch (error) {
      // ★ خطای غیرمنتظره در یک چک ⇒ همان چک **قرمز**، نه مرگِ کلِ سنجه. سنجه‌ای که
      //   crash کند، شکستِ خودش را از شکستِ چیزی که می‌سنجد قابلِ تفکیک نمی‌گذارد.
      results.push({
        name: `چکِ ${String(results.length + 1)} — خطای غیرمنتظره`,
        ok: false,
        detail: String((error as Error).message),
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      await attachPlan(pool, teamId, "q_small");
      await addBoard(pool, teamId, userId);
      await addBoard(pool, teamId, userId);
      // ★★ دو درخواستِ هم‌زمان روی **آخرین** ظرفیت.
      const both = await Promise.allSettled([
        addBoard(pool, teamId, userId, 250),
        addBoard(pool, teamId, userId, 250),
      ]);
      const okCount = both.filter((r) => r.status === "fulfilled").length;
      const n = Number(
        (
          await pool.query<{ n: string | number }>(
            "SELECT count(*) n FROM boards WHERE team_id = $1",
            [teamId],
          )
        ).rows[0]!.n,
      );
      const ok = okCount === 1 && n === 3;
      results.push({
        name: "★★ دو ساختِ هم‌زمان روی آخرین ظرفیت ⇒ فقط **یکی** رد می‌شود",
        ok,
        detail: ok
          ? `${okCount} موفق، ${both.length - okCount} ردّ · مجموع ${n} بورد ⇒ قفلِ ردیفِ تیم کار کرد`
          : `انتظار: ۱ موفق و ۳ بورد. واقعی: موفق=${okCount}، بورد=${n} ` +
            "⇒ بدونِ قفلِ ردیفِ تیم، شمارشِ داخلِ تراکنش اتمیک نیست",
      });
    } catch (error) {
      // ★ خطای غیرمنتظره در یک چک ⇒ همان چک **قرمز**، نه مرگِ کلِ سنجه. سنجه‌ای که
      //   crash کند، شکستِ خودش را از شکستِ چیزی که می‌سنجد قابلِ تفکیک نمی‌گذارد.
      results.push({
        name: `چکِ ${String(results.length + 1)} — خطای غیرمنتظره`,
        ok: false,
        detail: String((error as Error).message),
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۳: سنتینلِ -1 ─────────────────────────────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      await attachPlan(pool, teamId, "q_unlimited");
      // ⚠️ داخلِ try، چون اگر سنتینل بشکند **همان بوردِ اول** پرتاب می‌کند و بدونِ این،
      //    اسکریپت crash می‌کند به‌جای اینکه یک چکِ قرمزِ خوانا بدهد. یک سنجه باید
      //    **گزارش** بدهد، نه بترکد.
      let sentinelError: string | null = null;
      try {
        for (let i = 0; i < 6; i += 1) await addBoard(pool, teamId, userId);
      } catch (error) {
        sentinelError = String((error as Error).message);
      }
      const n = Number(
        (
          await pool.query<{ n: string | number }>(
            "SELECT count(*) n FROM boards WHERE team_id = $1",
            [teamId],
          )
        ).rows[0]!.n,
      );
      results.push({
        name: "★★ سنتینلِ `-1` یعنی نامحدود — نه «همه‌چیز بسته»",
        ok: n === 6 && sentinelError === null,
        detail:
          n === 6 && sentinelError === null
            ? "۶ بورد روی پلنِ نامحدود ساخته شد ⇒ چکِ ساده‌ی `count >= max` وارونه نشده"
            : `انتظار: ۶ بورد بدونِ خطا. واقعی: ${n} بورد، خطا=${sentinelError ?? "ندارد"}` +
              " — گیت روی پلنِ پولی **برعکس** کار می‌کند",
      });
    } catch (error) {
      // ★ خطای غیرمنتظره در یک چک ⇒ همان چک **قرمز**، نه مرگِ کلِ سنجه. سنجه‌ای که
      //   crash کند، شکستِ خودش را از شکستِ چیزی که می‌سنجد قابلِ تفکیک نمی‌گذارد.
      results.push({
        name: `چکِ ${String(results.length + 1)} — خطای غیرمنتظره`,
        ok: false,
        detail: String((error as Error).message),
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۴: ★★ فضای شخصی — بوردِ نامحدود، فضای محدود ───────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, { personal: true });
    try {
      // بدونِ اشتراک: رزولوشن باید `personal` بدهد، نه `free`.
      // ⚠️ داخلِ try به همان دلیلِ چکِ قبلی — سنجه باید گزارش بدهد، نه crash کند.
      let personalError: string | null = null;
      try {
        for (let i = 0; i < 5; i += 1) await addBoard(pool, teamId, userId);
      } catch (error) {
        personalError = String((error as Error).message);
      }
      const n = Number(
        (
          await pool.query<{ n: string | number }>(
            "SELECT count(*) n FROM boards WHERE team_id = $1",
            [teamId],
          )
        ).rows[0]!.n,
      );
      // ولی فضا سقف دارد: یک فایلِ غول‌آسا باید رد شود.
      const storageBlocked = await blocked(() =>
        withTransaction(pool, (tx) => assertQuota(tx, teamId, "storage", 2 * 1024 * 1024 * 1024)),
      );
      const ok = n === 5 && storageBlocked && personalError === null;
      results.push({
        name: "★★ فضای شخصی: بوردِ نامحدود ✓، ولی سقفِ فضا برقرار ✓",
        ok,
        detail: ok
          ? `${n} بورد ساخته شد (سقفِ «free» اعمال نشد) و فایلِ ۲GB ردّ شد ⇒ ` +
            "پلنِ «personal» درست رزولوو می‌شود و سقف روی چیزی است که واقعاً هزینه دارد"
          : `انتظار: ۵ بورد و ردِ فضا. واقعی: بورد=${n}، فضا-ردشد=${storageBlocked}، ` +
            `خطا=${personalError ?? "ندارد"}`,
      });
    } catch (error) {
      // ★ خطای غیرمنتظره در یک چک ⇒ همان چک **قرمز**، نه مرگِ کلِ سنجه. سنجه‌ای که
      //   crash کند، شکستِ خودش را از شکستِ چیزی که می‌سنجد قابلِ تفکیک نمی‌گذارد.
      results.push({
        name: `چکِ ${String(results.length + 1)} — خطای غیرمنتظره`,
        ok: false,
        detail: String((error as Error).message),
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۵: ★ تنزلِ فقط‌خواندنی (M4-D8) ────────────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool);
    try {
      await attachPlan(pool, teamId, "q_unlimited");
      for (let i = 0; i < 6; i += 1) await addBoard(pool, teamId, userId);
      // تنزل به پلنِ سه‌تایی، در حالی که تیم ۶ بورد دارد.
      await pool.query("UPDATE subscriptions SET plan_code = 'q_small' WHERE team_id = $1", [
        teamId,
      ]);
      const nowBlocked = await blocked(() => addBoard(pool, teamId, userId));
      const survived = Number(
        (
          await pool.query<{ n: string | number }>(
            "SELECT count(*) n FROM boards WHERE team_id = $1 AND deleted_at IS NULL",
            [teamId],
          )
        ).rows[0]!.n,
      );
      const ok = nowBlocked && survived === 6;
      results.push({
        name: "★ تنزل = فقط‌خواندنی: هیچ داده‌ای حذف نمی‌شود، فقط ساختِ جدید بسته است",
        ok,
        detail: ok
          ? "هر ۶ بورد سالم ماند و بوردِ هفتم ردّ شد ⇒ سیاستِ M4-D8 برقرار است"
          : `انتظار: ۶ بوردِ سالم + رد. واقعی: بورد=${survived}، blocked=${nowBlocked}`,
      });
    } catch (error) {
      // ★ خطای غیرمنتظره در یک چک ⇒ همان چک **قرمز**، نه مرگِ کلِ سنجه. سنجه‌ای که
      //   crash کند، شکستِ خودش را از شکستِ چیزی که می‌سنجد قابلِ تفکیک نمی‌گذارد.
      results.push({
        name: `چکِ ${String(results.length + 1)} — خطای غیرمنتظره`,
        ok: false,
        detail: String((error as Error).message),
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  // ── ۶: ★★ کاربرِ staff از گیت رد نمی‌شود ─────────────────────────────
  {
    const { userId, teamId } = await seedTeam(pool, { staff: true });
    try {
      await attachPlan(pool, teamId, "q_small");
      await addBoard(pool, teamId, userId);
      await addBoard(pool, teamId, userId);
      await addBoard(pool, teamId, userId);
      const staffBlocked = await blocked(() => addBoard(pool, teamId, userId));
      results.push({
        name: "★★ کاربرِ `is_staff` هم به سقف می‌خورد (گیت خاصیتِ **تیم** است، نه کاربر)",
        ok: staffBlocked,
        detail: staffBlocked
          ? "بوردِ چهارمِ کاربرِ staff ردّ شد ⇒ `effectiveBoardRole` (که به staff همه‌جا " +
            "`owner` می‌دهد) در مسیرِ گیت نیست"
          : "انتظار: رد. واقعی: staff از سقف رد شد — گیت دارد نقش را حل می‌کند!",
      });
    } catch (error) {
      // ★ خطای غیرمنتظره در یک چک ⇒ همان چک **قرمز**، نه مرگِ کلِ سنجه. سنجه‌ای که
      //   crash کند، شکستِ خودش را از شکستِ چیزی که می‌سنجد قابلِ تفکیک نمی‌گذارد.
      results.push({
        name: `چکِ ${String(results.length + 1)} — خطای غیرمنتظره`,
        ok: false,
        detail: String((error as Error).message),
      });
    } finally {
      await cleanup(pool, teamId, userId);
    }
  }

  await pool.query("DELETE FROM plans WHERE code IN ('q_small','q_unlimited')").catch(() => undefined);
  await pool.end();

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ گیتِ ظرفیت روی Postgresِ زنده اثبات شد (نه ادعا).");
}

await main();
