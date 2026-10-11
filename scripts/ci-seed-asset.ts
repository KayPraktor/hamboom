/**
 * یک شیءِ واقعی در باکتِ assets — **فیکسچرِ CI**، نه سنجه (M6، ۱۴۰۵/۰۷/۲۰).
 *
 * ── چرا لازم شد ────────────────────────────────────────────────────────
 *
 * [`infra:restore-storage`](restore-storage.ts) برای **هر باکت** چکِ `vacuous` دارد: بازیابیِ «هیچ»
 * چیزی را اثبات نمی‌کند، پس قرمز است. برای snapshots، `rt:compaction` پیش از پشتیبان اولین اشیاء را
 * از مسیرِ محصول می‌نویسد (ترتیبِ `ci.yml` به همین دلیل است). برای assets **هیچ سنجه‌ای** این کار را
 * نمی‌کند — `storage:smoke` و `assets:smoke` باکتِ خودشان را دارند. پس در محیطِ تمیزِ CI باکتِ assets
 * خالی می‌مانَد و مرحله‌ی بازیابی از روزی که نوشته شد **نمی‌توانست** آن‌جا سبز شود.
 *
 * ⚠️ این هرگز در CI دیده نشد: آن job از اولین پوشِ M6 روی `db:up` می‌افتاد و به این مرحله نمی‌رسید.
 * با شبیه‌سازیِ محلیِ همان job پیدا شد (checkoutِ تمیز + `.env.example` + استکِ خالی): ۱۷ مرحله سبز،
 * همین یکی قرمز با «مانیفست برای hamboom-assets هیچ ورودی‌ای ندارد». روی ماشینِ توسعه همیشه سبز بود،
 * چون باکتِ dev پر است — همان درسِ `db:smoke`ِ M5.
 *
 * ── چه چیزی هست و چه چیزی نیست ─────────────────────────────────────────
 *
 * یک PNG از راهِ `ObjectStore` (P4) در باکت می‌گذارد و بایت‌به‌بایت بازمی‌خوانَد. مسیرِ محصول
 * (presign → POSTِ مستقیم → commit → `GET /assets/:id`) را **نمی‌سنجد** — آن را `assets:smoke` (سرویس،
 * در CI) و `test:e2e:assets` (مرورگر، دستی) می‌سنجند. ردیفِ `files` هم نمی‌سازد: مشقِ بازیابی برای
 * assets فقط بایت می‌سنجد (چکِ `catalog` امروز فقط snapshots را می‌بیند).
 *
 * ⚠️ بیرون از CI **بالا نمی‌آید**: هر اجرا یک بلابِ بی‌مرجع در باکتی می‌گذارد که env نشانش می‌دهد —
 * روی ماشینِ توسعه یعنی زباله در باکتِ dev، روی VM یعنی زباله در باکتِ مشتری.
 *
 * اجرا: `pnpm ci:seed-asset` (فقط با `CI=true`، که GitHub Actions خودش می‌گذارد).
 */
import { loadEnv, s3EnvSchema } from "@hamboom/config";
import { createS3ObjectStore } from "@hamboom/storage";

if (process.env.CI !== "true") {
  console.error(
    "✖ `ci:seed-asset` فقط در CI اجرا می‌شود (CI=true). بیرون از آن یک بلابِ بی‌مرجع در باکتِ واقعی می‌گذارد.",
  );
  process.exit(1);
}

/** امضای PNG + بدنه‌ی قطعی — همان شکلی که `assets:smoke` آپلود می‌کند. */
function png(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < size; i++) bytes[i] = i & 0xff;
  return bytes;
}

const env = loadEnv(s3EnvSchema);
const store = createS3ObjectStore({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  defaultPresignTtl: env.S3_PRESIGN_TTL_SECONDS,
  bucket: env.S3_BUCKET_ASSETS,
});

const key = `ci-seed/${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
const body = png(2048);
await store.putObject(key, body, { contentType: "image/png" });

const back = await store.getObject(key);
if (back === null || back.length !== body.length || !back.every((b, i) => b === body[i])) {
  console.error(`✖ شیء نوشته شد ولی همان بایت‌ها برنگشتند: ${env.S3_BUCKET_ASSETS}/${key}`);
  process.exit(1);
}
console.log(`✔ ${env.S3_BUCKET_ASSETS}/${key} — ${String(body.length)} بایت، بازخوانی‌شده`);
