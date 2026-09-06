# `@hamboom/api`

REST APIِ اصلی (Fastify) — auth/user/team/board/folder/asset + `GET /boards/:id/rt-token`،
migrationِ کاملِ schema، و OpenAPI 3.1. ★ منطقِ تازه‌ی زیادی ندارد: `auth-core`/`assets`/`storage`
منطق را پشتِ پورت ساخته‌اند؛ اینجا **DB + HTTP + سیم‌کشی** است.

> برای کار کردن **روی** این اپ [`CLAUDE.md`](CLAUDE.md) را بخوان (خط‌قرمزها، تصمیم‌های فاز ۵). این فایل مرورِ کلی است.

## اجرا

```bash
pnpm db:up && pnpm db:migrate                 # یک رانر: infra/sql سپس apps/api/migrations، گیتِ checksum
APP_ENV=local node --env-file-if-exists=.env apps/api/src/server.ts    # PORT از config (روی این ماشین ۳۴۱۰)
# OTPِ dev: MockSms کد را در لاگ چاپ می‌کند؛ یا OTP_DEV_FIXED_CODE=123456 برای کدِ ثابت
```

مصرف‌کننده از راهِ [`@hamboom/sdk`](../../packages/sdk/) با آن حرف می‌زند (نه fetchِ خام). مستندات: `GET /docs` (OpenAPI 3.1).

## سطحِ endpointها (خلاصه)

`POST /auth/otp/{request,verify}` · `POST /auth/refresh` · `GET/PATCH /me` ·
`teams` (+ members/invites/folders) · **`boards`** (list/create/get/patch/delete/restore/duplicate/favorite/
access/members + **`rt-token`** + `snapshot`) · `assets` (presign/commit + `GET /assets/:id → ۳۰۲`) ·
**`billing`** (پایین).

## ★ پرداخت و اشتراک (M4)

`GET /billing/plans` (**عمومی**) · `POST /teams/:id/billing/checkout` (owner) ·
`GET /billing/zarinpal/callback` (**عمومی**، مقصدِ ریدایرکتِ درگاه) ·
`POST /billing/payments/:id/verify` (owner، بازیابیِ دستی) ·
`GET /teams/:id/billing/{subscription,invoices}` (admin) · `POST /teams/:id/billing/cancel` (owner).

- ★★ **`settlePayment` تنها مسیرِ فعال‌سازیِ اشتراک است** — هم callbackِ مرورگر و هم verifyِ
  دستی و هم آشتی‌دهی از همان رد می‌شوند. دو کپی یعنی دو تعریفِ متفاوت از «یک‌بار»
  ([ADR-050](../../ARCHITECTURE_DECISIONS.md#adr-050)/[ADR-055](../../ARCHITECTURE_DECISIONS.md#adr-055)).
- ★★ **مبلغ هرگز از کلاینت نمی‌آید** ([ADR-014](../../ARCHITECTURE_DECISIONS.md#adr-014)):
  `checkoutBody` هیچ فیلدِ ریالی ندارد و کلِ محاسبه سمتِ سرور است.
- ★★ **به `Status`ِ callback اعتماد نمی‌شود.** حتی روی `NOK` هم verifyِ سرور-به-سرور زده
  می‌شود؛ ممکن است پول capture شده باشد و مرورگر دروغ بگوید.
- ⚠️ **میان‌افزارِ `Idempotency-Key` روی callback اصلاً اجرا نمی‌شود** (غیر-POST و بدونِ auth).
  تنها حفاظ، `SELECT … FOR UPDATE` داخلِ `settlePayment` است — و همان کافی است.
- ★ **گاردِ بوت:** اگر `ZARINPAL_CALLBACK_URL` به مسیرِ **ثبت‌شده** نخورَد، اپ **بالا نمی‌آید**.
  پیش‌فرضِ اولیه یک پیشوندِ `/api/v1` داشت که هیچ‌جا ثبت نمی‌شود ⇒ درگاه کاربر را بعد از
  پرداختِ واقعی به ۴۰۴ می‌فرستاد.
- **آشتی‌دهی** ([ADR-056](../../ARCHITECTURE_DECISIONS.md#adr-056)): `services/reconcile.ts` +
  پلاگینِ بازه‌ای پشتِ `BILLING_RECONCILE_ENABLED` (**پیش‌فرض خاموش**؛ انتخابِ رهبر کارِ M5 است).
  اجرای دستی: `pnpm billing:reconcile`.
- **ظرفیت** ([ADR-053](../../ARCHITECTURE_DECISIONS.md#adr-053)): `assertQuota` با `count(*)`ِ
  **واقعی** و قفلِ ردیفِ تیم. ⚠️ `usage_counters` نه نوشته می‌شود نه خوانده — کشی که drift کند
  در دامنه‌ی پول از نبودش بدتر است.

## خط‌قرمزها (کاملش در CLAUDE.md)

- ★ **P4:** به Object Storage فقط از راهِ [`@hamboom/storage`](../../packages/storage/) — `@aws-sdk/*`ِ خام ممنوع (گیتِ `apiBoundaries`).
- ★ **P5:** پول `BIGINT` ریال — درایورِ pg باید `int8` را **`number`** بدهد نه `string`؛ در **یک** جایِ [`plugins/db.ts`](src/plugins/db.ts) تنظیم و با تست قفل ([ADR-015](../../ARCHITECTURE_DECISIONS.md#adr-015)).
- ★ **P7:** هیچ PII در لاگ — موبایل ماسک، OTP/token هرگز؛ redactorِ pino از `config` (یکی با realtime).
- ★★ **`effectiveBoardRole` fail-closed** و از **`auth-core`** (یک منبع با realtime، ADR-012). `undefined`≠`null`.
- ★ **`process.env` فقط از [`@hamboom/config`](../../packages/config/)** (گیتِ `processEnvDiscipline`).
- ★★ **نوشتنِ چندجدولی همیشه در یک تراکنش** (`withTransaction`) — ساختِ کاربر/تیم/بورد، پذیرشِ دعوت، `rotateSession`، commitِ دارایی. با خودآزمونِ شکستِ وسطِ تراکنش.
- ★ **`Idempotency-Key`** روی نوشتن‌های حساس (پاسخِ ۲xx کش می‌شود؛ تک‌نود/درون‌حافظه). ★★ برای
  **پرداخت** کافی نیست و روی آن تکیه نمی‌شود: کلیدِ checkout در ستونِ یکتای `payments.idempotency_key`
  می‌نشیند (دامنه‌دار به تیم) که از ری‌استارت و نودِ دوم جان به در می‌بَرد.
- ★★ **سقفِ زمانیِ اتصالِ Postgres** ([ADR-057](../../ARCHITECTURE_DECISIONS.md#adr-057)):
  `statement_timeout=15s` و `idle_in_transaction_session_timeout=30s` در `createDbPool`. دومی
  نگهبانِ واقعیِ تراکنشی است که منتظرِ پاسخِ درگاه مانده — `statement_timeout` نشستِ **بی‌کار** را نمی‌بیند.

## دستورات

```bash
pnpm --filter @hamboom/api test         # داخلِ pnpm verify
pnpm --filter @hamboom/api typecheck
pnpm sdk:contract                        # ★ تستِ قراردادیِ sdk↔api روی buildApp()ِ واقعی + DB (بیرونِ verify)
```

> ⚠️ پورت‌های این ماشین: DB **۵۵۴۴**، api **۳۴۱۰** — هر دو به‌خاطرِ رنجِ excludedِ ویندوز جابه‌جا
> شده‌اند و **بعد از هر ری‌استارت می‌توانند دوباره جابه‌جا شوند**. جزئیات در [CLAUDE.mdِ ریشه](../../CLAUDE.md).

## آنچه اینجا انجام نمی‌شود

JWT/نقش/OTP → [`auth-core`](../../packages/auth-core/) · presign/sniff → [`assets`](../../packages/assets/) ·
دروازه‌ی S3 → [`storage`](../../packages/storage/) · UI → [`apps/web`](../web/) · اتاق/realtime → [`apps/realtime`](../realtime/) ·
ریاضیِ پول و پورتِ درگاه → [`billing-core`](../../packages/billing-core/) ·
قالب/کامنت/نسخه/خروجی = فاز ۱۰ی M3 (جدول‌ها در schema، منطق نه) · استردادِ کامل و `reverse` → **M6**.
