/**
 * `@hamboom/storage` — abstraction روی Object Storage سازگار با S3 (P4، [ADR-013](../../../ARCHITECTURE_DECISIONS.md#adr-013)).
 *
 * ★ **تنها پکیجی که مجاز است `@aws-sdk/*` را import کند.** هیچ نامِ سرویسی
 * (`minio`/`arvan`) در امضای توابع نمی‌آید — سوییچ فقط با env.
 *
 * ⚠️ اسکلت — interfaceِ واقعی (`putObject`/`getObject`/`deleteObject`/`presignPut`/
 * `presignGet`/`headObject`/`listPrefix`) در **گام ۳٫۱** ساخته می‌شود، بعد از probeِ
 * گام ۳٫۰ که رفتارِ presignِ MinIO و اعمالِ سقفِ اندازه/نوع را با عدد می‌سنجد.
 */
export const STORAGE_PACKAGE = "@hamboom/storage";
