/**
 * ★★ سنجه‌ی M5 گام ۶٫۱ — **دو نود، یک رهبر** ([ADR-060](../ARCHITECTURE_DECISIONS.md#adr-060)).
 *
 * ── ⚠️ چرا این سنجه می‌تواند به‌راحتی دروغ بگوید ──────────────────────────
 *
 * درسِ گرانِ M4: **یک چکِ همزمانی هم‌زمان نیست، مگر ثابت شود.** سه بار در آن ماژول یک
 * سنجه سبز بود و با برداشتنِ عمدیِ چیزی که می‌سنجید **باز هم سبز مانْد** — چون دو تراکنش
 * هرگز هم‌پوشانی نمی‌کردند. اگر این‌جا هم «کار»ِ داخلِ قفل لحظه‌ای باشد، نودِ اول قفل را
 * می‌گیرد و آزاد می‌کند **پیش از** اینکه نودِ دوم اصلاً تلاش کند، و سنجه سبز می‌شود بدونِ
 * اینکه چیزی اثبات شده باشد.
 *
 * ⇒ کارِ داخلِ ناحیه‌ی بحرانی یک `pg_sleep`ِ **واقعی** است، و هر دو «نود» با
 * `Promise.all` هم‌زمان شروع می‌شوند.
 *
 * ── ★ سه چک ──────────────────────────────────────────────────────────────
 *
 * ۱. دو نودِ هم‌زمان ⇒ **دقیقاً یکی** کار می‌کند.
 * ۲. ★★ **خودآزمون:** همان دو نود **بدونِ قفل** ⇒ **هر دو** کار می‌کنند. بدونِ این،
 *    یک قفلِ همیشه-شکست‌خورده هم چکِ ۱ را پاس می‌کرد.
 * ۳. بعد از پایانِ رهبر، نوبتِ بعد **دوباره** گرفته می‌شود (قفل نشت نمی‌کند).
 *
 * اجرا: `pnpm infra:probe-leader` (بعد از `pnpm db:up`).
 */
import { databaseEnvSchema, loadEnv } from "@hamboom/config";

import { createDbPool } from "../apps/api/src/plugins/db.ts";
import { withAdvisoryLock } from "../apps/api/src/plugins/leader-lock.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** ⚠️ کلیدِ آزمایشی — عمداً از کلیدِ واقعیِ آشتی‌دهی جدا، تا با production تداخل نکند. */
const PROBE_KEY = 811_451_777;
/** ★ طولِ کارِ ساختگی. باید از زمانِ راه‌افتادنِ نودِ دوم **بلندتر** باشد. */
const WORK_SECONDS = 1;

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const results: CheckResult[] = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });
  };

  const newPool = () =>
    createDbPool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL, poolMax: 4 });

  // ★ دو استخرِ **جدا** — شبیه‌سازیِ دو فرایندِ api، نه دو تابع در یک استخر.
  const nodeA = newPool();
  const nodeB = newPool();

  /** کارِ داخلِ ناحیه‌ی بحرانی: یک تاخیرِ **واقعیِ** سمتِ دیتابیس. */
  const work = async (pool: ReturnType<typeof newPool>, tag: string): Promise<string> => {
    await pool.query(`SELECT pg_sleep(${String(WORK_SECONDS)})`);
    return tag;
  };

  try {
    // ── ۱: دو نودِ هم‌زمان ⇒ دقیقاً یکی ────────────────────────────────
    {
      const name = "★★ دو نودِ هم‌زمان ⇒ **دقیقاً یکی** sweep می‌کند";
      try {
        const [a, b] = await Promise.all([
          withAdvisoryLock({ pool: nodeA, key: PROBE_KEY }, () => work(nodeA, "A")),
          withAdvisoryLock({ pool: nodeB, key: PROBE_KEY }, () => work(nodeB, "B")),
        ]);
        const winners = [a, b].filter((r) => r !== null);
        record(
          name,
          winners.length === 1,
          winners.length === 1
            ? `رهبر: ${String(winners[0])} · نودِ دیگر نوبت را رد کرد`
            : `واقعی: A=${String(a)} B=${String(b)} ⇒ ${String(winners.length)} نود کار کردند`,
        );
      } catch (error) {
        record(name, false, `خودِ چک شکست: ${String((error as Error).message)}`);
      }
    }

    // ── ۲: ★★ خودآزمون — بدونِ قفل، هر دو کار می‌کنند ─────────────────
    {
      const name = "★★ خودآزمون: **بدونِ** قفل، هر دو نود کار می‌کنند (چک واقعاً چیزی می‌سنجد)";
      try {
        const [a, b] = await Promise.all([work(nodeA, "A"), work(nodeB, "B")]);
        const ok = a === "A" && b === "B";
        record(
          name,
          ok,
          ok
            ? "هر دو اجرا شدند ⇒ پس سبزِ چکِ ۱ از خودِ قفل می‌آید، نه از سریالی‌بودنِ تصادفی"
            : `واقعی: A=${String(a)} B=${String(b)}`,
        );
      } catch (error) {
        record(name, false, `خودِ چک شکست: ${String((error as Error).message)}`);
      }
    }

    // ── ۳: قفل نشت نمی‌کند ────────────────────────────────────────────
    {
      const name = "قفل بعد از پایانِ رهبر آزاد می‌شود (نوبتِ بعد دوباره گرفته می‌شود)";
      try {
        const first = await withAdvisoryLock({ pool: nodeA, key: PROBE_KEY }, () =>
          Promise.resolve("۱"),
        );
        const second = await withAdvisoryLock({ pool: nodeB, key: PROBE_KEY }, () =>
          Promise.resolve("۲"),
        );
        const ok = first === "۱" && second === "۲";
        record(
          name,
          ok,
          ok
            ? "هر دو نوبتِ پیاپی رهبر شدند ⇒ قفل روی اتصالِ درست آزاد شد"
            : `واقعی: اول=${String(first)} دوم=${String(second)} ⇒ قفل نشت کرده`,
        );
      } catch (error) {
        record(name, false, `خودِ چک شکست: ${String((error as Error).message)}`);
      }
    }

    for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
    const reds = results.filter((r) => !r.ok);
    if (reds.length > 0) {
      console.error(`\n✖ ${String(reds.length)} چک قرمز شد.`);
      process.exit(1);
    }
    console.log("\n✔ انتخابِ رهبر روی Postgresِ زنده اثبات شد (نه ادعا).");
  } finally {
    await nodeA.end().catch(() => undefined);
    await nodeB.end().catch(() => undefined);
  }
}

await main();
