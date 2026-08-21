/**
 * ★ smoke گام ۳٫۳ — `AssetService` روی MinIOِ واقعی (مثلِ storage:smoke). بیرونِ verify.
 *
 * جریانِ کامل: presign → آپلودِ **واقعیِ** POST → validateUploaded روی بایت‌های واقعی
 * (sha256 بازمحاسبه، sniff، اندازه) → resolve → دانلود → مقایسه. + دو حالتِ امنیتی.
 *
 * اجرا: MinIO بالا، سپس `pnpm assets:smoke`.
 */
import { createHash } from "node:crypto";

import { createS3ObjectStore, ensureBucket, type S3StorageConfig } from "@hamboom/storage";

import { createAssetService } from "../src/index.ts";

const config: S3StorageConfig = {
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  region: process.env.S3_REGION ?? "ir-thr-at1",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "hamboom_minio",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "hamboom_minio_dev_pw",
  forcePathStyle: true,
  bucket: "hamboom-assets-smoke",
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

function fakePng(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < size; i++) b[i] = i & 0xff;
  return b;
}
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** آپلودِ multipart/form-data روی presigned POST؛ `file` آخرین فیلد. */
async function post(url: string, fields: Record<string, string>, body: Uint8Array): Promise<number> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new Blob([body]), "f");
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) await res.text().catch(() => "");
  return res.status;
}

async function ensureReady(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      await ensureBucket(config);
      return;
    } catch {
      await sleep(500); // MinIO هنوز بالا نیامده
    }
  }
  throw new Error("MinIO در ۲۰ثانیه آماده نشد — آیا `docker compose up -d minio` اجرا شده؟");
}

console.log("\n=== smoke ۳٫۳ — AssetService روی MinIO ===\n");
await ensureReady();
const objectStore = createS3ObjectStore(config);
const svc = createAssetService({ objectStore, maxBytes: 1024 });
const ctx = { teamId: "t1", boardId: "b1", uploadedBy: "u1" };

// ── ۱) presign → آپلودِ واقعی ──
console.log("۱) presign → آپلودِ POSTِ واقعی:");
const png = fakePng(200);
const declaredSha = sha(png);
const presigned = await svc.presign({ mimeType: "image/png", sizeBytes: png.length, sha256: declaredSha }, ctx);
ok(Boolean(presigned.fileId && presigned.url && presigned.fields.key), "presign داد {fileId, url, fields}");
const key = presigned.fields.key;
const upStatus = await post(presigned.url, presigned.fields, png);
ok(upStatus >= 200 && upStatus < 300, `آپلودِ POST پذیرفته شد (${upStatus})`);

// ── ۲) validateUploaded روی بایت‌های واقعی ──
console.log("\n۲) validateUploaded (sha256 بازمحاسبه + sniff + اندازه):");
const verified = await svc.validateUploaded({
  key,
  declared: { mimeType: "image/png", sizeBytes: png.length, sha256: declaredSha },
});
ok(
  verified.sha256 === declaredSha && verified.mime === "image/png" && verified.sizeBytes === png.length,
  "بایت‌های واقعی تایید شدند",
);

// ── ۳) حالت‌های امنیتی ──
console.log("\n۳) امنیت:");
let threw = false;
try {
  await svc.validateUploaded({
    key,
    declared: { mimeType: "image/png", sizeBytes: png.length, sha256: "0".repeat(64) },
  });
} catch {
  threw = true;
}
ok(threw, "★ sha256ِ اعلامیِ غلط رد شد (سرور خودش حساب کرد)");

// آپلودِ بزرگ‌تر از declared روی همان presign — خودِ MinIO باید ردش کند.
const tight = await svc.presign({ mimeType: "image/png", sizeBytes: 100, sha256: sha(fakePng(100)) }, ctx);
const overStatus = await post(tight.url, tight.fields, fakePng(5000));
ok(overStatus >= 400, `★ آپلودِ بزرگ‌تر از declared را MinIO رد کرد (${overStatus})`);

// ── ۴) resolve → دانلود بیت‌به‌بیت ──
console.log("\n۴) resolve → دانلود:");
const url = await svc.resolve(key);
const dl = await fetch(url);
const back = new Uint8Array(await dl.arrayBuffer());
ok(dl.ok && back.length === png.length && back.every((b, i) => b === png[i]), `دانلودِ بیت‌به‌بیت (${dl.status})`);

console.log(`\nخلاصه: ${pass} سبز، ${fail} قرمز.`);
process.exit(fail === 0 ? 0 : 1);
