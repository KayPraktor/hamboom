# TODO-M6-admin.md — ماژول M6: `admin` (پنلِ ادمین + سه ارثیه‌ی M5)

> **وضعیت (۱۴۰۵/۰۶/۲۱): فاز ۰ ✅ · فاز ۱ ✅ · فاز ۲ (دوامِ داده) ✅ تمام شدند.** گپِ بازیابیِ Object
> Storageِ M5 بسته شد: پورتِ افزایشی (ADR-069)، آینه با sha256، `infra:restore-storage` با ۶ چک،
> چکِ ششمِ مشق، `backup-all`، جاروبِ صفحه‌بندی‌شده، گیتِ depsِ بازگشتی و خودآزمون از **داخلِ ایمیج** —
> همه روی سرویس‌های زنده و از ایمیجِ واقعی اجرا شدند. ⚠️ **۱٫۰ همچنان قرمز** (کلیدِ sms.ir در `.env`).
> ✅ **فاز ۲ تایید شد (۱۴۰۵/۰۶/۲۱).** ✅ **فاز ۳ (اسکلتِ پنل و گیتِ staff) تمام شد (۱۴۰۵/۰۶/۲۱)** — `/admin` پشتِ
> nginx با ناحیه‌ی `hb_admin` در **همان** بلوک، `requireStaff`/`requireStepUp`، step-up روی storeِ جدای OTP، `internal`
> در OpenAPI با سه شکستنِ عمدی، `admin-grant-staff` (اتمیک با audit، از داخلِ ایمیج)، `/panel`ِ lazy (+۷۲۳ B روی ورودی)،
> و **گیتِ ۱۶** در verify. همه روی استکِ واقعی پشتِ nginx (۴۰۱/۴۰۳/۴۰۳/۲۰۰، step-up، ۴۲۹ی لبه) اثبات شد.
> ✅ **فاز ۳ تایید شد (۱۴۰۵/۰۶/۲۶).** ✅ **فاز ۴ (`audit_logs`) تمام شد (۱۴۰۵/۰۶/۲۶)** — نویسنده در همان تراکنش، خواننده با
> keyset و IPِ ماسک (DTO تاییدِ D12)، نگهداشتِ ۳۶۵ روزه بدونِ پیش‌فرض؛ `sdk:contract` ۲۵/۲۵، `/panel/audit` در مرورگر با
> «بیشتر» و فیلتر. ✅ **فاز ۴ تایید شد (۱۴۰۵/۰۶/۲۷).** ✅ **فاز ۵ (کاربران و تیم‌ها) تمام و تایید شد (۱۴۰۵/۰۶/۲۷)** —
> staff ⇒ viewer، تعلیقِ D4-الف (یک تراکنش، اولین ۴۲۸ روی استکِ واقعی)، نمای پشتیبانی، جست‌وجوی POSTِ ممیزی‌شده؛ سنجه‌ی
> `admin:access` ۸/۸ و `sdk:contract` ۳۵/۳۵؛ بازبینیِ خصمانه‌ی ۵٫۵: ۱۴ یافته، ۷ رفع، ۳ محدودیتِ ثبت‌شده.
> ✅ **فاز ۶ (پرداخت‌ها و مدلِ استرداد) تمام و تایید شد (۱۴۰۵/۰۷/۰۲) — ۶٫۱ تا ۶٫۵:** migrationِ `0009`، `refundPayment(tx)`،
> انقضای مشروط با **verifyِ تازه**، sweepِ دستی، پنلِ `/panel/payments`، و بازبینیِ خصمانه‌ی جدا (**۱۰ یافته، ۸ رفع**).
> `sdk:contract` **۴۳/۴۳** · `billing:refund` **۱۱/۱۱** · `billing:settle` **۱۱/۱۱** · `probe-reconcile` **۱۰/۱۰** ·
> `billing:quota` ۶/۶ · `db:fk-test` سبز · verify ۱۶ گیت سبز.
> ✅ **فاز ۷ (آمار و وضعیتِ سیستم) تمام شد (۱۴۰۵/۰۷/۰۳) — ۷٫۰ تا ۷٫۵:** `last_seen_at` در ورود و refresh (گلو در
> خودِ `WHERE`، **بیرونِ** تراکنشِ `FOR SHARE` — داخلش روی PG `40P01 deadlock` داد) · `GET /admin/stats` با SQLِ
> خالص و سطلِ **روزِ تهران** · نمودارِ SVGِ خانگی (صفر dep، ورودی **+۵۱۴ B**) · `GET /admin/system` با ۸ چکِ
> موازی (Redis با `node:net`، باکت‌ها با `iteratePrefix`) · نمای فقط‌خواندنیِ پرچم‌ها.
> `sdk:contract` **۴۹/۴۹** · verify ۱۶ گیت سبز. ★ یک **باگِ ۴۲۸ی حلقه‌ای** در `stepUpFresh` پیدا و رفع شد، و
> **سه سبزِ دروغین در گیت‌های خودم** با شکستنِ عمدی گرفته شد (جدول در [PROGRESS](PROGRESS-M6-admin.md)).
> ✅ **تایید شد (۱۴۰۵/۰۷/۰۳)**؛ ⏭ قدمِ بعد فاز ۸ (E2E و سخت‌سازی) — هنوز شروع نشده.
>
> **نقطه‌ی ورود:** [`docs/m6-handoff.md`](docs/m6-handoff.md) — سندِ تحویلِ M5 به M6 (هفت چیزِ
> بی‌صدا‌شکننده، گپِ بازیابیِ Object Storage، تصمیم‌های باز).
>
> **قبل از شروع بخوان:** [PLAN.md](PLAN.md) §M6 و §۵٫۲ (`/admin/*`) و §۶ (`audit_logs`,
> `feature_flags`, `users.status`) · [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) —
> به‌ویژه **ADR-012** (نقشِ محاسبه‌شده — که ADR-066 بخشِ staffش را جایگزین می‌کند)، **ADR-031**
> (dev-only در production بالا نمی‌آید)، **ADR-038** (رفتارِ رفرشِ توکن روی WS)، **ADR-050/055/056**
> (یک مسیرِ فعال‌سازی، نردبانِ آشتی‌دهی)، **ADR-061** (`/metrics` عمومی نیست)، **ADR-013** (پورتِ
> storage)، و **ADR-065…069** (همین ماژول) · [`infra/RUNBOOK.md`](infra/RUNBOOK.md).
>
> **ماژول‌های تمام‌شده:** [TODO-M1](TODO-M1-canvas-core.md) · [TODO.md](TODO.md) (M2) ·
> [TODO-M3](TODO-M3-backend-api.md) · [TODO-M4](TODO-M4-billing.md) · [TODO-M5](TODO-M5-infra.md).
> **این فایل فقط M6 است.**

---

## دامنه‌ی M6

**داخل:** پنلِ ادمین **داخلِ `apps/web`** (زیرشاخه‌ی lazy در `/panel`) + `apps/api/src/routes/admin/*`
زیرِ پیشوندِ `/admin` · گیتِ staff + step-up · **اولین نویسنده‌ی `audit_logs`** + نگهداشتش · **تعلیقِ
واقعی** · نمای پشتیبانیِ فقط‌خواندنی · اشکال‌زداییِ پرداخت (verifyِ دستی، sweepِ دستی، انقضای مشروط،
فرزندخواندگی، **مدلِ استرداد** + mock + ثبتِ دستی) · آمارِ محصول (SQL) · وضعیتِ سیستم (نقاطِ کورِ
`/readyz`) · **بازیابیِ Object Storage** + پورتِ stream/pagination + چکِ بایت در مشق + صفحه‌بندیِ sweep.

⛔ **بیرون:**

| مورد | چرا | کجا |
|---|---|---|
| کتابخانه‌ی قالب | `templates` صفر ردیف، صفر کد — مدیریتِ هیچ (D10) | با فاز ۱۰ی M3 |
| استرداد/reverseِ **واقعیِ** زرین‌پال | GraphQL+OAuth روی میزبانِ نو (P2 ⇒ ADR) / whitelistِ IP؛ در dev اثبات‌ناپذیر = «قابلیتِ به‌زودی» ([ADR-049](ARCHITECTURE_DECISIONS.md#adr-049)) | با حسابِ واقعی؛ الگوی `listUnverified` |
| **حذفِ حساب** (نرم یا سخت) | FKهای RESTRICT (پرداخت، فاکتور، auditِ آینده)؛ purge فقط boards/files را می‌بیند (handoff #۷) | فقط **تعلیق** در M6؛ حذف = ADRِ جدا |
| `RT_CLUSTER=false` · تاخیرِ حذف در compactor · بستنِ WS از سمتِ سرور روی تعلیق | M2، ADRِ جدا | ثبت به‌عنوانِ تصمیمِ باز (ADR-066 §⏳، ADR-069) |
| feature flags (CRUD + ارزیاب) | صفر مصرف‌کننده — ارزیابِ بی‌خواننده = `usage_counters` دوباره (D7) | اولین مصرف‌کننده‌ی واقعی |
| نودِ دوم · Prometheus/Grafana · `apps/worker` · فاکتورِ PDF · CSPِ اجباری · نمای per-boardِ زنده | همان دلایلِ M5 / قاعده‌ی عمدیِ metrics | تریگرها |

---

## ✅ دوازده تصمیمِ مرزی — تایید شد (۱۴۰۵/۰۶/۲۱)

| # | تصمیم | نتیجه |
|---|---|---|
| **M6-D1** | جای پنل | داخلِ `apps/web`، lazy در `/panel`؛ API زیرِ `/admin` → [ADR-065](ARCHITECTURE_DECISIONS.md#adr-065) (انحرافِ ثبت‌شده از PLAN §۲) |
| **M6-D2** | مدلِ staff | `is_staff` می‌مانَد؛ `owner` → **`viewer`** در `effectiveBoardRole`؛ `requireStaff` با لوک‌آپِ DB؛ bootstrap با `admin-grant-staff` → [ADR-066](ARCHITECTURE_DECISIONS.md#adr-066) |
| **M6-D2′** | step-up | `POST /admin/step-up/{request,verify}` با `purpose='admin_step_up'` + `users.step_up_verified_at`؛ ⚠️ **per-user** نه per-session → ADR-066 |
| **M6-D3** | impersonation | نمای پشتیبانی با توکنِ خودِ staff؛ هیچ توکنی برای هدف؛ بورد با نقشِ viewer + audit `support.board.view` → ADR-066 |
| **M6-D4** | تعلیق | **(الف)**: OTP ۲۰۰ی بی‌صدا · refresh `401 USER_SUSPENDED` + clearCookie · سوزاندنِ خانواده‌ها · `isSuspended`⇒null · **WSِ باز تا reconnect می‌مانَد — مستند و سنجیده**. (ب) = گزینه‌ی بازِ M2 → ADR-066 |
| **M6-D5** | `audit_logs` | `recordAudit(tx, …)` در همان تراکنش؛ گیتِ ۱۶؛ `ip` ذخیره/ماسک/بدونِ pino؛ `AUDIT_RETENTION_DAYS` بدونِ پیش‌فرض → [ADR-067](ARCHITECTURE_DECISIONS.md#adr-067) |
| **M6-D6** | استرداد | مدل در `0009` + `refundPayment(tx)`؛ Mock refund/reverse؛ Zarinpal refund ⇒ `REFUND_UNAVAILABLE`؛ ثبتِ دستی تنها مسیرِ اجرایی → [ADR-068](ARCHITECTURE_DECISIONS.md#adr-068) |
| **M6-D7** | feature flags | موکول؛ فقط نمای فقط‌خواندنی |
| **M6-D8** | آمار و وضعیتِ سیستم | فقط SQL با `::bigint`؛ `last_seen_at` در refresh؛ SVGِ خانگی؛ `GET /admin/system` (DB · S3 ×۳ · Redis PING با `node:net` · سنِ پشتیبان · reconcile) → ADR-067 |
| **M6-D9** | سندِ `/admin` | پرچمِ `internal` + `INTERNAL_SCHEMAS` + سه خودآزمون → ADR-067 |
| **M6-D10** | قالب‌ها | بیرون |
| **M6-D11** | پورتِ `ObjectStore` | افزایشی: `getObjectStream`, `putObjectStream({contentLength})`, `iteratePrefix`, `copyObject` → [ADR-069](ARCHITECTURE_DECISIONS.md#adr-069) |
| **M6-D12** | shared-types | ✅ **تایید و نوشته شد (۱۴۰۵/۰۶/۲۱):** [`admin.ts`](packages/shared-types/src/api/admin.ts) (`adminMe`, `stepUpVerifyRequest`) · `User.isStaff` (+ `USER_COLUMNS`/`toUser` در api؛ `sdk:contract` ۱۶/۱۶) · چهار کدِ خطا به انتهای `apiErrorCodes` · `docs/openapi.json` بازتولید. DTOی هر فاز با توقفِ کوتاهِ ثبت‌شده در PROGRESS |

### عددهای سیاستی (تاییدِ مالک ۱۴۰۵/۰۶/۲۱، همراهِ نقشه)

| چه | عدد | کجا می‌نشیند |
|---|---|---|
| `AUDIT_RETENTION_DAYS` | **۳۶۵** | `retentionEnvSchema` — `purge-audit` بدونش بالا نمی‌آید |
| `ADMIN_STEP_UP_SECONDS` | **۶۰۰** | config |
| `hb_admin` (لبه‌ی `/admin`) | **۵ r/s، burst ۲۰** | `zones.conf` + مولدِ `infra-check-proxy` |
| ماسکِ شماره در پنل | پیش‌فرض ماسک؛ «نمایشِ کامل» = عملِ ممیزی‌شده (`user.phone.reveal`) | نما |
| اثرِ استرداد روی اشتراک | لغوِ فوریِ اشتراکِ **همان** پرداخت (`activated_by_payment_id`) | ADR-068 |
| آستانه‌ی «پشتیبانِ کهنه» | **۳۰ ساعت** | `GET /admin/system` |
| ⏳ نگهداشتِ آینه/مانیفستِ storage و `--prune`ِ dump | **هنوز تصمیمِ مالک نیست** (۱۴ پیش‌فرضِ runbook است، نه سیاست) | `backup-all --prune` |
| ⏳ سه سوالِ زرین‌پال | پرسیده می‌شود وقتی حساب آمد | ورودیِ انقضای مشروطِ ۶٫۳ |

### فایل‌های ماژول‌های دیگر که تاییدِ تک‌تک می‌خواهند (قانونِ ۱ی CLAUDE.md)

| فایل | چه | فاز |
|---|---|---|
| `packages/auth-core/src/roles.ts` | staff→viewer + `isSuspended`⇒null | ۵ |
| `packages/auth-core/src/refresh.ts` | `revokeAllForUser` روی پورت + memory | ۵ |
| ~~`packages/auth-core/src/otp.ts`~~ · `apps/api/src/adapters/otp-store.ts` | پارامترِ `purpose` — ✅ فاز ۳: فقط **adapter** (store به‌ازای هر هدف)؛ پورتِ auth-core دست نخورد | ۳ |
| `packages/board-access-db/src/index.ts` + کوئریِ inlineِ `routes/boards.ts:78-105` | `u.status` در SELECT | ۵ |
| `apps/api/src/adapters/session-store.ts` + `session-store.conformance.ts` | `revokeAllForUser` + سناریوی conformance | ۵ |
| `apps/api/src/routes/auth.ts` | status در OTP/refresh، clearCookie، `last_seen_at` | ۵، ۷ |
| `apps/api/src/services/billing.ts` | `settlePayment(deps, locator, { onSettled?(tx, outcome), callbackPayload? })` + assertِ `gateway ∧ gateway_mode` + `verify_payload`/`callback_payload` + `settleLocked` + **`refundPayment(tx)`** (ADR-068) | ۶ |
| `apps/api/src/routes/billing.ts` | callback: `callbackPayload` + `ok` فقط برای `paid` (یافته‌ی منتقدِ فاز ۶) | ۶ |
| `apps/api/src/services/reconcile.ts` | `actor?` + audit روی expire/adopt در همان تراکنش؛ انقضا = **verifyِ تازه زیرِ قفل** و فقط روی notPaid | ۶ |
| `packages/billing-core/src/{gateway,mock-gateway,zarinpal-gateway,index,gateway.test}.ts` | `refund` با نوعِ درست + `reverse` روی پورت، Mock refund/reverse، Zarinpal refund ⇒ unavailable | ۶ |
| `scripts/billing-probe-settle.ts` (سنجه‌ی M4) | چکِ ۶ از `refundPayment`؛ چکِ نو: دو verifyِ ادمینِ هم‌زمان | ۶ |
| `apps/api/src/app.ts` | ✅ ثبتِ admin، collectorِ `config.audit` (`app.adminRoutes`)، `registerAdminRoutes(deps)` | ۳ |
| `apps/api/src/openapi.ts` + `openapi.test.ts` + `scripts/gen-openapi.ts` | ✅ `internal` + `INTERNAL_SCHEMAS` (+ چکِ لو‌رفتن در `--check`) | ۳ |
| `apps/api/src/dto.ts` · `packages/sdk/src/client.ts` · `packages/config/src/sections.ts` | mapperهای admin · `sdk.admin.*` · env نو | ۳–۷ |
| `apps/api/src/logger.ts` | redactِ ip/phone/ua/email | ۴ |
| `packages/storage/src/*` | متدهای افزایشی | ۲ |
| `scripts/backup-{db,storage,common}.ts`, `restore-drill.ts`, `sweep-orphans*.ts`, `check-workspace-deps.ts`, `infra-check-proxy.ts` | پورتِ نو، چکِ بایت، جفت، صفحه‌بندی، دنبال‌کردنِ importِ نسبی، ادغامِ zone | ۲–۳ |
| `apps/realtime/src/server.ts` + `packages/canvas-sync/src/websocket-transport.ts` | **فقط اگر D4(ب) تایید شد** | — |
| نمای سطلِ `apps/web` | ✅ متنِ «بعد از ۳۰ روز پاک می‌شود» (یک خط، ارثیه‌ی M3) | ۳ |

---

## قوانین اجرای loop (همان انضباطِ M1…M5 + چهار تای مخصوصِ M6)

۱. **مبنای تیک‌زدن و کامیت فقط `pnpm verify` است** ([CLAUDE.md](CLAUDE.md) §«چرا `pnpm verify`»).
۲. **تیک زدن فقط بعد از تحققِ «معیار پذیرش»**. محقق نشد، ننویس انجام شد.
۳. ★ **اول probe، بعد کد** — فاز ۱ کلاً همین است؛ هر ادعای «امروز می‌شکند» پیش از رفع اندازه گرفته می‌شود.
۴. ★★ **یک گیتِ آزموده‌نشده گیت نیست.** هر ادعا با یک **شکستنِ عمدی** قرمز شده باشد، و شکستن چکِ **درستش** را قرمز کند.
۵. ★★ **هر جهشِ ادمین بدونِ ردیفِ audit در همان تراکنش، باگ است** (گیتِ ۳٫۷).
۶. ★★ **فاز ۵ (auth) و فاز ۶ (پول) هر کدام یک بازبینیِ خصمانه‌ی جدا** — درسِ ۲ی M4.
۷. ★ **صفر وابستگیِ نو مگر با ADR.** تنها استثنای ثبت‌شده: `yjs` از `devDependencies` به `dependencies`ِ ریشه (ADR-069). `pnpm license:check --strict` خطِ پایه‌ی فاز ۱ را نگه می‌دارد.
۸. ★ **هر اسکریپتی که داخلِ ایمیج اجرا می‌شود** در `PRODUCTION_SCRIPTS` + کامنتِ `api.Dockerfile` **و** یک اجرای واقعی از ایمیج (درسِ فاز ۲ و ۱۰ی M5).
۹. **P3 نشکند:** هر چیزی که به پنل اضافه می‌شود باید با `docker compose up && pnpm dev` بالا بیاید.
۱۰. **پایان هر session:** [`PROGRESS-M6-admin.md`](PROGRESS-M6-admin.md) با «چه شد / چه تصمیمی گرفتم / قدم بعد».

---

### ✅ فاز ۰ — تصمیم‌های مرزی (بدون کد) — **تمام شد (۱۴۰۵/۰۶/۲۱)**

| # | گام | معیار پذیرش |
|---|---|---|
| ✅ ۰٫۱ | ارائه‌ی M6-D1…D12 با هزینه/جایگزین + عددهای سیاستی | نقشه تایید شد؛ D4 = (الف)؛ عددها همان پیشنهاد؛ نگهداشتِ پشتیبان و سه سوالِ زرین‌پال باز ماندند و **جایشان مشخص شد** |
| ✅ ۰٫۲ | نوشتنِ [ADR-065…069](ARCHITECTURE_DECISIONS.md#adr-065) | پنج ADR — شمارِ کل ۶۴ → **۶۹** |
| ✅ ۰٫۳ | ساختِ این فایل + [`PROGRESS-M6-admin.md`](PROGRESS-M6-admin.md) + پیشنهادِ shared-types (D12) در PROGRESS → توقف → **تایید و اعمال** | سه بند نوشته شد؛ `pnpm verify` ۱۵ گیت سبز · `sdk:contract` ۱۶/۱۶ |

★ **روشِ فاز ۰:** هفت خواننده‌ی موازی روی کدِ واقعی (auth · DB · billing · اسکلتِ api · storage ·
رصدپذیری · ADR/PLAN) + یک بازبینِ خصمانه روی پیش‌نویسِ نقشه — **۱۸ یافته** (۱ بلاک‌کننده) که همه
وارد نقشه شد. جزئیات در PROGRESS.

---

### ✅ فاز ۱ — probe — **تمام شد (۱۴۰۵/۰۶/۲۱)**؛ ⚠️ ۱٫۰ قرمز، بقیه همان که نقشه پیش‌بینی کرده بود

| # | probe | نتیجه‌ی **اندازه‌گیری‌شده** |
|---|---|---|
| ⚠️ ۱٫۰ | hashِ `SMS_IR_API_KEY`ِ `.env` در برابرِ پیشوندِ ۴۰کاراکتریِ لو‌رفته (فیکسچرِ کامیتِ `c2d3c39`) | **MATCH** — `.env`ِ محلی هنوز همان پیشوند را دارد. یا کلید در پنلِ sms.ir باطل شده و `.env` به‌روز نشده (آن‌وقت `sms:probe` می‌افتد)، یا باطل نشده. **مالک تایید کند؛ کلیدِ تازه فقط او در `.env` می‌گذارد.** مقدار هیچ‌جا چاپ نشد |
| ✅ ۱٫۱ | [`admin:probe-access`](scripts/admin-probe-access.ts): staffِ بی‌عضویت روی بوردِ **خصوصیِ** غریبه — api‌ی واقعی (`buildApp` روی DB) + realtime‌ی واقعی | `GET /boards/:id/rt-token` → **۲۰۰، `role=owner`** · realtime نقشِ owner اعلام کرد · update **پذیرفته شد** (`board_updates` ۱ → ۲، بدونِ HB_ERROR). ریسکِ D2 اثبات شد |
| ✅ ۱٫۲ | همان probe: editor با OTP وارد می‌شود، بورد را باز می‌کند، بعد `status='suspended'` | **همه fail-open:** refresh → **۲۰۰ و access-tokenِ نو** · rt-token با توکنِ زنده → **۲۰۰ `role=editor`** · `POST /auth/otp/request` → ۲۰۰ و **چالش ساخته شد** (پیامک فرستاده می‌شد) · سوکتِ از-قبل-باز **هنوز می‌نویسد** (۴ → ۵، سوکت OPEN) · دست‌دادنِ نو با rt-tokenِ قبلی **پذیرفته** شد. واقعیت‌های ۳ و ۳′ اثبات شد |
| ✅ ۱٫۳ | `sum(amount_rial)` از استخرِ api | `typeof === "string"` (`"75990000"`)؛ `count(*)` number؛ `coalesce(sum(..),0)::bigint` → **number**. B-2 زنده است، cast جواب می‌دهد |
| ✅ ۱٫۴ | `React.lazy` روی `/panel`ِ خالی + `vite build` (بعد revert) | chunkِ ورودی **۱٬۷۴۸٬۳۲۴ → ۱٬۷۴۸٬۵۱۳ بایت (+۱۸۹ B**، فقط stubِ import + تعریفِ route) · chunkِ جدا `PanelPage-*.js` ۱۷۲ B · ۱۲۸ → ۱۲۹ chunk. معیارِ ۳٫۶: رشدِ ورودی < ۱KB |
| ✅ ۱٫۵ | شیءِ ۲۰۰MB در MinIO: `getObject`ِ پورت (Buffer) در برابرِ خواندنِ استریمی | **Buffer: `arrayBuffers` +۶۰۰MB (≈۳× شیء، گذرا) و RSS ۲۹۰ → ۹۰۰MB** در ۰٫۷s · **stream: `arrayBuffers` +۱۴٫۵MB** در ۰٫۶s (حافظه‌ی ثابت). عددِ ADR-069 |
| ✅ ۱٫۶ | `license-check --strict` | **۱۰۰۶ پکیج، صفر تخلف** حتی در dev-scope — خطِ پایه‌ی M6 صفر است |
| ✅ ۱٫۷ | `SELECT is_staff, status WHERE id=$1` روی استخرِ گرم، n=۵۰۰ | **p50 ۰٫۴۶ms · p90 ۰٫۶۱ms · p99 ۰٫۸۸ms · max ۱٫۶۶ms** — `requireStaff` per-request ارزان است |
| ✅ ۱٫۸ | `infra:backup` واقعی، بعد مشق با `S3_BUCKET_SNAPSHOTS`/`ASSETS` = باکتِ **ناموجود**؛ ۱۴ ردیفِ `board_snapshots` در DB | **۵/۵ سبز** — مشق هیچ بایتی از snapshots نمی‌خوانَد. نقصِ واقعیت ۱۰ اثبات شد |
| ✅ ۱٫۹ | `covers('/admin/','/admin/users')` · رندر با کلیدِ `/admin` · `nginx -t`ِ واقعی روی خروجی | **`false`** (پیشوندِ مرده ⇒ گیت قرمز) · **۲ بلوکِ `location /admin`** · nginx: **`[emerg] duplicate location "/admin"`، test failed**. هر دو گزینه‌ی ساده می‌شکنند ⇒ ۳٫۱ مولد را ادغام می‌کند |

★ **دو یافته‌ی جانبی:** پاسخِ `GET /boards/:id/rt-token` فقط `token` دارد (نقش فقط داخلِ JWT است) ·
ورودِ OTP برای کاربرِ موجود **تیمِ شخصی** می‌سازد (`teams.owner_user_id` RESTRICT) — هر cleanup/حذفی
اول تیم‌ها را باید ببرد؛ همان دلیلِ «حذفِ حساب بیرون است».

---

### ✅ فاز ۲ — دوامِ داده: بستنِ گپِ M5 — **تمام شد (۱۴۰۵/۰۶/۲۱)**

| # | گام | نتیجه‌ی **اثبات‌شده** |
|---|---|---|
| ✅ ۲٫۱ | [ADR-069](ARCHITECTURE_DECISIONS.md#adr-069): `getObjectStream`/`putObjectStream({contentLength})`/`iteratePrefix` روی پورت، S3 + memory | `storage:smoke` روی MinIO **۱۶/۱۶** (۵MB استریمی بیت‌به‌بیت، طولِ غلط **رد**، `iteratePrefix` = `listPrefix`) · ۸ تستِ واحد · P4/ESLint سبز. ⚠️ ادعای «صفر لمسِ ۵ بدل» **دقیق نبود**: بدلِ خودآزمونِ sweep شیءِ کامل است نه spread ⇒ سه خط گرفت (و ۲٫۶ همان فایل را می‌خواست). `copyObject` **ساخته نشد** — مصرف‌کننده ندارد |
| ✅ ۲٫۲ | [`backup-run.ts`](scripts/backup-run.ts) (بدونِ اثرِ جانبی): آینه‌ی استریمی با hashِ حینِ عبور، `sha256` در مانیفست، skip = هم‌اندازه **و** shaی شناخته، مانیفستِ قدیمی = «نمی‌دانم» ⇒ کپیِ دوباره | [`backup-storage.self-test`](scripts/backup-storage.self-test.ts) **۵/۵** · اجرای واقعی: ۴۲ شیء با مانیفستِ قدیمیِ M5 همه دوباره hash شدند، اجرای دوم **۴۲ skip** |
| ✅ ۲٫۳ | ★★ [`infra:restore-storage`](scripts/restore-storage.ts) + [core](scripts/restore-storage-core.ts): پیش‌فرض باکتِ drill، `--to-live`، `--prefix`, `--database`؛ ۶ چک: `count`·`size`·`integrity`·`catalog`·`opens`(Y.Doc با همان `state_vector` — بازخوانیِ compactor، بدونِ importِ realtime)·`vacuous` | خودآزمون **۷/۷** (۵ شکستنِ عمدی، هرکدام **فقط** چکِ خودش؛ ⚠️ «بریده» فقط `size` را قرمز می‌کند، نه integrity — دقیق‌تر از انتظار) · **اجرای اول روی سرویس‌های زنده دو ردیفِ زباله‌ی دستیِ M3 را گرفت** (`catalog` + `opens`)؛ بعد از حذفشان ۳۰ snapshot + ۱۲ دارایی **۶/۶** |
| ✅ ۲٫۴ | مشق چکِ ششمِ `bytes` گرفت (آینه‌ی پشتیبان، `byte_size`، گاردِ vacuous) | probe ۱٫۸ حالا **قرمز** می‌شود (dumpِ قبل از حذفِ زباله: «۱ از ۱۴ بی‌بایت»)؛ خودآزمون **۶/۶** («آینه یک کلید کم دارد ⇒ فقط bytes»)؛ اجرای واقعی ۶/۶ · CI: مشق **بعد از** `rt:compaction` |
| ✅ ۲٫۵ | [`backup-all.ts`](scripts/backup-all.ts): dump→mirror در یک پروسه، یک stamp، `storageManifestKey` ↔ `pgBackupKey` | اجرای واقعی: `pg/…10-19-04Z.dump ↔ storage/manifest-…10-19-04Z.json`؛ پنجره **کوتاه** شد نه بسته — بستن = تاخیرِ حذف در compactor (M2، تصمیمِ باز) |
| ✅ ۲٫۶ | `planSweep` روی `iteratePrefix`؛ `WARN_OBJECTS` حذف | خودآزمون **۶/۶** با `listPrefix`ی که عمداً **throw** می‌کند (برگشت به فهرستِ کامل قرمز می‌شود)؛ گزارشِ واقعی روی مسیرِ صفحه‌بندی‌شده |
| ✅ ۲٫۷ | `yjs` → `dependencies`ِ ریشه · `PRODUCTION_SCRIPTS` +۶ · کامنتِ Dockerfile · ★ گیتِ deps **بستارِ importهای نسبی** را در برابرِ `dependencies`ِ **صاحبِ** هر فایل می‌سنجد (فایلِ `apps/realtime` در بستار ⇒ قرمز) · `images.yml`: هر دو خودآزمون از **داخلِ ایمیج** · CI بازچینی · compose: `backup-all`, `restore-storage` · RUNBOOK §۴٫۱ + cron · `docs/backup-restore.md` · `infra/README` | deps: ۴ خودآزمونِ نو + شکستنِ عمدیِ واقعی (yjs به dev ⇒ `✖ … restore-storage.self-test.ts`) · **ایمیجِ واقعی ساخته شد** و `backup-all`/`restore-storage`/`restore-drill` از داخلش علیه سرویس‌های زنده **همه سبز**؛ `rt:compaction` و `assets:smoke` بعد از تغییرِ پورت سبز |

⚠️ **باقی‌مانده‌ی ثبت‌شده:** `--to-live` روی داده‌ی واقعی اجرا نشده (منطق همان کپیِ drill است، مقصد فرق دارد) ·
نگهداشتِ آینه/مانیفست عددِ مالک · `copyObject` تا مصرف‌کننده · تاخیرِ حذف در compactor (M2).

---

### ✅ فاز ۳ — اسکلتِ پنل و گیتِ staff — **تمام شد (۱۴۰۵/۰۶/۲۱)**؛ ⏸ منتظرِ تاییدِ مالک

| # | گام | نتیجه‌ی **اثبات‌شده** |
|---|---|---|
| ✅ ۳٫۱ | `/admin` در [`api-prefixes`](apps/web/src/api-prefixes.ts)؛ مولدِ [`infra-check-proxy`](scripts/infra-check-proxy.ts) ناحیه‌ای با کلیدِ **برابرِ** پیشوند را در **همان** بلوک می‌نشاند؛ `hb_admin` ۵r/s رگبار ۲۰ در [`zones.conf`](infra/nginx/zones.conf) | خودآزمون +۲ («دقیقاً یک `location /admin`» و «مولدِ ساده‌لوح دو تا می‌ساخت») · `nginx -t` روی خروجیِ **تولیدشده** با ایمیجِ `nginx:1.27-alpine`: staging/http ✔، production بی‌گواهی **رد** (گاردِ خودمان)، production+گواهی ✔؛ و بلوکِ دومِ عمدی ⇒ `[emerg] duplicate location "/admin"` · روی استکِ واقعی: رگبارِ ۴۰ روی `/admin/me` ⇒ **۲۲ عبور، ۱۸×۴۲۹** (رگبارِ دوم ۴/۳۶)؛ همان رگبار روی `/me` ⇒ ۴۰×۲۰۰ |
| ✅ ۳٫۲ | [`admin-guard.ts`](apps/api/src/admin-guard.ts): `requireStaff` (یک SELECT PK در هر درخواست، fail-closed، ۴۰۳ی یک‌شکل با علت فقط در لاگ) + `requireStepUp` (۴۲۸، per-user) · step-up روی `createPgOtpStore(db, "admin_step_up")` (★ `purpose` روی **store**، نه پورت — auth-core دست‌نخورده) · migration [`0008`](apps/api/migrations/0008_admin_indexes.sql) (`step_up_verified_at` + ایندکس‌های ۴٫۱ — یک‌جا) | **پشتِ nginx (ایمیجِ واقعی، staging):** anon **۴۰۱** · کاربرِ عادی **۴۰۳** · staffِ معلق **۴۰۳** · حذفِ staff **۴۰۳** (لاگ: `not_staff`×۲، `status_suspended`×۱) · staff `/admin/me` **۲۰۰** با همان توکنِ قبل از اعطا · step-up: request ۲۰۰ → کدِ غلط **۴۰۰ OTP_INVALID** → کدِ درست ۲۰۰ با `stepUpVerifiedAt` تازه · ⚠️ **۴۲۸ فقط در تست** (۱۰ تستِ `admin.test.ts` با مسیرِ عمدیِ step-up‌گیت‌شده: null/کهنه ⇒ ۴۲۸، تازه ⇒ ۲۰۰؛ زمانِ آینده ⇒ کهنه) — فاز ۳ عملِ مخربی ندارد؛ **روی استکِ واقعی در ۵٫۲** با اولین مسیرِ مخرب · conformanceِ نو «دو هدف مستقل‌اند» روی memory و **PG** (شکستنِ عمدی: set بی‌purpose ⇒ قرمز) · `sdk:contract` **۲۰/۲۰** (۱۷–۲۰ نو، از جمله «درخواستِ step-up چالشِ ورود را consume نمی‌کند») |
| ✅ ۳٫۳ | [`openapi.ts`](apps/api/src/openapi.ts): `internal` روی `RouteDoc`، `INTERNAL_SCHEMAS`، `routeDrift`/`publicSpecProblems`ِ خالص؛ سه مسیرِ admin مستند و **بیرونِ** سندِ عمومی؛ تگِ admin در `tags` نیست | سه شکستنِ عمدی + یکی اضافه، همه قرمز (`openapi.test.ts` ۱۰ تست): مسیرِ داخلیِ بی‌سند · پرچمِ برداشته‌شده ⇒ `/admin/me` در سندِ عمومی · `AdminMe` لای components · تگِ admin · ★ همان چک روی سندِ **واقعی** داخلِ `gen-openapi --check` (گیتِ `docs (openapi)`) — `docs/openapi.json` بدونِ تغییر |
| ✅ ۳٫۴ | [`admin-grant-staff.ts`](scripts/admin-grant-staff.ts) (`--phone`، `--revoke`, `--self-test`): `FOR UPDATE` + پرچم + ردیفِ audit در **یک** تراکنش؛ سلب `step_up_verified_at` را پاک می‌کند؛ ارقامِ فارسی نرمال | خودآزمون **۶/۶** روی PGِ زنده (rollback): اعطا/تکرارِ بی‌ردیف/★ **شکستِ عمدیِ INSERTِ audit ⇒ پرچم برنمی‌گردد**/سلب · بدونِ `--phone` exit 1 **پیش از خواندنِ env** (از داخلِ ایمیجِ بدونِ `DATABASE_URL` هم) · `PRODUCTION_SCRIPTS`/Dockerfile/compose `grant-staff` · ★ واقعاً با `compose --profile ops run --rm grant-staff` از **ایمیج**: grant → `/admin/me` ۲۰۰ → revoke → ۴۰۳؛ `audit_logs`: `staff.grant`, `staff.revoke` · CI: خودآزمون در `services` + گاردِ `--phone` از داخلِ ایمیج در `images.yml` |
| ✅ ۳٫۵ | `GET /admin/me` (DTOی `adminMe`)، `sdk.admin.{me, stepUp.request, stepUp.verify}`، لینکِ «پنلِ ادمین» در بخشِ «مدیریت»ِ سایدبارِ داشبورد فقط با `User.isStaff` | `sdk:contract` ۲۰/۲۰ · مرورگر: بعد از `admin:grant-staff` و رفرش، لینک هست و `/admin/me` ۲۰۰؛ بعد از `--revoke` و رفرش، لینک نیست و `/panel` به `/dashboard` برمی‌گردد |
| ✅ ۳٫۶ | زیرشاخه‌ی lazy [`/panel`](apps/web/src/panel/) (`PanelLayout` + `PanelHome` از **یک** chunk، `RequireAuth→RequireStaff→Suspense`) + `PanelTable` (مشتقِ `invoice-table`) + step-up در مرورگر · «حذف‌شده — بعد از ۳۰ روز برای همیشه پاک می‌شود» در سطل | chunkِ ورودی **۱٬۷۴۸٬۴۶۹ → ۱٬۷۴۹٬۱۹۲ B (+۷۲۳ B) برای خودِ پنل** (< ۱KB ✔) و +۴۲۶ B برای لینکِ سایدبار و متنِ سطل (مالِ ورودی‌اند)؛ chunkِ پنل ۴٫۴KB · `lint (CSS)`، typecheck، lint سبز · مرورگر: کدِ غلط «کد نادرست است.»، کدِ درست ⇒ «آخرین step-up ۲۱ شهریور ۱۴۰۵، ۱۸:۱۷» بدونِ refetch · ⏳ **صفحه‌بندیِ cursor و تاییدِ مخرب عمداً با اولین مصرف‌کننده** (۴٫۳ و ۵٫۲) — کدِ بی‌مصرف‌کننده = D7 |
| ✅ ۳٫۷ | [`check-admin-audit.ts`](scripts/check-admin-audit.ts) — گیتِ **۱۶** (`admin audit`): collectorِ `onRoute` هر مسیرِ `/admin` را با `config.audit` جمع می‌کند (`app.adminRoutes`)؛ `audited(action)` در [`audit.ts`](apps/api/src/audit.ts) با واژگانِ union | خودآزمون ۵ چک (خالص + `POST /admin/_selftest`ِ عمدی روی اپِ **واقعی**) + چک در یک اجرا · ★ شکستنِ عمدیِ واقعی: `audited()` از `step-up/verify` برداشته شد ⇒ `✖ … POST /admin/step-up/verify` (و اصلاح: خودآزمون `includes` است نه «دقیقاً یکی»، تا چکِ اصلی با نامِ مسیرِ واقعی قرمز شود) · `pnpm verify` **۱۶ گیت سبز** · ⚠️ فاز ۳ فقط **اعلام** را می‌سنجد؛ نوشتنِ ردیف در همان تراکنش = `recordAudit`ِ فاز ۴ |

⚠️ **باقی‌مانده‌ی ثبت‌شده‌ی فاز ۳:** ۴۲۸ روی استکِ واقعی با اولین مسیرِ مخرب (۵٫۲) · `audited()` تا فاز ۴ بی‌پشتوانه است
(step-up/verify هنوز ردیف نمی‌نویسد؛ گیت فقط فراموشی را می‌گیرد) · لینکِ سایدبار تا **رفرش** بعد از اعطا نمی‌آید
(`isStaff` با `/me` می‌آید — گیتِ سرور از همان درخواست اثر می‌کند) · ۱٫۰ (کلیدِ sms.ir) همچنان بی‌پاسخ.

---

### ✅ فاز ۴ — `audit_logs`: نویسنده، خواننده، نگهداشت — **تمام و تایید شد (۱۴۰۵/۰۶/۲۷)**

| # | گام | معیار پذیرش |
|---|---|---|
| ✅ ۴٫۱ | migration **`0008_admin_indexes.sql`** فقط: ایندکس‌های audit (`actor_user_id, created_at`، `created_at`)، trgm روی `users.display_name` و `teams.name`، `payments(team_id, requested_at DESC)`, `payments(ref_id)`, `users.step_up_verified_at` | ★ **در فاز ۳ نوشته شد** (step-up ستونش را لازم داشت؛ ایندکس‌ها یک‌جا تا شماره‌ی `0009`ِ ADR-068 برای استرداد بماند): `db:migrate` روی DBِ موجود ✔، `db:smoke`/`db:fk-test` ✔، migrate در استکِ staging ✔؛ ⛔ ستون‌های استرداد **نه** (۰۰۰۹، فاز ۶) |
| ✅ ۴٫۲ | [`recordAudit(tx, …)`](apps/api/src/audit.ts) — تنها نقطه‌ی نوشتن (INSERT با executorِ داده‌شده، هیچ لاگ، هیچ بلعیدنِ خطا؛ IPِ نامعتبر ⇒ `null` نه شکستِ عمل؛ v4-mapped نرمال) + `auditActor(req)`؛ هر دو مسیرِ step-up حالا در `withTransaction` می‌نویسند (ارسالِ پیامک داخلِ tx: ۱۰s < ۳۰s idle) · `LOG_REDACT_PATHS` +۱۵ مسیر (`ip/phone/user_agent/userAgent/email` × ریشه/`*.`/`*.*.`) | `sdk:contract` **۲۲/۲۲**: ۲۱ = دو ردیفِ `staff.step_up.request` + یک `staff.step_up` با actor/target/**ip** · ۲۲ = `recordAudit` داخلِ تراکنشی که بعدش می‌شکند ⇒ **هیچ ردیفی** (روی PGِ واقعی) · شکستنِ عمدی (برداشتنِ recordAudit از verify) ⇒ ۲۱ قرمز · `logger.test` نشتِ عمدیِ AuditEntry/ردیفِ خام/ریشه: ۷ مقدار، هیچ‌کدام در خروجی — ★ اولین اجرا **قرمز** شد: `{actor:{ip}}` دو سطح تو است و wildcardِ یک‌سطحی نمی‌گرفتش ⇒ `*.*.k` اضافه شد · `audit.test` ۴ |
| ✅ ۴٫۳ | [`services/audit-log.ts`](apps/api/src/services/audit-log.ts): keyset روی `(created_at, id) DESC` (ایندکسِ `0008`)، cursor = base64url(`iso|id`)، `limit+1`، فیلترِ actor/action(پیشوندی، LIKE escape)/target/بازه، `maskIp` (v4 `a.b.x.x`، v6 دو گروه)، cursorِ خراب ⇒ **۴۰۰** نه «از اول» · DTOهای `auditLogEntry`/`auditLogQuery` در shared-types (**تاییدِ D12 ۱۴۰۵/۰۶/۲۶**) · `GET /admin/audit` (internal، `INTERNAL_SCHEMAS` +۲؛ فقط‌خواندنی ⇒ بی‌`audited()`) · `toAuditLogEntry(r, maskIp)` (تنها مسیرِ ردیف→DTO) · `sdk.admin.audit(query)` · [`/panel/audit`](apps/web/src/panel/PanelAudit.tsx) با `useInfiniteQuery` روی `nextCursor` — **اولین مصرف‌کننده‌ی صفحه‌بندیِ cursor** | ۸ تستِ خالص · `sdk:contract` **۲۵/۲۵**: ۲۳ = `auditLogEntry.parse` روی سیم، `ipMasked=127.0.x.x` (نه کامل) · ۲۴ = صفحه‌ی ۲ متفاوت و قدیمی‌تر، آخرش `null` · ۲۵ = پیشوندی `staff.step_up` ⇒ ۳ (request هم می‌گیرد)، cursorِ خراب ⇒ **۴۰۰ VALIDATION_ERROR** · مرورگر: ۳۳ ردیفِ واقعی+seed ⇒ ۲۵ + «بیشتر» ⇒ ۳۳ یکتا و دکمه می‌رود (درخواستِ دوم با `cursor=`)، فیلترِ `staff.revoke` ⇒ ۱۶ (seed پاک شد) · chunkِ ورودی +۷۶۳ B (route + lazy)، chunkِ پنل ۴٫۴ → ۷٫۶KB · `docs/openapi.json` بی‌تغییر (internal) |
| ✅ ۴٫۴ | [`purge-audit.ts`](scripts/purge-audit.ts) + `auditRetentionEnvSchema` (**بدونِ پیش‌فرض**، بخشِ جدا تا `purge-deleted`/backup نشکنند)؛ پیش‌فرض گزارش، `--delete` صریح، `--days=N` overrideِ یک اجرا (نامعتبر ⇒ exit 1، نه بازگشت به سیاست) | خودآزمون **۴/۴** روی PGِ زنده (rollback): بدونِ عدد ⇒ `ConfigError` · مرزِ ۳۶۵: ۴۰۰روزه می‌رود، **مرزی و تازه می‌مانند** (`<`، ثبت‌شده) · idempotent · `PRODUCTION_SCRIPTS`/Dockerfile/compose `purge-audit`/CI/RUNBOOK cron ماهانه/README/`.env*` (۳۶۵) · ⚠️ compose با `:?` **نه**: کلِ استک را بدونِ یک متغیرِ ماهانه می‌انداخت (آزموده) ⇒ `:-` و ConfigErrorِ خودِ اسکریپت (`""` هم رد می‌شود) |

---

### ✅ فاز ۵ — کاربران و تیم‌ها — **تمام و تایید شد (۱۴۰۵/۰۶/۲۷)**

| # | گام | نتیجه‌ی **اثبات‌شده** |
|---|---|---|
| ✅ ۵٫۱ | [`services/admin-users.ts`](apps/api/src/services/admin-users.ts): `classifyQuery` (ارقامِ فارسی/عربی نرمال؛ `09…` پیشوندِ شماره، UUID، متن)، جست‌وجوی کاربر/تیم (trgm + `similarity`، پیشوندِ slug)، جزئیاتِ کاربر (تیم‌ها/نقش/پلن، بوردهای ساخته‌شده، **نشست‌های زنده**)، جزئیاتِ تیم (`TEAM_BILLING_COLUMNS` — ظرفیت با `count(*)`ِ زنده، اعضا با `status`، اشتراکِ زنده) · DTOها (تاییدِ D12 ۱۴۰۵/۰۶/۲۷): `adminUserSummary` (**`phoneMasked`**، بی‌فیلدِ `phone`)، `adminUserDetail`، `adminTeamSummary/Detail`، `adminSearchResult`، `phoneRevealResult`، `suspendRequest`، `adminUserBoard` · مسیرها **`POST /admin/search`** (بدنه، ممیزی‌شده `user.search` بدونِ عبارت — بعد از ۵٫۵)، `GET /admin/users/:id`، `/admin/teams/:id` + `POST …/phone/reveal` (audit `user.phone.reveal`) · `sdk.admin.{search, users.*, teams.get}` · پنل `/panel/users` (عبارت در state، نه URL)، `/panel/users/:id`، `/panel/teams/:id` | ۱۱ تستِ خالص · `sdk:contract` ۲۶–۲۸، ۳۵ (شماره‌ی فارسی = لاتین؛ `phoneMasked=0912***02`، `"phone" in u` **false**؛ reveal ⇒ شماره‌ی کامل + ۱ ردیفِ audit؛ `usage.boards` زنده) · مرورگر: `۰۹۱۲۱` ⇒ ۴ کاربر با شماره‌ی ماسک، صفحه‌ی کاربر، «نمایشِ کامل» ⇒ POST ۲۰۰ و ردیف · روی PGِ dev هر پنج جست‌وجو در **۹۲ms** |
| ✅ ۵٫۲ | ★★ تعلیق: `POST /admin/users/:id/{suspend,unsuspend}` (`requireStepUp` + `FOR UPDATE` + `status` + `revokeAllForUser` + audit با `reason`/`sessionsRevoked` در **یک** تراکنش؛ staff ۴۰۹ CONFLICT، تکراری ۴۰۹ INVALID_TRANSITION) · `SessionStore.revokeAllForUser` (پورت + memory + pg + conformance، **شکستنِ عمدی ⇒ قرمز**) · [`roles.ts`](packages/auth-core/src/roles.ts): `isSuspended` **اجباری** ⇒ `null` مقدم بر همه · [`board-access-db`](packages/board-access-db/src/index.ts) `u.status` (api **و** realtime با یک تغییر) · [`auth.ts`](apps/api/src/routes/auth.ts): OTP ۲۰۰ی بی‌صدا، refresh **۴۰۱ `USER_SUSPENDED`** + clearCookie (پیش از چرخش، مستقل از `revoked_at`) · sdk `onSessionEnded(reason)` · web `status="suspended"` + کارتِ «حساب معلق شده است» · پنل: confirm + دلیل، **۴۲۸ در جا** با `StepUpForm` | ★★ **سنجه‌ی [`admin:access`](scripts/admin-access-gauge.ts) ۸/۸** روی api+realtime‌ی واقعی (probeِ فاز ۱ با انتظارِ برعکس؛ در CI): refresh ۴۰۱ USER_SUSPENDED + کوکی پاک · rt-token ۴۰۳ · OTP ۲۰۰ بی‌چالش · دست‌دادنِ نو **رد** (FORBIDDEN، ۱۰۰۸) · **WSِ باز هنوز می‌نویسد (assertِ محدودیتِ مستند)** — شکستنِ عمدی (staff→owner) ⇒ ۳ قرمز · `sdk:contract` ۳۱–۳۴ (۴۲۸ بدونِ step-up؛ نشستِ زنده ۰، سوخته ≥۱؛ شکستنِ عمدیِ `revokeAllForUser` ⇒ ۳۱ و ۳۴ قرمز؛ شکستنِ `isSuspended` ⇒ ۳۲ قرمز) · ★★ **روی استکِ واقعی پشتِ nginx (ایمیجِ `m6p5`) ۱۱/۱۱**: اولین **۴۲۸** روی استک → step-up → تعلیق ۲۰۰ → refresh ۴۰۱ USER_SUSPENDED → OTP بی‌صدا (لاگِ `otpSuppressed`) → rt-token ۴۰۳ → unsuspend · مرورگر: ۴۲۸ ⇒ فرمِ step-up زیرِ عمل ⇒ تایید ⇒ suspend ۲۰۰ ⇒ «معلق»، نشست‌های زنده ۰؛ کاربرِ معلق بعد از رفرش «حساب معلق شده است» می‌بیند؛ بعد از رفعِ تعلیق کوکی پاک ⇒ `/login` |
| ✅ ۵٫۳ | staff → **viewer** در `effectiveBoardRole` (ADR-066 §۱؛ realtime بی‌لمس، همان تابع) · `support.board.view` وقتی نقش **فقط** از staff می‌آید — در `requireBoardRole` (همه‌ی خواندن‌های REST) + `GET /boards/:id` + rt-token، با de-dupeِ ۱۰ دقیقه (کلاینت هر ۴۵s mint می‌کند) | `admin:access` ۱٫۱a–c: rt-token viewer، realtime viewer، نوشتن **رد** (`board_updates` ۰→۰، `FORBIDDEN`×۲، سوکت باز) · `sdk:contract` ۲۹: `GET /boards/:id` بدونِ rt-token **همان خواندن** ردیف می‌نویسد (★ اول قرمز بود — آن مسیر reader را مستقیم می‌خوانَد؛ رفع شد)، rt-token viewer، PATCH ۴۰۳، دو mintِ بعدی ردیفِ نو نه · `billing:quota` چکِ ۶ سبز · هر ۷ سنجه‌ی rt سبز |
| ✅ ۵٫۴ | `GET /admin/users/:id/boards` (کوئریِ خودِ پنل: سازنده/عضوِ مستقیم/تیمِ `team`-access، بی‌لینک، حذف‌شده‌ها هم؛ نقشِ **خودِ کاربر** با `isSuspended:false`) + «بازکردن (فقط‌خواندنی)» = `/b/:id` با توکنِ خودِ staff | `sdk:contract` ۳۰ (بوردِ خصوصیِ هدف با `role=owner`) · مرورگر: staff بوردِ خصوصیِ کاربر را باز کرد — «**فقط‌خواندنی** · ذخیره شد»، `rt-token` ۲۰۰، ردیفِ `support.board.view` با `{role:viewer, windowMinutes:10}` · ⚠️ «دو تب با دو کاربر» در این مرورگر ممکن نیست (یک cookie jar؛ و «خروج» کوکی را نمی‌بندد — یافته‌ی ۵٫۵) ⇒ طرفِ «می‌بیند/نمی‌نویسد» با کلاینتِ WSِ سنجه اثبات شد، طرفِ رابط با تبِ staff |
| ✅ ۵٫۵ | بازبینیِ خصمانه‌ی جدا (auth): سه یابنده با سه لنز (نشست/احراز · مجوز/ممیزی · داده/PII/رابط) → **۱۴ یافته** (۱۱ یکتا) → ★ ردکننده‌های workflow همه به سقفِ نشست خوردند (۲۸ عامل) ⇒ راستی‌آزمایی **دستی روی کد**، هر یافته با یک چکِ قراردادی یا تست | **۷ رفع شد**: `/auth/otp/verify` بدونِ چکِ status (چالشِ پیش از تعلیق نشست می‌ساخت) ⇒ چکِ `FOR SHARE` در همان تراکنش + تعلیق چالش‌های ورود را مصرف می‌کند (چکِ ۳۲b/c، شکستنِ عمدی ⇒ قرمز) · مسابقه‌ی suspend↔refresh ⇒ چکِ status **داخلِ** تراکنشِ چرخش با `FOR SHARE` · **پیشوندِ شماره** ماسک را رقم‌به‌رقم بازسازی می‌کرد بی‌ردیفِ reveal ⇒ فقط شماره‌ی کامل (چکِ ۲۶) · **شماره‌ی کامل در لاگِ api/nginx و تاریخچه‌ی مرورگر** با `GET ?q=` ⇒ `POST` با بدنه + ممیزیِ `user.search` + سریالایزرِ req بدونِ query string (تستِ نشتِ عمدی؛ روی استک صفر url با `?`) · `sessionsRevoked` ردیف‌های چرخانده را می‌شمرد ⇒ فقط زنده‌ها (conformance) · کشِ تیم بعد از تعلیق کهنه می‌مانْد ⇒ invalidate · `/` و `/login` وضعیتِ `suspended` را anonymous می‌گرفتند ⇒ `SuspendedNotice` در هر سه نقطه · **۳ ثبت شد، رفع نه**: زمانِ پاسخِ OTPِ بی‌صدا (تک‌رقمی ms در برابرِ روند‌سفرِ پیامک) قابلِ تمایز است — ضدِ enumerationِ §۴ «شکل» است نه «زمان» (ADR-066 ⏳) · یک ردیفِ `support.board.view` می‌تواند یک WSِ بازِ چندساعته را بپوشاند (همان گزینه‌ی M2) · ردیفِ support از `board-access.ts`/`assets.ts` بدونِ ip/UA (دو خطِ M3، با تایید) |

⚠️ **باقی‌مانده‌ی ثبت‌شده‌ی فاز ۵:** «خروج»ِ web نشست را در سرور نمی‌بندد (M3، بیرونِ M6) · خطای «بدنه‌ی خالی با content-type json»ِ Fastify به‌جای ۴۰۰، ۵۰۰ی بی‌کد می‌شود (M3 error handler؛ sdk هرگز چنین درخواستی نمی‌فرستد) · سنجه‌های `rt:*` کاربرانِ `seed-member` را پاک نمی‌کنند (۷۴ ردیفِ یتیم در DBِ dev پیدا و پاک شد؛ `cleanupSeed` فقط مالک را می‌بَرد — M2/M3) · پیامِ چکِ ۶ی `billing:quota` هنوز می‌گوید «staff همه‌جا owner» (متنِ M4، رفتار درست) · chunkِ ورودی +۲٬۹۵۳ B (کارتِ معلق و متدهای sdk در ورودی‌اند).

---

### ✅ فاز ۶ — پرداخت‌ها و مدلِ استرداد (کدِ پول ⇒ بازبینیِ خصمانه‌ی جدا) — **تمام و تایید شد (۱۴۰۵/۰۷/۰۲)**

| # | گام | نتیجه‌ی **اثبات‌شده** |
|---|---|---|
| ✅ ۶٫۱ | migration **[`0009_refunds.sql`](apps/api/migrations/0009_refunds.sql)** (ADR-068): ستون‌های استرداد + `payments_refunded_ck`/`payments_refund_full_ck`/`payments_paid_at_ck` + `invoices.refunded_at` و CHECKِ جایگزین (`paid_at` **می‌مانَد**) + `payments_requested_idx` · [`services/admin-payments.ts`](apps/api/src/services/admin-payments.ts) (فهرستِ keyset با فیلترِ team/ref_id(دقیق)/authority(پیشوندی)/status، جزئیات + فاکتور + اشتراکِ `activated_by_payment_id`، `expireBlockedReason`) · DTOها (تاییدِ D12 ۱۴۰۵/۰۷/۰۱): `adminPaymentQuery/Summary/Detail`، `paymentActionResult`، `expireRequest`، `refundRequest` (union)، `refundResult`، `reconcileRequest/Report` + کدِ خطای `REFUND_REJECTED` · `callback_payload`/`verify_payload` **از این فاز واقعاً نوشته می‌شوند** (verdictِ نرمال‌شده، بدونِ کارت) | ۱۱ تستِ خالص · روی PGِ dev (۶۱ پرداخت): دو صفحه‌ی ۵تایی بی‌هم‌پوشانی، فیلترِ تیم ۵۰/۵۰، ref_id دقیق ۱، پیشوندِ authority ۱، `'%'` escape ⇒ ۰، cursorِ خراب ⇒ ۴۰۰ — **۷۲ms**؛ keyset با `enable_seqscan=off` **Index Scan بدونِ Sort** · `sdk:contract` ۳۶–۳۷ (summary بدونِ payload/کارت؛ `verifyPayload.status=paid` و بدونِ `cardHash`) |
| ✅ ۶٫۲ | `POST /admin/payments/:id/verify` = همان `settlePayment` با قلابِ `onSettled(tx, outcome)` **داخلِ همان تراکنش** + `assertGatewayMatches` (`gateway` **و** `gateway_mode`) + step-up؛ ۲۰۰ برای هر outcome · هسته به `settleLocked(tx,…)` جدا شد تا مسیرِ انقضا همان را صدا بزند | `billing:settle` **۱۱/۱۱** با چکِ نو: دو verifyِ **ادمینِ** هم‌زمان (درگاهِ کُند) ⇒ یک اشتراک و **دو** ردیفِ audit (`activated` + `alreadySettled`) · `sdk:contract` ۳۸ (ردیفِ auditِ همان تراکنش) و ۴۱ (ردیفِ درگاه/حالتِ دیگر ⇒ ۴۰۹ CONFLICT) |
| ✅ ۶٫۳ | `POST /admin/payments/:id/expire`: نردبانِ ADR-056 **پله‌ی ۳ کامل** (pending + authority + `failure_code` + سنِ ≥ `expireAfterMs`) زیرِ قفل، بعد **verifyِ تازه** ⇒ paid ⇒ **فعال‌سازی**، notPaid ⇒ `applyExpiry` (ردیف `canceled`، فاکتور `void`، audit)، gatewayError ⇒ هیچ · همین در sweep هم (`expireStalePayment`) · `POST /admin/payments/reconcile` زیرِ همان advisory lock با `batchSize ≤ ۲۵` · expire/adopt در sweep ردیفِ audit با actorِ **سیستم** می‌نویسند | `billing:probe-reconcile` **۱۰/۱۰** · ★★ مرورگر: پرداختِ رهاشده‌ی ۸۰ساعته با `failure_code` ⇒ دکمه فعال ⇒ کلیک ⇒ **«نتیجه: activated»** و اشتراک فعال شد (نه باطل) — همان سناریویی که منتقد گرفته بود · دکمه روی ردیفِ `paid` **غیرفعال با دلیلِ سرور** · sweepِ دستی از پنل: گزارشِ ۰/۰/۰ + ردیفِ `payment.reconcile` |
| ✅ ۶٫۴ | `refundPayment(tx)` **تنها نویسنده‌ی `refunded`**: قفل → assertِ درگاه/حالت → فقط از `paid` → کانال (`manual` = مرجعِ دستی · `gateway` = پورت) → ردیف+فاکتور `refunded` با `paid_at`ِ دست‌نخورده → اشتراکِ هدف `canceled` → **بازگرداندنِ دوره‌ی جایگزین‌شده** (پیوندِ لنگر) · پورتِ `refund`/`reverse` با نوعِ درست؛ Mock هر دو، Zarinpal `unavailable` **بدونِ fetch** | ★★ سنجه‌ی نو [`billing:refund`](scripts/billing-probe-refund.ts) **۱۰/۱۰** · `sdk:contract` ۳۹/۴۰/۴۳ (استردادِ تمدید ⇒ اشتراکِ قبلی برمی‌گردد؛ دوباره ⇒ ۴۰۹ و بدونِ auditِ دوم؛ بدونِ step-up ⇒ ۴۲۸) · مرورگر: ۴۲۸ ⇒ step-up ⇒ استردادِ دستی ⇒ «مسترد»، فاکتور `refunded`، اشتراک `canceled` + اشتراکِ قبلی `active` |
| ✅ ۶٫۵ | بازبینیِ خصمانه‌ی جدا (کدِ پول): **دو** بازبینِ مستقل با دو لنز (سرویس/دیتابیس · مسیر/sdk/رابط) — ۴۱۱k توکن، صفر تکراریِ گیت‌ها | **۱۰ یافته، ۸ رفع، ۲ ثبت‌شده** (جدول پایین) · دو چکِ نو که با شکستنِ عمدی **قرمز** می‌شوند: کوپنِ سقف‌دار (`billing:settle` ۱۱/۱۱) و استردادِ هم‌پوشانِ بازگردانی (`billing:refund` ۱۱/۱۱) · `sdk:contract` ۴۳/۴۳ · verify ۱۶ گیت · مرورگر: `POST /admin/payments/search` بدونِ query string، برچسبِ گزارشِ آزمایشی، دو متنِ تاییدِ متفاوت |

#### ★★ ۶٫۵ — ده یافته‌ی بازبینیِ خصمانه (کدِ پول)

| # | شدت | یافته | چه شد |
|---|---|---|---|
| ۱ | **پول‌سوز** | **شمارنده‌ی کوپن بی‌قید `+1` می‌خورد** حتی وقتی ردیفِ مصرف با `ON CONFLICT DO NOTHING` درج نشده بود ⇒ با `max_redemptions`، تسویه‌ی دوم به `coupons_redemptions_ck` می‌خورد ⇒ **کلِ تراکنش rollback** ⇒ پرداختِ **پرداخت‌شده** `pending` می‌مانْد و هر verifyِ بعدی هم می‌شکست (باگِ M4، بیرونِ دیدِ همه‌ی گیت‌ها چون هیچ سنجه‌ای کوپن نمی‌ساخت) | ✅ افزایش به `RETURNING` گره خورد؛ چکِ نو در `billing:settle` (دو پرداختِ پرداخت‌شده با یک کوپنِ سقف‌دار ⇒ هر دو activated، شمارنده ۱) — با شکستنِ عمدی قرمز شد |
| ۲ | correctness | **بازگردانیِ اشتراک وضعیتِ پرداختِ پشتوانه را بدونِ قفل می‌خواند** (`FOR UPDATE OF s`) ⇒ دو استردادِ هم‌پوشان می‌توانستند یک اشتراکِ **زنده‌ی بی‌پشتوانه** بسازند | ✅ `FOR UPDATE OF s, p`؛ چکِ ۱۱ی `billing:refund` با تاخیرِ واقعی **داخلِ** تراکنشِ رقیب — بدونِ قفل **قرمز** می‌شود |
| ۳ | **پول‌سوز** | **دسته‌ی sweep می‌توانست با ردیف‌های «سمی» برای همیشه پر بماند:** کوئری فقط `gateway` را فیلتر می‌کرد و `assertGatewayMatches`ِ نو روی حالتِ ناهم‌خوان پرتاب می‌کند ⇒ چند ردیفِ به‌جامانده‌ی sandbox بعد از رفتن به production، آشتی‌دهی را از دیدنِ پرداخت‌های واقعی بازمی‌داشت | ✅ فیلترِ `gateway_mode` در کوئریِ sweep + شمارشِ ردیف‌های حالتِ دیگر در `errors` (نامرئی نمی‌شوند). ⏳ باقی‌مانده: ردیفی که به دلیلِ **دیگری** همیشه می‌شکند هنوز یک اسلات می‌گیرد — ستونِ `sweep_attempts` کارِ فاز بعد |
| ۴ | correctness | **مسیرِ ownerِ verify** هر `alreadySettled` را `settled: true` می‌گفت — همان دروغی که فاز ۶ ده خط بالاتر در callback رفع کرده بود | ✅ غیرِ `paid` ⇒ ۴۰۹ `INVALID_TRANSITION` با وضعیتِ واقعی |
| ۵ | design | **فعال‌سازی از مسیرِ sweep هیچ ردیفِ auditی نمی‌گذاشت** (قرینه‌ی گپی که خودم در انقضای دستی گرفتم) | ✅ قلابِ `onSettled` روی `settleOne` و `expireStalePayment`: هر `activated` ردیفِ `payment.verify` با `via` و actorِ staff/سیستم می‌گیرد |
| ۶ | **security** | `GET /admin/payments?refId=…` شماره‌ی پیگیریِ بانکیِ مشتری را در query string و لاگِ nginx می‌نشاند — دقیقاً الگویی که فاز ۵ برای `/admin/search` بسته بود (و کامنتِ خودِ routerِ من خلافش را ادعا می‌کرد) | ✅ **`POST /admin/payments/search`** با بدنه، ممیزی‌شده (`payment.search` — فقط **نوعِ** فیلتر، نه مقدارش). در مرورگر: دو POST، صفر query string در لاگ |
| ۷ | design | سقفِ `batchSize=۲۵` با مهلتِ ۶۰ثانیه‌ای nginx نمی‌خواند (۲۵×۱۵s) | ✅ سقف ۱۰، پیش‌فرض ۵ — و **صادقانه** نوشته شد که حتی این هم تضمین نیست: ۵۰۴ sweep را متوقف نمی‌کند و ردیف‌های audit می‌مانند |
| ۸ | design | «فقط گزارش» همان شمارنده‌های عمل را نشان می‌داد که در dry-run **همیشه صفرند** | ✅ برچسبِ جدا: «گزارشِ آزمایشی (هیچ تغییری داده نشد): N بررسی · M جوان · K یتیم» + فهرستِ هشدارها |
| ۹ | nit | یک متنِ تایید برای هر دو کانالِ استرداد، با واژه‌هایی که جابه‌جاییِ پول را وعده می‌داد | ✅ دو متنِ متفاوت؛ «ثبتِ دستی» صریح می‌گوید پولی جابه‌جا نمی‌کند |
| ۱۰ | correctness | **استرداد کوپن را آزاد نمی‌کند** — مشتریِ مسترد‌شده کوپنش را هم سوزانده | ⏳ **سیاستِ ثبت‌شده، نه باگ**: پیش‌فرضِ تاییدشده «برنمی‌گردد» است؛ حالا در RUNBOOK §۷٫۳ و در `metadata`ی ردیفِ audit دیده می‌شود تا پشتیبانی بداند باید دستی آزاد کند |

★★ **منتقدِ خصمانه روی خودِ طرح** (پیش از کد، یک عامل): ۷ یافته — دو تا طرح را عوض کردند (**انقضای دستی با آستانه‌ی ۲۰ دقیقه‌ی کهنگی** به‌جای سقفِ ۷۲ ساعت ⇒ پولِ کاربرِ کُند پیشِ درگاه می‌مانْد؛ **استردادِ تمدید** باقی‌مانده‌ی دوره‌ی قبلیِ پرداخت‌شده را دور می‌ریخت)، یکی **همان‌جا رفع شد** (cursorِ keyset با `Date`ِ میلی‌ثانیه‌ای ردیفِ هم‌میکروثانیه را گم می‌کرد — در `audit-log.ts`ِ فاز ۴ هم؛ روی PG بازتولید شد: cursorِ قدیمی **۰** از ۲ ردیف، نو ۳/۳)، سه تا وارد طرح شدند (assertِ `gateway_mode`، سقفِ `batchSize`، `REFUND_REJECTED`)، یکی سوالِ سیاستی ماند (کوپن بعد از استرداد برنمی‌گردد).

⚠️ **دو سبزِ دروغین که خودمان گرفتیم:** سنجه‌ی استرداد با برداشتنِ `FOR UPDATE` **سبز مانْد** (چون `settlePayment` زودتر همان ردیف را قفل می‌کند) ⇒ چکِ «دو استردادِ هم‌زمان با تاخیرِ اجباری داخلِ ناحیه‌ی بحرانی» اضافه شد و بدونِ قفل قرمز می‌شود · و مسیرِ انقضا وقتی به **فعال‌سازی** می‌رسید هیچ ردیفِ auditی نمی‌نوشت (یک جهشِ مالی با actorِ نامعلوم) — در مرورگر دیده شد و با ردیفِ `payment.verify` با `via:"expire"` بسته شد.

---

### فاز ۷ — آمار و وضعیتِ سیستم

| # | گام | معیار پذیرش |
|---|---|---|
| ✅ ۷٫۰ | **اندازه‌گیریِ پیش از کد** (۵ خواننده روی کد + ۶ probe روی PG/MinIOِ زنده) | ۷ یافته که نقشه را عوض کردند — جدول در [PROGRESS](PROGRESS-M6-admin.md) |
| ✅ ۷٫۱ | [`touchLastSeen`](apps/api/src/routes/auth.ts) در ورود **و** refresh (D8) — گلو در خودِ `WHERE`، **بیرونِ** تراکنشِ `FOR SHARE` | ✅ حداکثر یک UPDATE هر ۱۵ دقیقه · تستِ واحد با شکستنِ عمدی قرمز شد · `sdk:contract` **۴۴** روی PGِ زنده (می‌نویسد ⇒ گلو نگه می‌دارد ⇒ بعد از کهنگی دوباره می‌نویسد) · ★ probe: همین UPDATE **داخلِ** تراکنش ⇒ `40P01 deadlock detected` |
| ✅ ۷٫۱b | ★★ **باگِ ۴۲۸ی حلقه‌ای** در [`stepUpFresh`](apps/api/src/admin-guard.ts): `age >= 0` هر جلو‌بودنِ ساعتِ PG (اندازه‌گیری: ۰–۲ms) را «کهنه» می‌شمرد ⇒ staff کد را وارد می‌کرد و باز ۴۲۸ می‌گرفت | ✅ رواداریِ `CLOCK_SKEW_TOLERANCE_MS = 2_000`؛ تستِ نو با برگرداندنِ `age >= 0` قرمز شد · دو شکستِ «گذرا»ی `sdk:contract` همین بود؛ حالا سه اجرای پیاپی سبز |
| ✅ ۷٫۲ | [`services/admin-stats.ts`](apps/api/src/services/admin-stats.ts): سه سازنده‌ی کوئریِ **خالص** + `readStats`ِ سه‌کوئریِ موازی؛ سطل = **روزِ تهران** (انحرافِ الف تایید شد)؛ «تیم‌ها به تفکیکِ پلن» از `teams` شروع می‌شود و `subscriptions` را LEFT JOIN می‌کند (وگرنه ۱۸ از ۲۰ تیمِ این ماشین بی‌صدا حذف می‌شدند)؛ سری با `generate_series` **صفر‌پُر** | ✅ **۳۵ms** روی PGِ زنده، هر مقدار `number` · `sdk:contract` **۴۵** (`typeof` روی سطحِ API) + **۴۹** (بوردِ ۱:۰۰ بامدادِ تهران در **آخرین** سطل — با UTC قرمز شد) · شکلِ کوئری در [`admin-stats.test.ts`](apps/api/src/services/admin-stats.test.ts) قفل (برداشتنِ `::bigint` قرمزش می‌کند) |
| ✅ ۷٫۳ | [`BarChart.tsx`](apps/web/src/panel/BarChart.tsx) — ~۹۰ خط SVG، صفر dep، رنگ از توکن‌های `--hb-*` (تمِ تیره مجانی)، tooltip با `<title>`ِ بومی و صفر JS، زمان **از راست به چپ** | ✅ chunkِ ورودی **+۵۱۴ B** (معیار < ۱KB) · chunkِ پنل ۳۱٬۴۹۵ → **۴۲٬۲۹۰** بایت · **صفر** میزبانِ خارجی در chunkِ ساخته‌شده · بدونِ `xmlns` (گیتِ P2) · در مرورگر با خواندنِ `x`ِ هر `rect` اثبات شد |
| ✅ ۷٫۴ | [`services/system-status.ts`](apps/api/src/services/system-status.ts): ۸ چکِ **موازی**، هر کدام با مهلتِ خودش · باکت‌ها با **`iteratePrefix`** نه `headObject` · Redis با RESP PINGِ `node:net` (+TLS برای `rediss:`)، **صفر وابستگیِ نو** · سنِ پشتیبان از مهرِ **داخلِ نامِ** کلید (نه `sort().at(-1)` که «آخرین دیتابیس به ترتیبِ الفبا» می‌دهد) · اختلافِ ساعت · `reconcile` با **سه** معنیِ جدا | ✅ روی استکِ واقعی: db ۴ms · باکت‌ها ۷/۱۰/۱۱ms · Redis ۵ms (PONG) · پشتیبانِ ۲۸۹٫۸ ساعته ⇒ **هشدار** · آشتی‌دهیِ خاموش ⇒ **نامعلوم** · `/readyz` بایت‌به‌بایت همان (چکِ ۴۶) · ۱۷ تستِ واحد، و برگرداندن به `headObject` **دقیقاً همان یک تست** را قرمز کرد |
| ✅ ۷٫۵ | [`services/admin-flags.ts`](apps/api/src/services/admin-flags.ts) + جدول در صفحه‌ی سیستم | ✅ `sdk:contract` **۴۷** (ردیفِ واقعی درج و دیده شد) · جدول امروز **خالی** است و همان نوشته می‌شود — پرچمِ نمایشیِ ساختگی ساخته نشد |

---

### ✅ فاز ۷ — تمام و **تایید شد (۱۴۰۵/۰۷/۰۳)**

### فاز ۸ — E2E و سخت‌سازی

| # | گام | معیار پذیرش |
|---|---|---|
| ۸٫۱ | E2Eِ playwright روی استکِ واقعی: ورودِ staff → جست‌وجو → تعلیق → نمای پشتیبانی → verifyِ دستیِ mock؛ کاربرِ غیرِ staff `/panel` را نمی‌بیند | سبز |
| ۸٫۲ | رگبار روی `/admin` ⇒ ۴۲۹ی nginx؛ هدرِ XFFِ جعلی سطل نمی‌سازد | اعداد |
| ۸٫۳ | P2 روی باندلِ واقعی با chunkِ پنل · `license:check --strict` = همان خطِ پایه‌ی ۱٫۶ | صفر میزبان، صفر depِ نو |
| ۸٫۴ | E2Eِ «چسباندنِ لینکِ ویدیو روی بوم» (ارثیه‌ی handoff §۴) — کدام میزبان‌ها صدا زده می‌شوند | اندازه‌گیری، سند |
| ۸٫۵ | CSP: فقط **اندازه‌گیری** (کدام دایرکتیوها بوم را می‌شکنند) | سند، بدونِ enforce |

---

### فاز ۹ — تحویل

| # | گام | معیار پذیرش |
|---|---|---|
| ۹٫۱ | `docs/admin.md` (واژگانِ audit، step-up، جریان‌ها، محدودیتِ WSِ باز) | — |
| ۹٫۲ | RUNBOOK: grant-staff، تعلیق، restore-storage، backup-all، purge-audit، cronِ جفت | هر دستور یک بار **واقعاً اجرا** شده (درسِ فاز ۱۰ی M5) |
| ۹٫۳ | `docs/m7-handoff.md` (اولین استقرارِ واقعی / launch) + CLAUDE.md + PROGRESS | — |
| ۹٫۴ | بازبینیِ خصمانه‌ی اسناد + گیتِ نهایی: `verify` ۱۶ گیت، ۷ سنجه‌ی realtime، سنجه‌های billing (+`refund`)، مشق ۶ چک، restore-storage، E2E | همه سبز با عدد |

---

## ⚠️ تله‌های محیطی (میراثِ M1…M5، هنوز زنده)

- **رنجِ excludedِ ویندوز بعد از هر ری‌استارت جابه‌جا می‌شود.** پورت‌های امروز: **DB ۵۵۴۴ · api ۳۴۱۰ ·
  Redis ۷۶۰۰ · MinIO ۱۵۹۰۰ · web ۱۵۳۸۰**. `netsh interface ipv4 show excludedportrange protocol=tcp`.
- **`VITE_API_TARGET` باید در `apps/web/.env.local` باشد**، نه `.env`ِ ریشه.
- **فریمِ مختصاتِ کلیکِ Browser pane با ویوپورت یکی نیست** — تبدیل: `x * frameW / innerWidth`؛ screenshot روی
  بومِ excalidraw time-out می‌کند.
- **`node --env-file-if-exists=.env`** الگوی اجرای اسکریپت‌هاست.
- heredocِ bash در این محیط `\\n` را به خطِ نو تبدیل می‌کند — اسکریپتِ ویرایش را با Write بنویس.
- ★ **سقفِ نشستِ Claude:** workflowهای چندعاملی در همین فاز دو بار به سقف خوردند (هر دور ~۲٫۵M توکن).
  خواننده‌های موازی را کوچک و هدفمند نگه دار؛ بازبینیِ خصمانه‌ی **تک‌عاملی** (~۳۴۰k) کافی و ارزان بود.
