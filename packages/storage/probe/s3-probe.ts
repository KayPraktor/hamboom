/**
 * ★ probe گام ۳٫۰ (M3) — رفتارِ واقعیِ S3/presign روی MinIO، **قبل از** نوشتنِ interfaceِ storage.
 *
 * پرسشِ اصلی (قیدِ مالک): آیا محدودیتِ اندازه/نوع را می‌شود در **خودِ امضای presign** گذاشت،
 * تا آپلودِ مستقیمِ کلاینت که دورِ سرور را می‌زند، در لایه‌ی storage رد شود — نه فقط در `commit`؟
 * یعنی: آیا MinIO یک `Content-Length`/`Content-Type`ِ **امضاشده** را اعمال می‌کند؟
 *
 * ⚠️ اسکریپتِ شواهد (خارج از verify). نتیجه در PROGRESS؛ امضای `presignPut`ِ گام ۳٫۱ را قفل می‌کند.
 * اجرا: `docker compose ... up -d minio` سپس `node packages/storage/probe/s3-probe.ts`.
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
  cond ? pass++ : fail++;
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

/** آپلودِ خام با fetch روی یک presigned URL؛ status و پیام را برمی‌گرداند. */
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
await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: "rt/bin", Body: bytes, ContentType: "application/octet-stream" }));
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

// ── ۳) ★ presignPut با Content-Length و Content-Type امضاشده ──
console.log("\n۳) ★ presignPut — آیا سقفِ اندازه/نوعِ امضاشده اعمال می‌شود؟");
const good = new Uint8Array(10).fill(0x41); // دقیقاً ۱۰ بایت
const putCmd = new PutObjectCommand({
  Bucket: BUCKET,
  Key: "rt/limited",
  ContentLength: good.length,
  ContentType: "text/plain",
});
const putUrl = await getSignedUrl(s3, putCmd, {
  expiresIn: 900,
  signableHeaders: new Set(["content-length", "content-type"]),
});

// آپلودِ درست (همان اندازه/نوع)
const s1 = await put(putUrl, good, { "content-type": "text/plain", "content-length": String(good.length) });
ok(s1 >= 200 && s1 < 300, `آپلودِ درست (۱۰ بایت، text/plain) پذیرفته شد (status ${s1})`);

// آپلودِ بزرگ‌تر روی همان URL — MinIO باید ردش کند اگر Content-Length امضا اعمال شود
const big = new Uint8Array(2000).fill(0x42);
const s2 = await put(putUrl, big, { "content-type": "text/plain", "content-length": String(big.length) });
console.log(`     آپلودِ بزرگ‌تر (۲۰۰۰ بایت) روی همان امضا → status ${s2}`);
ok(s2 >= 400, s2 >= 400 ? "★ MinIO سقفِ Content-Lengthِ امضاشده را **اعمال کرد** (رد شد)" : "⚠️ MinIO سقفِ امضا را اعمال **نکرد** — باید POST-policy سنجید");

// آپلود با Content-Typeِ ناهمخوان روی همان URL
const s3t = await put(putUrl, good, { "content-type": "image/png", "content-length": String(good.length) });
console.log(`     آپلود با Content-Typeِ غلط (image/png) روی همان امضا → status ${s3t}`);
ok(s3t >= 400, s3t >= 400 ? "★ MinIO نوعِ امضاشده را **اعمال کرد** (رد شد)" : "⚠️ MinIO نوعِ امضاشده را اعمال **نکرد**");

console.log(`\nخلاصه: ${pass} سبز، ${fail} قرمز.`);
console.log("یافته‌ها (برای گام ۳٫۱ و PROGRESS): اعمالِ Content-Length/Type امضاشده روی MinIO بالا چاپ شد.");
process.exit(0); // probe همیشه ۰ برمی‌گردد؛ یافته در متن است، نه در کدِ خروج
