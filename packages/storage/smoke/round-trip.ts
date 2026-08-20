/**
 * ★ smoke گام ۳٫۱ — رفت‌وبرگشتِ واقعیِ `ObjectStore` روی MinIO (مثلِ `db:smoke`).
 *
 * برخلافِ `probe/` (که رفتارِ **خامِ** SDK را می‌سنجید و دورریختنی است)، این
 * اسکریپت **خودِ abstraction** (`createS3ObjectStore`) را می‌آزماید و **کِیپر** است:
 * هر بار که storage عوض شد باید سبز بماند. بیرونِ `pnpm verify` چون MinIO لازم دارد.
 *
 * اجرا: `docker compose -f infra/docker/docker-compose.yml --env-file .env up -d minio`
 *        سپس `pnpm storage:smoke`.
 */
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

import { createS3ObjectStore, type S3StorageConfig } from "../src/index.ts";

const ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const REGION = process.env.S3_REGION ?? "ir-thr-at1";
const KEY_ID = process.env.S3_ACCESS_KEY_ID ?? "hamboom_minio";
const SECRET = process.env.S3_SECRET_ACCESS_KEY ?? "hamboom_minio_dev_pw";
const BUCKET = "hamboom-storage-smoke";

const config: S3StorageConfig = {
  endpoint: ENDPOINT,
  region: REGION,
  accessKeyId: KEY_ID,
  secretAccessKey: SECRET,
  forcePathStyle: true,
  bucket: BUCKET,
  defaultPresignTtl: 900,
};

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (cond) pass++;
  else fail++;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// setup: باکت را با SDKِ خام بساز — کارِ minio-init در production؛ اینجا فقط برای smoke.
const raw = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
  forcePathStyle: true,
});
async function ensureBucket(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      await raw.send(new CreateBucketCommand({ Bucket: BUCKET }));
      return;
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
      await sleep(500); // MinIO هنوز بالا نیامده
    }
  }
  throw new Error("MinIO در ۲۰ثانیه آماده نشد — آیا `docker compose up -d minio` اجرا شده؟");
}

console.log("\n=== smoke ۳٫۱ — ObjectStore روی MinIO (forcePathStyle) ===\n");
await ensureBucket();
const store = createS3ObjectStore(config);

// ۱) putObject → getObject بیت‌به‌بیت
console.log("۱) put → get و متادیتا:");
const key = "smoke/round-trip.bin";
const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x01, 0x7f, 0xfe, 0x00, 0x2a]);
await store.putObject(key, bytes, { contentType: "application/octet-stream" });
const got = await store.getObject(key);
ok(
  got !== null && got.length === bytes.length && got.every((b, i) => b === bytes[i]),
  "putObject → getObject بیت‌به‌بیت سالم",
);
const head = await store.headObject(key);
ok(head !== null && head.size === bytes.length, `headObject اندازه‌ی واقعی (${head?.size})`);

// ۲) listPrefix
const list = await store.listPrefix("smoke/");
ok(list.includes(key), `listPrefix کلید را برمی‌گرداند (${list.length} کلید)`);

// ۳) presignGet → دانلودِ مستقیم
console.log("\n۲) presignGet:");
const getUrl = await store.presignGet(key);
const dl = await fetch(getUrl);
const dlBytes = new Uint8Array(await dl.arrayBuffer());
ok(
  dl.ok && dlBytes.length === bytes.length && dlBytes.every((b, i) => b === bytes[i]),
  `presignGet دانلودِ بیت‌به‌بیت (status ${dl.status})`,
);

// ۴) ★ presignUpload (POST-policy) — هر سه حالت، از راهِ abstraction
console.log("\n۳) ★ presignUpload (POST-policy) — سقف/نوع از راهِ interface:");
const uploadKey = "smoke/uploaded.txt";
const up = await store.presignUpload({ key: uploadKey, maxBytes: 1024, contentType: "text/plain" });
async function post(body: Uint8Array, contentTypeOverride?: string): Promise<number> {
  const form = new FormData();
  for (const [k, v] of Object.entries(up.fields)) {
    if (k === "Content-Type" && contentTypeOverride) continue;
    form.append(k, v);
  }
  if (contentTypeOverride) form.append("Content-Type", contentTypeOverride);
  form.append("file", new Blob([body]), "f");
  const res = await fetch(up.url, { method: "POST", body: form });
  if (!res.ok) await res.text().catch(() => "");
  return res.status;
}
const under = await post(new Uint8Array(500).fill(0x41));
ok(under >= 200 && under < 300, `زیرِ سقف (۵۰۰ ≤ ۱۰۲۴) پذیرفته (${under})`);
const over = await post(new Uint8Array(5000).fill(0x42));
ok(over >= 400, `★ بالای سقف (۵۰۰۰) توسط MinIO رد (${over})`);
const wrongType = await post(new Uint8Array(500).fill(0x41), "image/png");
ok(wrongType >= 400, `★ نوعِ غلط (image/png) توسط MinIO رد (${wrongType})`);
const uploaded = await store.headObject(uploadKey);
ok(uploaded !== null && uploaded.size === 500, `آپلودِ POSTِ درست واقعاً ذخیره شد (${uploaded?.size})`);

// ۵) delete و قراردادِ «کلیدِ غایب = null، نه خطا»
console.log("\n۴) delete و قراردادِ null:");
await store.deleteObject(key);
ok((await store.getObject(key)) === null, "بعد از deleteObject، getObject → null");
ok((await store.getObject("smoke/does-not-exist")) === null, "کلیدِ غایب: getObject → null (نه throw)");
ok((await store.headObject("smoke/does-not-exist")) === null, "کلیدِ غایب: headObject → null (نه throw)");

console.log(`\nخلاصه: ${pass} سبز، ${fail} قرمز.`);
process.exit(fail === 0 ? 0 : 1);
