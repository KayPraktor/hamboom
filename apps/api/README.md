# `@hamboom/api`

REST APIِ اصلی (Fastify) — auth/user/team/board/folder/asset + `GET /boards/:id/rt-token`،
migrationِ کاملِ schema، و OpenAPI 3.1. ★ منطقِ تازه‌ی زیادی ندارد: `auth-core`/`assets`/`storage`
منطق را پشتِ پورت ساخته‌اند؛ اینجا **DB + HTTP + سیم‌کشی** است.

> برای کار کردن **روی** این اپ [`CLAUDE.md`](CLAUDE.md) را بخوان (خط‌قرمزها، تصمیم‌های فاز ۵). این فایل مرورِ کلی است.

## اجرا

```bash
pnpm db:up && pnpm db:migrate                 # یک رانر: infra/sql سپس apps/api/migrations، گیتِ checksum
APP_ENV=local node --env-file-if-exists=.env apps/api/src/server.ts    # پیش‌فرض روی ۳۰۰۲
# OTPِ dev: MockSms کد را در لاگ چاپ می‌کند؛ یا OTP_DEV_FIXED_CODE=123456 برای کدِ ثابت
```

مصرف‌کننده از راهِ [`@hamboom/sdk`](../../packages/sdk/) با آن حرف می‌زند (نه fetchِ خام). مستندات: `GET /docs` (OpenAPI 3.1).

## سطحِ endpointها (خلاصه)

`POST /auth/otp/{request,verify}` · `POST /auth/refresh` · `GET/PATCH /me` ·
`teams` (+ members/invites/folders) · **`boards`** (list/create/get/patch/delete/restore/duplicate/favorite/
access/members + **`rt-token`** + `snapshot`) · `assets` (presign/commit + `GET /assets/:id → ۳۰۲`).

## خط‌قرمزها (کاملش در CLAUDE.md)

- ★ **P4:** به Object Storage فقط از راهِ [`@hamboom/storage`](../../packages/storage/) — `@aws-sdk/*`ِ خام ممنوع (گیتِ `apiBoundaries`).
- ★ **P5:** پول `BIGINT` ریال — درایورِ pg باید `int8` را **`number`** بدهد نه `string`؛ در **یک** جایِ [`plugins/db.ts`](src/plugins/db.ts) تنظیم و با تست قفل ([ADR-015](../../ARCHITECTURE_DECISIONS.md#adr-015)).
- ★ **P7:** هیچ PII در لاگ — موبایل ماسک، OTP/token هرگز؛ redactorِ pino از `config` (یکی با realtime).
- ★★ **`effectiveBoardRole` fail-closed** و از **`auth-core`** (یک منبع با realtime، ADR-012). `undefined`≠`null`.
- ★ **`process.env` فقط از [`@hamboom/config`](../../packages/config/)** (گیتِ `processEnvDiscipline`).
- ★★ **نوشتنِ چندجدولی همیشه در یک تراکنش** (`withTransaction`) — ساختِ کاربر/تیم/بورد، پذیرشِ دعوت، `rotateSession`، commitِ دارایی. با خودآزمونِ شکستِ وسطِ تراکنش.
- ★ **`Idempotency-Key`** روی نوشتن‌های حساس (پاسخِ ۲xx کش می‌شود؛ تک‌نود/درون‌حافظه فعلاً — M4 که پرداخت آمد باید ماندگار شود).

## دستورات

```bash
pnpm --filter @hamboom/api test         # داخلِ pnpm verify
pnpm --filter @hamboom/api typecheck
pnpm sdk:contract                        # ★ تستِ قراردادیِ sdk↔api روی buildApp()ِ واقعی + DB (بیرونِ verify)
```

> پورتِ DB روی این ماشین **۵۴۳۳** است نه ۵۴۳۲ (PostgreSQL 18 بومی ۵۴۳۲ را گرفته). در `.env`ِ محلی. جزئیات در [CLAUDE.mdِ ریشه](../../CLAUDE.md).

## آنچه اینجا انجام نمی‌شود

JWT/نقش/OTP → [`auth-core`](../../packages/auth-core/) · presign/sniff → [`assets`](../../packages/assets/) ·
دروازه‌ی S3 → [`storage`](../../packages/storage/) · UI → [`apps/web`](../web/) · اتاق/realtime → [`apps/realtime`](../realtime/) ·
پرداخت/قالب/کامنت/خروجی = فاز ۱۰/M4 (جدول‌ها در schema، منطق نه) — [`docs/m4-handoff.md`](../../docs/m4-handoff.md).
