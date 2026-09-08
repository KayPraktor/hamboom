#!/usr/bin/env node
/**
 * انتظار برای آمادگیِ واقعیِ postgres / redis / minio — M5 گام ۳٫۲.
 *
 * ── چرا یک اسکریپت، و نه `docker compose up --wait` ─────────────────────
 *
 * ۱. **minio عمداً healthcheck ندارد** (تصمیمِ M3 گام ۳٫۰: تصویرش ابزارِ سلامتِ
 *    داخلِ کانتینر را تضمین نمی‌کند)، پس `--wait` درباره‌اش چیزی نمی‌داند.
 * ۲. ★★ **«پورت باز است» با «آماده است» یکی نیست.** Postgres در حالِ initdb هم
 *    اتصال می‌پذیرد و بعد خطا می‌دهد؛ یک انتظارِ TCPی، مسابقه‌ی زمانی را فقط
 *    نامرئی می‌کند. این‌جا هر سرویس با **کارِ واقعیِ خودش** سنجیده می‌شود:
 *    `SELECT 1`، `PING`، و endpointِ سلامتِ minio.
 *
 * ⚠️ **در CI اجرا می‌شود ولی محلی هم اجرا می‌شود** — با همان `.env`. اگر روزی
 * سرویسی اضافه شد، این‌جا هم اضافه شود، وگرنه اولین شکستِ CI یک تایم‌اوتِ گنگ است.
 *
 * اجرا: `node --env-file-if-exists=.env scripts/ci-wait-services.mjs`
 */
import Redis from "ioredis";
import pg from "pg";

/**
 * سقفِ کلِ انتظار. عددش سخاوتمند است چون شکستش باید «واقعاً بالا نیامد» باشد.
 *
 * ★ از env قابلِ کوتاه‌کردن است — تنها راهِ **آزمودنِ خودِ این اسکریپت**: با یک آدرسِ
 * غلط و سقفِ چندثانیه‌ای باید قرمز شود، وگرنه فقط ادعا می‌کند که منتظر می‌مانَد.
 */
const TIMEOUT_MS = Number(process.env.CI_WAIT_TIMEOUT_MS ?? 120_000);
const INTERVAL_MS = 1000;

const deadline = Date.now() + TIMEOUT_MS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ⚠️ `error.message` به‌تنهایی کافی نیست: خطای اتصالِ Node یک `AggregateError` با
 * **پیامِ خالی** است (آزموده شد — گزارشِ «آخرین خطا:» خالی درآمد و هیچ‌چیز نمی‌گفت).
 * یک تایم‌اوتِ بی‌دلیل، همان چیزی است که ساعت‌ها وقت می‌گیرد.
 */
function describe(error) {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message, error.code, ...(error.errors ?? []).map((e) => describe(e))];
  return parts.filter(Boolean).join(" · ") || error.name;
}

/** یک بررسی را تا آماده‌شدن یا تایم‌اوت تکرار می‌کند و **آخرین خطا** را گزارش می‌دهد. */
async function waitFor(name, probe) {
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      await probe();
      console.log(`✔ ${name}`);
      return;
    } catch (error) {
      lastError = describe(error);
      await sleep(INTERVAL_MS);
    }
  }
  console.error(`✖ ${name} در ${TIMEOUT_MS / 1000} ثانیه آماده نشد.\n    آخرین خطا: ${lastError}`);
  process.exit(1);
}

const need = (key) => {
  const value = process.env[key];
  if (!value) {
    // ⚠️ پیامِ اولیه می‌گفت «در CI با `cp .env.example .env` ساخته می‌شود» — و **گمراه
    //    کننده بود**: اولین اجرای واقعیِ CI همین‌جا قرمز شد در حالی که فایل ساخته **شده
    //    بود**؛ چیزی که نبود، `--env-file` روی خودِ دستور بود.
    console.error(
      `✖ ${key} تعریف نشده. وجودِ فایلِ .env کافی نیست — باید بارگذاری شود: \`pnpm ci:wait\``,
    );
    process.exit(1);
  }
  return value;
};

const databaseUrl = need("DATABASE_URL");
const redisUrl = need("REDIS_URL");
const s3Endpoint = need("S3_ENDPOINT");

await waitFor("postgres پاسخ می‌دهد (SELECT 1)", async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => undefined);
  }
});

await waitFor("redis پاسخ می‌دهد (PING)", async () => {
  // ⚠️ `lazyConnect` لازم است تا خطای اتصال به‌جای یک eventِ بی‌صاحب، rejectِ همین
  //    promise شود — وگرنه اسکریپت به‌جای گزارش، crash می‌کند.
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
});

await waitFor("minio پاسخ می‌دهد (health/live)", async () => {
  const res = await fetch(new URL("/minio/health/live", s3Endpoint), {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`وضعیت ${res.status}`);
});

// ★ باکت‌ها را `minio-init` می‌سازد و آن سرویس **خارج می‌شود**، پس صرفِ بالا بودنِ
//   minio تضمین نمی‌کند باکت‌ها آمده باشند. اولین آپلود بدونشان می‌شکست (M3 گام ۵٫۴).
await waitFor("باکت‌های minio ساخته شده‌اند", async () => {
  for (const bucket of [need("S3_BUCKET_ASSETS"), need("S3_BUCKET_SNAPSHOTS")]) {
    const res = await fetch(new URL(`/${bucket}`, s3Endpoint), {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    // ۴۰۳ یعنی «هست ولی اجازه نداری» — باکت **وجود دارد**؛ ۴۰۴ یعنی هنوز ساخته نشده.
    if (res.status === 404) throw new Error(`باکتِ ${bucket} هنوز نیست`);
  }
});

console.log("\n✔ هر سه سرویس کارِ واقعیِ خودشان را انجام دادند، نه فقط پورت باز کردند.");
