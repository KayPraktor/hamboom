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
   ★ M6 (ADR-066): `BoardAccessInput.isSuspended` **اجباری** است و مقدم بر همه (معلق ⇒ `null`)؛ staff **viewer**
   است نه owner. هر کوئریِ inlineی که ورودیِ این تابع را می‌سازد (`GET /boards`) باید `u.status` را هم بخوانَد —
   فیلدِ اجباری همین را در typecheck می‌گیرد.
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
| `src/routes/` | auth · user · team · folder · board · access · rt-token · asset · billing (M4) · **admin** (M6) | ۵٫۳–۵٫۵ |
| `src/admin-guard.ts` (۷٫۱b) | ⚠️⚠️ `stepUpFresh` رواداریِ `CLOCK_SKEW_TOLERANCE_MS = 2_000` دارد: مهرِ `step_up_verified_at` را **Postgres** می‌زند و تازگی‌اش را **Node** می‌سنجد؛ با `age >= 0`ِ قبلی، جلو‌بودنِ یک میلی‌ثانیه‌ایِ ساعتِ دیتابیس (اندازه‌گیری: ۰–۲ms) step-upِ تازه را «کهنه» می‌کرد و staff در حلقه‌ی ۴۲۸ می‌افتاد | M6 ۷٫۱b |
| `src/admin-guard.ts` · `src/audit.ts` | ★ M6 فاز ۳: `requireStaff` (SELECT PK در هر درخواست، fail-closed) + `requireStepUp` (۴۲۸، per-user) · `audited(action)` = اعلامِ ممیزی برای گیتِ ۱۶ (`app.adminRoutes`)؛ `recordAudit(tx)` تنها نویسنده (فاز ۴) | M6 ۳–۴ |
| `src/services/admin-payments.ts` · `routes/admin.ts` (فاز ۶) | ★★ M6 فاز ۶ (ADR-068): خواندنِ پرداخت‌ها (keyset، فیلترِ team/ref_id/authority/status) + `expireBlockedReason` (نردبانِ ADR-056 **پله‌ی ۳**: ۷۲ ساعت **و** یک پاسخِ درگاه) · `services/billing.ts`: `settleLocked`/`lockPaymentForSettle`/`assertGatewayMatches` (`gateway` **و** `gateway_mode`) + قلابِ `onSettled(tx)` + نوشتنِ `verify_payload`/`callback_payload` + **`refundPayment(tx)`** (تنها نویسنده‌ی `refunded`؛ اشتراکِ هدف `canceled` و دوره‌ی جایگزین‌شده **برمی‌گردد**) · `services/reconcile.ts`: انقضا = **verifyِ تازه زیرِ قفل** (`expireStalePayment`/`applyExpiry`، یک تعریف برای دستی و خودکار) + auditِ expire/adopt با actorِ سیستم | M6 ۶ |
| `src/services/{admin-stats,system-status,admin-flags}.ts` · `routes/admin-stats.ts` (فاز ۷) | ★★ M6 فاز ۷ (M6-D8/ADR-067): **آمارِ محصول فقط با SQLِ خالص** — سه سازنده‌ی کوئریِ خالص، هر تجمیع `::bigint` (B-2: `sum()` روی `bigint` نوعِ `numeric` می‌دهد که استخر کوئرس نمی‌کند)، سطلِ روزانه با `AT TIME ZONE 'Asia/Tehran'` و بازگشت به **لحظه** (نما هیچ ریاضیِ منطقه‌ای نمی‌کند)، سریِ **صفر‌پُر** با `generate_series`، و «تیم‌ها به تفکیکِ پلن» که از `teams` شروع می‌شود نه `subscriptions` · **وضعیتِ سیستم**: ۸ چکِ موازی با مهلتِ per-probe؛ باکت‌ها با `iteratePrefix` (⚠️ `headObject` روی باکتِ **ناموجود** هم `null` می‌دهد ⇒ سبزِ دروغین)، Redis با RESP PINGِ `node:net` (بدونِ وابستگیِ نو؛ `rediss:`/`REDIS_TLS` هم پشتیبانی می‌شود)، سنِ پشتیبان از **مهرِ داخلِ نامِ کلید**، و اختلافِ ساعتِ PG↔api · ⚠️ `/readyz` **دست‌نخورده** می‌مانَد (ADR-067). هر سه مسیر `GET`ِ `staffOnly` و **بدونِ** `audited()` | M6 ۷ |
| `src/routes/auth.ts` (فاز ۷٫۱) | ★★ `touchLastSeen(db, userId)` — گلویِ ۱۵ دقیقه در خودِ `WHERE`، و عمداً **بیرونِ** تراکنشِ چرخش: آن تراکنش روی همین ردیف `FOR SHARE` دارد و یک UPDATE داخلش **ارتقای قفل** است ⇒ روی PGِ زنده `40P01 deadlock detected` برای یکی از دو refreshِ هم‌زمان. خطایش بلعیده و فقط `message` لاگ می‌شود (P7) | M6 ۷ |
| `src/services/admin-users.ts` · `routes/admin.ts` (فاز ۵) | ★★ M6 فاز ۵ (ADR-066): جست‌وجو (**`POST /admin/search`**، ممیزی‌شده `user.search`؛ شماره فقط **کامل** — پیشوند ماسک را بازسازی می‌کرد) و جزئیاتِ کاربر و تیم (کوئری‌های خودِ پنل؛ شماره فقط از `toAdminUserSummary` و **ماسک**)، `phone/reveal` (POST، ممیزی‌شده)، **تعلیق/رفعِ تعلیق** (step-up + `FOR UPDATE` + `revokeAllForUser` + audit در **یک** تراکنش؛ staff ۴۰۹)، `users/:id/boards` (نمای پشتیبانی). `routes/auth.ts`: معلق ⇒ OTP ۲۰۰ی بی‌صدا؛ `otp/verify` و refresh با چکِ status **داخلِ تراکنش** (`FOR SHARE` روی `users` — پشتِ `FOR UPDATE`ِ تعلیق می‌ایستد) ⇒ ۴۰۱ `USER_SUSPENDED` + clearCookie. `logger.ts`: سریالایزرِ `req` بدونِ query string. `services/boards.ts`: `requireBoardRole` روی خواندنِ **staff-only** ردیفِ `support.board.view` می‌نویسد (de-dupe ۱۰ دقیقه) — `GET /boards/:id` و rt-token که reader را مستقیم می‌خوانند همان را صدا می‌زنند | M6 ۵ |

## دستورات

```bash
pnpm --filter @hamboom/api typecheck
pnpm --filter @hamboom/api lint
pnpm --filter @hamboom/api test
# migration (گام ۵٫۱ به بعد): اول infra بعد api، یک رانر
pnpm db:up && pnpm db:migrate    # پورتِ DB روی این ماشین ۵۵۴۴ (CLAUDE.md ریشه)
```

⚠️ **`test` فعلاً `--passWithNoTests` دارد** (گام ۵٫۰ هنوز تستِ خودش را ندارد؛ گیتِ واقعیِ این گام،
خودآزمونِ `apiBoundaries` در `packages/eslint-config/test/` است). **گام ۵٫۱ که اولین تستِ api را
بیاورد، این فلگ برداشته می‌شود** — همان کاری که `storage` در گام ۳٫۱ کرد.

## چیزهایی که اینجا انجام نمی‌شوند

منطقِ JWT/نقش/refresh/OTP (کارِ [`auth-core`](../../packages/auth-core/))؛ presign/sniff/sha256
(کارِ [`assets`](../../packages/assets/))؛ دروازه‌ی S3 (کارِ [`storage`](../../packages/storage/))؛
کلاینتِ typed (کارِ `packages/sdk`، فاز ۶)؛ UI (کارِ `apps/web`، فاز ۸)؛ و منطقِ اتاق/realtime
(فاز ۷ فقط پورت تزریق می‌کند). کامنت/نسخه/قالب/خروجی/پرداخت = فاز ۱۰/M4 (جدول‌ها در schema، منطق نه).
