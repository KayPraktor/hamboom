/**
 * پیاده‌سازیِ `ObjectStore` روی S3 — **تنها جای مجازِ `@aws-sdk/*`** در کلِ ریپو
 * (P4، گیتِ ESLintِ `storageBoundaries`).
 *
 * ⚠️ نامِ سرویس (`minio`/`arvan`) اینجا هم نمی‌آید؛ همه‌چیز از `S3StorageConfig`
 * می‌آید که مصرف‌کننده از `@hamboom/config` (`s3EnvSchema`) می‌سازد. این پکیج خودش
 * `process.env` را نمی‌خواند (PLAN §۴).
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { ObjectHead, ObjectStore, PresignUploadOptions, PresignedUpload } from "./object-store.ts";

/** پیکربندیِ یک `ObjectStore` — مقید به **یک** باکت. مصرف‌کننده از `s3EnvSchema` می‌سازد. */
export interface S3StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** ★ probe ۳٫۰/ADR-013: MinIO لازمش دارد؛ متغیرِ مستقل. */
  forcePathStyle: boolean;
  bucket: string;
  /** TTLِ پیش‌فرضِ presign به ثانیه (`S3_PRESIGN_TTL_SECONDS`). */
  defaultPresignTtl: number;
}

/** یک `ObjectStore`ِ مقید به `config.bucket` می‌سازد. */
export function createS3ObjectStore(config: S3StorageConfig): ObjectStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: config.forcePathStyle,
  });
  const bucket = config.bucket;

  return {
    async putObject(key, body, opts) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: opts?.contentType }),
      );
    },

    async getObject(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!res.Body) return null;
        return new Uint8Array(await res.Body.transformToByteArray());
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async headObject(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        const head: ObjectHead = {
          size: res.ContentLength ?? 0,
          contentType: res.ContentType,
          etag: res.ETag,
        };
        return head;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async listPrefix(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const obj of res.Contents ?? []) {
          if (obj.Key !== undefined) keys.push(obj.Key);
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token !== undefined);
      return keys;
    },

    async presignGet(key, opts) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: opts?.expiresIn ?? config.defaultPresignTtl,
      });
    },

    async presignUpload(opts: PresignUploadOptions): Promise<PresignedUpload> {
      const { url, fields } = await createPresignedPost(client, {
        Bucket: bucket,
        Key: opts.key,
        Conditions: [
          ["content-length-range", 0, opts.maxBytes],
          ["eq", "$Content-Type", opts.contentType],
        ],
        Fields: { "Content-Type": opts.contentType },
        Expires: opts.expiresIn ?? config.defaultPresignTtl,
      });
      return { url, fields };
    },
  };
}

/**
 * «کلید نیست» را با **نام/status** می‌شناسیم، نه با متنِ خطا (که می‌تواند عوض شود).
 * GetObject خطای `NoSuchKey` می‌دهد، HeadObject خطای `NotFound` (۴۰۴).
 */
function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404;
}

/**
 * ★ ادمینِ باکت — عمداً **بیرونِ** interfaceِ `ObjectStore` (که نازک می‌مانَد). ساختِ باکت یک
 * عملِ S3ِ ادمین است، پس اینجا — تنها جای مجازِ `@aws-sdk` — زندگی می‌کند، نه در مصرف‌کننده‌ها
 * (که حق ندارند SDK را ببینند، P4). idempotent: اگر باکت از قبل مالِ ماست، بی‌سروصدا برمی‌گردد.
 * برای smoke و تنظیمِ اولیه؛ در production کارِ minio-init/آروان است.
 */
export async function ensureBucket(config: S3StorageConfig): Promise<void> {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: config.forcePathStyle,
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
    throw e;
  }
}
