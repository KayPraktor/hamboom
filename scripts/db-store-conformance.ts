/**
 * conformanceِ پورت‌های store روی Postgresِ زنده + ★★ **تستِ اتمیکِ دو-چرخشِ همزمان** — گام ۵٫۲.
 *
 * ── چرا این اسکریپت، و چرا حیاتی است ──────────────────────────────────
 *
 * ۱. **conformanceِ مشترک:** همان case‌هایی که در verify روی `createMemory*Store` سبزند، اینجا روی
 *    `createPg*Store` اجرا می‌شوند. اگر PG و memory از هم واگرا شوند، یکی قرمز می‌شود — «انحرافِ
 *    پیاده‌سازی» را می‌گیرد (قیدِ صریحِ مالک).
 *
 * ۲. ★★ **اتمیک‌بودنِ چرخش:** N چرخشِ **همزمان** روی یک توکن. با `SELECT … FOR UPDATE` باید **دقیقاً
 *    یکی** موفق شود (بقیه reuse/invalid). این **همان خانواده‌ی باگِ `seq` در M2** است که زیرِ همزمانی
 *    ۴۳ از ۵۰۰ append را بی‌صدا می‌خورد — پس واقعی است، نه اختیاری.
 *
 *    ⚠️ **اثباتِ خودآزمون:** اگر `FOR UPDATE` را از `findByHash` برداری، چند چرخش هم‌زمان `used=false`
 *    می‌بینند و **بیش از یکی** موفق می‌شود → این تست **قرمز** می‌شود (okCount>1). با آن سد، همیشه ۱.
 *
 * مثلِ `db:smoke`/`db:fk-test` به Postgresِ زنده نیاز دارد و skip نمی‌شود.
 * اجرا: `pnpm db:store-test` (بعد از `pnpm db:up && pnpm db:migrate`).
 */
import { randomUUID } from "node:crypto";

import { RefreshError, rotateSession, startSession } from "@hamboom/auth-core";
import { databaseEnvSchema, loadEnv } from "@hamboom/config";

import { createPgOtpStore } from "../apps/api/src/adapters/otp-store.ts";
import { otpStoreCases } from "../apps/api/src/adapters/otp-store.conformance.ts";
import { createPgSessionStore } from "../apps/api/src/adapters/session-store.ts";
import { sessionStoreCases } from "../apps/api/src/adapters/session-store.conformance.ts";
import { createDbPool } from "../apps/api/src/plugins/db.ts";
import type pg from "pg";

const CONCURRENCY = 10;

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

/** یک چرخش در تراکنشِ خودش — دقیقاً منطقِ endpointِ `/auth/refresh` (commit-on-reuse). */
async function rotateOnce(pool: pg.Pool, rawToken: string, ttl: number): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await rotateSession(createPgSessionStore(client), rawToken, { ttlSeconds: ttl });
      await client.query("COMMIT");
      return "ok";
    } catch (error) {
      if (error instanceof RefreshError) {
        if (error.code === "reuse") {
          await client.query("COMMIT"); // سوزاندنِ خانواده باید بماند
          return "reuse";
        }
        await client.query("ROLLBACK");
        return error.code;
      }
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

async function testConcurrentRotate(pool: pg.Pool, userId: string): Promise<Result> {
  // توکنِ ریشه R برای این کاربر.
  const rootToken = await startSession(createPgSessionStore(pool), userId, { ttlSeconds: 3600 });

  // ★ N چرخشِ همزمانِ **همان** توکن.
  const outcomes = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => rotateOnce(pool, rootToken, 3600)),
  );
  const okCount = outcomes.filter((o) => o === "ok").length;
  const ok = okCount === 1;
  return {
    name: `atomicity — ${CONCURRENCY} چرخشِ همزمانِ یک توکن → دقیقاً یکی موفق`,
    ok,
    detail: `okCount=${okCount} (باید ۱)؛ outcomes=[${outcomes.join(", ")}]${
      ok ? "" : "  ← FOR UPDATE شکسته؟ چند چرخش markUsed را هم‌زمان دیدند (خانواده‌ی باگِ seq)"
    }`,
  };
}

/**
 * ★★ تستِ **قطعیِ** قفل — برخلافِ `testConcurrentRotate` که به تایمینگ وابسته است (چون
 * قفلِ نوشتنِ `markUsed` هم تا حدی سریالی می‌کند)، این مستقیم می‌سنجد که `findByHash`ِ **دومِ**
 * همزمان تا commit/rollbackِ اولی **بلاک** می‌شود. بردنِ `FOR UPDATE` این را **قطعاً** قرمز می‌کند:
 * بدونِ قفلِ خواندن، خواننده‌ی دوم بی‌درنگ برمی‌گردد و `used=false`ِ کهنه می‌بیند — همان حفره.
 */
async function testForUpdateLocks(pool: pg.Pool, userId: string): Promise<Result> {
  // ★ مستقیم insert/findByHash روی یک `tokenHash` مشترک (نه startSize که توکنِ **خام** می‌دهد و
  //    findByHash **هش** می‌خواهد). این‌طور دقیقاً همان متدی که قفل می‌گذارد را می‌سنجیم.
  const tokenHash = randomUUID();
  await createPgSessionStore(pool).insert({
    tokenHash,
    familyId: randomUUID(),
    sub: userId,
    used: false,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  const c1 = await pool.connect();
  const c2 = await pool.connect();
  try {
    await c1.query("BEGIN");
    await c2.query("BEGIN");

    // c1 سطر را با findByHash (FOR UPDATE) قفل می‌کند.
    const r1 = await createPgSessionStore(c1).findByHash(tokenHash);
    if (r1 === null) {
      return { name: "atomicity — قفلِ خواندن", ok: false, detail: "c1 نتوانست ردیف را پیدا کند" };
    }

    // c2 همان را می‌خواند — با FOR UPDATE باید تا آزادشدنِ قفلِ c1 معطل بماند.
    let c2Resolved = false;
    const c2Find = createPgSessionStore(c2)
      .findByHash(tokenHash)
      .then(() => {
        c2Resolved = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 400));
    const blocked = !c2Resolved;

    await c1.query("ROLLBACK"); // قفل آزاد → c2 ادامه می‌یابد
    await c2Find;
    await c2.query("ROLLBACK");

    return {
      name: "atomicity — findByHashِ دومِ همزمان با FOR UPDATE بلاک می‌شود (قطعی)",
      ok: blocked,
      detail: blocked
        ? "c2 تا rollbackِ c1 معطل ماند — قفلِ سطرِ خواندن کار می‌کند"
        : "c2 بی‌درنگ برگشت — FOR UPDATE شکسته؟ دو خواننده used=falseِ کهنه می‌بینند (خانواده‌ی باگِ seq)",
    };
  } finally {
    c1.release();
    c2.release();
  }
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = createDbPool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL, poolMax: 20 });

  const results: Result[] = [];
  const userId = randomUUID();
  await pool.query(
    "INSERT INTO users (id, display_name, presence_color) VALUES ($1, 'store conformance', '#000000')",
    [userId],
  );

  try {
    const sessionStore = createPgSessionStore(pool);
    for (const c of sessionStoreCases) {
      try {
        await c.run(sessionStore, userId);
        results.push({ name: `session/${c.name}`, ok: true, detail: "" });
      } catch (error) {
        results.push({ name: `session/${c.name}`, ok: false, detail: String(error) });
      }
    }

    const otpStore = createPgOtpStore(pool);
    for (const c of otpStoreCases) {
      try {
        await c.run(otpStore);
        results.push({ name: `otp/${c.name}`, ok: true, detail: "" });
      } catch (error) {
        results.push({ name: `otp/${c.name}`, ok: false, detail: String(error) });
      }
    }

    results.push(await testForUpdateLocks(pool, userId)); // ★ FOR UPDATE را قطعی می‌سنجد
    results.push(await testConcurrentRotate(pool, userId)); // end-to-end: دقیقاً یکی موفق
  } finally {
    await pool.query("DELETE FROM users WHERE id = $1", [userId]); // cascade → auth_sessions
    await pool.query("DELETE FROM otp_challenges WHERE destination LIKE 'conftest-%'");
    await pool.end();
  }

  for (const r of results) {
    console.log(`${r.ok ? "✔" : "✖"} ${r.name}${r.detail ? `\n    ${r.detail}` : ""}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} از ${results.length} چک افتاد.`);
    process.exit(1);
  }
  console.log(
    `\n✔ همه‌ی ${results.length} چک سبز — conformanceِ PG↔memory + اتمیک‌بودنِ ${CONCURRENCY}-چرخشِ همزمان (نه ادعا).`,
  );
}

await main();
