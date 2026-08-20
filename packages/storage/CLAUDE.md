# CLAUDE.md — `@hamboom/storage`

abstraction روی Object Storage سازگار با S3. **بخشِ P4 ماژول M3.** یک نمونه‌ی
`ObjectStore` به **یک باکت** مقید است؛ مصرف‌کننده به‌ازای هر باکت یکی می‌سازد.

**قبل از کار بخوان:** [PLAN §۳](../../PLAN.md) (compose/MinIO) و [§۴](../../PLAN.md) (env S3) ·
[ADR-013](../../ARCHITECTURE_DECISIONS.md#adr-013) (abstraction S3) · [`PROGRESS-M3` §فاز ۳](../../PROGRESS-M3-backend-api.md)
(یافته‌ی probe ۳٫۰ + گام ۳٫۱).

## خط قرمزها

1. ★ **تنها پکیجی در کل ریپو که `@aws-sdk/*` را import می‌کند** (P4). گیتش
   `storageBoundaries()` در [`eslint-config/boundaries.js`](../eslint-config/boundaries.js) است،
   وصل به [`eslint.config.js`](eslint.config.js)، و **خودآزمون** در
   [`eslint-config/test/boundaries.test.js`](../eslint-config/test/boundaries.test.js) (سه‌لایه).
   ⚠️ `@aws-sdk` اینجا عمداً **مجاز** است — اگر کسی «برای P4» ببنددش، خودِ لایه از کار می‌افتد؛
   تستِ `allowed` نگهبانش است (با شکستنِ عمدی ۵ تست قرمز شد).
2. ★ **این پکیج `process.env` را نمی‌خواند** (PLAN §۴). config `s3EnvSchema` را می‌خواند و یک
   `S3StorageConfig` می‌سازد؛ `createS3ObjectStore(config)` آن را می‌گیرد. پس storage خالص و تست‌پذیر می‌ماند.
3. ★★ **آپلود = `presignUpload` (POST-policy)، نه PUT.** probe ۳٫۰ روی MinIO با عدد ثابت کرد presigned
   PUT سقفِ اندازه را اعمال نمی‌کند (بدونِ امضای `content-length` هر اندازه‌ای پذیرفته می‌شود). فقط
   `createPresignedPost` با `content-length-range` + `eq $Content-Type` سقف را **سمتِ سرور** اعمال می‌کند.
   خروجی `{url, fields}` است و `file` باید **آخرین** فیلدِ فرم باشد. ⚠️ روی MinIO تایید شد؛ **آروان در
   ۳٫۳/M5 باید تایید شود** (ADR-013: رفتارِ presign بین سرویس‌ها فرق می‌کند).
4. **هیچ نامِ سرویسی (`minio`/`arvan`) در امضا** — سوییچ فقط با env (`S3_ENDPOINT`/کلیدها). `S3_FORCE_PATH_STYLE`
   متغیرِ مستقل است (MinIO لازمش دارد؛ آروان هم `true`).
5. **`getObject`/`headObject` روی کلیدِ غایب `null` می‌دهند، نه throw** — قراردادِ `SnapshotStore` همین را می‌خواهد.

## ★ تله: پسوندِ `.ts` روی importهای نسبی

مثلِ `config`/`realtime` این پکیج مستقیم با Node اجرا می‌شود (smoke) — importهای نسبی `.ts` صریح
می‌خواهند (`allowImportingTsExtensions` روشن). جزئیات در [`config/CLAUDE.md`](../config/CLAUDE.md).

## ساختار

| فایل | چیست |
|---|---|
| `src/object-store.ts` | پورتِ `ObjectStore` + تایپ‌ها (بدونِ `@aws-sdk`) |
| `src/s3-object-store.ts` | `createS3ObjectStore(config)` روی `@aws-sdk` + `S3StorageConfig` |
| `probe/s3-probe.ts` | ⚠️ **دورریختنی** — شواهدِ گام ۳٫۰ (مکانیزمِ presign)؛ حذف هنگامِ بستنِ فاز ۳ |
| `smoke/round-trip.ts` | ★ **کِیپر** — رفت‌وبرگشتِ `ObjectStore` روی MinIO؛ هر بار storage عوض شد اجرا شود |

`probe/` و `smoke/` بیرونِ verify‌اند (MinIO لازم دارند) و در tsconfig/eslint نادیده‌اند.

## دستورات

```bash
pnpm --filter @hamboom/storage typecheck
pnpm --filter @hamboom/storage lint
# رفت‌وبرگشتِ واقعی (داکر لازم): اول MinIO را بالا بیاور
docker compose -f infra/docker/docker-compose.yml --env-file .env up -d minio
pnpm storage:smoke
```

## چیزهایی که اینجا انجام نمی‌شوند

`StorageSnapshotStore` (پیاده‌سازیِ پورتِ realtime — گام ۳٫۲) و `AssetTransport` سمتِ سرور
(endpointهای presign/commit — گام ۳٫۳) **مصرف‌کننده‌ی** این پکیج‌اند، نه بخشِ آن. ساختِ باکت
(minio-init) کارِ زیرساخت است (گام ۳٫۳). این پکیج فقط abstractionِ خامِ S3 است.
