# CLAUDE.md — `@hamboom/api`

REST APIِ اصلی (Fastify). **بخشِ فاز ۵ ماژول M3 — بزرگ‌ترین و یکپارچه‌سازترین فاز.**
auth/user/team/board/asset + `GET /boards/:id/rt-token`، migrationِ کاملِ schema، و
پیاده‌سازیِ DBِ پورت‌های فاز ۳/۴.

★ **این اپ منطقِ تازه‌ی زیادی ندارد** — `auth-core`/`assets`/`storage` منطق را پشتِ پورت ساخته‌اند؛
اینجا **DB + HTTP + سیم‌کشی** است.

**قبل از کار بخوان:** [PLAN §۴](../../PLAN.md) (env)، [§۵](../../PLAN.md) (قرارداد API)، [§۶](../../PLAN.md)
(schema) · [ARCHITECTURE_DECISIONS.md](../../ARCHITECTURE_DECISIONS.md) — به‌ویژه **ADR-001، ADR-005،
ADR-011، ADR-012، ADR-013، ADR-015، ADR-020، ADR-021، ADR-031، ADR-039** ·
[TODO-M3 §فاز ۵](../../TODO-M3-backend-api.md) · [PROGRESS-M3](../../PROGRESS-M3-backend-api.md).

## خط قرمزها

1. ★ **P4 — به Object Storage فقط از راهِ `@hamboom/storage`.** `@aws-sdk/*`ِ خام ممنوع (گیتِ
   `apiBoundaries`). این اپ پلاگینِ `s3` را روی `createS3ObjectStore` می‌سازد، نه SDK.
2. ★ **P5 — پول `BIGINT` ریال.** درایورِ Postgres باید `int8` را به **`number`** بدهد نه `string` —
   در **یک** جای پلاگینِ db تنظیم و با تست قفل شود ([ADR-015](../../ARCHITECTURE_DECISIONS.md#adr-015)).
3. ★ **P7 — هیچ PII در لاگ.** موبایل ماسک، OTP/token هرگز. redactorِ pino از لیستِ مرکزیِ `config`
   می‌آید (یکی با نسخه‌ی realtime)، نه محلی ([ADR-020](../../ARCHITECTURE_DECISIONS.md#adr-020)).
4. ★★ **`effectiveBoardRole` fail-closed** — و `undefined`≠`null`. api و realtime از **یک** تابعِ
   `auth-core` مصرف می‌کنند ([ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012)). مسیرِ داغِ realtime روی
   هر update این را صدا **نمی‌زند** (نقش در `session.role` کش است)؛ ولی endpointهای REST هر بار می‌سنجند.
5. ★ **`process.env` فقط از `@hamboom/config`** (گیتِ `processEnvDiscipline`). env جدید با schema +
   `.env.example` هم‌زمان اضافه شود.
6. ★ **هرگز `@hamboom/sdk`** — sdk کلاینتِ api است (دورِ باطل). با realtime هم از راهِ `auth-core`، نه import.
7. ★★ **نوشتنِ چندجدولی همیشه در یک تراکنش** (تصمیمِ مالک): ساختِ کاربر/تیم/بورد، پذیرشِ دعوت،
   `rotateSession` (با `SELECT … FOR UPDATE`)، commitِ دارایی. با خودآزمونِ شکستِ وسطِ تراکنش.

## تصمیم‌های قفل‌شده‌ی فاز ۵ (مالک، ۱۴۰۵/۰۵/۲۸)

- **DP-1 (رانرِ migration):** یک رانر، دو پوشه‌ی مرتب — `scripts/migrate.ts` (افزایشی) اول
  `infra/sql/migrations` بعد `apps/api/migrations` را با **یک `schema_migrations`** اجرا می‌کند.
  FK-ALTER در migrationِ دومِ api، بعد از هر دو جدول. (گام ۵٫۱.)
- **دو FKِ ارثی:** `board_updates.board_id`/`board_snapshots.board_id → boards(id)` **`ON DELETE CASCADE`**؛
  `origin_user_id → users(id)` **`ON DELETE SET NULL`**. ⚠️ CASCADE بلابِ S3 را پاک نمی‌کند (جاروبِ M5/worker).
- **DP-5 (`isBoardOwner`):** مالک = `boards.created_by = sub` یا `board_members.role='owner'`.
- **DP-2/DP-3 (آشتیِ schema):** `auth_sessions` یک ستونِ `rotated_at` می‌گیرد (پورتِ reuseِ فاز ۴)؛
  `otp_challenges` phone→`destination`/`purpose='login'`، «آخرین مصرف‌نشده». جزئیات در گام ۵٫۲.
- **DP-4 (`hasValidLink` در بازبینیِ زنده):** به فاز ۵٫۲ (adapterِ `BoardAccessReader`) موکول — گزینه‌ی
  grantِ ماندگار تا پورتِ auth-core دست‌نخورده بماند؛ تصمیمِ نهایی سرِ آن گام با مالک.

## ساختار (از گام ۵٫۱ پر می‌شود)

| مسیر | چیست | گام |
|---|---|---|
| `src/index.ts` | صادرات (فعلاً فقط اسکلت) | ۵٫۰ ✅ |
| `src/app.ts` | `buildApp()`ِ تست‌پذیر (بدونِ `listen`) | ۵٫۱ |
| `src/plugins/` | db (Kysely+pg، int8→number) · redis · s3 · auth-guard · rate-limit · error · request-id | ۵٫۱ |
| `migrations/` | `0001_init.sql` (کلِ schema) + `0002_board_fks.sql` (دو FK) | ۵٫۱ |
| `src/adapters/` | DBِ پورت‌ها: BoardAccessReader · SessionStore · OtpStore · AssetTransport | ۵٫۲ |
| `src/routes/` | auth · user · team · folder · board · access · rt-token · asset | ۵٫۳–۵٫۵ |

## دستورات

```bash
pnpm --filter @hamboom/api typecheck
pnpm --filter @hamboom/api lint
pnpm --filter @hamboom/api test
# migration (گام ۵٫۱ به بعد): اول infra بعد api، یک رانر
pnpm db:up && pnpm db:migrate    # پورتِ DB روی این ماشین ۵۴۳۳ (CLAUDE.md ریشه)
```

⚠️ **`test` فعلاً `--passWithNoTests` دارد** (گام ۵٫۰ هنوز تستِ خودش را ندارد؛ گیتِ واقعیِ این گام،
خودآزمونِ `apiBoundaries` در `packages/eslint-config/test/` است). **گام ۵٫۱ که اولین تستِ api را
بیاورد، این فلگ برداشته می‌شود** — همان کاری که `storage` در گام ۳٫۱ کرد.

## چیزهایی که اینجا انجام نمی‌شوند

منطقِ JWT/نقش/refresh/OTP (کارِ [`auth-core`](../../packages/auth-core/))؛ presign/sniff/sha256
(کارِ [`assets`](../../packages/assets/))؛ دروازه‌ی S3 (کارِ [`storage`](../../packages/storage/))؛
کلاینتِ typed (کارِ `packages/sdk`، فاز ۶)؛ UI (کارِ `apps/web`، فاز ۸)؛ و منطقِ اتاق/realtime
(فاز ۷ فقط پورت تزریق می‌کند). کامنت/نسخه/قالب/خروجی/پرداخت = فاز ۱۰/M4 (جدول‌ها در schema، منطق نه).
