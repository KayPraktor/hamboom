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
ok(
  uploaded !== null && uploaded.size === 500,
  `آپلودِ POSTِ درست واقعاً ذخیره شد (${uploaded?.size})`,
);

// ★ M6 / ADR-069 — سه متدِ افزایشی روی انبارِ واقعی
console.log("\n۴) ★ stream و پیمایش (M6/ADR-069):");
{
  const { Readable } = await import("node:stream");
  const { createHash } = await import("node:crypto");
  // ۵MB در تکه‌های ۶۴KB — بزرگ‌تر از یک صفحه‌ی TCP و از یک chunkِ SDK، کوچک‌تر از این‌که smoke کند شود.
  const size = 5 * 1024 * 1024;
  const chunk = Buffer.alloc(64 * 1024);
  for (let i = 0; i < chunk.length; i++) chunk[i] = i & 0xff;
  const expectHash = createHash("sha256");
  for (let sent = 0; sent < size; sent += chunk.length) expectHash.update(chunk);
  const expected = expectHash.digest("hex");

  let left = size;
  const src = new Readable({
    read() {
      if (left <= 0) {
        this.push(null);
        return;
      }
      left -= chunk.length;
      this.push(chunk);
    },
  });
  const streamKey = "smoke/stream.bin";
  await store.putObjectStream(streamKey, src, {
    contentLength: size,
    contentType: "application/octet-stream",
  });
  const streamHead = await store.headObject(streamKey);
  ok(streamHead?.size === size, `putObjectStream با contentLength: اندازه‌ی سمتِ سرور ${streamHead?.size}`);

  const back = await store.getObjectStream(streamKey);
  const gotHash = createHash("sha256");
  let seen = 0;
  for await (const c of back!) {
    gotHash.update(c as Buffer);
    seen += (c as Buffer).byteLength;
  }
  ok(
    seen === size && gotHash.digest("hex") === expected,
    `getObjectStream بیت‌به‌بیت (sha256 برابر، ${seen} بایت)`,
  );
  ok((await store.getObjectStream("smoke/does-not-exist")) === null, "getObjectStream غایب → null");

  // ★ طولِ غلط باید **رد** شود — وگرنه «طول اجباری» فقط یک فیلد است، نه یک قرارداد.
  let wrongLenRejected = false;
  try {
    await store.putObjectStream("smoke/wrong-len.bin", Readable.from([Buffer.from([1, 2, 3])]), {
      contentLength: 10,
    });
  } catch {
    wrongLenRejected = true;
  }
  ok(wrongLenRejected, "putObjectStream با contentLengthِ غلط توسط انبار رد می‌شود");

  const iterated: string[] = [];
  for await (const k of store.iteratePrefix("smoke/")) iterated.push(k);
  const listed = await store.listPrefix("smoke/");
  ok(
    iterated.length === listed.length && iterated.every((k) => listed.includes(k)),
    `iteratePrefix همان ${iterated.length} کلیدِ listPrefix را می‌دهد`,
  );
  await store.deleteObject(streamKey);
}

// ۵) delete و قراردادِ «کلیدِ غایب = null، نه خطا»
console.log("\n۵) delete و قراردادِ null:");
await store.deleteObject(key);
ok((await store.getObject(key)) === null, "بعد از deleteObject، getObject → null");
ok(
  (await store.getObject("smoke/does-not-exist")) === null,
  "کلیدِ غایب: getObject → null (نه throw)",
);
ok(
  (await store.headObject("smoke/does-not-exist")) === null,
  "کلیدِ غایب: headObject → null (نه throw)",
);

console.log(`\nخلاصه: ${pass} سبز، ${fail} قرمز.`);
process.exit(fail === 0 ? 0 : 1);
