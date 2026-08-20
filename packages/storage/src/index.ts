/**
 * `@hamboom/storage` — abstraction روی Object Storage سازگار با S3 (P4، [ADR-013](../../../ARCHITECTURE_DECISIONS.md#adr-013)).
 *
 * ★ **تنها پکیجی که مجاز است `@aws-sdk/*` را import کند** (گیتِ ESLintِ `storageBoundaries`،
 * خودآزمون در `packages/eslint-config/test/boundaries.test.js`). هیچ نامِ سرویسی
 * (`minio`/`arvan`) در امضای توابع نمی‌آید — سوییچ فقط با env (PLAN §۴).
 */
export type {
  ObjectHead,
  ObjectStore,
  PresignUploadOptions,
  PresignedUpload,
} from "./object-store.ts";
export { createS3ObjectStore } from "./s3-object-store.ts";
export type { S3StorageConfig } from "./s3-object-store.ts";
export { createMemoryObjectStore } from "./memory-object-store.ts";
