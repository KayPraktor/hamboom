# `@hamboom/storage`

دروازه‌ی **Object Storage** — تنها جایی در کلِ مونوریپو که حق دارد `@aws-sdk/client-s3` را
import کند (اصل **P4**، [ADR-013](../../ARCHITECTURE_DECISIONS.md#adr-013)). هر ماژولِ دیگر
(api، realtime، assets) فقط `ObjectStore` را می‌بیند، نه SDKِ خام. گیتِ ESLintش
(`storageBoundaries`) **با `RuleTester` خودآزمون** است.

> برای کار کردن **روی** این پکیج [`CLAUDE.md`](CLAUDE.md) را بخوان. این فایل برای **مصرف‌کننده** است.

## استفاده

```ts
import { createS3ObjectStore } from "@hamboom/storage";

const store = createS3ObjectStore({
  endpoint: config.S3_ENDPOINT,        // MinIO در dev (پورتِ ۹۸۰۰ روی این ماشین)
  region, accessKeyId, secretAccessKey, bucket,
  forcePathStyle: true,                // MinIO
});

await store.putObject(key, bytes, mime);
const bytes = await store.getObject(key);   // null اگر نبود
await store.deleteObject(key);
const { url, fields } = await store.presignPost(key, { maxBytes, contentType }); // POST-policy
const signedGetUrl = await store.presignGet(key);   // برای `GET /assets/:id` → ۳۰۲
```

## دو چیزی که تضمین می‌کند

- ⚠️ **بازخوانی بعد از `put` تزئینی نیست:** انباری که `put`ش موفق برگردد ولی ناقص بنویسد، بدونِ این
  مرحله باعث می‌شود updateهای **واقعی** حذف شوند (compactorِ realtime بعدِ snapshot، updateهای قدیمی را
  پاک می‌کند). تستش هست.
- ★ **آپلود با presigned POST-policy، نه PUT** ([ADR-044](../../ARCHITECTURE_DECISIONS.md#adr-044)): فقط
  POST-policy سقفِ اندازه را با `content-length-range` **اعمال** می‌کند؛ presigned PUT نمی‌کند. فیلدِ `file`
  باید **آخرین** فیلدِ فرم باشد.

## ⚠️ تله‌ی محیطیِ ویندوز

MinIO روی این ماشین **۹۸۰۰/۹۸۰۱** است نه ۹۰۰۰/۹۰۰۱ — پورت‌های ۹۰۰۰/۹۰۰۱ در رنجِ excludedِ ویندوز افتاده‌اند
و `docker` نمی‌تواند bind کند. در `.env`ِ محلی override شده؛ compose/`.env.example` روی پیش‌فرضِ PLAN ماندند.
جزئیات در [CLAUDE.mdِ ریشه](../../CLAUDE.md).

## دستورات

```bash
pnpm --filter @hamboom/storage test        # داخلِ pnpm verify
pnpm --filter @hamboom/storage typecheck
pnpm db:up                                  # postgres + redis + minio (+ minio-init: باکت‌های assets/snapshots)
```

## آنچه اینجا انجام نمی‌شود

اعتبارسنجیِ دارایی (sha256/sniff) → [`assets`](../assets/) · route/DB → [`apps/api`](../../apps/api/) ·
snapshotِ سند → [`apps/realtime`](../../apps/realtime/) (که این store را تزریق می‌گیرد).
