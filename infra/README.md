# `infra/` — استقرارِ هم‌بوم

> **وضعیت: M5 فاز ۰ تا ۵ تمام است** — ایمیج، CI، سخت‌سازیِ راز، و رصدپذیری.
> پشتیبان (فاز ۷) و TLS/لبه (فاز ۹) هنوز نیامده‌اند. runbookِ کامل
> کارِ گامِ ۱۰٫۱ است؛ این فایل امروز فقط «چطور بالا می‌آید» را می‌گوید.

| مسیر | چیست |
|---|---|
| [`docker/docker-compose.yml`](docker/docker-compose.yml) | استکِ **توسعه** — فقط زیرساخت (postgres, redis, minio) |
| [`docker/docker-compose.prod.yml`](docker/docker-compose.prod.yml) | استکِ **production/staging** — زیرساخت + هر سه اپ |
| [`docker/api.Dockerfile`](docker/api.Dockerfile) · [`realtime`](docker/realtime.Dockerfile) · [`web`](docker/web.Dockerfile) | ایمیج‌ها |
| [`nginx/`](nginx/) | reverse proxy — ⚠️ `api-locations.conf` **تولیدشده** است |
| [`sql/`](sql/) | EXTENSIONهای اولیه + migrationهای مشترکِ realtime |
| ★ [`docs/observability.md`](../docs/observability.md) | `/metrics`، آستانه‌های هشدار، و `/healthz` در برابرِ `/readyz` |

---

## چیدمان

```
              ┌──────────────── web (nginx :8080) ──────────────┐
  کاربر ──▶   │  /            → SPAِ ساخته‌شده (dist)            │
              │  /static/…    → باندلِ hashدار (کشِ ابدی)        │
              │  «پیشوندهای api» → api:3002                     │
              │  /rt          → realtime:3001 (WebSocket)       │
              └─────────────────────────────────────────────────┘
                         │                    │
                   api (:3002)          realtime (:3001)
                         │                    │
                    postgres ◀───────────────┘   redis     Object Storage (آروان)
```

★ **فقط `web` پورت publish می‌کند.** postgres و redis هیچ پورتی روی هاست ندارند —
تنها از شبکه‌ی داخلیِ compose دیده می‌شوند.

★★ **یک مبدأ برای همه‌چیز.** دلیلش همان دلیلِ پروکسیِ devِ Vite است: کوکیِ refreshِ
HttpOnly مسیرِ `/auth` دارد و `baseUrl`ِ sdk خالی است. api روی دامنه‌ی جدا یعنی CORS و
کوکیِ third-party. (اثبات‌شده: چرخه‌ی کاملِ OTP → کوکی → `/me` → refresh از پشتِ همین
پروکسی کار کرد.)

---

## بالاآوردن روی یک ماشینِ تمیز

```bash
# ۱. فایلِ محیط را بساز
cp .env.production.example .env.production   # و همه‌ی «‼️»ها را عوض کن

# ۲. ساختِ ایمیج‌ها (یا pullِ ایمیجِ CI — گامِ ۳٫۵)
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production build

# ۳. بالا آوردن — migration خودکار پیش از api اجرا می‌شود
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production up -d

# ۴. وضعیت
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production ps
```

### ⚠️ تفاوت‌های `.env.production` با `.env`ِ توسعه

| متغیر | توسعه | production |
|---|---|---|
| `DATABASE_URL` | `…@localhost:5544/…` | `…@postgres:5432/…` (نامِ سرویس در شبکه‌ی compose) |
| `REDIS_URL` | `…@localhost:7600/0` | `…@redis:6379/0` |
| `S3_ENDPOINT` | MinIOی لوکال | آروان (`https://s3.ir-thr-at1.arvanstorage.ir`) |
| `DATABASE_SSL` | `false` | `false` **فقط** تا وقتی دیتابیس در همان compose است — وگرنه ★ اپ بالا نمی‌آید |
| `APP_ENV` | `local` | `staging` یا `production` |
| `WEB_BASE_URL` · `ZARINPAL_CALLBACK_URL` | `localhost` | دامنه‌ی واقعی |

★★ **مسیرِ `ZARINPAL_CALLBACK_URL` باید دقیقاً `/billing/zarinpal/callback` باشد** —
`registerBillingRoutes` وگرنه در **بوت** می‌شکند (اثبات‌شده در همین ایمیج، exit 1).

⛔ **`APP_ENV=production` تا سیم‌کشیِ دو سرویسِ واقعی بالا نمی‌آید، و هر دو عمدی‌اند:**
`assertGatewayAllowed` (درگاهِ پرداخت) و `assertSmsProviderAllowed` (پیامک) — هر دو
اثبات‌شده در ایمیج با exit 1. ★ تا آن‌وقت **`APP_ENV=staging` با mock کاملاً کار می‌کند** و
کلِ استک رویش اثبات شده است.

★★ **و سه گاردِ دیگر روی خودِ پیکربندی** ([`production-guards.ts`](../packages/config/src/production-guards.ts)):
رازِ ضعیف · دیتابیسِ **دورِ** بدونِ SSL · و متغیرهای dev-only (`RT_DEV_JWT_SECRET`،
`OTP_DEV_FIXED_CODE`). همه‌ی تخلف‌ها **با هم** گزارش می‌شوند، نه یکی‌یکی.

---

## کارهای اپراتور — همان ایمیجِ api، کانتینرِ یک‌بارمصرف

★★ [ADR-062](../ARCHITECTURE_DECISIONS.md#adr-062): کارِ دوره‌ای **`apps/worker` نمی‌خواهد**.
هیچ ایمیجِ دومی هم لازم نیست — همان ایمیجِ api با `command`ِ دیگر اجرا می‌شود.

```bash
C="docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production"

# migration دستی (در `up` خودکار است)
$C run --rm migrate

# آشتی‌دهیِ پرداخت — از cronِ خودِ VM
$C --profile ops run --rm reconcile
$C --profile ops run --rm reconcile node scripts/billing-reconcile.ts --dry-run
```

⚠️ **فقط دو ورودی از `scripts/` در ایمیج پشتیبانی می‌شوند** — `migrate.ts` و
`billing-reconcile.ts`. بقیه ابزارِ dev/CI اند و وابستگی‌هایشان در نصبِ `--prod` نیستند.

---

## ⚠️ پروکسی: تنها جایی که نباید دستی ویرایش شود

`nginx/api-locations.conf` از [`apps/web/src/api-prefixes.ts`](../apps/web/src/api-prefixes.ts)
**تولید** می‌شود — همان فهرستی که پروکسیِ devِ Vite هم از آن می‌آید.

```bash
pnpm infra:check-proxy              # گیت (داخلِ pnpm verify هم هست)
pnpm infra:check-proxy -- --write   # بازتولید بعد از افزودنِ مسیرِ نو به api
```

گیت سه چیز را با هم می‌سنجد: مسیرهای **واقعیِ ثبت‌شده‌ی** api، فهرستِ پروکسیِ dev، و
فایلِ nginx. اگر مسیری از قلم بیفتد، کاربر به‌جای JSON صفحه‌ی SPA می‌گیرد — همان کلاسِ
نقصی که در فاز ۹ی M4 فقط با اجرای واقعی پیدا شد.

---

## آنچه هنوز نیست

| چه چیزی | کجا |
|---|---|
| TLS و سقفِ نرخِ لبه | فاز ۹ — تصمیمِ «گواهی از آروان یا ACME» عمداً باز است |
| پشتیبان و مشقِ بازیابی | فاز ۷ |
| ⚠️⚠️ **فرستنده‌ی واقعیِ پیامک** | ⛔ بلاک‌کننده‌ی launch — از فاز ۴، `APP_ENV=production` بدونِ آن **بالا نمی‌آید**. انتخابِ سرویس تصمیمِ مالک است |
