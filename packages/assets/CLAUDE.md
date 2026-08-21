# CLAUDE.md — `@hamboom/assets`

لایه‌ی دامنه‌ی دارایی: presign آپلود، اعتبارسنجیِ commit، و resolve. **بخشِ گام ۳٫۳ ماژول M3.**

★ **مصرف‌کننده‌ی `@hamboom/storage` است، نه بخشی از آن** ([ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029)):
قاعده‌ی mime، کلیدِ team/board، sniff و sha256 اینجاست تا storage نازک بمانَد — همان تناظرِ
`canvas-sync`↔`ydoc-schema`.

**قبل از کار بخوان:** [PLAN §۵٫۲](../../PLAN.md) (endpointهای asset + یادداشتِ ۱) و [§۷](../../PLAN.md)
(مدلِ `HbAsset`) · [ADR-044](../../ARCHITECTURE_DECISIONS.md#adr-044) (POST-policy) · [ADR-013](../../ARCHITECTURE_DECISIONS.md#adr-013).

## خط قرمزها

1. ★★ **سرور هرگز به ادعای کلاینت اعتماد نمی‌کند.** `validateUploaded` **خودش** روی بایت‌های واقعیِ
   دانلودشده `sha256` می‌گیرد و با مقدارِ اعلامی مقایسه می‌کند، نوعِ واقعی را با **sniffِ magic-bytes**
   (نه `Content-Type`ِ اعلامی) می‌سنجد، و اندازه را با `headObject`. کلِ ارزشِ commit همین است — چون
   آپلودِ مستقیم دورِ سرور را می‌زند. (قیدِ مالک ۱۴۰۵/۰۵/۲۸.)
2. ★ **`@aws-sdk/*` ممنوع است** (P4، گیتِ `assetsBoundaries`). به Object Storage **فقط از راهِ
   `@hamboom/storage`** می‌رسد. اگر روزی این باز شود، storage دیگر نازک نیست.
3. ★ **`uploadedBy`/`teamId`/`boardId` از `ctx` (توکن) می‌آیند، هرگز از بدنه‌ی کلاینت** — وگرنه هرکس
   فایل را به نامِ دیگری بالا می‌گذارد. `presign(req, ctx)` این تفکیک را ساختاری می‌کند.
4. **آپلود = presigned POST با `content-length-range`** ([ADR-044](../../ARCHITECTURE_DECISIONS.md#adr-044))،
   نه PUT. خروجیِ `{ url, fields }` است و `file` آخرین فیلدِ فرم. probe ۳٫۰ ثابت کرد PUT سقف را اعمال نمی‌کند.
5. **`width`/`height` اینجا استخراج نمی‌شود** (تصمیمِ مالک ۱۴۰۵/۰۵/۲۸): decoderِ سمتِ سرور (`sharp`) یک
   وابستگیِ native سنگین است و w/h نمایشی است نه امنیتی. کلاینت w/h خودش را دارد؛ فاز ۵/worker پرش می‌کند.
6. **این پکیج `process.env` را نمی‌خواند** — `maxBytes`/allowed از config می‌آیند (فاز ۵ سیم‌کشی می‌کند).

## ساختار

| فایل | چیست |
|---|---|
| `src/asset-service.ts` | `createAssetService({ objectStore, maxBytes, … })` → `presign`/`validateUploaded`/`resolve` |
| `src/sniff.ts` | `sniffMime(bytes)` — تشخیصِ نوعِ واقعی از magic-bytes (png/jpeg/webp/gif/svg) |
| `smoke/round-trip.ts` | ★ رفت‌وبرگشتِ واقعی روی MinIO — بیرونِ verify (mc: `pnpm assets:smoke`) |

## دستورات

```bash
pnpm --filter @hamboom/assets typecheck
pnpm --filter @hamboom/assets test
docker compose -f infra/docker/docker-compose.yml --env-file .env up -d minio
pnpm assets:smoke
```

## چیزهایی که اینجا انجام نمی‌شوند (کارِ فاز ۵ — `apps/api`)

endpointهای HTTP (`POST /assets/presign`/`commit`، `GET /assets/:id` با ۳۰۲)، جدولِ `files` +
migration + **ثبتِ رکورد** + دی‌دوپِ `sha256` (به DB نیاز دارند)، `UPLOAD_MAX_BYTES` در config، و
سیم‌کشیِ `ctx` از توکن. این ماژول فقط منطقِ خالص + `ObjectStore` است؛ `commit` اینجا **اعتبارسنجی**
می‌کند، **ثبت** نمی‌کند.
