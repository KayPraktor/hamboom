/**
 * ★ probe گام ۳٫۰ (M3) — رفتارِ واقعیِ S3/presign روی MinIO، **قبل از** نوشتنِ interfaceِ storage.
 *
 * پرسشِ اصلی (قیدِ مالک): محدودیتِ اندازه/نوع باید در **خودِ امضا/policyِ presign** اعمال شود، تا
 * آپلودِ مستقیمِ کلاینت که دورِ سرور را می‌زند در لایه‌ی storage رد شود — نه فقط در `commit`.
 *
 * دو مکانیزم **با عدد** مقایسه می‌شوند (تصمیمِ OD-2):
 *   ۳) presigned **PUT** با `Content-Length`/`Content-Type`ِ امضاشده — مشاهده‌ای: MinIO چه می‌کند؟
 *   ۴) presigned **POST** با `content-length-range` + `eq $Content-Type` — مکانیزمِ موردِنظرِ مالک،
 *      روی **هر دو حالت**: آپلودِ زیرِ سقف باید **پذیرفته**، آپلودِ بالای سقف باید **توسط خودِ MinIO رد** شود.
 *
 * ⚠️ اسکریپتِ شواهد (خارج از verify؛ `probe/` در tsconfig و eslint نادیده است، بعد از ثبتِ عدد پاک می‌شود).
 * اجرا: `docker compose -f infra/docker/docker-compose.yml --env-file .env up -d minio` سپس
 *        `node packages/storage/probe/s3-probe.ts`.
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const REGION = process.env.S3_REGION ?? "ir-thr-at1";
const KEY_ID = process.env.S3_ACCESS_KEY_ID ?? "hamboom_minio";
const SECRET = process.env.S3_SECRET_ACCESS_KEY ?? "hamboom_minio_dev_pw";
const BUCKET = "hamboom-probe";

const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
  forcePathStyle: true, // ★ ADR-013: رایج‌ترین علتِ شکستِ مهاجرتِ S3 — اینجا صریح می‌سنجیمش
});

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (cond) pass++;
  else fail++;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitReady(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      return;
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
      await sleep(500); // minio هنوز بالا نیامده — retry
    }
  }
  throw new Error("MinIO در ۲۰ثانیه آماده نشد — آیا `docker compose up -d minio` اجرا شده؟");
}

/** آپلودِ خام با fetch روی یک presigned PUT URL؛ فقط status را برمی‌گرداند. */
async function put(url: string, body: Uint8Array, headers: Record<string, string>): Promise<number> {
  const res = await fetch(url, { method: "PUT", body, headers });
  if (!res.ok) await res.text().catch(() => "");
  return res.status;
}

console.log("\n=== probe ۳٫۰ — رفتارِ S3/presign روی MinIO (forcePathStyle) ===\n");
await waitReady();
console.log("MinIO آماده است؛ باکتِ probe ساخته شد.\n");

// ── ۱) رفت‌وبرگشتِ باینری بیت‌به‌بیت ──
console.log("۱) رفت‌وبرگشتِ باینری (put → get):");
const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x01, 0x7f, 0xfe]);
await s3.send(
  new PutObjectCommand({ Bucket: BUCKET, Key: "rt/bin", Body: bytes, ContentType: "application/octet-stream" }),
);
const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: "rt/bin" }));
const back = new Uint8Array(await got.Body!.transformToByteArray());
ok(back.length === bytes.length && back.every((b, i) => b === bytes[i]), "بایت‌ها بیت‌به‌بیت سالم برگشتند");
const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: "rt/bin" }));
ok(head.ContentLength === bytes.length, `headObject اندازه‌ی واقعی را می‌دهد (${head.ContentLength})`);

// ── ۲) presignGet ──
console.log("\n۲) presignGet (دانلودِ مستقیم):");
const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: "rt/bin" }), { expiresIn: 900 });
const dl = await fetch(getUrl);
ok(dl.ok, `presignGet دانلود شد (status ${dl.status})`);

// ── ۳) presigned PUT با Content-Length/Content-Type امضاشده — مشاهده‌ای ──
console.log("\n۳) presigned PUT با `Content-Length`/`Content-Type`ِ امضاشده — MinIO چه می‌کند؟");
const good = new Uint8Array(10).fill(0x41); // دقیقاً ۱۰ بایت
const putUrl = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: BUCKET, Key: "rt/put-limited", ContentLength: good.length, ContentType: "text/plain" }),
  { expiresIn: 900, signableHeaders: new Set(["content-length", "content-type"]) },
);
const putGood = await put(putUrl, good, { "content-type": "text/plain", "content-length": String(good.length) });
ok(putGood >= 200 && putGood < 300, `آپلودِ درست (۱۰ بایت، text/plain) پذیرفته شد (status ${putGood})`);
// همان امضا، ولی بدنه‌ی بزرگ‌تر و نوعِ غلط — آیا MinIO ردشان می‌کند؟ (یافته، نه pass/fail)
const big = new Uint8Array(2000).fill(0x42);
const putBig = await put(putUrl, big, { "content-type": "text/plain", "content-length": String(big.length) });
const putWrongType = await put(putUrl, good, { "content-type": "image/png", "content-length": String(good.length) });
const putSizeEnforced = putBig >= 400;
const putTypeEnforced = putWrongType >= 400;
console.log(`     · ۲۰۰۰ بایت روی همان امضا → status ${putBig}   ⇒ ${putSizeEnforced ? "رد" : "پذیرفته"} (تغییرِ هدرِ امضاشده امضا را می‌شکند)`);
console.log(`     · Content-Typeِ غلط روی همان امضا → status ${putWrongType}   ⇒ ${putTypeEnforced ? "رد" : "پذیرفته"}`);
// ★ سوالِ کلیدی: آن ۴۰۳ «سقفِ اندازه» است یا فقط «امضا شکست»؟ اگر content-length را **اصلاً امضا نکنیم**،
//   آیا کلاینت هر اندازه‌ای می‌فرستد؟ این دقیقاً همان «دورزدنی‌بودن»ِ ادعاشده است.
const putUnsignedUrl = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: BUCKET, Key: "rt/put-unsigned" }),
  { expiresIn: 900 }, // بدونِ signableHeaders — content-length امضا نمی‌شود
);
const putUnsignedBig = await put(putUnsignedUrl, new Uint8Array(5000).fill(0x43), {});
const putUnsignedBypasses = putUnsignedBig >= 200 && putUnsignedBig < 300;
console.log(
  `     · PUTِ بدونِ امضای content-length، بدنه‌ی ۵۰۰۰ بایت → status ${putUnsignedBig}   ⇒ ${putUnsignedBypasses ? "★ هیچ سقفی نیست — این همان دورزدن است" : "رد"}`,
);

// ── ۴) ★ presigned POST با content-length-range + eq Content-Type — مکانیزمِ مالک، هر دو حالت ──
console.log("\n۴) ★ presigned POST (`content-length-range` + `eq $Content-Type`) — روی خودِ MinIO:");
const MAX = 1024; // سقفِ ۱کیلوبایت برای این probe
const { url: postUrl, fields } = await createPresignedPost(s3, {
  Bucket: BUCKET,
  Key: "rt/post-limited",
  Conditions: [
    ["content-length-range", 0, MAX],
    ["eq", "$Content-Type", "text/plain"],
  ],
  Fields: { "Content-Type": "text/plain" },
  Expires: 900,
});
console.log(`     (postUrl: ${postUrl} · فیلدها: ${Object.keys(fields).join(", ")})`);

/** آپلودِ multipart/form-data روی presigned POST؛ `file` باید **آخرین** فیلد باشد (قاعده‌ی S3). */
async function postUpload(bodyBytes: Uint8Array, contentTypeOverride?: string): Promise<number> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (k === "Content-Type" && contentTypeOverride) continue; // زیر جایگزین می‌شود
    form.append(k, v);
  }
  if (contentTypeOverride) form.append("Content-Type", contentTypeOverride);
  form.append("file", new Blob([bodyBytes]), "f");
  const res = await fetch(postUrl, { method: "POST", body: form });
  if (!res.ok) await res.text().catch(() => "");
  return res.status;
}

// ۴a) زیرِ سقف + نوعِ درست → باید پذیرفته شود
const postUnder = await postUpload(new Uint8Array(500).fill(0x41));
ok(postUnder >= 200 && postUnder < 300, `زیرِ سقف (۵۰۰ ≤ ${MAX} بایت، text/plain) پذیرفته شد (status ${postUnder})`);
// ۴b) ★ بالای سقف → باید توسط خودِ MinIO رد شود
const postOver = await postUpload(new Uint8Array(5000).fill(0x42));
ok(postOver >= 400, `★ بالای سقف (۵۰۰۰ > ${MAX} بایت) توسط خودِ MinIO رد شد (status ${postOver})`);
// ۴c) ★ نوعِ ناهمخوان → باید توسط خودِ MinIO رد شود
const postWrongType = await postUpload(new Uint8Array(500).fill(0x41), "image/png");
ok(postWrongType >= 400, `★ نوعِ ناهمخوان (image/png ≠ text/plain) رد شد (status ${postWrongType})`);

// ── یافته‌ها (برای گام ۳٫۱/۳٫۳ و PROGRESS §OD-2) ──
console.log("\n── یافته‌ها ──");
console.log(
  `  presigned PUT (content-length **امضاشده**): اندازه ${putSizeEnforced ? "✔ پین" : "✘"} · نوع ${putTypeEnforced ? "✔ پین" : "✘"} — ولی **دقیق**، نه بازه؛ و ${putUnsignedBypasses ? "بدونِ امضای content-length ✘ هیچ سقفی نیست" : "بدونِ امضا هم رد شد"}`,
);
console.log(
  `  presigned POST (content-length-range + eq): اندازه ${postOver >= 400 ? "✔ اعمال" : "✘"} · نوع ${postWrongType >= 400 ? "✔ اعمال" : "✘"} — **بازه** [۰..MAX]، مستقل از هدرِ کلاینت`,
);

console.log(`\nخلاصه: ${pass} سبز، ${fail} قرمز.`);
// ★ برخلافِ نسخه‌ی اول، این‌بار exit با نتیجه گره خورده: بخشِ ۴ مکانیزمی است که به آن **متعهد** می‌شویم،
//   پس اگر POST-policy هر دو حالت را درست اعمال نکند، باید **قرمز** باشد — نه پنهان در متن.
process.exit(fail === 0 ? 0 : 1);
