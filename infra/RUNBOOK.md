# RUNBOOK — هم‌بوم روی VM (M5 گام ۱۰٫۱)

> دفترچه‌ی **اپراتور**: ساعتِ سه صبح، یک چیزی خراب است، و باید بدانی دقیقاً چه بزنی.
> «چطور چیده شده» در [`README.md`](README.md) است؛ این‌جا فقط **رویه** است — هر رویه با
> دستورهایی که واقعاً در این ریپو وجود دارند، و با چیزی که پیش از آن روی همین ماشین یا در
> CI اثبات شده. جایی که رویه‌ای هنوز اثبات نشده، **با ⏳ نوشته شده**، نه پنهان.

```bash
# همه‌ی دستورهای این فایل با این مخفف نوشته شده‌اند (روی VM، در ریشه‌ی ریپو):
C="docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production"
```

⚠️⚠️ **پیش از هر چیز، دو گاردی که بوت را رد می‌کنند و باید بدانی چرا:**
`APP_ENV=production` با درگاهِ `mock` **بالا نمی‌آید** (`GatewayNotAllowedError`)، و با
`PAYMENT_PROVIDER=zarinpal` بدونِ `ZARINPAL_MERCHANT_ID`ِ ۳۶کاراکتری هم نه (خطای صریحِ خودش)؛
و کانتینرِ `web` بدونِ دو فایلِ TLS در production **بالا نمی‌آید**
([ADR-064](../ARCHITECTURE_DECISIONS.md#adr-064)). هیچ‌کدام باگ نیستند؛ اگر دیدی، پیکربندی
ناقص است. تا تاییدِ زرین‌پال، **`APP_ENV=staging`** همان استک است با mock.

---

## ۱. اولین استقرار — روزِ صفر

### ۱٫۱ روی VM، پیش از هر چیز: probe

```bash
bash infra/probe-vm.sh          # چهار گروه: ایمیجِ پایه · رجیستری · وابستگیِ build · مقصدهای runtime
```

نتیجه‌اش را در [`PROGRESS-M5-infra.md`](../PROGRESS-M5-infra.md) ثبت کن — این همان
اندازه‌گیری‌ای است که [ADR-063](../ARCHITECTURE_DECISIONS.md#adr-063) روی آن باز مانده.
اگر `postgres:16-alpine`/`redis:7-alpine` از VM قابلِ کشیدن نبود، در ۱٫۳ `--base` بده.

### ۱٫۲ آماده‌سازیِ VM

| چه | چطور |
|---|---|
| Docker + plugin compose | نصبِ رسمیِ Docker Engine؛ `docker compose version` باید ≥ 2 باشد |
| ریپو | `git clone` با deploy keyِ **فقط‌خواندنی**، یا `rsync`ِ پوشه‌ی `infra/` **به‌علاوه‌ی** `.env.production.example`ِ ریشه — compose فایلِ `infra/docker/docker-compose.prod.yml` و `infra/sql/` را می‌خواهد، نه سورس را (ایمیج‌ها با ship می‌آیند) |
| فایروال | فقط **۲۲، ۸۰، ۴۴۳** باز. هیچ سرویسِ دیگری پورتِ هاست ندارد و نباید بگیرد |
| `.env.production` | `cp .env.production.example .env.production` و **همه‌ی «‼️»ها**؛ سپس `chmod 600 .env.production` — راز فقط این‌جاست، هیچ‌جای دیگر |
| TLS | دو فایل در `infra/docker/tls/` (`fullchain.pem` + `privkey.pem`) — از پنلِ آروان یا certbot؛ دستورِ هر دو در [`README.md`](README.md). ⚠️ با certbot **ترتیب**: اول `APP_ENV=staging` و `up -d` (حالتِ http، ACME جواب می‌دهد) → certbot → دو فایل → `APP_ENV=production` → `up -d` |
| CORSِ باکت | مرورگر **مستقیم** به Object Storage می‌فرستد و می‌خوانَد (presign، P4). در پنلِ آروان روی `hamboom-assets`: origin `https://<دامنه>`، متدهای `GET, POST, PUT, HEAD`، همه‌ی هدرها. بدونش تصویر «قابِ خالی» می‌شود در حالی که همه‌چیز healthy است (ردیفش در §۵) |

⚠️ **کلیدِ sms.ir** فقط در `.env.production` می‌نشیند، و اگر جایی جز آن دیده شده (چت، تیکت،
لاگ) **باطلش کن و کلیدِ نو بگیر** — کلیدِ لو‌رفته یعنی پیامکِ رایگان برای دیگران، به حسابِ ما.

### ۱٫۳ ایمیج‌ها — از ماشینِ توسعه، نه از رجیستری ([ADR-063](../ARCHITECTURE_DECISIONS.md#adr-063))

```bash
# روی ماشینِ توسعه:
pnpm infra:ship -- --build --tag=$(git rev-parse --short HEAD) --to=root@<IP>
pnpm infra:ship -- --build --tag=… --to=root@<IP> --base     # اگر probe گفت VM به Docker Hub نمی‌رسد
```

اسکریپت در مقصد هر سه تگ را `inspect` می‌کند و **شناسه‌ها را با مبدأ می‌سنجد**؛ آخرش
`IMAGE_TAG` را چاپ می‌کند — **همان** را در `.env.production` بگذار. حدس‌زدنش ممنوع.
(اندازه‌ی واقعیِ انتقال: هر سه ایمیج **۱۸۵MB**، api تنها **۱۱۹MB**.)

### ۱٫۴ بالا آوردن

```bash
$C up -d            # migrate خودکار پیش از api اجرا می‌شود (service_completed_successfully)
$C ps               # هر پنج سرویس باید (healthy) باشند: postgres، redis، api، realtime، web
```

### ۱٫۵ اثباتِ روزِ صفر — هیچ‌کدام را رد نکن

| # | چه | انتظار |
|---|---|---|
| ۱ | `curl -sI http://<دامنه>/boards` | `301` به `https://` |
| ۲ | `curl -s https://<دامنه>/healthz` · `/readyz` | هر دو `200`؛ اگر `/readyz` ۵۰۳ داد، بدنه فقط `not_ready` است و **علت در لاگِ api** (`$C logs --tail=40 api`، سطرِ `readyz:`) |
| ۳ | `curl -sI https://<دامنه>/` | `Strict-Transport-Security` و `X-Content-Type-Options` در پاسخ |
| ۴ | ورود با شماره‌ی واقعی | پیامک **می‌رسد** و کد می‌خواند (فازِ ۴٫۵ روی گوشیِ واقعی اثبات شد) |
| ۵ | باز کردنِ یک بورد | نقطه‌ی سبز و «ذخیره شد» در نوارِ وضعیت (hover: «متصل · ذخیره شد») — یعنی `wss://` از پشتِ nginx وصل است |
| ۶ | `$C logs --tail=50 api` | هیچ `ProductionConfigError`، هیچ `TRUST_PROXY` |
| ۷ | `$C --profile ops run --rm backup` | یک dump در باکتِ **جدا** (`S3_BUCKET_BACKUPS`) + مانیفست |
| ۸ | `$C --profile ops run --rm restore-drill` | **پنج چک سبز** — پشتیبانِ روزِ صفر واقعاً برمی‌گردد |
| ۹ | درجِ یک تصویر روی بوم + رفرش | تصویر می‌مانَد — یعنی CORSِ باکت و presign با دامنه‌ی واقعی درست‌اند (روی MinIOی لوکال اثبات شده، روی آروان نه) |

★ ردیفِ ۸ همان روز، نه هفته‌ی بعد: پشتیبانِ بازیابی‌نشده پشتیبان نیست.

---

## ۲. استقرارِ نسخه‌ی جدید

```bash
# ماشینِ توسعه — فقط بعد از CI سبز روی همان کامیت:
pnpm infra:ship -- --build --tag=$(git rev-parse --short HEAD) --to=root@<IP>

# VM:
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<تگِ چاپ‌شده>/' .env.production
$C up -d                    # migrate اجرا می‌شود؛ بعد api/realtime/web با ایمیجِ نو
$C ps                       # (healthy) × ۵
$C logs --tail=30 migrate   # «همه‌ی migrationها از قبل اعمال شده‌اند (N فایل)» یا `✔ <نامِ فایل>` برای هر تازه
```

**چه چیزی هنگامِ `up -d` می‌گذرد:** `migrate` یک advisory lock می‌گیرد
(`lock_timeout=60s`؛ در گام ۷٫۳ با رقیبِ واقعی ۶ ثانیه صبر کرد، بی‌رقیب ۲۳۳ms)، migrationهای
تازه را اعمال می‌کند، و **checksumِ** قبلی‌ها را می‌سنجد — فایلِ دست‌خورده‌ی قدیمی بوت را رد
می‌کند. بعد api بالا می‌آید و web به آن وصل می‌شود. یک قطعیِ چند ثانیه‌ای برای کاربرانِ
متصل عادی است: کلاینت‌ها با backoff + jitter برمی‌گردند (گام ۵٫۱ی M2، `rt:reconnect`).

⚠️ **پیش از هر استقرار یک پشتیبان بگیر** (`$C --profile ops run --rm backup`). روی دیتابیسِ
کوچک چند ثانیه است (روی داده‌ی واقعی اندازه‌گیری نشده) و تنها راهِ برگشت از یک migrationِ
ناسازگار (بخشِ ۳).

---

## ۳. Rollback

**Rollback = ایمیجِ قبلی، همان schema.** migrationها **برگشت ندارند** (فقط رو به جلو، با
دفترِ checksum) — پس دو حالت:

### ۳٫۱ نسخه‌ی نو migration نداشت (یا migrationش با کدِ قبلی سازگار است)

```bash
docker images hamboom/api                              # تگ‌های موجود روی VM — قبلی هنوز هست
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<تگِ قبلی>/' .env.production
$C up -d
$C ps
```

★ ایمیج‌های قبلی روی VM می‌مانند تا `docker image prune` بزنی (بخشِ ۶) — پس **حداقل دو
تگِ آخر را نگه دار**.

### ۳٫۲ نسخه‌ی نو migrationِ ناسازگار داشت

کدِ قبلی روی schemaی نو بالا نمی‌آید (یا بدتر: بالا می‌آید و غلط می‌نویسد). راهِ درست:
**بازیابیِ پشتیبانِ پیش از استقرار** (بخشِ ۴) + ایمیجِ قبلی. ⚠️ هر چیزی که کاربران
**بعد از** آن پشتیبان نوشته‌اند از دست می‌رود — به همین دلیل پشتیبانِ پیش از استقرار
اجباری است. ⏳ و امروز **هیچ گیتی** کدِ قبلی را روی schemaی نو نمی‌سنجد (CI فقط کدِ نو را روی
دیتابیسِ تازه اجرا می‌کند) — تا آن روز، سازگاریِ رو به عقبِ هر migration بازبینیِ **دستی** است.

---

## ۴. بازیابی از پشتیبان — روزِ حادثه

مرجع: [`docs/backup-restore.md`](../docs/backup-restore.md). خلاصه‌ی عملیاتی:

```bash
# ۰. کدام پشتیبان؟ (بدونِ --key، آخرین)
#    فهرست: از پنلِ Object Storage، پیشوندِ pg/ در باکتِ پشتیبان؛ کنارِ هر dump یک .json است

# ۱. نویسنده‌ها را بخوابان — هیچ‌چیز نباید وسطِ بازیابی بنویسد
$C stop api realtime

# ۲. ★★ اول مشق، روی دیتابیسِ دورریختنی — پنج چک: sha256، restore، migrations (نام + checksum)، rows، fk
$C --profile ops run --rm restore-drill node scripts/restore-drill.ts --key=pg/hamboom-<زمان>.dump --keep
#    --keep یعنی دیتابیسِ «hamboom_restore_drill» می‌مانَد — همان نسخه‌ی راستی‌آزمایی‌شده

# ۳. فقط اگر هر پنج چک سبز بود: **جابه‌جاییِ نام**، نه بازیابیِ دوباره
#    ⚠️ داخلِ کانتینر با sh -c: `$POSTGRES_USER` در شلِ اپراتور تعریف نشده (--env-file فقط به compose می‌رود)
$C exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "ALTER DATABASE hamboom RENAME TO hamboom_broken_'$(date +%Y%m%d%H%M)'; ALTER DATABASE hamboom_restore_drill RENAME TO hamboom;"'

# ۴. بالا بیاور و اثبات کن
$C up -d api realtime
$C ps
curl -s https://<دامنه>/readyz
```

★ چرا جابه‌جاییِ نام و نه `pg_restore`ِ دوباره روی اصل: دیتابیسِ مشق **همان** چیزی است که
پنج چک رویش سبز شد؛ یک بازیابیِ دوم روی اصل یک فرصتِ دومِ خراب‌شدن است. دیتابیسِ
`hamboom_broken_…` را تا یک هفته نگه دار، بعد `DROP DATABASE`.

✅ **همین چهار گام روی استکِ productionِ همین ماشین اجرا شد** (۱۴۰۵/۰۶/۱۹، `APP_ENV=staging`):
کاربرِ واقعی از راهِ OTP → `backup` → `stop api realtime` → مشق با `--keep` **۵/۵** → جابه‌جاییِ
نام → `up -d api realtime` → هر دو healthy، `/readyz` **۲۰۰**، ردیفِ کاربر و ۸ migration در
دیتابیسِ برگشته، و `migrate` روی آن گفت «همه‌ی migrationها از قبل اعمال شده‌اند (8 فایل)».

⚠️ **بازیابیِ Object Storage اسکریپت ندارد.** `backup-storage` آینه‌ی یک‌طرفه می‌سازد
(`storage/<bucket>/<key>` در باکتِ پشتیبان + مانیفستِ تاریخ‌دار)؛ برگرداندنش امروز **دستی**
است (کپیِ کلید‌به‌کلید از پنل یا با ابزارِ S3ِ خودت). ⏳ در فهرستِ تحویل به M6
([`docs/m6-handoff.md`](../docs/m6-handoff.md)). ⚠️⚠️ و این فقط تصاویرِ آپلودی نیست: بعد از
فشرده‌سازی (گام ۴٫۴ی M2) updateهای پیش از snapshot از `board_updates` **حذف می‌شوند** — یعنی
محتوای بورد تا `seq_upto` فقط در snapshotِ Object Storage است. پشتیبانِ دیتابیس بدونِ آینه‌ی
Object Storage بوردِ کامل را برنمی‌گرداند؛ **هر دو** با هم یک پشتیبان‌اند (گام ۷٫۴؛ M5-D7 فقط
می‌گوید باکتِ پشتیبان جدا باشد).

---

## ۵. «چه کنم اگر…»

| نشانه | اول این را ببین | علتِ رایج و رفع |
|---|---|---|
| `$C ps` می‌گوید `web` **Exited (1)** | `$C logs web` | «گواهیِ TLS نیست» ⇒ دو فایل در `TLS_DIR`، یا `APP_ENV=staging` تا گواهی برسد. یا `[emerg] host not found in upstream "api:3002"` (دیده‌شده در ۹٫۲ وقتی web بدونِ api بالا آمد) ⇒ api/realtime نیستند، اول آن‌ها |
| `api` مدام **Restarting** | `$C logs --tail=40 api` | `ProductionConfigError` (رازِ ضعیف، `TRUST_PROXY=false`، `DATABASE_SSL`، متغیرِ dev-only) — پیام همه‌ی تخلف‌ها را **با هم** می‌گوید · `GatewayNotAllowedError` ⇒ درگاهِ mock در production · `SMS_IR_TEMPLATE_ID` ⇒ خالی گذاشته‌ای؟ |
| `/readyz` **۵۰۳** ولی `/healthz` ۲۰۰ | `$C logs --tail=20 api` سطرِ `readyz:` (بدنه فقط `not_ready` است؛ علت در لاگ) | دیتابیس. `$C ps postgres` → `$C logs postgres`. ⚠️ با میزبانِ **غیرقابلِ دسترس** تا ~۵s طول می‌کشد (`connectionTimeoutMillis`ِ گام ۵ی M5؛ پیش از آن ۲۱s بود) |
| کاربران «**اتصالِ مجدد…**» می‌بینند | `$C logs --tail=40 realtime` | «خطای اتصالِ Redis» ⇒ `$C ps redis`. اگر realtime سالم است: nginx؟ `curl -sI https://<دامنه>/rt` باید `404` بدهد (پاسخِ خودِ realtime به درخواستِ بدونِ upgrade) نه `502` |
| «**ذخیره‌نشده**» روی بوم | `$C logs realtime` با `نوشتنِ update شکست خورد` | Postgres پر/کند/بسته. **هیچ‌چیز گم نشده تا کاربر تب را نبسته** — سند در حافظه‌ی کلاینت و اتاق است؛ اول دیتابیس را نجات بده |
| کاربر می‌گوید «کد نمی‌آید» | `$C logs api` با `sms.ir` | `pnpm sms:probe -- --to=09…` از ماشینِ توسعه با همان کلید. `status ≠ 1` ⇒ پنلِ sms.ir (اعتبار؟ قالب رد شده؟). ⚠️ کلیدِ باطل‌شده هم همین شکل است |
| ورود **۴۲۹** می‌دهد در حالی که کاربر تازه‌کار است | لاگِ nginx (`$C logs web`) در برابرِ لاگِ api | ۴۲۹ی **nginx** (بدونِ `x-ratelimit-limit`) ⇒ ناحیه‌ی `hb_auth` (۱/s، رگبار ۳۰ به‌ازای IP) · ۴۲۹ی **api** ⇒ `RATE_LIMIT_OTP_MAX` به‌ازای IP. پشتِ CGNAT یک اداره یک IP است — عدد را با تصمیمِ مالک بالا ببر، نه بی‌صدا |
| پرداخت انجام شد ولی اشتراک فعال نشد | `payments` با `status='pending'` | callback گم شده. آشتی‌دهی (`BILLING_RECONCILE_ENABLED=true`) در بازه‌ی بعدی می‌گیردش؛ دستی: `$C --profile ops run --rm reconcile node scripts/billing-reconcile.ts --dry-run` بعد بدونِ `--dry-run`. ⛔ هیچ ردیفی را دستی `failed` نکن ([ADR-056](../ARCHITECTURE_DECISIONS.md#adr-056)) |
| بازگشت از درگاه **۴۰۴** | `ZARINPAL_CALLBACK_URL` | مسیر باید دقیقاً `/billing/zarinpal/callback` باشد — گاردِ بوت این را می‌گیرد، پس اگر رسیدی این‌جا، دامنه غلط است نه مسیر |
| **دیسک پر** | `df -h` · `docker system df` | لاگِ کانتینر سقف دارد (۱۰MB×۳)؛ مظنون: ایمیج‌های قدیمی (`docker image prune -a --filter "until=720h"` — ⚠️ دو تگِ آخر را نگه دار) یا `pgdata`. ★ `pg/`ِ باکتِ پشتیبان روی VM نیست |
| **گواهی منقضی شد** | `openssl x509 -enddate -noout -in infra/docker/tls/fullchain.pem` | دو فایل را جایگزین کن + `$C exec web nginx -s reload`. ⚠️ HSTS یک‌ساله است: مرورگرِ کاربر http را قبول نمی‌کند، پس «موقتاً بدونِ TLS» **گزینه نیست** |
| **آب‌رفتنِ حافظه‌ی realtime** | `/metrics` از داخلِ شبکه: `hamboom_rt_adr048_trigger_ratio` | ≥ ۰٫۶ یعنی تریگرِ [ADR-048](../ARCHITECTURE_DECISIONS.md#adr-048) — نودِ دوم/room affinity؛ پیش‌نیازهایش در [`README.md`](README.md). زیرِ آن: `RT_ROOM_IDLE_TIMEOUT_MS` را کوتاه‌تر کن |
| `migrate` **۶۰ ثانیه** صبر کرد و افتاد | `$C ps -a` | یک `migrate`ِ دیگر قفل را دارد (استقرارِ هم‌زمان؟) — منتظر بمان یا آن را متوقف کن؛ `lock_timeout` عمدی است تا استقرارِ بی‌صدا معلق نماند |
| CI قرمز شد روی «گاردهای بوت داخلِ ایمیج» با «به دلیلِ **دیگری**» | نامِ خطای واقعی در لاگِ مرحله | ترتیبِ گاردها عوض شده (فاز ۴ و ۹٫۲ هر دو همین‌جا خوردند) — envِ آن چک را کامل کن، نه اینکه چک را شل کنی |
| بعد از ری‌استارتِ VM هیچ‌چیز بالا نیامد | `docker ps` | `restart: unless-stopped` هست؛ اگر خودت `stop` کرده بودی، `$C up -d` |
| سرویسی `(unhealthy)` است ولی `Up` | `$C ps` · `$C logs <سرویس>` | ⚠️ **Compose سرویسِ unhealthy را ری‌استارت نمی‌کند** (فقط خروجِ فرایند را می‌بیند) و nginx هم passive-health ندارد ⇒ کاربران timeout می‌گیرند. `$C restart <سرویس>`؛ علت (event loopِ گیرکرده، بوردِ غول، S3ِ معلق) بعدش |
| **تصویر «قابِ خالی»** یا درج نمی‌شود، همه healthy | devtoolsِ مرورگرِ کاربر (خطای CORS) | مرورگر مستقیم به Object Storage می‌رود؛ CORSِ باکت `https://<دامنه>` را مجاز نکرده (§۱٫۲). لاگِ api/nginx **هیچ‌چیز** نشان نمی‌دهد چون presign و commit موفق‌اند |
| **بورد باز نمی‌شود** (لودینگ/خطا) ولی `/readyz` ۲۰۰ | `$C logs --tail=40 realtime` با `snapshot` | Object Storageِ آروان قطع/کند یا کلیدِ S3 چرخیده: بوردِ فشرده‌شده برای بازشدن **snapshot لازم دارد** و `/readyz` هیچ‌کدام از دو سرور S3 را نمی‌سنجد. اتاق‌های در حافظه کار می‌کنند، تازه‌ها نه. `curl -sI $S3_ENDPOINT` از VM |
| همه «**در حالِ ذخیره…**» می‌بینند و هیچ‌چیز ذخیره نمی‌شود | `$C logs realtime` با `صاحبیِ بورد از دست رفت` / `بررسیِ قفلِ صاحب شکست خورد` | **Redis** (پایین، OOM با `maxmemory` و `noeviction`، رمزِ غلط): بدونِ قفلِ صاحب هیچ نودی **نمی‌نویسد** (fail-closed، ADR-006) و updateها فقط در حافظه‌ی realtime‌اند. ⚠️⚠️ **realtime را ری‌استارت نکن تا Redis برنگردد** — آن حافظه تنها نسخه است. اول `$C ps redis` / `$C logs redis`، بعد صاحبی خودکار برمی‌گردد |
| «پشتیبانِ آخر کِی بود؟» | پنلِ Object Storage، باکتِ پشتیبان، پیشوندِ `pg/` — تازه‌ترین `.json` | اگر قدیمی‌تر از دیشب است، cron بی‌صدا افتاده: `/var/log/hamboom/backup.log` (§۶). ⚠️ با `--prune=14`، دو هفته شکستِ بی‌صدا یعنی **هیچ** نقطه‌ی بازیابی |

---

## ۶. کارهای دوره‌ای — cronِ خودِ VM ([ADR-062](../ARCHITECTURE_DECISIONS.md#adr-062): بدونِ worker)

```cron
# crontab -e  (کاربری که docker را می‌بیند) — مسیرِ ریپو را جایگزین کن؛ mkdir -p /var/log/hamboom
# ⚠️ هر خط لاگ می‌نویسد و MAILTO دارد: cronی که بی‌صدا بیفتد، «پشتیبانِ سه‌هفته‌پیش» روزِ حادثه است.
MAILTO=<ایمیلِ خودت>
C="docker compose -f /srv/hamboom/infra/docker/docker-compose.prod.yml --env-file /srv/hamboom/.env.production"
L=/var/log/hamboom
# پشتیبانِ دیتابیس، شبانه ۰۳:۱۰ — ۱۴ تای آخر می‌مانند (⏳ عددِ نگهداشت تصمیمِ مالک است)
10 3 * * *   $C --profile ops run --rm backup node scripts/backup-db.ts --prune=14 >> $L/backup.log 2>&1 || echo "backup FAILED $(date)" >> $L/FAILED
# آینه‌ی Object Storage، شبانه ۰۳:۳۰
30 3 * * *   $C --profile ops run --rm backup-storage >> $L/backup-storage.log 2>&1 || echo "backup-storage FAILED $(date)" >> $L/FAILED
# ★★ مشقِ بازیابی، هفتگی یکشنبه ۰۴:۰۰ — پشتیبانی که هر هفته برنمی‌گردد، پشتیبان نیست
0  4 * * 0   $C --profile ops run --rm restore-drill >> $L/restore-drill.log 2>&1 || echo "restore-drill FAILED $(date)" >> $L/FAILED
# سطلِ بازیافت (M5-D9 = ۳۰ روز) و بعدش جاروبِ بلابِ یتیم — ترتیب اجباری، هفتگی دوشنبه ۰۴:۳۰
30 4 * * 1   $C --profile ops run --rm purge node scripts/purge-deleted.ts --delete >> $L/purge.log 2>&1 && $C --profile ops run --rm sweep-orphans node scripts/sweep-orphans.ts --delete >> $L/sweep.log 2>&1
# ایمیج‌های قدیمی، ماهانه — ⚠️ فیلتر **سن** را می‌بیند نه تعدادِ تگ: اگر استقرارِ قبلی هم >۳۰ روز
#   پیش بوده، تگِ قبلی (بی‌کانتینر) می‌رود. پیش از rollback `docker images hamboom/api` را ببین.
0  5 1 * *   docker image prune -a -f --filter "until=720h"
```

⚠️ **آشتی‌دهی در cron نیست** — با `BILLING_RECONCILE_ENABLED=true` داخلِ خودِ api است
(پلاگینِ بازه‌ای + advisory lock، [ADR-060](../ARCHITECTURE_DECISIONS.md#adr-060)). کانتینرِ
`reconcile` برای اجرای **دستی** است. ⚠️ **تمدیدِ گواهی** هم این‌جا نیست: certbot تایمرِ
خودش را دارد، ولی هوکِ deploy را **خودت می‌سازی** (`/etc/letsencrypt/renewal-hooks/deploy/hamboom.sh`:
کپیِ دو فایل + `nginx -s reload` — دو خطش در [`README.md`](README.md))؛ بدونِ آن گواهیِ تازه
می‌آید و nginx همان قدیمی را سرو می‌کند.

★ فایلِ `$L/FAILED` **باید وجود نداشته باشد** — یک `test -e /var/log/hamboom/FAILED` در چکِ هفتگیِ خودت.
⏳ هشدارِ خودکار (متریکِ «سنِ آخرین پشتیبان») ندارد؛ در فهرستِ M6.

★ اسکریپت‌های این cron همان‌هایی‌اند که CI هر push اجرا می‌کند (`ci.yml`) — ولی **نه با همین
پرچم‌ها**: CI `backup` را بدونِ `--prune` و `purge`/`sweep-orphans` را فقط با `--self-test` می‌زند.
منطقِ حذف در خودآزمون‌ها پوشیده است؛ شاخه‌ی `--prune=14` نه. پس «روی VM خراب بود» معمولاً
محیط است، ولی برای `--prune` اولین اجرا را خودت ببین.

---

## ۷. بهداشتِ راز

- `.env.production` تنها خانه‌ی راز است؛ `chmod 600`، هرگز در git، هرگز در چت/تیکت.
- **چرخشِ `JWT_SECRET`** فقط accessهای در گردش (≤ `ACCESS_TOKEN_TTL_SECONDS`، ۱۵ دقیقه) و
  توکن‌های `rt` را بی‌اعتبار می‌کند؛ refresh **مات و در دیتابیس** است (ADR-011) و باطل نمی‌شود،
  پس کاربران بی‌صدا access نو می‌گیرند و **خارج نمی‌شوند**. خروجِ اجباریِ همه = پاک‌کردنِ
  ردیف‌های نشست، نه چرخشِ راز.
- **چرخشِ کلیدِ sms.ir**: کلیدِ نو در پنل → `.env.production` → `$C up -d api`. کلیدِ قبلی
  را **باطل** کن؛ کلیدی که در گفت‌وگویی دیده شده از همان لحظه لو‌رفته حساب می‌شود.
- **چرخشِ رمزِ Postgres/Redis رویه دارد، نه فقط ویرایشِ فایل:** `POSTGRES_PASSWORD` فقط در
  **initdb** اعمال می‌شود (volumeِ `pgdata` رمزِ قدیمی را نگه می‌دارد) — پس:
  `$C exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "ALTER ROLE $POSTGRES_USER PASSWORD '"'"'<نو>'"'"'"'`
  → `DATABASE_URL` و `POSTGRES_PASSWORD` هر دو در `.env.production` → `$C up -d` (api، realtime، migrate، ops همه از `DATABASE_URL` می‌خوانند).
  Redis: `REDIS_PASSWORD` و `REDIS_URL` هر دو → `$C up -d redis realtime api` (`--requirepass` با ری‌استارتِ redis اعمال می‌شود؛ تا آن لحظه realtime «صاحبی از دست رفت» می‌گوید — ردیفش در §۵). ⚠️ دو متغیر برای یک رمز، و هیچ گاردی ناهم‌خوانی‌شان را نمی‌گیرد.
- **پشتیبان‌ها PII دارند** (شماره‌ی موبایل، ایمیل، محتوای بورد). دسترسی به `S3_BUCKET_BACKUPS`
  همان‌قدر محرمانه است که خودِ دیتابیس؛ اگر سرویس اجازه می‌دهد کلیدِ **فقط-نوشتن** برای
  کانتینرِ `backup` بگیر (M5-D7).
- `/metrics` هیچ توکنی ندارد و **نباید** بیرون برود — nginx نمی‌بَردش و پورتِ هاست ندارد.
  از داخلِ شبکه‌ی compose: `$C exec web wget -qO- http://api:3002/metrics`.

---

## ۸. آنچه این runbook هنوز ندارد (⏳ صادقانه)

| چه | وضعیت |
|---|---|
| **اجرای واقعی روی VMِ آروان** | هیچ‌کدام از بخش‌های ۱ تا ۴ هنوز روی VM اجرا نشده. روی همین ماشین اثبات شده: بوتِ استک (`staging`؛ `production` فقط تا گاردها)، اثبات‌های روزِ صفر جز ۴ (پیامک روی گوشیِ واقعی، جدا)، backup → drill → جابه‌جاییِ نام. ⏳ **اثبات‌نشده:** `infra:ship --to=` روی sshِ واقعی (خودآزمونش مبدأ=مقصد بود) و `probe-vm.sh` از داخلِ ایران. اولین استقرارِ واقعی این فایل را بازنویسی می‌کند |
| بازیابیِ Object Storage | اسکریپت ندارد (بخشِ ۴) — M6 |
| نودِ دوم | پیش‌نیازها در README؛ رویه ندارد چون تریگرش نرسیده |
| هشدارِ خودکار (alerting) | `/metrics` هست، ولی هیچ‌چیز آن را نمی‌خواند — Prometheus/Grafana عمداً بیرونِ M5 ([ADR-061](../ARCHITECTURE_DECISIONS.md#adr-061)). تا آن روز: بخشِ ۵ را دستی، و فایلِ `FAILED`ِ §۶ |
| `/readyz` که Object Storage و Redis را نمی‌بیند | طراحیِ فاز ۵: readyz فقط دیتابیس. با S3ِ قطع بوردِ فشرده‌شده باز نمی‌شود و با Redisِ قطع هیچ‌چیز ذخیره نمی‌شود، ولی هر دو ۲۰۰ می‌دهند — ردیف‌هایشان در §۵ |
| ری‌استارتِ خودکارِ سرویسِ `(unhealthy)` | Compose ندارد؛ autoheal یک ایمیجِ دیگر از رجیستری است (ADR-063) — تصمیم برای روزی که یک بار واقعاً لازم شد |
