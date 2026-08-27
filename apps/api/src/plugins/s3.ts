import { createS3ObjectStore, type ObjectStore, type S3StorageConfig } from "@hamboom/storage";

import type { ApiConfig } from "../config.ts";

/**
 * ساختِ `ObjectStore`ها از configِ api (فاز ۵).
 *
 * ★ **P4:** دسترسی به Object Storage فقط از راهِ `@hamboom/storage` — این اپ `@aws-sdk`ِ خام را
 * import نمی‌کند (گیتِ `apiBoundaries`). یک `ObjectStore` به **یک باکت** مقید است، پس به‌ازای هر
 * باکت (snapshots/assets) یکی ساخته می‌شود. این‌ها در `buildApp` ساخته و به routeها تزریق می‌شوند
 * (یا در تست، نمونه‌ی دروغین جایشان می‌نشیند — بدونِ نیاز به MinIO).
 */

function s3ConfigFor(config: ApiConfig, bucket: string): S3StorageConfig {
  return {
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    bucket,
    defaultPresignTtl: config.S3_PRESIGN_TTL_SECONDS,
  };
}

/** `ObjectStore`ِ مقید به باکتِ snapshots — بوتِ سریعِ بورد (`GET /boards/:id/snapshot`). */
export function createSnapshotObjectStore(config: ApiConfig): ObjectStore {
  return createS3ObjectStore(s3ConfigFor(config, config.S3_BUCKET_SNAPSHOTS));
}

/** `ObjectStore`ِ مقید به باکتِ assets — آپلود/دانلودِ تصویر. */
export function createAssetObjectStore(config: ApiConfig): ObjectStore {
  return createS3ObjectStore(s3ConfigFor(config, config.S3_BUCKET_ASSETS));
}
