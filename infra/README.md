# `infra/` — استقرارِ هم‌بوم

> **وضعیت: M5 فاز ۰ تا ۸ تمام است** — ایمیج، CI، سخت‌سازیِ راز، رصدپذیری، انتخابِ
> رهبر، **دوامِ داده**، و **نگهداشت**. TLS/لبه (فاز ۹) هنوز نیامده. runbookِ کامل کارِ گامِ ۱۰٫۱
> است؛ این فایل امروز «چطور بالا می‌آید» را می‌گوید.

| مسیر | چیست |
|---|---|
| [`docker/docker-compose.yml`](docker/docker-compose.yml) | استکِ **توسعه** — فقط زیرساخت (postgres, redis, minio) |
| [`docker/docker-compose.prod.yml`](docker/docker-compose.prod.yml) | استکِ **production/staging** — زیرساخت + هر سه اپ |
| [`docker/api.Dockerfile`](docker/api.Dockerfile) · [`realtime`](docker/realtime.Dockerfile) · [`web`](docker/web.Dockerfile) | ایمیج‌ها |
| [`nginx/`](nginx/) | reverse proxy — ⚠️ `api-locations.conf` **تولیدشده** است |
| [`sql/`](sql/) | EXTENSIONهای اولیه + migrationهای مشترکِ realtime |
| ★ [`docs/observability.md`](../docs/observability.md) | `/metrics`، آستانه‌های هشدار، و `/healthz` در برابرِ `/readyz` |
| ★★ [`docs/backup-restore.md`](../docs/backup-restore.md) | پشتیبان، **مشقِ بازیابی**، و داستانِ migration در استقرار |

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

# ۲. ایمیج‌ها — از ماشینِ توسعه فرستاده می‌شوند (ADR-063)، نه از رجیستری
#    روی ماشینِ توسعه:  pnpm infra:ship -- --build --tag=$(git rev-parse --short HEAD) --to=root@<IP>
#    و بعد IMAGE_TAG را در .env.production همان بگذار.
#    ⊕ یا اگر ترجیح می‌دهی همان‌جا build شود:
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

⛔ **`APP_ENV=production` هنوز یک بلاک‌کننده دارد — و فقط یکی.** ✅ گیتِ پیامک با
`SMS_PROVIDER=smsir` باز شد (M5 فازِ ۴٫۵)، پس آنچه می‌مانَد `assertGatewayAllowed` است:
تا تاییدِ حسابِ زرین‌پال و `ZARINPAL_MERCHANT_ID`، production بالا نمی‌آید. اثبات‌شده با
چهار حالتِ بوت — با `smsir` خطا حالا `GatewayNotAllowedError` است، نه پیامک.
★ تا آن‌وقت **`APP_ENV=staging` کاملاً کار می‌کند** و کلِ استک رویش اثبات شده است.

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

# ★★ دوامِ داده (فاز ۷) — شبانه، و مشق **هفتگی**
$C --profile ops run --rm backup -- --prune=14
$C --profile ops run --rm backup-storage
$C --profile ops run --rm restore-drill

# نگهداشت و پاک‌سازی (فاز ۸) — ⚠️ ترتیب اجباری است
$C --profile ops run --rm purge node scripts/purge-deleted.ts --days=N --delete
$C --profile ops run --rm sweep-orphans node scripts/sweep-orphans.ts --delete
```

⚠️⚠️ **اول purge بعد sweep.** purge فقط **ردیف** می‌بَرد؛ بلابِ S3 با CASCADE پاک
نمی‌شود (نشتیِ ثبت‌شده از M3) و تازه بعدش **یتیم** می‌شود تا جاروب برش دارد. برعکسش
بی‌اثر است: تا ردیف هست، جاروب بلاب را «دارای مرجع» می‌بیند — که همان رفتارِ درست است.

⚠️ **هر دو پیش‌فرضِ «فقط گزارش» دارند** و `--delete` صریح می‌خواهند؛ و `purge` بدونِ
`--days=N` عمداً بالا نمی‌آید (M5-D9 تصمیمِ مالک است، نه پیش‌فرضِ ما).

★★ **مشقِ بازیابی تزئینی نیست:** یک پشتیبانِ بازیابی‌نشده پشتیبان نیست. روی یک دیتابیسِ
موقت برمی‌گرداند و پنج ادعا را می‌سنجد — از جمله **شمارشِ ردیف**، که تنها چکی است که
پشتیبانِ «schema سالم، داده غایب» را می‌گیرد. جزئیات در
[`docs/backup-restore.md`](../docs/backup-restore.md).

⚠️ **فقط این ورودی‌ها از `scripts/` در ایمیج پشتیبانی می‌شوند** — `migrate.ts`،
`billing-reconcile.ts`، `backup-db.ts`، `backup-storage.ts`، `restore-drill.ts`،
`sweep-orphans.ts` و `purge-deleted.ts` (به‌همراهِ کمکی‌هایشان). بقیه ابزارِ dev/CI اند و وابستگی‌هایشان در نصبِ `--prod` نیستند.
★ فهرست در `PRODUCTION_SCRIPTS`ِ [`check-workspace-deps.ts`](../scripts/check-workspace-deps.ts)
است و گیتِ `deps` جداافتادنش از Dockerfile را قرمز می‌کند.

---

## رساندنِ ایمیج به VM — [ADR-063](../ARCHITECTURE_DECISIONS.md#adr-063)

★ **بدونِ رجیستری.** CI ایمیج‌ها را **می‌سازد و گیت می‌شود، ولی push نمی‌کند**؛ انتقال یک
آرشیوِ `docker save` است که روی ssh بارگذاری می‌شود:

```bash
pnpm infra:ship                                   # تمرینِ محلی (بدونِ ssh)
pnpm infra:ship -- --build --tag=$(git rev-parse --short HEAD) --to=root@<IP>
pnpm infra:ship -- --self-test                    # دو شکستنِ عمدی
pnpm infra:ship -- --to=root@<IP> --base          # + postgres/redis، اگر VM به Docker Hub نمی‌رسد
```

**اندازه‌گیریِ واقعی:** هر سه ایمیج با `docker save` **۱۸۵MB** می‌شوند و api تنها
**۱۱۹MB** — نه ۱٫۲GBی که `docker images` نشان می‌دهد (آن عدد لایه‌های مشترک را چند بار
می‌شمارد). با این اعداد رجیستری فقط چند دقیقه صرفه‌جویی می‌کند و در عوض **دو** وابستگیِ
شبکه‌ای می‌آورد که هیچ‌کدام در کنترلِ ما نیستند.

★ **انتقال در مقصد راستی‌آزمایی می‌شود:** بعد از `docker load`، هر تگ `inspect` می‌شود و
شناسه‌اش با مبدأ سنجیده می‌شود — وگرنه یک بارگذاریِ ناقص یا یک ایمیجِ هم‌نامِ **قدیمی** در
مقصد، «موفق» دیده می‌شود.

⚠️ اسکریپت `IMAGE_TAG` را چاپ می‌کند؛ همان را در `.env.production` بگذار. حدس‌زدنش ممنوع.

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

## ⚠️⚠️ پیش از افزودنِ نودِ دوم این را بخوان

★ **ممیزیِ M5 گام ۶٫۳.** امروز استقرار **تک‌نودی** است و همه‌چیز درست کار می‌کند. سه چیز
وضعیتِ درون‌حافظه‌ای دارند؛ برای هرکدام سوال این بود: **باگِ درستی است یا فقط اتلاف؟**

| چه چیزی | با نودِ دوم چه می‌شود | حکم |
|---|---|---|
| ✅ **آشتی‌دهیِ بازه‌ای** | هر نود تایمرِ خودش را دارد | **حل شد** — advisory lock ([ADR-060](../ARCHITECTURE_DECISIONS.md#adr-060))؛ فقط یک نود sweep می‌کند |
| ✅ **`Idempotency-Key`ِ پرداخت** | میان‌افزارِ حافظه‌ای نود B کلیدِ نود A را نمی‌شناسد | ★★ **درستی از قبل امن بود** — یکتاییِ `payments_idem_uq` در **دیتابیس**، نه میان‌افزار. و شکافِ باقی‌مانده (۵۰۰ی بازنده‌ی هم‌زمان) در فاز ۶ بسته شد |
| ⚠️ **`Idempotency-Key`ِ بقیه‌ی POSTها** | دو کلیکِ هم‌زمان روی دو نود ⇒ **دو بورد/تیم/فولدر** | **باگِ کاربری، نه فساد داده.** پول درگیر نیست. رفع = ذخیره‌ی مشترک (Redis) |
| ⚠️ **سقفِ نرخ** (`@fastify/rate-limit`، حافظه‌ای) | هر نود جدا می‌شمارد ⇒ سقفِ موثر **N برابر** | **تضعیفِ حفاظت.** `RATE_LIMIT_OTP_MAX=5` با ۳ نود یعنی ۱۵ پیامک — هم هزینه، هم سطحِ enumeration |

⇒ **شرطِ نودِ دوم:** هر دو موردِ ⚠️ باید به یک ذخیره‌ی مشترک بروند. تا آن‌وقت `web` تنها
درِ ورودی است و **یک** نودِ api/realtime پشتش می‌ایستد.

★★ **و چرا نودِ دوم امروز اصلاً لازم نیست:** تریگرش عددی است و حالا اندازه‌پذیر —
`hamboom_rt_adr048_trigger_ratio` در [`observability.md`](../docs/observability.md).

---

## آنچه هنوز نیست

| چه چیزی | کجا |
|---|---|
| TLS و سقفِ نرخِ لبه | فاز ۹ — تصمیمِ «گواهی از آروان یا ACME» عمداً باز است |

