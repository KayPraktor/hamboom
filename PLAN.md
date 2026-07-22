# PLAN.md — هم‌بوم (Hamboom)

> سند مرجع برنامه‌ریزی پروژه. هر session جدید Claude Code باید این فایل +
> [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) را قبل از کدنویسی بخواند.
>
> **وضعیت:** پیش‌نویس ۱ — منتظر تایید مالک پروژه
> **تاریخ:** ۱۴۰۵/۰۴/۳۱ (2026-07-22)
> **دامنه:** hamboom.ir (خریداری‌شده، هنوز DNS ندارد)
> **مرجع محصولی:** [docs/iranian-miro-spec.md](docs/iranian-miro-spec.md)

---

## فهرست

1. [خلاصه اجرایی و اصول ثابت](#۱-خلاصه-اجرایی-و-اصول-ثابت)
2. [ساختار مونوریپو](#۲-ساختار-مونوریپو)
3. [محیط لوکال — docker-compose](#۳-محیط-لوکال--docker-compose)
4. [پیکربندی و متغیرهای محیطی (لوکال ↔ آروان)](#۴-پیکربندی-و-متغیرهای-محیطی)
5. [قرارداد API](#۵-قرارداد-api)
6. [Schema دیتابیس PostgreSQL](#۶-schema-دیتابیس-postgresql)
7. [مدل‌سازی Element ها داخل Yjs Doc](#۷-مدلسازی-element-ها-داخل-yjs-doc)
8. [شش ماژول: مسئولیت‌ها و ترتیب اجرا](#۸-شش-ماژول-مسئولیتها-و-ترتیب-اجرا)
9. [تصمیم‌های باز — نیاز به تایید تو](#۹-تصمیمهای-باز--نیاز-به-تایید-تو)
10. [ریسک‌های شناخته‌شده](#۱۰-ریسکهای-شناختهشده)

---

## ۱. خلاصه اجرایی و اصول ثابت

**محصول:** پلتفرم وایت‌بورد همکاری بلادرنگ، فارسی/RTL native، میزبانی ۱۰۰٪ داخل ایران، پرداخت ریالی.

**اصول غیرقابل‌مذاکره (هر session باید رعایت کند):**

| # | اصل | معنای عملی |
|---|-----|-----------|
| P1 | فقط لایسنس MIT / Apache-2.0 / BSD / ISC / 0BSD | قبل از افزودن هر dependency، فیلد `license` بررسی شود. `tldraw@>=2`, `ag-grid-enterprise`, `highcharts`, `fabric.js@6 (؟)` ممنوع. اسکریپت `pnpm run license:check` در CI. |
| P2 | صفر وابستگی به سرویس خارجی در runtime | بدون Google Fonts CDN، بدون Sentry SaaS، بدون Stripe، بدون Cloudflare. همه assets خودمیزبان. |
| P3 | همه‌چیز از روز اول لوکال اجرا می‌شود | `docker compose up && pnpm dev` باید کافی باشد. هیچ feature ای نباید برای توسعه به حساب ابری واقعی نیاز داشته باشد. |
| P4 | Object Storage فقط از پشت یک abstraction | کد اپ هرگز `minio` یا `arvan` را نمی‌شناسد؛ فقط `packages/storage` با S3 API. سوییچ = تغییر env. |
| P5 | پول همیشه `BIGINT` ریال | هیچ‌جا float، هیچ‌جا تومان در دیتابیس. تبدیل به تومان فقط در لایه نمایش. |
| P6 | RTL و فارسی، نه ترجمه | `dir="rtl"` روی `<html>`، logical CSS properties (`inline-start` به‌جای `left`)، اعداد فارسی در UI، تاریخ جلالی در نمایش / UTC در دیتابیس. |
| P7 | هیچ PII در لاگ | شماره موبایل ماسک‌شده (`0912***4567`)، کد OTP هرگز لاگ نشود. |

**تخمین زمانی (واقع‌بینانه، solo + agent):** MVP قابل‌عرضه ≈ ۳ تا ۵ ماه کار مستمر. این سند مسیر را می‌دهد، نه شتاب را.

---

## ۲. ساختار مونوریپو

ابزار: **pnpm workspaces + Turborepo**. دلیل در [ADR-002](ARCHITECTURE_DECISIONS.md#adr-002).

```
hamboom/
├─ apps/
│  ├─ web/                      # SPA اصلی — React 19 + Vite + TS
│  │  ├─ src/
│  │  │  ├─ routes/             # TanStack Router: /، /b/:boardId، /t/:teamSlug، /settings
│  │  │  ├─ features/
│  │  │  │  ├─ auth/            # صفحات OTP، شماره موبایل، refresh
│  │  │  │  ├─ dashboard/       # لیست بورد، فولدر، جستجو
│  │  │  │  ├─ board/           # پوسته‌ی صفحه بورد (toolbar، پنل‌ها، presence)
│  │  │  │  ├─ templates/       # گالری قالب
│  │  │  │  ├─ team/            # اعضا، دعوت، نقش
│  │  │  │  └─ billing/         # پلن، checkout، فاکتور
│  │  │  ├─ app/                # QueryClient، router، error boundary، theme
│  │  │  └─ main.tsx
│  │  ├─ public/fonts/          # Vazirmatn (SIL OFL) — خودمیزبان
│  │  ├─ index.html             # <html dir="rtl" lang="fa">
│  │  ├─ vite.config.ts
│  │  └─ CLAUDE.md
│  │
│  ├─ api/                      # REST API — Fastify 5 + TS  (ADR-001)
│  │  ├─ src/
│  │  │  ├─ modules/            # هر ماژول: routes.ts, service.ts, repo.ts, schema.ts
│  │  │  │  ├─ auth/  teams/  boards/  assets/  templates/
│  │  │  │  ├─ comments/  exports/  billing/  admin/
│  │  │  ├─ plugins/            # db, redis, s3, auth-guard, rate-limit, request-id, error
│  │  │  ├─ lib/                # otp, jwt, pagination, policy (RBAC)
│  │  │  ├─ app.ts              # buildApp() — تست‌پذیر، بدون listen
│  │  │  └─ server.ts
│  │  ├─ migrations/            # SQL خام، ترتیبی: 0001_init.sql ...
│  │  ├─ test/
│  │  └─ CLAUDE.md
│  │
│  ├─ realtime/                 # سرور WebSocket — Yjs + Redis  (ADR-006)
│  │  ├─ src/
│  │  │  ├─ server.ts           # uWebSockets.js یا ws
│  │  │  ├─ room.ts             # چرخه‌عمر یک اتاق (Y.Doc در حافظه)
│  │  │  ├─ persistence/        # postgres-update-log + s3-snapshot
│  │  │  ├─ pubsub/             # redis fanout بین نودها
│  │  │  ├─ auth.ts             # اعتبارسنجی توکن اتصال (verify از api)
│  │  │  └─ awareness.ts
│  │  └─ CLAUDE.md
│  │
│  ├─ worker/                   # کارهای پس‌زمینه — BullMQ روی Redis
│  │  ├─ src/jobs/
│  │  │  ├─ export-board.ts     # PNG/SVG/PDF با headless chromium
│  │  │  ├─ thumbnail.ts
│  │  │  ├─ snapshot-compact.ts # فشرده‌سازی update log → snapshot در S3
│  │  │  ├─ send-sms.ts         # کاوه‌نگار
│  │  │  ├─ subscription-renew.ts
│  │  │  └─ retention-cleanup.ts
│  │  └─ CLAUDE.md
│  │
│  └─ admin/                    # پنل ادمین پلتفرم (جدا از داشبورد تیم)
│     └─ CLAUDE.md              # Vite app جدا، روی admin.hamboom.ir
│
├─ packages/
│  ├─ canvas-core/              # ★ ماژول ۱ — موتور بوم
│  │  ├─ src/
│  │  │  ├─ engine/             # wrapper روی Excalidraw + patch ها
│  │  │  ├─ elements/           # سازنده/نرمال‌ساز sticky, shape, connector, frame...
│  │  │  ├─ tools/              # ابزارهای هم‌بوم (sticky, frame, connector, comment-pin)
│  │  │  ├─ ui/                 # toolbar، پنل رنگ، context menu (RTL)
│  │  │  ├─ text/               # bidi، shaping، اندازه‌گیری متن فارسی
│  │  │  ├─ theme/              # پالت میرو-استایل، توکن‌ها
│  │  │  └─ sync/               # ★ contract.ts — قرارداد canvas ↔ sync
│  │  └─ CLAUDE.md
│  │
│  ├─ ydoc-schema/              # ساختار Y.Doc، binder، migration نسخه schema
│  ├─ shared-types/             # ★ قرارداد مشترک: zod schema های DTO، کد خطاها، enum ها
│  ├─ sdk/                      # کلاینت typed برای API (از shared-types ساخته می‌شود)
│  ├─ ui/                       # دیزاین‌سیستم RTL: Button, Modal, Toast, Menu, tokens
│  ├─ i18n/                     # رشته‌های fa، تاریخ جلالی، اعداد فارسی، pluralization
│  ├─ storage/                  # abstraction روی S3 (MinIO ↔ Arvan)  — P4
│  ├─ auth-core/               # JWT sign/verify + policy engine (مشترک api و realtime)
│  ├─ config/                   # env parsing با zod — تنها نقطه خواندن process.env
│  └─ tsconfig/  eslint-config/ # پیکربندی مشترک
│
├─ vendor/
│  └─ excalidraw/               # git submodule (فقط اگر به فورک کامل رسیدیم — ADR-003)
│
├─ patches/                     # pnpm patch برای اصلاحات جراحی روی @excalidraw/excalidraw
│
├─ infra/
│  ├─ docker/
│  │  ├─ docker-compose.yml     # استک لوکال
│  │  ├─ docker-compose.override.yml.example
│  │  ├─ Dockerfile.api  Dockerfile.realtime  Dockerfile.worker  Dockerfile.web
│  │  └─ minio-init.sh
│  ├─ k8s/                      # manifest / helm chart برای آروان (فاز دیپلوی)
│  └─ sql/                      # seed، ایندکس‌های تحلیلی
│
├─ docs/
│  ├─ iranian-miro-spec.md      # سند محصول (موجود)
│  ├─ api.md                    # خروجی OpenAPI
│  └─ runbook.md
│
├─ scripts/                     # license-check.ts، seed.ts، smoke.ts
├─ .env.example                 # ★ تنها منبع حقیقت نام متغیرها
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
├─ CLAUDE.md                    # قوانین ریشه برای همه session ها
├─ PLAN.md                      # ← این فایل
├─ ARCHITECTURE_DECISIONS.md
└─ TODO.md                      # TODO ماژول فعال (الان: canvas-core)
```

**قاعده وابستگی بین پکیج‌ها (اجباری، در ESLint چک شود):**

```
apps/*        →  packages/*        ✅
packages/*    →  packages/*        ✅ (بدون چرخه)
packages/*    →  apps/*            ❌ هرگز
canvas-core   →  sdk / storage     ❌ (canvas باید مستقل از شبکه باشد)
ydoc-schema   →  canvas-core       ❌ (ydoc-schema پایین‌تر است)
```

---

## ۳. محیط لوکال — docker-compose

مسیر نهایی فایل: `infra/docker/docker-compose.yml`
اجرا: `docker compose -f infra/docker/docker-compose.yml --env-file .env up -d`

```yaml
# infra/docker/docker-compose.yml
# استک توسعه لوکال هم‌بوم.
# هیچ سرویسی اینجا نباید در production استفاده شود — در آروان معادل Managed آن‌ها می‌آید.
name: hamboom

services:
  postgres:
    image: postgres:16-alpine          # آروان Managed PostgreSQL هم 16 دارد
    container_name: hamboom-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-hamboom}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-hamboom_dev_pw}
      POSTGRES_DB: ${POSTGRES_DB:-hamboom}
      # ترتیب مرتب‌سازی فارسی درست + timezone صریح UTC
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C.UTF-8"
      TZ: UTC
      PGTZ: UTC
    command:
      - postgres
      - -c
      - max_connections=200
      - -c
      - shared_preload_libraries=pg_stat_statements
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ../sql/init:/docker-entrypoint-initdb.d:ro   # فقط EXTENSION ها؛ migration واقعی از apps/api
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-hamboom} -d ${POSTGRES_DB:-hamboom}"]
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:7-alpine              # آروان Managed Redis
    container_name: hamboom-redis
    restart: unless-stopped
    command: >
      redis-server
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy noeviction
      --requirepass ${REDIS_PASSWORD:-hamboom_dev_pw}
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a ${REDIS_PASSWORD:-hamboom_dev_pw} ping | grep PONG"]
      interval: 5s
      timeout: 5s
      retries: 20

  # ── جایگزین لوکال ArvanCloud Object Storage ─────────────────────────
  # هر دو S3 API استاندارد را پیاده می‌کنند. سوییچ = فقط تغییر S3_* در .env
  minio:
    image: minio/minio:latest
    container_name: hamboom-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY_ID:-hamboom_minio}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_ACCESS_KEY:-hamboom_minio_dev_pw}
      MINIO_REGION: ${S3_REGION:-ir-thr-at1}     # همان نام region آروان تا رفتار یکسان بماند
    ports:
      - "${MINIO_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 20

  minio-init:
    image: minio/mc:latest
    container_name: hamboom-minio-init
    depends_on:
      minio:
        condition: service_healthy
    environment:
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:-hamboom_minio}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:-hamboom_minio_dev_pw}
      S3_BUCKET_ASSETS: ${S3_BUCKET_ASSETS:-hamboom-assets}
      S3_BUCKET_EXPORTS: ${S3_BUCKET_EXPORTS:-hamboom-exports}
      S3_BUCKET_SNAPSHOTS: ${S3_BUCKET_SNAPSHOTS:-hamboom-snapshots}
    entrypoint: /bin/sh
    command: /scripts/minio-init.sh
    volumes:
      - ./minio-init.sh:/scripts/minio-init.sh:ro
    restart: "no"

  # ── ابزارهای توسعه (در production وجود ندارند) ──────────────────────
  mailpit:                              # تست ایمیل (روش ورود دوم)
    image: axllent/mailpit:latest
    container_name: hamboom-mailpit
    restart: unless-stopped
    ports:
      - "${MAILPIT_SMTP_PORT:-1025}:1025"
      - "${MAILPIT_UI_PORT:-8025}:8025"
    profiles: ["dev"]

  # شبیه‌ساز درگاه پیامک — OTP را در ترمینال چاپ می‌کند تا هزینه پیامک ندهیم
  sms-mock:
    image: node:24-alpine
    container_name: hamboom-sms-mock
    working_dir: /app
    command: node sms-mock.mjs
    volumes:
      - ./sms-mock.mjs:/app/sms-mock.mjs:ro
    ports:
      - "${SMS_MOCK_PORT:-4010}:4010"
    profiles: ["dev"]

volumes:
  pgdata:
  redisdata:
  miniodata:
```

```sh
# infra/docker/minio-init.sh
set -eu
mc alias set local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
for b in "$S3_BUCKET_ASSETS" "$S3_BUCKET_EXPORTS" "$S3_BUCKET_SNAPSHOTS"; do
  mc mb --ignore-existing "local/$b"
  mc anonymous set none "local/$b"          # همه دسترسی‌ها فقط با presigned URL
done
# assets: نگهداری نسخه‌ها برای بازیابی؛ exports: حذف خودکار پس از ۷ روز
mc version enable "local/$S3_BUCKET_ASSETS" || true
mc ilm rule add --expire-days 7 "local/$S3_BUCKET_EXPORTS" || true
echo "minio buckets ready"
```

**نکته مهم درباره‌ی سوییچ به آروان:** هیچ خطی از کد اپ نباید تغییر کند. فقط این‌ها در `.env` عوض می‌شوند:

| متغیر | لوکال (MinIO) | آروان (⚠️ در زمان دیپلوی تایید شود) |
|---|---|---|
| `S3_ENDPOINT` | `http://minio:9000` | `https://s3.ir-thr-at1.arvanstorage.ir` |
| `S3_REGION` | `ir-thr-at1` | `ir-thr-at1` |
| `S3_FORCE_PATH_STYLE` | `true` | `true` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | مقادیر dev | کلیدهای آروان |
| `S3_PUBLIC_BASE_URL` | `http://localhost:9000` | آدرس CDN آروان |

> ⚠️ endpoint و region دقیق آروان باید در زمان ساخت حساب از پنل خودشان تایید شود. کد نباید مقدار hardcode داشته باشد.

---

## ۴. پیکربندی و متغیرهای محیطی

**قاعده:** فقط `packages/config` اجازه‌ی خواندن `process.env` را دارد. یک schema با zod، fail-fast در بوت.

```bash
# .env.example  (کامل — هر متغیر جدید اینجا هم اضافه شود)

# ── عمومی ──────────────────────────────────────────
NODE_ENV=development
APP_ENV=local                          # local | staging | production
APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:3000
REALTIME_WS_URL=ws://localhost:3001
LOG_LEVEL=debug
TZ=UTC

# ── PostgreSQL ─────────────────────────────────────
POSTGRES_USER=hamboom
POSTGRES_PASSWORD=hamboom_dev_pw
POSTGRES_DB=hamboom
POSTGRES_PORT=5432
DATABASE_URL=postgres://hamboom:hamboom_dev_pw@localhost:5432/hamboom
DATABASE_SSL=false                     # آروان: true
DATABASE_POOL_MAX=20

# ── Redis ──────────────────────────────────────────
REDIS_PASSWORD=hamboom_dev_pw
REDIS_PORT=6379
REDIS_URL=redis://:hamboom_dev_pw@localhost:6379/0
REDIS_TLS=false                        # آروان: احتمالاً true

# ── Object Storage (S3-compatible) ────────────────
S3_ENDPOINT=http://localhost:9000
S3_REGION=ir-thr-at1
S3_ACCESS_KEY_ID=hamboom_minio
S3_SECRET_ACCESS_KEY=hamboom_minio_dev_pw
S3_FORCE_PATH_STYLE=true
S3_BUCKET_ASSETS=hamboom-assets
S3_BUCKET_EXPORTS=hamboom-exports
S3_BUCKET_SNAPSHOTS=hamboom-snapshots
S3_PUBLIC_BASE_URL=http://localhost:9000
S3_PRESIGN_TTL_SECONDS=900

# ── Auth ───────────────────────────────────────────
JWT_ACCESS_SECRET=change_me_dev_only_32_chars_minimum
JWT_REFRESH_SECRET=change_me_dev_only_32_chars_minimum_2
JWT_ACCESS_TTL=900                     # ۱۵ دقیقه
JWT_REFRESH_TTL=2592000                # ۳۰ روز
OTP_LENGTH=5
OTP_TTL_SECONDS=120
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_DEV_FIXED_CODE=11111               # فقط APP_ENV=local — OTP ثابت، بدون پیامک

# ── SMS (کاوه‌نگار) ────────────────────────────────
SMS_PROVIDER=mock                      # mock | kavenegar
SMS_MOCK_URL=http://localhost:4010
KAVENEGAR_API_KEY=
KAVENEGAR_OTP_TEMPLATE=hamboom-otp
KAVENEGAR_SENDER=

# ── Email (گزینه دوم) ──────────────────────────────
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM="هم‌بوم <no-reply@hamboom.ir>"

# ── پرداخت: زرین‌پال ──────────────────────────────
PAYMENT_PROVIDER=zarinpal              # zarinpal | idpay | mock
ZARINPAL_MODE=sandbox                  # sandbox | production
ZARINPAL_MERCHANT_ID=00000000-0000-0000-0000-000000000000   # ⚠️ placeholder
ZARINPAL_CURRENCY=IRR                  # IRR (ریال) — در دیتابیس همیشه ریال
ZARINPAL_CALLBACK_URL=http://localhost:3000/api/v1/billing/zarinpal/callback
IDPAY_API_KEY=
VAT_PERCENT=10                         # ⚠️ نیاز به تایید حسابدار

# ── Realtime ───────────────────────────────────────
RT_PORT=3001
RT_MAX_ROOMS_PER_NODE=500
RT_ROOM_IDLE_TIMEOUT_MS=120000
RT_HEARTBEAT_INTERVAL_MS=25000         # مهم: کوتاه‌تر از idle timeout لودبالانسر آروان
RT_SNAPSHOT_EVERY_UPDATES=500
RT_SNAPSHOT_EVERY_MS=60000
RT_MAX_DOC_BYTES=52428800              # ۵۰MB سقف سخت هر بورد

# ── محدودیت‌ها / Rate limit ────────────────────────
RATE_LIMIT_GLOBAL_PER_MIN=300
RATE_LIMIT_OTP_PER_PHONE_PER_HOUR=5
RATE_LIMIT_OTP_PER_IP_PER_HOUR=20
UPLOAD_MAX_BYTES=20971520              # ۲۰MB هر فایل
```

---

## ۵. قرارداد API

- **پیشوند:** `/api/v1`
- **احراز هویت:** `Authorization: Bearer <accessToken>` (JWT)؛ refresh token در cookie با `HttpOnly; Secure; SameSite=Lax`
- **قالب خطا** (یکسان در همه‌جا):

```jsonc
// HTTP 4xx/5xx
{
  "error": {
    "code": "BOARD_NOT_FOUND",        // enum در packages/shared-types
    "message": "بورد پیدا نشد.",       // فارسی، قابل نمایش به کاربر
    "details": { "boardId": "…" },     // اختیاری
    "requestId": "01J…"                // برای پیگیری در لاگ
  }
}
```

- **صفحه‌بندی:** cursor-based. `?limit=50&cursor=<opaque>` → `{ "items": [...], "nextCursor": "…" | null }`
- **Idempotency:** روی POST های مالی و ساخت منابع، هدر `Idempotency-Key`
- **مستندسازی:** schema های zod → OpenAPI 3.1 خودکار → `docs/api.md` + `/api/v1/docs`

### ۵.۱ شکل داده‌های اصلی

```ts
// packages/shared-types/src/dto.ts  (منبع حقیقت؛ zod + استخراج type)

type ISODateTime = string;   // همیشه UTC، مثال: "2026-07-22T09:30:00.000Z"
type UUID = string;
type Rial = number;          // BIGINT در DB؛ در JSON عدد صحیح ریال

// ── User ────────────────────────────────────────────
interface User {
  id: UUID;
  phone: string | null;               // E.164: "+989121234567"
  phoneVerified: boolean;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;           // URL امضاشده یا null
  locale: "fa" | "en";
  createdAt: ISODateTime;
  lastSeenAt: ISODateTime | null;
}
// نسخه‌ی سبک برای نمایش در presence و لیست اعضا
interface UserPublic { id: UUID; displayName: string; avatarUrl: string | null; color: string; }

// ── Team (Workspace) ────────────────────────────────
type TeamRole = "owner" | "admin" | "member" | "guest";
interface Team {
  id: UUID;
  slug: string;                        // یکتا، در URL: /t/acme
  name: string;
  avatarUrl: string | null;
  planCode: string;                    // "free" | "pro" | "team" | ...
  subscriptionStatus: "none" | "trialing" | "active" | "past_due" | "canceled" | "expired";
  myRole: TeamRole;                    // نقش کاربر جاری
  memberCount: number;
  limits: { maxMembers: number; maxBoards: number; maxStorageBytes: number };
  usage:  { members: number; boards: number; storageBytes: number };
  createdAt: ISODateTime;
}
interface TeamMember { user: UserPublic; role: TeamRole; joinedAt: ISODateTime; invitedBy: UUID | null; }

// ── Board ───────────────────────────────────────────
type BoardRole = "owner" | "editor" | "commenter" | "viewer";
type BoardAccessMode = "private" | "team" | "link_view" | "link_comment" | "link_edit";
interface Board {
  id: UUID;
  teamId: UUID;
  folderId: UUID | null;
  title: string;
  thumbnailUrl: string | null;
  accessMode: BoardAccessMode;
  linkToken: string | null;            // فقط اگر accessMode لینک‌محور باشد
  myRole: BoardRole;
  createdBy: UserPublic;
  elementCount: number;                // تقریبی، برای نمایش
  docSizeBytes: number;
  lastActivityAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  isFavorite: boolean;
  templateId: UUID | null;             // اگر از قالب ساخته شده
}
interface BoardSummary extends Pick<Board,
  "id"|"title"|"thumbnailUrl"|"lastActivityAt"|"myRole"|"isFavorite"|"folderId"> {}

// ── Template ────────────────────────────────────────
type TemplateCategory =
  | "brainstorm" | "retrospective" | "flowchart" | "mindmap"
  | "planning" | "strategy" | "ux_research" | "education" | "other";
interface Template {
  id: UUID;
  slug: string;
  title: string;                       // فارسی
  description: string;
  category: TemplateCategory;
  thumbnailUrl: string | null;
  previewImageUrl: string | null;
  tags: string[];
  isPublic: boolean;
  isPremium: boolean;                  // نیازمند پلن پولی
  usageCount: number;
  createdAt: ISODateTime;
}

// ── Comment ─────────────────────────────────────────
interface CommentThread {
  id: UUID; boardId: UUID;
  anchor: { kind: "element"; elementId: string } | { kind: "point"; x: number; y: number };
  resolvedAt: ISODateTime | null; resolvedBy: UserPublic | null;
  createdBy: UserPublic; createdAt: ISODateTime;
  comments: Comment[];
}
interface Comment {
  id: UUID; threadId: UUID; author: UserPublic;
  body: string;                        // متن ساده + @mention به شکل <@uuid>
  mentions: UUID[];
  createdAt: ISODateTime; editedAt: ISODateTime | null;
}

// ── Billing ─────────────────────────────────────────
interface Plan {
  code: string; name: string; description: string;
  priceMonthlyRial: Rial; priceYearlyRial: Rial;
  maxMembers: number; maxBoards: number; maxStorageBytes: number;
  features: string[];                  // فهرست فارسی برای صفحه قیمت
  isActive: boolean; sortOrder: number;
}
interface Subscription {
  id: UUID; teamId: UUID; planCode: string;
  status: "trialing"|"active"|"past_due"|"canceled"|"expired";
  period: "monthly" | "yearly"; seats: number;
  currentPeriodStart: ISODateTime; currentPeriodEnd: ISODateTime;
  cancelAtPeriodEnd: boolean;
}
interface Invoice {
  id: UUID; number: string;            // "HB-1405-000123"
  subtotalRial: Rial; discountRial: Rial; vatRial: Rial; totalRial: Rial;
  status: "draft"|"open"|"paid"|"void"|"refunded";
  issuedAt: ISODateTime; paidAt: ISODateTime | null;
  lineItems: { title: string; qty: number; unitPriceRial: Rial; totalRial: Rial }[];
}
```

### ۵.۲ فهرست Endpoint ها

| متد | مسیر | شرح | نقش لازم |
|---|---|---|---|
| **احراز هویت** ||||
| POST | `/auth/otp/request` | `{ phone }` → ارسال OTP. پاسخ همیشه ۲۰۰ (جلوگیری از enumeration) | عمومی |
| POST | `/auth/otp/verify` | `{ phone, code }` → `{ accessToken, user, isNewUser }` + cookie refresh | عمومی |
| POST | `/auth/email/request` | ورود با ایمیل (magic link) — گزینه دوم | عمومی |
| POST | `/auth/email/verify` | `{ token }` | عمومی |
| POST | `/auth/refresh` | چرخش refresh token (rotation + reuse detection) | cookie |
| POST | `/auth/logout` | ابطال session جاری | کاربر |
| GET | `/auth/sessions` / DELETE `/auth/sessions/:id` | مدیریت دستگاه‌ها | کاربر |
| **کاربر** ||||
| GET | `/me` | پروفایل + تیم‌ها | کاربر |
| PATCH | `/me` | `{ displayName?, locale? }` | کاربر |
| POST | `/me/avatar` | presign آپلود آواتار | کاربر |
| **تیم** ||||
| GET | `/teams` | تیم‌های کاربر | کاربر |
| POST | `/teams` | `{ name, slug? }` | کاربر |
| GET/PATCH | `/teams/:teamId` | | member / admin |
| DELETE | `/teams/:teamId` | حذف نرم + دوره‌ی ۳۰ روزه بازیابی | owner |
| GET | `/teams/:teamId/members` | | member |
| PATCH | `/teams/:teamId/members/:userId` | `{ role }` | admin |
| DELETE | `/teams/:teamId/members/:userId` | | admin |
| POST | `/teams/:teamId/invites` | `{ phone? , email?, role }` → پیامک/ایمیل دعوت | admin |
| GET | `/teams/:teamId/invites` / DELETE `/invites/:id` | | admin |
| POST | `/invites/:token/accept` | | کاربر |
| **فولدر** ||||
| GET/POST | `/teams/:teamId/folders` | | member |
| PATCH/DELETE | `/folders/:id` | | member |
| **بورد** ||||
| GET | `/boards?teamId=&folderId=&q=&favorite=&limit=&cursor=` | لیست/جستجو | member |
| POST | `/boards` | `{ teamId, title, folderId?, templateId? }` | member |
| GET | `/boards/:boardId` | متادیتا + نقش من + توکن اتصال realtime | viewer+ |
| PATCH | `/boards/:boardId` | `{ title?, folderId? }` | editor+ |
| DELETE | `/boards/:boardId` | حذف نرم (سطل ۳۰ روزه) | owner |
| POST | `/boards/:boardId/restore` | | owner |
| POST | `/boards/:boardId/duplicate` | | editor+ |
| POST | `/boards/:boardId/favorite` / DELETE | | viewer+ |
| GET | `/boards/:boardId/rt-token` | JWT کوتاه‌عمر (۶۰ثانیه) برای اتصال WS | viewer+ |
| GET | `/boards/:boardId/snapshot` | `application/octet-stream` — آخرین state کامل Yjs (بوت سریع) | viewer+ |
| **اشتراک‌گذاری و دسترسی بورد** ||||
| GET | `/boards/:boardId/access` | حالت اشتراک + اعضای مستقیم | viewer+ |
| PUT | `/boards/:boardId/access` | `{ accessMode }` → تولید/ابطال linkToken | owner |
| POST | `/boards/:boardId/members` | `{ userId, role }` | owner |
| PATCH/DELETE | `/boards/:boardId/members/:userId` | | owner |
| POST | `/public/boards/resolve` | `{ linkToken }` → دسترسی مهمان | عمومی |
| **نسخه‌ها** ||||
| GET | `/boards/:boardId/versions` | فهرست نسخه‌های نام‌گذاری‌شده + خودکار | viewer+ |
| POST | `/boards/:boardId/versions` | `{ label }` — ثبت نسخه از وضعیت فعلی | editor+ |
| GET | `/boards/:boardId/versions/:versionId/snapshot` | باینری | viewer+ |
| POST | `/boards/:boardId/versions/:versionId/restore` | بازگردانی (خودش یک نسخه جدید می‌سازد) | editor+ |
| **فایل‌ها** ||||
| POST | `/boards/:boardId/assets/presign` | `{ mimeType, sizeBytes, sha256 }` → `{ fileId, uploadUrl, headers }` | editor+ |
| POST | `/boards/:boardId/assets/:fileId/commit` | تایید آپلود، اعتبارسنجی سایز/نوع واقعی | editor+ |
| GET | `/assets/:fileId` | ۳۰۲ به presigned GET | viewer+ |
| **قالب‌ها** ||||
| GET | `/templates?category=&q=` | | عمومی |
| GET | `/templates/:idOrSlug` | | عمومی |
| POST | `/boards/:boardId/save-as-template` | (فاز ۲) | admin |
| **کامنت** ||||
| GET | `/boards/:boardId/threads?resolved=` | | viewer+ |
| POST | `/boards/:boardId/threads` | `{ anchor, body }` | commenter+ |
| POST | `/threads/:threadId/comments` | `{ body }` | commenter+ |
| PATCH/DELETE | `/comments/:id` | | نویسنده |
| POST | `/threads/:threadId/resolve` / `/unresolve` | | commenter+ |
| **خروجی** ||||
| POST | `/boards/:boardId/exports` | `{ format: "png"\|"svg"\|"pdf"\|"json", scope, scale }` → `{ jobId }` | viewer+ |
| GET | `/exports/:jobId` | `{ status, downloadUrl? }` | viewer+ |
| **پرداخت** ||||
| GET | `/billing/plans` | فهرست پلن‌ها (عمومی برای صفحه قیمت) | عمومی |
| GET | `/teams/:teamId/billing/subscription` | | admin |
| POST | `/teams/:teamId/billing/checkout` | `{ planCode, period, seats, couponCode? }` → `{ paymentId, redirectUrl }` | owner |
| GET | `/billing/zarinpal/callback?Authority=&Status=` | برگشت از درگاه → verify → ریدایرکت به web | عمومی |
| POST | `/billing/payments/:id/verify` | verify دستی (بازیابی پرداخت گم‌شده) | owner |
| GET | `/teams/:teamId/billing/invoices` | | admin |
| GET | `/invoices/:id/pdf` | | admin |
| POST | `/teams/:teamId/billing/cancel` | لغو در پایان دوره | owner |
| **سلامت** ||||
| GET | `/healthz` / `/readyz` | بدون auth، برای K8s probe | — |
| **ادمین پلتفرم** ||||
| — | `/admin/*` | کاربران، تیم‌ها، پرداخت‌ها، قالب‌ها، feature flag، آمار | staff |

### ۵.۳ WebSocket (سرور realtime)

```
ws://<host>/rt?board=<boardId>&token=<rtToken>
```

- `rtToken` از `GET /boards/:id/rt-token` می‌آید، ۶۰ ثانیه اعتبار، شامل `{ sub, boardId, role, exp }`
- پروتکل: پیام‌های باینری y-protocols (`sync`, `awareness`) + یک namespace سفارشی هم‌بوم:

| نوع پیام | جهت | محتوا |
|---|---|---|
| `0x00 SYNC` | دوطرفه | y-protocols sync step 1/2/update |
| `0x01 AWARENESS` | دوطرفه | cursor، انتخاب، viewport، ابزار فعال |
| `0x10 HB_AUTH_REFRESH` | client→server | توکن جدید قبل از انقضا |
| `0x11 HB_PERMISSION` | server→client | تغییر نقش در لحظه (مثلاً از editor به viewer) |
| `0x12 HB_ROOM_INFO` | server→client | تعداد کاربران، وضعیت ذخیره، شماره seq |
| `0x13 HB_EPHEMERAL` | دوطرفه | استروک freedraw در حال کشیدن، لیزر پوینتر، reaction — **ذخیره نمی‌شود** |
| `0x14 HB_ERROR` | server→client | `{ code, message }` سپس بستن اتصال |

---

## ۶. Schema دیتابیس PostgreSQL

**قواعد کلی**
- کلید اصلی: `uuid` تولیدشده در اپ (UUIDv7 برای ترتیب زمانی و ایندکس بهتر)
- زمان‌ها: `timestamptz`، همیشه UTC. تبدیل جلالی فقط در UI.
- حذف نرم: `deleted_at timestamptz`؛ ایندکس‌های یکتا با `WHERE deleted_at IS NULL`
- پول: `bigint` ریال
- Migration: SQL خام ترتیبی در `apps/api/migrations/`، بدون ORM auto-sync ([ADR-005](ARCHITECTURE_DECISIONS.md#adr-005))
- افزونه‌ها: `pgcrypto`، `pg_trgm` (جستجوی فارسی عنوان بورد)، `btree_gin`

```sql
-- 0001_init.sql (خلاصه ساختاری — جزئیات constraint در فاز پیاده‌سازی کامل می‌شود)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ══ کاربر و احراز هویت ══════════════════════════════════════
CREATE TABLE users (
  id                uuid PRIMARY KEY,
  phone             varchar(20),                    -- E.164
  phone_verified_at timestamptz,
  email             varchar(255),
  email_verified_at timestamptz,
  display_name      varchar(80)  NOT NULL,
  avatar_file_id    uuid,                           -- FK → files (تاخیری)
  locale            varchar(5)   NOT NULL DEFAULT 'fa',
  presence_color    varchar(7)   NOT NULL,          -- رنگ ثابت کاربر در بوم
  status            varchar(20)  NOT NULL DEFAULT 'active',  -- active|suspended|deleted
  is_staff          boolean      NOT NULL DEFAULT false,
  last_seen_at      timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;

-- کدهای یک‌بارمصرف. کد به‌صورت hash ذخیره می‌شود، هرگز plaintext.
CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY,
  purpose       varchar(30) NOT NULL,               -- login|phone_change|email_verify
  channel       varchar(10) NOT NULL,               -- sms|email
  destination   varchar(255) NOT NULL,
  code_hash     text        NOT NULL,
  attempts      smallint    NOT NULL DEFAULT 0,
  max_attempts  smallint    NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  request_ip    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_dest_idx ON otp_challenges (destination, created_at DESC);

CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL,                 -- برای تشخیص reuse در rotation
  refresh_token_hash text NOT NULL,
  device_label       varchar(120),
  ip                 inet,
  user_agent         text,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;

-- ══ تیم / ورک‌اسپیس ═════════════════════════════════════════
CREATE TABLE teams (
  id             uuid PRIMARY KEY,
  slug           varchar(50) NOT NULL,
  name           varchar(120) NOT NULL,
  avatar_file_id uuid,
  owner_user_id  uuid NOT NULL REFERENCES users(id),
  is_personal    boolean NOT NULL DEFAULT false,    -- ورک‌اسپیس شخصی که خودکار ساخته می‌شود
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE UNIQUE INDEX teams_slug_uq ON teams (lower(slug)) WHERE deleted_at IS NULL;

CREATE TABLE team_members (
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role       varchar(20) NOT NULL,                 -- owner|admin|member|guest
  invited_by uuid REFERENCES users(id),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

CREATE TABLE team_invites (
  id           uuid PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  channel      varchar(10) NOT NULL,               -- sms|email
  destination  varchar(255) NOT NULL,
  role         varchar(20) NOT NULL,
  token_hash   text NOT NULL,
  invited_by   uuid NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ══ فولدر و بورد ════════════════════════════════════════════
CREATE TABLE folders (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES folders(id) ON DELETE CASCADE,
  name       varchar(120) NOT NULL,
  position   double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE boards (
  id                uuid PRIMARY KEY,
  team_id           uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  folder_id         uuid REFERENCES folders(id) ON DELETE SET NULL,
  title             varchar(200) NOT NULL DEFAULT 'بورد بدون عنوان',
  created_by        uuid NOT NULL REFERENCES users(id),
  thumbnail_file_id uuid,
  access_mode       varchar(20) NOT NULL DEFAULT 'team',   -- private|team|link_view|link_comment|link_edit
  link_token_hash   text,                                   -- توکن لینک اشتراک (hash)
  template_id       uuid,                                   -- FK → templates
  schema_version    smallint NOT NULL DEFAULT 1,            -- نسخه ساختار Y.Doc
  element_count     integer NOT NULL DEFAULT 0,             -- تقریبی، از realtime به‌روز می‌شود
  doc_size_bytes    bigint  NOT NULL DEFAULT 0,
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX boards_team_idx     ON boards (team_id, last_activity_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX boards_title_trgm   ON boards USING gin (title gin_trgm_ops);

CREATE TABLE board_members (          -- دسترسی مستقیم فرد به بورد (فراتر از عضویت تیم)
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role     varchar(20) NOT NULL,                 -- owner|editor|commenter|viewer
  added_by uuid REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE board_favorites (
  user_id  uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, board_id)
);

-- ══ ذخیره‌سازی سند Yjs ══════════════════════════════════════
-- الگو: append-only log از update های Yjs + snapshot دوره‌ای در Object Storage.
-- بازیابی یک بورد = آخرین snapshot + همه update های بعد از آن.
CREATE TABLE board_updates (
  id         bigserial PRIMARY KEY,
  board_id   uuid   NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seq        bigint NOT NULL,                    -- شماره ترتیبی درون بورد
  payload    bytea  NOT NULL,                    -- Yjs update باینری
  byte_size  integer NOT NULL,
  origin_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX board_updates_seq_uq ON board_updates (board_id, seq);

CREATE TABLE board_snapshots (
  id             uuid PRIMARY KEY,
  board_id       uuid   NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seq_upto       bigint NOT NULL,                -- تا کدام seq فشرده شده
  storage_key    text   NOT NULL,                -- کلید در bucket snapshots
  state_vector   bytea  NOT NULL,                -- برای sync سریع
  byte_size      bigint NOT NULL,
  element_count  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_snapshots_board_idx ON board_snapshots (board_id, seq_upto DESC);

CREATE TABLE board_versions (          -- نسخه‌های نام‌گذاری‌شده (version history)
  id          uuid PRIMARY KEY,
  board_id    uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES board_snapshots(id),
  label       varchar(120),
  kind        varchar(20) NOT NULL DEFAULT 'auto',  -- auto|manual|pre_restore
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ══ فایل‌ها ═════════════════════════════════════════════════
CREATE TABLE files (
  id           uuid PRIMARY KEY,
  team_id      uuid REFERENCES teams(id) ON DELETE CASCADE,
  board_id     uuid REFERENCES boards(id) ON DELETE CASCADE,
  uploader_id  uuid REFERENCES users(id),
  bucket       varchar(63) NOT NULL,
  storage_key  text        NOT NULL,
  mime_type    varchar(120) NOT NULL,
  size_bytes   bigint      NOT NULL,
  width        integer, height integer,
  sha256       char(64),
  status       varchar(20) NOT NULL DEFAULT 'pending',  -- pending|ready|failed|quarantined
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX files_sha_idx ON files (team_id, sha256) WHERE deleted_at IS NULL;  -- دی‌دوپ در سطح تیم

-- ══ قالب‌ها ═════════════════════════════════════════════════
CREATE TABLE templates (
  id                uuid PRIMARY KEY,
  slug              varchar(80) NOT NULL UNIQUE,
  title             varchar(160) NOT NULL,
  description       text,
  category          varchar(40) NOT NULL,
  tags              text[] NOT NULL DEFAULT '{}',
  thumbnail_file_id uuid REFERENCES files(id),
  preview_file_id   uuid REFERENCES files(id),
  doc_storage_key   text NOT NULL,               -- Y.Doc اولیه در bucket snapshots
  is_public         boolean NOT NULL DEFAULT true,
  is_premium        boolean NOT NULL DEFAULT false,
  usage_count       integer NOT NULL DEFAULT 0,
  sort_order        integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- ══ کامنت ══════════════════════════════════════════════════
CREATE TABLE comment_threads (
  id           uuid PRIMARY KEY,
  board_id     uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  anchor_kind  varchar(10) NOT NULL,             -- element|point
  element_id   varchar(64),                      -- id عنصر داخل Y.Doc (نه FK)
  anchor_x     double precision,
  anchor_y     double precision,
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_threads_board_idx ON comment_threads (board_id) WHERE resolved_at IS NULL;

CREATE TABLE comments (
  id         uuid PRIMARY KEY,
  thread_id  uuid NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL,
  mentions   uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);

-- ══ اشتراک و پرداخت ═════════════════════════════════════════
CREATE TABLE plans (
  code                varchar(30) PRIMARY KEY,     -- free|pro|team|enterprise
  name                varchar(80) NOT NULL,
  description         text,
  price_monthly_rial  bigint NOT NULL DEFAULT 0,
  price_yearly_rial   bigint NOT NULL DEFAULT 0,
  max_members         integer NOT NULL,
  max_boards          integer NOT NULL,            -- -1 = نامحدود
  max_storage_bytes   bigint  NOT NULL,
  features            jsonb   NOT NULL DEFAULT '[]',
  is_active           boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0
);

CREATE TABLE subscriptions (
  id                   uuid PRIMARY KEY,
  team_id              uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  plan_code            varchar(30) NOT NULL REFERENCES plans(code),
  status               varchar(20) NOT NULL,       -- trialing|active|past_due|canceled|expired
  period               varchar(10) NOT NULL,       -- monthly|yearly
  seats                integer NOT NULL DEFAULT 1,
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_active_uq ON subscriptions (team_id)
  WHERE status IN ('trialing','active','past_due');   -- هر تیم فقط یک اشتراک فعال

CREATE TABLE coupons (
  code             varchar(40) PRIMARY KEY,
  percent_off      smallint,
  amount_off_rial  bigint,
  max_redemptions  integer,
  redeemed_count   integer NOT NULL DEFAULT 0,
  valid_from       timestamptz,
  valid_until      timestamptz,
  plan_codes       text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id             uuid PRIMARY KEY,
  team_id        uuid NOT NULL REFERENCES teams(id),
  subscription_id uuid REFERENCES subscriptions(id),
  number         varchar(30) NOT NULL UNIQUE,      -- HB-1405-000123
  subtotal_rial  bigint NOT NULL,
  discount_rial  bigint NOT NULL DEFAULT 0,
  vat_rial       bigint NOT NULL DEFAULT 0,
  total_rial     bigint NOT NULL,
  status         varchar(20) NOT NULL DEFAULT 'open',  -- draft|open|paid|void|refunded
  line_items     jsonb NOT NULL DEFAULT '[]',
  buyer_legal    jsonb,                            -- اطلاعات حقوقی خریدار برای فاکتور رسمی
  coupon_code    varchar(40) REFERENCES coupons(code),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz
);

CREATE TABLE payments (
  id                uuid PRIMARY KEY,
  team_id           uuid NOT NULL REFERENCES teams(id),
  invoice_id        uuid REFERENCES invoices(id),
  initiated_by      uuid NOT NULL REFERENCES users(id),
  gateway           varchar(20) NOT NULL,           -- zarinpal|idpay|mock
  gateway_mode      varchar(20) NOT NULL,           -- sandbox|production
  amount_rial       bigint NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'pending', -- pending|paid|failed|canceled|refunded|verify_failed
  authority         varchar(80),                    -- زرین‌پال Authority
  ref_id            varchar(80),                    -- شماره پیگیری بانک
  card_pan_masked   varchar(30),
  fee_rial          bigint,
  failure_code      varchar(40),
  idempotency_key   varchar(80) NOT NULL,
  request_payload   jsonb,
  callback_payload  jsonb,
  verify_payload    jsonb,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  verified_at       timestamptz
);
CREATE UNIQUE INDEX payments_idem_uq      ON payments (idempotency_key);
CREATE UNIQUE INDEX payments_authority_uq ON payments (gateway, authority) WHERE authority IS NOT NULL;

-- ══ عملیاتی ═════════════════════════════════════════════════
CREATE TABLE usage_counters (            -- کش شمارنده‌ها برای اعمال محدودیت پلن
  team_id       uuid PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  boards_count  integer NOT NULL DEFAULT 0,
  members_count integer NOT NULL DEFAULT 0,
  storage_bytes bigint  NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  team_id       uuid REFERENCES teams(id),
  action        varchar(60) NOT NULL,       -- board.delete، team.member.role_change، billing.checkout ...
  target_type   varchar(40),
  target_id     text,
  ip            inet,
  user_agent    text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_team_idx ON audit_logs (team_id, created_at DESC);

CREATE TABLE sms_logs (
  id                  uuid PRIMARY KEY,
  provider            varchar(20) NOT NULL,
  destination_masked  varchar(30) NOT NULL,   -- P7: هرگز شماره کامل
  template            varchar(60),
  status              varchar(20) NOT NULL,
  provider_message_id varchar(80),
  cost_rial           bigint,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE export_jobs (
  id           uuid PRIMARY KEY,
  board_id     uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  format       varchar(10) NOT NULL,       -- png|svg|pdf|json
  options      jsonb NOT NULL DEFAULT '{}',
  status       varchar(20) NOT NULL DEFAULT 'queued',  -- queued|running|done|failed
  file_id      uuid REFERENCES files(id),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE TABLE feature_flags (
  key         varchar(60) PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  rollout_pct smallint NOT NULL DEFAULT 0,
  team_ids    uuid[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

### نمودار رابطه‌ها (خلاصه)

```
users ──< team_members >── teams ──< boards ──< board_updates
  │                          │        │    └──< board_snapshots ──< board_versions
  │                          │        ├──< board_members
  │                          │        ├──< comment_threads ──< comments
  │                          │        └──< export_jobs
  │                          ├──< folders
  │                          ├──< team_invites
  │                          ├──< files
  │                          ├──  usage_counters (1:1)
  │                          └──< subscriptions ──< invoices ──< payments
  ├──< auth_sessions
  └──< board_favorites

templates ──(کپی اولیه)──> boards
plans ──< subscriptions
```

---

## ۷. مدل‌سازی Element ها داخل Yjs Doc

### ۷.۱ ساختار کلی سند

```
Y.Doc (یکی به‌ازای هر board)
│
├─ Y.Map  "meta"        ← { schemaVersion:number, boardId, title, createdAt, background }
│
├─ Y.Map  "elements"    ← elementId (string) → Y.Map<propName, value>
│                          کلید = id عنصر؛ مقدار = Y.Map از property های عنصر
│
├─ Y.Map  "assets"      ← fileId → { key, bucket, mime, w, h, sha256, uploadedBy, createdAt }
│                          ⚠️ فقط متادیتا. باینری هرگز داخل Y.Doc نمی‌رود.
│
├─ Y.Map  "appState"    ← وضعیت مشترک بورد: gridSize, gridEnabled, viewBackgroundColor,
│                          frameRendering, snapToObjects
│
└─ Y.Map  "commentPins" ← threadId → { x, y, elementId?, resolved:boolean }
                           (متن کامنت‌ها در Postgres است؛ اینجا فقط سنجاق روی بوم)

Awareness (خارج از سند — ذخیره نمی‌شود، فقط در حافظه/شبکه)
└─ clientId → { user, cursor, selectedIds, viewport, activeTool, followingUserId, ephemeral }
```

**چرا `Y.Map` به‌جای `Y.Array` برای عناصر؟** ادغام تغییرات همزمان روی عناصر مختلف بدون تداخل، و حذف مشکل «جابه‌جایی ایندکس» در آرایه. ترتیب z-order با فیلد `index` (fractional indexing) مدیریت می‌شود، نه با ترتیب آرایه. جزئیات: [ADR-007](ARCHITECTURE_DECISIONS.md#adr-007).

**چرا هر عنصر خودش یک `Y.Map` است، نه یک آبجکت ساده؟** تا دو کاربر بتوانند همزمان دو property مختلف از یک عنصر را عوض کنند (یکی رنگ، یکی موقعیت) بدون اینکه یکی دیگری را پاک کند. تداخل فقط در سطح یک property واحد رخ می‌دهد (LWW).

### ۷.۲ Property های مشترک همه عناصر

```ts
// packages/ydoc-schema/src/element.ts
interface HbElementBase {
  id: string;                    // nanoid(16)
  type: HbElementType;
  // هندسه
  x: number; y: number;
  width: number; height: number;
  angle: number;                 // رادیان
  // چیدمان
  index: string;                 // fractional index — z-order (مثلاً "a0", "a0V", "a1")
  frameId: string | null;        // عضویت در فریم
  groupIds: string[];            // گروه‌بندی تودرتو (بیرونی‌ترین آخر)
  locked: boolean;
  // ظاهر
  strokeColor: string;           // "#1a1a1a" یا "transparent"
  backgroundColor: string;
  fillStyle: "solid" | "hachure" | "cross-hatch";
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  roughness: 0 | 1 | 2;          // هم‌بوم پیش‌فرض 0 = خط تمیز (میرو-استایل)
  opacity: number;               // 0..100
  roundness: { type: 2 | 3; value?: number } | null;
  // متادیتا Excalidraw (برای سازگاری با موتور رندر لازم است)
  seed: number;
  version: number;
  versionNonce: number;
  updated: number;               // epoch ms
  isDeleted: boolean;            // حذف نرم — عنصر می‌ماند تا undo/CRDT درست کار کند
  boundElements: Array<{ id: string; type: "text" | "arrow" }> | null;
  link: string | null;
  // ★ افزوده‌های هم‌بوم
  customData: HbCustomData;
}

interface HbCustomData {
  hb: {
    schema: 1;                          // نسخه ساختار customData
    kind: HbKind;                       // معنای محصولی عنصر (متفاوت از type رندر)
    createdBy: string;                  // userId
    lastEditedBy: string;
    createdAt: number;
    tags?: string[];
    // ویژه‌ی هر kind:
    sticky?:    { palette: HbStickyColor; autoFit: boolean };
    connector?: { style: "straight" | "elbow" | "curved"; label?: string };
    frame?:     { collapsed: boolean; color: string };
    card?:      { status?: string; assigneeIds?: string[] };   // فاز ۲ (کانبان)
  };
}

type HbKind = "sticky" | "shape" | "text" | "connector" | "frame" | "image" | "draw" | "embed";
type HbElementType =
  | "rectangle" | "ellipse" | "diamond"
  | "arrow" | "line" | "freedraw"
  | "text" | "image" | "frame";
```

> **قاعده مهم:** `type` چیزی است که موتور رندر می‌فهمد. `customData.hb.kind` چیزی است که محصول می‌فهمد.
> یک استیکی‌نوت از نظر موتور فقط یک `rectangle` است؛ از نظر هم‌بوم یک `sticky`. این تفکیک اجازه می‌دهد
> بدون دست‌زدن به موتور رندر، نوع محصولی جدید اضافه کنیم.

### ۷.۳ ساختار دقیق هر نوع

#### الف) Sticky Note (استیکی‌نوت)

مرکب از **دو عنصر**: یک container مستطیل + یک عنصر متن مقید (bound text). این الگو بومی Excalidraw است و از آن استفاده می‌کنیم تا ویرایش متن، wrap و auto-resize رایگان به دست بیاید.

```ts
// عنصر ۱ — ظرف
{
  id: "stk_a1b2c3",
  type: "rectangle",
  kind: "sticky",                       // در customData.hb.kind
  x: 100, y: 200, width: 220, height: 220,
  angle: 0, index: "a3",
  strokeColor: "transparent",           // میرو-استایل: بدون حاشیه
  backgroundColor: "#FFF9B1",           // از پالت HB_STICKY
  fillStyle: "solid",
  strokeWidth: 1, strokeStyle: "solid",
  roughness: 0,                          // ★ کلید ظاهر «تمیز» به‌جای دست‌نویس
  roundness: { type: 3, value: 8 },
  opacity: 100,
  boundElements: [{ id: "txt_a1b2c3", type: "text" }],
  customData: { hb: { schema: 1, kind: "sticky",
                      sticky: { palette: "yellow", autoFit: true },
                      createdBy: "…", lastEditedBy: "…", createdAt: 1753… } }
}

// عنصر ۲ — متن مقید
{
  id: "txt_a1b2c3",
  type: "text",
  containerId: "stk_a1b2c3",            // اتصال به ظرف
  text: <Y.Text>,                       // ★ Y.Text — ویرایش همزمان کاراکتری
  originalText: <string>,               // نسخه بدون wrap
  fontSize: 20,
  fontFamily: HB_FONT.vazirmatn,        // شناسه عددی فونت در رجیستری هم‌بوم
  textAlign: "center",
  verticalAlign: "middle",
  lineHeight: 1.6,                      // ★ فارسی به فضای عمودی بیشتری نیاز دارد
  direction: "auto",                    // ★ افزوده هم‌بوم: rtl | ltr | auto
  strokeColor: "#1a1a1a",
  autoResize: true,
}
```

**پالت استیکی (میرو-استایل، ۱۲ رنگ):** در `packages/canvas-core/src/theme/sticky-palette.ts`.
هر رنگ سه مقدار دارد: `bg` (پس‌زمینه)، `text` (رنگ متن با کنتراست کافی)، `accent` (نوار انتخاب).

| کلید | نام فارسی | bg | text |
|---|---|---|---|
| `yellow` | زرد | `#FFF9B1` | `#1a1a1a` |
| `lime` | مغزپسته‌ای | `#D5F692` | `#1a1a1a` |
| `green` | سبز | `#C9F2C7` | `#1a1a1a` |
| `mint` | نعنایی | `#B6F2E8` | `#1a1a1a` |
| `sky` | آبی آسمانی | `#B3E5FC` | `#1a1a1a` |
| `blue` | آبی | `#A6CCF5` | `#1a1a1a` |
| `violet` | بنفش | `#D0C6F5` | `#1a1a1a` |
| `pink` | صورتی | `#F5C0DF` | `#1a1a1a` |
| `red` | قرمز | `#F5A9A9` | `#1a1a1a` |
| `orange` | نارنجی | `#FFCC96` | `#1a1a1a` |
| `gray` | خاکستری | `#E6E6E6` | `#1a1a1a` |
| `black` | مشکی | `#2C2C2C` | `#FFFFFF` |

> ⚠️ این کدهای رنگ **بازسازی سلیقه‌ای در همان خانواده‌ی رنگی** هستند، نه کپی از توکن‌های میرو. قبل از انتشار، توسط طراح/خودت نهایی و با WCAG AA (کنتراست ≥ 4.5:1 برای متن) اعتبارسنجی شوند.

#### ب) Shape (شکل)

```ts
{
  type: "rectangle" | "ellipse" | "diamond",
  kind: "shape",
  strokeColor: "#1a1a1a", backgroundColor: "transparent",
  roughness: 0, roundness: { type: 3, value: 16 } | null,
  boundElements: [{ id: "txt_…", type: "text" }] | null,   // متن داخل شکل (اختیاری)
}
```
تفاوت با sticky: حاشیه دارد، پس‌زمینه پیش‌فرض شفاف، متن اختیاری، اندازه آزاد.

#### ج) Text (متن آزاد)

```ts
{
  type: "text", kind: "text",
  containerId: null,                   // آزاد روی بوم
  text: <Y.Text>,
  fontSize: 20, fontFamily: HB_FONT.vazirmatn,
  textAlign: "right",                  // ★ پیش‌فرض فارسی
  direction: "auto",
  lineHeight: 1.6,
  autoResize: true,
}
```

#### د) Connector (کانکتور / پیکان)

```ts
{
  type: "arrow", kind: "connector",
  points: [[0,0], [120,40], [240,40]],  // مختصات نسبی به x,y عنصر
  startBinding: { elementId: "stk_a1", focus: 0.12, gap: 6 } | null,
  endBinding:   { elementId: "stk_b2", focus: -0.3, gap: 6 } | null,
  startArrowhead: null,
  endArrowhead: "arrow" | "triangle" | "dot" | null,
  elbowed: boolean,                     // مسیریابی پله‌ای (میرو-استایل)
  boundElements: [{ id: "txt_lbl", type: "text" }] | null,   // برچسب روی خط
  customData: { hb: { kind: "connector", connector: { style: "elbow" } } }
}
```

**قاعده همگام‌سازی مهم:** وقتی عنصری جابه‌جا می‌شود، کانکتورهای متصل باید محاسبه مجدد شوند. این محاسبه **در همه کلاینت‌ها به‌صورت قطعی (deterministic)** انجام می‌شود از روی binding — نه اینکه هر کلاینت `points` جدید بنویسد. فقط کلاینتی که عنصر را حرکت داده، `points` نهایی را در پایان درگ commit می‌کند. جزئیات در [ADR-008](ARCHITECTURE_DECISIONS.md#adr-008).

#### ه) Frame (فریم / سکشن)

```ts
{
  type: "frame", kind: "frame",
  name: "جلسه هفتگی — هفته ۱۲",
  x, y, width, height,
  backgroundColor: "#FFFFFF",
  customData: { hb: { kind: "frame", frame: { collapsed: false, color: "#5B8DEF" } } }
}
// عضویت: هر عنصر داخل فریم، فیلد frameId خودش را برابر id فریم می‌گذارد.
// حرکت فریم = حرکت فریم + همه عناصری که frameId شان برابر آن است، در یک transaction.
```

#### و) Image (تصویر)

```ts
// عنصر روی بوم
{
  type: "image", kind: "image",
  fileId: "f_9x8y7z",                  // کلید در Y.Map "assets"
  scale: [1, 1],
  status: "saved" | "pending",
  crop: { x, y, width, height, naturalWidth, naturalHeight } | null,
}

// Y.Map "assets" → "f_9x8y7z"
{
  fileId: "f_9x8y7z",
  bucket: "hamboom-assets",
  key: "teams/<teamId>/boards/<boardId>/f_9x8y7z.webp",
  mime: "image/webp",
  width: 1200, height: 800,
  sizeBytes: 184320,
  sha256: "…",
  uploadedBy: "<userId>",
  createdAt: 1753…
}
```
کلاینت برای نمایش، `GET /api/v1/assets/:fileId` را صدا می‌زند و ۳۰۲ به presigned URL می‌گیرد (کش‌شده در حافظه تا انقضا).

#### ز) Freedraw (قلم آزاد)

```ts
{
  type: "freedraw", kind: "draw",
  points: [[0,0],[2,3],[5,7], …],      // ⚠️ ممکن است صدها نقطه باشد
  pressures: number[],
  simulatePressure: boolean,
}
```
**قاعده حیاتی:** استروک در حال کشیدن **هرگز** در Y.Doc نوشته نمی‌شود. تا لحظه‌ی `pointerup` فقط از کانال `HB_EPHEMERAL` در awareness پخش می‌شود تا بقیه ببینند. در `pointerup` یک‌بار به‌عنوان عنصر کامل commit می‌شود (پس از ساده‌سازی مسیر با الگوریتم Ramer–Douglas–Peucker). بدون این قاعده، هر خط ۳۰۰ آپدیت CRDT تولید می‌کند.

### ۷.۴ سیاست تراکنش و throttling

| عملیات | کانال | فرکانس |
|---|---|---|
| حرکت مکان‌نما | awareness | throttle 40ms |
| تغییر انتخاب | awareness | فوری |
| تغییر viewport (برای follow) | awareness | throttle 100ms |
| درگ کردن عنصر | Y.Doc | throttle 50ms + commit نهایی در drop |
| تغییر اندازه | Y.Doc | throttle 50ms |
| تایپ در متن | Y.Doc (Y.Text delta) | debounce 150ms |
| استروک freedraw | ephemeral → Y.Doc | فقط یک commit در pointerup |
| ساخت/حذف عنصر | Y.Doc | فوری |
| تغییر رنگ/استایل | Y.Doc | فوری |

همه‌ی تغییرات یک ژست کاربر باید در **یک `doc.transact()`** با `origin` مشخص انجام شوند تا:
- undo/redo کل ژست را یک واحد ببیند (`Y.UndoManager` با `trackedOrigins`)
- binder بتواند تغییرات محلی را از remote تشخیص دهد و حلقه echo نسازد

### ۷.۵ نسخه‌بندی schema

`meta.schemaVersion` در هر سند ذخیره می‌شود. `packages/ydoc-schema/src/migrations/` مجموعه‌ای از توابع `migrateV1toV2(doc)` دارد که در **سرور realtime هنگام بارگذاری اتاق** اجرا می‌شوند (نه در کلاینت — تا همه کلاینت‌ها یک نسخه ببینند). اگر کلاینت نسخه‌ی قدیمی‌تر از سرور داشت، پیام `HB_ERROR{ code: "CLIENT_TOO_OLD" }` و درخواست رفرش.

---

## ۸. شش ماژول: مسئولیت‌ها و ترتیب اجرا

### گراف وابستگی

```
                       ┌──────────────┐
         ┌─────────────│  M5: infra   │  (سبک — فقط compose + config + CI)
         │             └──────┬───────┘
         │                    │
   ┌─────▼────────┐    ┌──────▼────────┐
   │ M1: canvas-  │    │ M3: backend-  │      ← موازی، بدون وابستگی متقابل
   │     core     │    │     api       │        (قرارداد مشترک: packages/shared-types)
   └─────┬────────┘    └──────┬────────┘
         │                    │
         └────────┬───────────┘
                  ▼
        ┌───────────────────┐
        │ M2: realtime-sync │      ← به contract از M1 و auth/permission از M3 نیاز دارد
        └─────────┬─────────┘
                  ▼
        ┌───────────────────┐
        │   M4: billing     │      ← به team/subscription از M3 نیاز دارد
        └─────────┬─────────┘
                  ▼
        ┌───────────────────┐
        │ M6: admin-dashboard│     ← به همه API های بالا نیاز دارد
        └───────────────────┘
```

### ترتیب پیشنهادی اجرا

| گام | ماژول | چرا این ترتیب |
|---|---|---|
| ۰ | **M5 (بخش حداقلی)** | قبل از هر چیز باید `docker compose up` کار کند و `packages/config` + `packages/shared-types` اسکلت داشته باشند. بدون این، M1 و M3 نمی‌توانند تست شوند. **۱ تا ۲ روز، نه بیشتر.** |
| ۱ | **M1 + M3 (موازی)** | مستقل‌اند. اگر توکن/زمان محدود است، اول **M1** چون سخت‌ترین و پرریسک‌ترین بخش است و اگر شکست بخورد کل معماری عوض می‌شود. |
| ۲ | **M2** | فقط وقتی `CanvasSyncAdapter` از M1 و `rt-token` از M3 آماده باشند. |
| ۳ | **M4** | بعد از اینکه محصول واقعاً کار می‌کند. پول گرفتن برای چیزی که هنوز کار نمی‌کند بی‌معنی است. |
| ۴ | **M5 (بخش کامل)** | Dockerfile های production، K8s manifest، CI/CD، مانیتورینگ — وقتی می‌خواهی دیپلوی کنی. |
| ۵ | **M6** | آخر. تا آن موقع می‌دانی واقعاً چه چیزی را باید مدیریت کنی. |

> **نقاط ادغام:** بعد از گام ۱ و گام ۲، یک session معمولی (نه loop) برای smoke test و به‌روزرسانی `shared-types`. تغییر `shared-types` همیشه باید دستی تایید شود.

---

### M1 — `canvas-core` (موتور بوم) ★ اولین ماژول

**مسیر:** `packages/canvas-core/`
**TODO تفصیلی:** [TODO.md](TODO.md)

**مسئول است برای:**
- بسته‌بندی و سفارشی‌سازی موتور رندر Excalidraw به‌عنوان یک کامپوننت React مستقل
- پشتیبانی کامل RTL و متن فارسی (جهت، shaping، اندازه‌گیری، wrap، ویرایشگر inline)
- تعریف و ساخت انواع عناصر هم‌بوم (`sticky`, `shape`, `text`, `connector`, `frame`, `image`, `draw`)
- پالت و توکن‌های ظاهری میرو-استایل (`roughness: 0`، رنگ‌های استیکی، گوشه‌های گرد)
- نوار ابزار، منوی راست‌کلیک، پنل استایل — همه RTL و فارسی
- ★ **تعریف `CanvasSyncAdapter`** — قرارداد رسمی بین بوم و لایه sync
- Undo/Redo، کپی/پیست، snap، alignment guide، mini-map

**مسئول نیست برای:** شبکه، احراز هویت، ذخیره‌سازی، Yjs. این پکیج باید کاملاً **آفلاین و بدون شبکه** قابل اجرا و تست باشد (یک آداپتور in-memory برای تست).

**خروجی قابل‌تحویل:** یک Storybook/دموی لوکال که در آن می‌شود استیکی فارسی ساخت، کانکتور کشید، فریم درست کرد — همه بدون سرور.

---

### M2 — `realtime-sync` (همگام‌سازی بلادرنگ)

**مسیر:** `apps/realtime/` + `packages/ydoc-schema/`

**مسئول است برای:**
- سرور WebSocket با پروتکل y-protocols + پیام‌های سفارشی هم‌بوم
- مدیریت چرخه‌عمر اتاق: بارگذاری (snapshot + update log) → حافظه → تخلیه پس از idle
- **پایداری:** نوشتن update ها در `board_updates`، فشرده‌سازی دوره‌ای به snapshot در Object Storage
- **Awareness:** مکان‌نما، انتخاب، viewport، حالت «دنبال‌کردن کاربر»
- **مقیاس افقی:** Redis pub/sub برای انتشار update بین نودها ([ADR-006](ARCHITECTURE_DECISIONS.md#adr-006))
- اعتبارسنجی `rtToken` و اعمال نقش (viewer نمی‌تواند بنویسد — در سرور enforce شود، نه فقط UI)
- پیاده‌سازی `CanvasSyncAdapter` سمت کلاینت (`packages/ydoc-schema/src/binder.ts`)
- migration نسخه schema سند

**وابسته به:** contract از M1، `rt-token` و مدل دسترسی از M3.

---

### M3 — `backend-api` (API اصلی)

**مسیر:** `apps/api/` + `packages/sdk/` + `packages/auth-core/` + `packages/storage/`

**مسئول است برای:**
- احراز هویت: OTP پیامکی (اصلی)، ایمیل (دوم)، JWT + refresh rotation، مدیریت session
- CRUD تیم، عضویت، دعوت، نقش
- CRUD بورد، فولدر، علاقه‌مندی، جستجو، سطل بازیافت
- موتور مجوز (policy engine): محاسبه‌ی نقش موثر کاربر روی یک بورد از ترکیب نقش تیم + نقش مستقیم + حالت لینک
- قالب‌ها، کامنت‌ها، نسخه‌ها
- آپلود فایل با presigned URL + اعتبارسنجی سمت سرور
- صف کارهای پس‌زمینه (BullMQ) و endpoint های job
- محدودیت نرخ، audit log، OpenAPI

**وابسته به:** فقط M5 (پایگاه‌داده و config).

---

### M4 — `billing` (پرداخت و اشتراک)

**مسیر:** `apps/api/src/modules/billing/` + `apps/web/src/features/billing/` + `apps/worker/src/jobs/subscription-*`

**مسئول است برای:**
- تعریف پلن‌ها و اعمال محدودیت‌ها (تعداد عضو، بورد، فضا) — enforcement در سرور
- جریان کامل زرین‌پال: `request` → ریدایرکت به درگاه → `callback` → `verify` → فعال‌سازی اشتراک
- **تضمین یک‌بار بودن پرداخت:** idempotency key + قفل روی `authority` + آشتی‌دهی (reconciliation) برای پرداخت‌های گم‌شده
- صدور فاکتور (شماره‌گذاری سالانه شمسی)، محاسبه VAT، کوپن تخفیف
- تمدید خودکار/دستی، دوره‌ی مهلت (grace period)، downgrade در انقضا
- لایه آداپتور درگاه (`PaymentGateway` interface) تا آیدی‌پی بعداً بدون تغییر منطق اضافه شود
- حالت `mock` برای تست خودکار بدون تماس شبکه

**⚠️ نکته حقوقی:** استفاده از درگاه واقعی زرین‌پال نیاز به احراز کسب‌وکار و (بسته به نوع حساب) نماد اعتماد الکترونیکی دارد. کد کامل با sandbox ساخته می‌شود؛ فقط `ZARINPAL_MERCHANT_ID` و `ZARINPAL_MODE` در پایان عوض می‌شود.

**وابسته به:** مدل تیم/کاربر از M3.

---

### M5 — `infra` (زیرساخت)

**مسیر:** `infra/` + `packages/config/` + `.github/workflows/` (یا GitLab CI)

**فاز حداقلی (گام ۰):** docker-compose، `.env.example`، `packages/config`، اسکلت `shared-types`، اسکریپت migration، seed داده تستی.

**فاز کامل (گام ۴):**
- Dockerfile های چندمرحله‌ای production برای api / realtime / worker / web
- K8s manifest یا Helm chart برای آروان: Deployment، Service، Ingress (با پیکربندی WebSocket)، HPA، PDB، ConfigMap/Secret
- سیاست پشتیبان‌گیری: `pg_dump` روزانه به Object Storage + تست بازیابی
- مانیتورینگ: OpenTelemetry → Prometheus + Grafana (هر دو خودمیزبان، متن‌باز)
- لاگ ساخت‌یافته (pino) + جمع‌آوری
- CI: lint، typecheck، تست، **license-check**، build image
- تنظیمات ویژه ایران: heartbeat کوتاه WebSocket، timeout مقاوم، تلاش مجدد

---

### M6 — `admin-dashboard` (پنل ادمین پلتفرم)

**مسیر:** `apps/admin/` + `apps/api/src/modules/admin/`

> توجه: این با «داشبورد تیم» فرق دارد. داشبورد تیم (مدیریت اعضا و پلن خودِ تیم) بخشی از M3/M4 در `apps/web` است. M6 پنل داخلی خودِ توست.

**مسئول است برای:** جستجوی کاربر/تیم، مشاهده و رفع اشکال پرداخت‌ها (verify دستی، استرداد)، مدیریت کتابخانه قالب‌ها، feature flag، آمار محصول (کاربر فعال، بورد ساخته‌شده، درآمد)، مشاهده audit log، تعلیق حساب، پشتیبانی (impersonation فقط-خواندنی با ثبت در audit).

---

## ۹. تصمیم‌های باز — نیاز به تایید تو

هیچ‌کدام مانع شروع M1 نیستند، ولی قبل از M4 باید مشخص شوند.

| # | موضوع | چیزی که الان placeholder گذاشتم | چه چیزی از تو لازم است |
|---|---|---|---|
| Q1 | **قیمت پلن‌ها** | `free / pro / team` با قیمت `0` در seed | قیمت ریالی ماهانه و سالانه هر پلن، و اینکه قیمت‌گذاری per-seat است یا per-team |
| Q2 | **محدودیت پلن رایگان** | ۳ بورد، ۳ عضو، ۱۰۰MB | اعداد واقعی — این مهم‌ترین اهرم تبدیل کاربر است |
| Q3 | **VAT** | `VAT_PERCENT=10` | آیا مالیات بر ارزش افزوده اضافه می‌شود یا در قیمت مستتر است؟ فاکتور رسمی می‌خواهی؟ |
| Q4 | **موجودیت حقوقی** | ندارد | شخص حقیقی یا شرکت؟ روی نوع حساب زرین‌پال و نیاز به نماد اعتماد اثر دارد |
| Q5 | **درگاه پیامک** | `SMS_PROVIDER=mock` | کاوه‌نگار یا ملی‌پیامک؟ (روی قالب پیامک و API اثر دارد) |
| Q6 | **حریم خصوصی / نگهداری داده** | حذف نرم ۳۰ روزه، export ۷ روزه | مدت نگهداری بورد حذف‌شده، تاریخچه نسخه، لاگ‌ها |
| Q7 | **زبان انگلیسی** | ساختار i18n آماده، فقط `fa` پر می‌شود | آیا فاز ۱ باید انگلیسی هم داشته باشد؟ (پیشنهاد من: نه) |
| Q8 | **تماس صوتی/تصویری** | حذف از فاز ۱ | تایید حذف؟ (نیاز به SFU خودمیزبان مثل LiveKit دارد — یک پروژه کامل جداست) |
| Q9 | **فونت** | Vazirmatn (SIL OFL — مجاز) | تایید. اگر فونت اختصاصی/تجاری می‌خواهی، الان بگو |
| Q10 | **نام تجاری و لوگو** | ندارد | برای صفحه ورود و فاکتور لازم می‌شود |

---

## ۱۰. ریسک‌های شناخته‌شده

| ریسک | احتمال | اثر | کاهش |
|---|---|---|---|
| **متن فارسی روی canvas** — Excalidraw متن را خودش روی canvas اندازه‌گیری و wrap می‌کند؛ bidi و شکست خط فارسی ممکن است غلط باشد | بالا | بالا — بدون این محصول بی‌فایده است | **اولین کار در M1**، قبل از هر چیز دیگری با یک spike اثبات شود (TODO.md گام ۲) |
| **دیوار لایسنس/فورک Excalidraw** — اگر تغییرات لازم از طریق props و patch ممکن نباشد | متوسط | بالا | مسیر پلکانی در [ADR-003](ARCHITECTURE_DECISIONS.md#adr-003): npm → patch → fork، با معیار مشخص برای عبور به مرحله بعد |
| **حجم Y.Doc** — بورد بزرگ (>۵۰۰۰ عنصر) کند می‌شود | متوسط | متوسط | سقف سخت `RT_MAX_DOC_BYTES`، فشرده‌سازی snapshot، هشدار در UI، بارگذاری تنبل تصاویر |
| **تاییدیه زرین‌پال طولانی می‌شود** | متوسط | متوسط | کد کامل با sandbox؛ فرآیند احراز را ۶ هفته قبل از دیپلوی شروع کن |
| **پایداری WebSocket روی شبکه ایران** | بالا | متوسط | heartbeat ۲۵ثانیه، اتصال مجدد با backoff، صف آفلاین update ها، نشانگر واضح وضعیت اتصال در UI |
| **از دست رفتن داده در crash نود realtime** | پایین | بحرانی | نوشتن update در Postgres **قبل از** ack به کلاینت (یا حداکثر ۱ثانیه تاخیر)، snapshot دوره‌ای، تست بازیابی |
| **تنها بودن توسعه‌دهنده** | قطعی | بالا | مستندسازی همه تصمیم‌ها (همین فایل‌ها)، `PROGRESS.md` در پایان هر session، تست خودکار به‌عنوان حافظه‌ی رفتاری |

---

## ضمیمه: دستورات روزمره

```bash
# راه‌اندازی اولیه
pnpm install
docker compose -f infra/docker/docker-compose.yml --profile dev up -d
pnpm --filter @hamboom/api migrate:up
pnpm --filter @hamboom/api seed

# توسعه
pnpm dev                    # turbo: web + api + realtime + worker همزمان
pnpm --filter @hamboom/canvas-core dev   # فقط دموی بوم

# کیفیت
pnpm lint && pnpm typecheck && pnpm test
pnpm license:check          # P1 — گیت اجباری در CI
```
