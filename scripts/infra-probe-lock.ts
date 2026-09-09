/**
 * probeِ M5 گام ۱٫۵ — **advisory lockِ Postgres** روی دیتابیسِ زنده
 * ([ADR-060](../ARCHITECTURE_DECISIONS.md#adr-060)).
 *
 * ── چرا probe، پیش از کد ────────────────────────────────────────────────
 *
 * فاز ۶ می‌خواهد انتخابِ رهبرِ آشتی‌دهی را روی `pg_try_advisory_lock` بنا کند. سه ادعا زیرِ
 * آن تصمیم است و هیچ‌کدام از مستندات نقل نمی‌شود — این‌جا **اندازه‌گیری** می‌شوند:
 *
 *   ۱. دو نشست، یک کلید ⇒ فقط یکی می‌گیرد.
 *   ۲. آزادسازیِ صریح ⇒ نشستِ دوم می‌تواند بگیرد.
 *   ۳. ★★ **مرگِ نشستِ صاحبِ قفل ⇒ قفل خودکار آزاد می‌شود.** این همان چیزی است که یک
 *      نودِ مرده را بی‌خطر می‌کند؛ اگر درست نباشد، یک crash کلِ آشتی‌دهی را تا ری‌استارتِ
 *      دیتابیس می‌خواباند.
 *   ۴. ⚠️ **قفل به نشست بسته است، نه به تراکنش و نه به استخر.** پس گرفتن روی یک اتصالِ
 *      استخر و آزادکردن روی اتصالِ دیگر **کار نمی‌کند** — و این دقیقاً همان خطایی است که
 *      در کدِ آینده آسان رخ می‌دهد، چون `pool.query` انتخابِ اتصال را پنهان می‌کند.
 *   ۵. کلیدهای متفاوت با هم تداخل ندارند.
 *
 * ★ هر بلوک try/catch دارد: شکستِ خودِ سنجه باید یک چکِ **قرمز** باشد، نه یک crash.
 *
 * اجرا: `pnpm infra:probe-lock` (بعد از `pnpm db:up`).
 */
import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import pg from "pg";

import { createDbPool } from "../apps/api/src/plugins/db.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** کلیدهای آزمایشی — عمداً از کلیدِ واقعیِ آشتی‌دهی جدا، تا با production تداخل نکند. */
const KEY_A = 918_273_641;
const KEY_B = 918_273_642;

const tryLock = async (c: pg.Client | pg.PoolClient, key: number): Promise<boolean> =>
  (await c.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [key])).rows[0]!
    .locked;

const unlock = async (c: pg.Client | pg.PoolClient, key: number): Promise<boolean> =>
  (await c.query<{ released: boolean }>("SELECT pg_advisory_unlock($1) AS released", [key]))
    .rows[0]!.released;

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const conn = { connectionString: env.DATABASE_URL };
  const results: CheckResult[] = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });
  };
  const failed = (name: string, error: unknown): void => {
    record(name, false, `خودِ چک شکست: ${String((error as Error).message)}`);
  };

  // ── ۱ و ۲: انحصار، و آزادسازیِ صریح ────────────────────────────────
  {
    const name = "★ دو نشست و یک کلید ⇒ فقط یکی می‌گیرد؛ بعد از آزادسازی، دومی می‌گیرد";
    const a = new pg.Client(conn);
    const b = new pg.Client(conn);
    try {
      await a.connect();
      await b.connect();
      const first = await tryLock(a, KEY_A);
      const secondBlocked = await tryLock(b, KEY_A);
      await unlock(a, KEY_A);
      const secondAfter = await tryLock(b, KEY_A);
      await unlock(b, KEY_A);

      const ok = first && !secondBlocked && secondAfter;
      record(
        name,
        ok,
        ok
          ? "اولی گرفت · دومی رد شد · بعد از آزادسازی دومی گرفت"
          : `واقعی: first=${first} secondBlocked=${secondBlocked} secondAfter=${secondAfter}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await a.end().catch(() => undefined);
      await b.end().catch(() => undefined);
    }
  }

  // ── ۳: ★★ مرگِ نشست ⇒ آزادسازیِ خودکار ─────────────────────────────
  {
    const name =
      "★★ مرگِ نشستِ صاحبِ قفل ⇒ قفل **خودکار** آزاد می‌شود (نودِ مرده سیستم را نمی‌خواباند)";
    const owner = new pg.Client(conn);
    const other = new pg.Client(conn);
    try {
      await owner.connect();
      await other.connect();
      const held = await tryLock(owner, KEY_A);
      const blockedWhileAlive = await tryLock(other, KEY_A);

      // ★ قطعِ نشست، بدونِ آزادسازیِ صریح — شبیه‌سازیِ crashِ نود.
      await owner.end();
      // به Postgres فرصت بده پاک‌سازیِ نشست را ثبت کند.
      await other.query("SELECT pg_sleep(0.3)");

      const takenAfterDeath = await tryLock(other, KEY_A);
      await unlock(other, KEY_A);

      const ok = held && !blockedWhileAlive && takenAfterDeath;
      record(
        name,
        ok,
        ok
          ? "قفل با قطعِ نشست آزاد شد ⇒ crashِ نود، آشتی‌دهی را تا ری‌استارتِ دیتابیس نمی‌خواباند"
          : `واقعی: held=${held} blockedWhileAlive=${blockedWhileAlive} takenAfterDeath=${takenAfterDeath}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await owner.end().catch(() => undefined);
      await other.end().catch(() => undefined);
    }
  }

  // ── ۴: ⚠️ قفل به **نشست** بسته است، نه به استخر ────────────────────
  {
    const name = "⚠️ گرفتن روی یک اتصالِ استخر و آزادکردن روی اتصالِ دیگر **کار نمی‌کند**";
    const pool = createDbPool({ connectionString: env.DATABASE_URL, ssl: false, poolMax: 4 });
    try {
      // ★ دو اتصالِ **متمایز** از استخر — همان چیزی که `pool.query` پنهانش می‌کند.
      const c1 = await pool.connect();
      const c2 = await pool.connect();

      const locked = await tryLock(c1, KEY_B);
      const releasedOnWrongConn = await unlock(c2, KEY_B); // انتظار: false
      const stillHeld = !(await tryLock(c2, KEY_B)); // هنوز دستِ c1 است
      const releasedOnRightConn = await unlock(c1, KEY_B); // انتظار: true

      c1.release();
      c2.release();

      const ok = locked && !releasedOnWrongConn && stillHeld && releasedOnRightConn;
      record(
        name,
        ok,
        ok
          ? "آزادسازی روی اتصالِ اشتباه `false` داد و قفل باقی مانْد ⇒ ADR-060 درست می‌گوید: **اتصالِ اختصاصی**"
          : `واقعی: locked=${locked} releasedOnWrong=${releasedOnWrongConn} stillHeld=${stillHeld} releasedOnRight=${releasedOnRightConn}`,
      );
    } catch (error) {
      failed(name, error);
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  // ── ۵: کلیدهای متفاوت مستقل‌اند ────────────────────────────────────
  {
    const name = "کلیدهای متفاوت با هم تداخل ندارند (هر کارِ دوره‌ای کلیدِ خودش را می‌گیرد)";
    const a = new pg.Client(conn);
    const b = new pg.Client(conn);
    try {
      await a.connect();
      await b.connect();
      const one = await tryLock(a, KEY_A);
      const two = await tryLock(b, KEY_B);
      await unlock(a, KEY_A);
      await unlock(b, KEY_B);

      const ok = one && two;
      record(name, ok, ok ? "هر دو گرفتند" : `واقعی: A=${one} B=${two}`);
    } catch (error) {
      failed(name, error);
    } finally {
      await a.end().catch(() => undefined);
      await b.end().catch(() => undefined);
    }
  }

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ ${reds.length} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ رفتارِ advisory lock روی Postgresِ زنده اثبات شد (نه ادعا).");
}

await main();
