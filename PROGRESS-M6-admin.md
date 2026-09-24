# PROGRESS-M6-admin.md — دفترِ کارِ ماژول M6 (`admin`)

> «چه شد / چه تصمیمی گرفتم / قدم بعد» در پایانِ هر session.
> TODO در [`TODO-M6-admin.md`](TODO-M6-admin.md) · نقطه‌ی ورود [`docs/m6-handoff.md`](docs/m6-handoff.md).

---

## ۱۴۰۵/۰۶/۲۱ — فاز ۰: تصمیم‌های مرزی

**چه شد:** نقشه‌ی M6 تایید شد، دوازده تصمیمِ مرزی بسته شد، و پنج ADR نوشته شد (۶۴ → **۶۹**).
صفر خط کد — عمداً، مثلِ فاز ۰ی M4 و M5. ⏸ **متوقف در ۰٫۳:** پیشنهادِ shared-types (پایین) منتظرِ
تاییدِ مالک است؛ فاز ۱ بعد از آن.

### روش: اول کد، بعد نقشه — و یک بازبینِ خصمانه روی خودِ نقشه

هفت خواننده‌ی موازیِ فقط‌خواندنی روی زیرسیستم‌هایی که M6 لمس می‌کند (auth/staff · schema · billing ·
اسکلتِ api و گیت‌ها · storage/backup · رصدپذیری/realtime · ADR/PLAN)، هرکدام با الزامِ «هر ادعا با
file:line». بعد پیش‌نویسِ نقشه نوشته شد و یک بازبینِ **خصمانه‌ی تک‌عاملی** مأمورِ رد کردنش شد:
**۱۸ یافته** (۱ بلاک‌کننده، ۹ اصلی، ۸ جزئی) و ۷ جاافتادگی — همه وارد نقشه شد؛ ۶ ادعا را سعی
کرد رد کند و نتوانست (آن‌ها در ADRها «تایید شد» علامت خورده‌اند).

⚠️ **هزینه‌ی روش:** دو دورِ خواننده‌های موازی هر بار ~۲٫۵M توکن و **دو بار به سقفِ نشست خورد**
(۱۱ از ۱۳ عامل افتادند؛ دورِ دوم ۸ تا). بازبینِ خصمانه‌ی تک‌عاملی ~۳۴۰k بود و بیشترین ارزش را
داشت. ثبت شد در تله‌های محیطیِ TODO: خواننده‌ها را کوچک نگه دار، منتقد را تک‌نفره.

### ★★ دوازده واقعیتی که نقشه را شکل دادند (همه اندازه‌گیری‌شده، در TODO §۰)

مهم‌ترین‌هایشان: **`is_staff` امروز یعنی `owner` روی هر بورد** (`roles.ts:65`) — یعنی «impersonationِ
فقط‌خواندنی»ِ PLAN روی مکانیزمِ فعلی ناممکن است و یک staffِ لو‌رفته نوشتن روی کلِ پلتفرم دارد ·
**`users.status='suspended'` صفر جا enforce می‌شود** (نه OTP، نه refresh، نه reader، نه realtime)
· **`audit_logs`، `feature_flags`، `templates` هر سه جدول دارند و صفر کد** · **استرداد** هیچ
پیاده‌سازی ندارد و `invoices_paid_at_ck` مانعِ چرخشِ وضعیت بدونِ پاک‌کردنِ `paid_at` است ·
**مشقِ بازیابیِ M5 با باکتِ snapshotsِ کاملاً خالی سبز می‌مانَد** (فقط ردیف می‌شمارد) ·
`last_seen_at` هرگز نوشته نمی‌شود ⇒ «کاربرِ فعال» امروز داده ندارد.

### ★★ ادعایی که خودم غلط نوشتم و بازبین گرفت — و نقشه را عوض کرد

پیش‌نویس می‌گفت: «`board-access-db` برای suspended `null` برگرداند ⇒ realtime در HB_AUTH_REFRESHِ
بعدی ≤ ۶۰s قطع می‌کند — بدونِ لمسِ realtime». **غلط بود، سه جا:** سرور روی refreshِ ردشده سوکت
را نمی‌بندد و `session.role` را دست نمی‌زند ([`server.ts:499-515`](apps/realtime/src/server.ts)،
قیدِ ۳ی ADR-038) · هیچ بازسنجیِ دوره‌ایِ exp/نقش ندارد · و کلاینت اگر نتواند توکنِ تازه بگیرد
فقط لاگ می‌کند و حتی دوباره زمان‌بندی نمی‌کند
([`websocket-transport.ts:378-394`](packages/canvas-sync/src/websocket-transport.ts)). پس
تنها اثرِ واقعیِ تعلیق روی realtime «ردِ دست‌دادنِ نو» است. سنجه‌ای که «HB_ERROR رسید» را می‌سنجید
**سبزِ دروغین** می‌شد چون نوشتن ادامه داشت.

**تصمیم (M6-D4، تاییدِ مالک):** گزینه‌ی راست‌گو — تعلیق دست‌دادنِ نو، rt-token، OTP و refresh را
می‌بندد؛ **نشستِ WSِ از-قبل-باز تا reconnect می‌مانَد** و سنجه‌ی ۵٫۲ دقیقاً همین را assert می‌کند.
گزینه‌ی M2 (بستنِ سوکت با `CLOSE_POLICY` وقتی نقش null شد + fatalشدنِ کلاینت) در ADR-066 §⏳
به‌عنوانِ پیشنهادِ جدا ثبت شد.

### هفده یافته‌ی دیگرِ بازبین (خلاصه — هرکدام حالا یک گام یا معیارِ پذیرش دارد)

| # | یافته | کجا رفت |
|---|---|---|
| ۱ | کلیدِ zoneِ `/admin/` در گیتِ پروکسی **هیچ مسیری را نمی‌پوشاند** (`covers` = `prefix + "/"` ⇒ `/admin//`)؛ کلیدِ `/admin` هم دو `location` می‌سازد ⇒ nginx بوت نمی‌شود | ۱٫۹ اندازه می‌گیرد؛ ۳٫۱ مولد را ادغام می‌کند + `nginx -t` |
| ۲ | step-up با `/auth/otp/verify` **خانواده‌ی نشستِ نو** می‌سازد و OtpStore `purpose='login'` را هاردکد کرده و چالشِ ورودِ در جریان را می‌کُشد | D2′: مسیرِ جدا + `purpose` + `step_up_verified_at`؛ **per-user** صریح |
| ۳ | `settlePayment` مالکِ تراکنشِ خودش است ⇒ audit «در همان تراکنش» بدونِ تغییرِ امضا ناممکن؛ و جدولِ لمسِ فایل‌ها ۸ فایل کم داشت | hookِ `onSettled(tx)`؛ جدولِ لمس کامل شد |
| ۴ | گیتِ deps importِ **نسبی** را دنبال نمی‌کند؛ `yjs` devDependency است ⇒ `restore-storage` روی VM سرِ بوت می‌میرد در حالی که CI سبز است (کلاسِ نقصِ فاز ۲ی M5) | ۲٫۷: `yjs`→dependencies، deps بازگشتی، خودآزمون از **داخلِ ایمیج** |
| ۵ | در CI مشق **پیش از** `rt:compaction` می‌دود ⇒ چکِ بایت یا همیشه vacuous یا همیشه قرمز | ۲٫۴: ترتیبِ CI + گاردِ vacuous |
| ۶ | ستون‌های استرداد در همان `0008` ⇒ منجمد پیش از بازبینیِ خصمانه‌ی فاز ۶؛ و CHECKِ نو بدونِ `DROP`ِ قدیمی تناقض دارد | `0009` جدا در فاز ۶ + `DROP CONSTRAINT` |
| ۷ | `apps/api` هیچ Redis client ندارد ⇒ ioredis = وابستگیِ نو؛ و PING از api حالتِ خطرناک (realtime بدونِ صاحب) را نمی‌بیند | RESP PING با `node:net` + سند: فقط «Redis پاسخ می‌دهد»؛ گیجِ «اتاق‌های بی‌صاحب» = پیشنهادِ M2 |
| ۸ | پرچمِ `internal` paths را پنهان می‌کند ولی **`components.schemas` همه‌ی schemaها را لو می‌دهد** | `INTERNAL_SCHEMAS` + خودآزمونِ سوم |
| ۹ | «جفت‌کردنِ dump و mirror» پنجره را **کوتاه** می‌کند، نمی‌بندد؛ و هر دو اسکریپت `await main()` هستند | ۲٫۵ بازنویسی شد: کوتاه‌کردن + آشکارسازی با `catalog`؛ بستنِ کامل = M2 |
| ۱۰ | `/auth/otp/request` عمداً همیشه ۲۰۰ است (ضدِ enumeration)؛ ۴۰۱ِ refresh کوکی را پاک نمی‌کند | D4: ۲۰۰ی بی‌صدا؛ ۴۰۱ + clearCookie |
| ۱۱ | `null`ِ reader یعنی «بورد نیست» — دوپهلو می‌شد | `isSuspended` روی `BoardAccessInput`؛ null در `effectiveBoardRole` |
| ۱۲ | collectorِ `onRoute` فقط `METHOD url` را دارد ⇒ گیتِ audit مکانیزم می‌خواهد | `config.audit` + collector |
| ۱۳ | تاییدِ یک‌جای همه‌ی DTOها = تصویبِ حدسِ فاز ۷ در فاز ۰ | D12: فقط فضای نام + کدها + `User.isStaff` |
| ۱۴ | `ZarinpalGateway.reverse` پشتِ پرچم همان «قابلیتِ به‌زودی»ِ ADR-049 است؛ و «اشتراک canceled» نمی‌گفت **کدام** | فقط Mock؛ هدف = `activated_by_payment_id` |
| ۱۵ | `putObjectStream` بدونِ `ContentLength` با SDK v3 خطا می‌دهد؛ `lib-storage` نیست | طول اجباری در امضا |
| ۱۶ | `admin-grant-staff` و `purge-audit` هم داخلِ ایمیج اجرا می‌شوند | هر دو در `PRODUCTION_SCRIPTS` |
| ۱۷ | `revokeAllForUser` سه پیاده‌سازی + conformance می‌خواهد | ۵٫۲ صریح شد |

**جاافتادگی‌ها که اضافه شدند:** سه سوالِ زرین‌پال در عددهای سیاستی · E2Eِ «چسباندنِ لینکِ ویدیو»
(۸٫۴) · صفحه‌بندیِ `sweep-orphans` (۲٫۶) · **حذفِ حساب صریحاً بیرون** · redactِ pino پیش از اولین
نویسنده · متنِ «۳۰ روز» در سطلِ web (۳٫۶) · هشدارِ «آشتی‌دهی هرگز اجرا نشده» در وضعیتِ سیستم (۷٫۴).

### تصمیم‌هایی که گرفتم (و چرا)

**M6-D2 (staff → viewer) ساده‌ترین رفعِ یک حفره‌ی واقعی بود، نه یک قابلیتِ نو.** یک خط در
`roles.ts`، و چون realtime همان تابع را از auth-core import می‌کند (تایید شد:
`auth-core-authority.ts`)، **صفر لمسِ apps/realtime**. جایگزین‌ها (claimِ `act`، TOTP، سطح‌بندی) هر
کدام قرارداد یا وابستگی می‌آوردند برای چیزی که PLAN فقط «فقط‌خواندنی با ثبت در audit» خواسته.

**M6-D1: فاز ۲ (دوامِ داده) پیش از پنل.** گپِ از‌دست‌رفتنِ داده مستقل از پنل وجود دارد و بدونِ
UI است؛ پنلی که «حذف/تعلیق» می‌دهد وقتی بازیابیِ storage وجود ندارد، ترتیبِ غلط است.

**M6-D7 (flags موکول) خلافِ متنِ PLAN است و آگاهانه.** جدول از M3 هست و صفر مصرف‌کننده؛ ارزیابِ
cache‌دارِ بی‌خواننده همان `usage_counters` است که M5 حذفش کرد.

**M6-D8: `/metrics` خوانده نمی‌شود.** handoff گفته بود «اگر پنل از `/metrics` بخواند M6 اولین
خواننده است و ADR-061 جلو می‌افتد». نه — آمار از SQL می‌آید و ADR-061 دست‌نخورده می‌مانَد؛ وضعیتِ
سیستم هم چیزهایی را می‌سنجد که در `/metrics` نیستند (S3، Redis، سنِ پشتیبان).

### ✅ پیشنهادِ shared-types (M6-D12) — طبقِ ADR-021 و قانونِ ۲ی CLAUDE.md؛ **تایید شد و در ادامه‌ی همین روز نوشته شد** (بخشِ بعد)

سه تغییر، همه **افزودنی** و بدونِ تغییرِ هیچ شکلِ موجود:

**۱. فایلِ نو `packages/shared-types/src/api/admin.ts`** — فعلاً فقط فضای نام و دو نوعی که فاز ۳
لازم دارد؛ شکلِ DTOهای فازهای ۴–۷ (`AuditLogEntry`, `AdminUserSummary`, `AdminTeamSummary`,
`PaymentAdminView`, `AdminStats`, `SystemStatus`) در **همان فاز** با یک توقفِ کوتاهِ ثبت‌شده در
همین فایل می‌آید، پیش از `sdk:contract`ِ همان فاز:

```ts
// packages/shared-types/src/api/admin.ts — M6، ADR-065/066
export const adminMe = z.object({ userId: uuid, isStaff: z.literal(true), stepUpVerifiedAt: isoDateTime.nullable() });
export const stepUpVerifyRequest = z.object({ code: z.string().regex(/^\d{4,8}$/) });
```

**۲. `User.isStaff: z.boolean()`** در `user.ts` (فقط روی `user`، نه `userPublic` — DTOی کامل فقط به
خودِ کاربر می‌رسد: `routes/auth.ts:110`، `routes/me.ts:46,65`؛ تایید شد).

**۳. چهار کدِ خطا، افزوده به **انتهای** `apiErrorCodes`** (قاعده‌ی خودِ فایل):

```ts
  // ── M6 (admin)، فاز ۰ — به انتها، طبقِ قاعده‌ی بالا ──
  "USER_SUSPENDED",      // refresh/ورودِ کاربرِ معلق (ADR-066)
  "STEP_UP_REQUIRED",    // ۴۲۸ — عملِ مخربِ ادمین بدونِ OTPِ تازه (ADR-066)
  "REFUND_UNAVAILABLE",  // کانالِ استردادِ واقعی هنوز نیست (ADR-068)
  "INVALID_TRANSITION",  // چرخشِ وضعیتِ نامجاز روی payment/subscription (ADR-068)
```

⚠️ **هیچ‌کدام تا تاییدِ مالک نوشته نشد** (و بعد از تایید، نوشته شد — پایین). بدونِ ۲ و ۳ فاز ۳ نمی‌تواند بسته شود (لینکِ «پنل»
و کدِ `STEP_UP_REQUIRED`)؛ بدونِ ۱ می‌شود موقتاً با DTOی محلی در api جلو رفت ولی sdk بی‌تایپ می‌مانَد
و قراردادِ «یک zod، سه خروجی» (`schemas.ts:5-8`) می‌شکند — پیشنهاد نمی‌کنم.

### قدم بعد

⏸ **تاییدِ پیشنهادِ shared-types** (سه بندِ بالا). بعدش **فاز ۱ (probe)** — ۱۰ اندازه‌گیری، از جمله
۱٫۰ (کلیدِ sms.ir باطل شده؟) و ۱٫۲ (اثباتِ اینکه تعلیق امروز روی هیچ‌چیز اثر ندارد، **پیش از** رفع).
بازهای بیرونی همان قبلی‌ها: زرین‌پال · قالبِ تولیدیِ sms.ir · `RATE_LIMIT_OTP_MAX` · نگهداشتِ پشتیبان
(`--prune`) · PLAN Q4 · VAT.

---

## ۱۴۰۵/۰۶/۲۱ (ادامه) — بستنِ ۰٫۳ و فاز ۱: probe

**چه شد:** مالک سه بندِ shared-types را تایید کرد و نوشته شد؛ فاز ۱ (ده اندازه‌گیری) تمام شد.
نُه تا همان چیزی را نشان دادند که نقشه از خواندنِ کد پیش‌بینی کرده بود — **ولی این‌بار با عدد، روی
سیمِ واقعی** — و یکی (۱٫۰) قرمز است.

### ✅ ۰٫۳ بسته شد — shared-types (D12)

[`admin.ts`](packages/shared-types/src/api/admin.ts) با دو نوعِ فاز ۳ · `User.isStaff` (و همراهش
`USER_COLUMNS`/`toUser` در `dto.ts`، وگرنه `/me` فیلد را نمی‌داد و `sdk:contract` روی zod می‌افتاد —
۱۶/۱۶ سبز) · چهار کدِ خطا به انتهای `apiErrorCodes` · و چون `User` و `ApiError` هر دو در
`components.schemas`ِ سندِ عمومی‌اند، `pnpm openapi:gen` بازتولید شد (گیتِ `docs` وگرنه قرمز بود).
`pnpm verify` ۱۵ گیت سبز.

⚠️ **یک دروغِ گذرای گیت:** اجرای اول `✖ typecheck (پکیج‌ها)` داد بدونِ هیچ `error TS` و بدونِ خطِ
`Tasks:` — همان نشانه‌ی جدولِ CLAUDE.md (turbo کشته شده، نه task افتاده). اجرای مستقیمِ
`turbo run typecheck --force` ۱۵/۱۵ داد و اجرای دومِ verify سبز شد (`Tasks:` ×۴). ثبت شد، نه حدس.

### ⚠️ ۱٫۰ — کلیدِ sms.ir: `.env` هنوز پیشوندِ لو‌رفته را دارد

مالک گفت «حل شده». اندازه گرفتم (فقط hash، بدونِ چاپِ مقدار): پیشوندِ ۴۰کاراکتریِ فیکسچرِ تاریخی
(`c2d3c39`) با ۴۰ کاراکترِ اولِ `SMS_IR_API_KEY`ِ `.env`ِ محلی **یکی است**. دو تفسیر: (الف) کلید در پنلِ
sms.ir باطل شده و فقط `.env` کهنه است — آن‌وقت `pnpm sms:probe` باید بیفتد؛ (ب) باطل نشده. از این‌جا
قابلِ تشخیص نیست و **هیچ کلیدی را من در فایل نمی‌نویسم**. مالک تایید کند و کلیدِ تازه را در `.env`
بگذارد؛ ۱٫۰ تا آن موقع قرمز می‌مانَد و بلاک‌کننده‌ی فاز ۲ نیست (پیامک در فاز ۲ نقشی ندارد).

### ★★ ۱٫۱ و ۱٫۲ — [`admin:probe-access`](scripts/admin-probe-access.ts): fail-open روی سیمِ واقعی

probe نه mock دارد نه بدل: `buildApp` روی همان DB (با رازِ سنجه تا rt-tokenش را realtime‌ی فرزند
بپذیرد) + `apps/realtime/src/main.ts`ِ واقعی + یک بوردِ **خصوصی**. نتایج:

| | اندازه‌گیری |
|---|---|
| staffِ بی‌عضویت | rt-token **۲۰۰ `role=owner`** · realtime `owner` · update **پذیرفته** (`board_updates` ۱→۲) |
| بعد از `status='suspended'` | refresh **۲۰۰ + access-tokenِ نو** · rt-token **۲۰۰ `editor`** · OTP request **۲۰۰ و چالش ساخته شد** (پیامک می‌رفت) · سوکتِ باز **هنوز می‌نویسد** (۴→۵) · دست‌دادنِ نو با توکنِ قبلی **پذیرفته** |

یعنی هر پنج نقطه‌ای که D4 می‌بندد امروز باز است — و «سوکتِ باز هنوز می‌نویسد» دقیقاً همان
محدودیتی است که D4-الف صادقانه نگه می‌دارد. **همین اسکریپت در فاز ۵ سنجه‌ی `admin:access` می‌شود**
با انتظارهای برعکس؛ الان عمداً probe است (گزارش می‌دهد، exit 0).

⚠️ دو بار افتاد پیش از آنکه درست شود، هر دو تقصیرِ خودِ probe: بدنه‌ی rt-token `role` ندارد (فقط
داخلِ JWT است) · و ورودِ OTP برای کاربرِ موجود **تیمِ شخصی** می‌سازد که `owner_user_id` RESTRICT دارد ⇒
cleanup باید اول تیم را ببرد. ردیف‌های جامانده‌ی دو اجرای افتاده دستی پاک شدند.

### بقیه‌ی اعداد (جدولِ کامل در TODO فاز ۱)

**۱٫۳** `sum(bigint)` رشته، `::bigint` عدد · **۱٫۴** lazy: ورودی +۱۸۹ بایت، chunkِ جدا ۱۷۲ بایت ·
**۱٫۵** ۲۰۰MB: Buffer ≈۳× شیء در `arrayBuffers` (+۶۰۰MB، RSS ۲۹۰→۹۰۰)، stream +۱۴٫۵MB · **۱٫۶** strict:
۱۰۰۶ پکیج، صفر تخلف · **۱٫۷** لوک‌آپِ staff p50 ۰٫۴۶ms / p99 ۰٫۸۸ms · **۱٫۸** مشق با باکتِ ناموجود
۵/۵ سبز با ۱۴ ردیفِ snapshot · **۱٫۹** `/admin/` هیچ مسیری را نمی‌پوشاند، `/admin` دو بلوک، nginx
`duplicate location` (emerg).

★ **۱٫۵ یک ادعای مبهمِ ADR-069 را دقیق کرد:** «کلِ شیء در حافظه» کم‌گویی بود — SDK بدنه را جمع
می‌کند و `transformToByteArray` یک‌بار دیگر کپی می‌کند، پس لحظه‌ای **سه برابرِ** شیء می‌نشیند.

### تصمیم‌هایی که گرفتم

- probeها را **نگه داشتم** فقط وقتی بعداً سنجه می‌شوند (`admin-probe-access`)؛ بقیه (hash، B-2،
  lazy، ۲۰۰MB، nginx) یک‌بارمصرف بودند و بعد از ثبتِ عدد حذف شدند — اسکریپتِ probeِ بی‌مصرف در
  `scripts/` همان `probe/s3-probe.ts`ِ M3 است که هنوز «دورریختنی» مانده.
- ۱٫۸ را با **env-override به باکتِ ناموجود** سنجیدم نه با خالی‌کردنِ باکتِ واقعی: ادعا «مشق بایت
  نمی‌خوانَد» است و این دقیقاً همان را ثابت می‌کند، بدونِ دست‌زدن به داده‌ی dev.

### قدم بعد

⏸ **تاییدِ فاز ۱** و پاسخِ ۱٫۰ (کلیدِ sms.ir). بعدش **فاز ۲ (دوامِ داده)**: ADR-069 روی پورت (۲٫۱)،
مانیفستِ sha (۲٫۲)، `infra:restore-storage` با ۶ چک و ۵ شکستنِ عمدی (۲٫۳)، چکِ بایت در مشق + ترتیبِ
CI (۲٫۴)، `backup-all` (۲٫۵)، صفحه‌بندیِ sweep (۲٫۶)، سیم‌کشی + گیتِ depsِ بازگشتی + خودآزمون از
داخلِ ایمیج (۲٫۷).

---

## ۱۴۰۵/۰۶/۲۱ (ادامه) — فاز ۲: دوامِ داده، بستنِ گپِ M5

**چه شد:** بازیابیِ Object Storage — تنها گپِ داده‌ای که RUNBOOKِ M5 صادقانه ثبت کرده بود — بسته شد،
و همه‌چیز نه فقط با `pnpm` بلکه **از داخلِ ایمیجِ واقعیِ api علیه سرویس‌های زنده** اجرا شد.
`pnpm verify` ۱۵ گیت سبز؛ `rt:compaction` و `assets:smoke` بعد از تغییرِ پورت سبز.

### آنچه ساخته شد

- **پورت** ([ADR-069](ARCHITECTURE_DECISIONS.md#adr-069)): `getObjectStream`، `putObjectStream` با طولِ
  **اجباری**، `iteratePrefix` — در S3 و memory؛ `storage:smoke` روی MinIO ۱۶/۱۶ (۵MB استریمی، طولِ غلط
  توسط انبار **رد**). ⚠️ دو اصلاح روی ADR: «صفر لمسِ پنج بدل» دقیق نبود — بدلِ خودآزمونِ sweep شیءِ کامل
  است و سه خطِ stub گرفت؛ و `copyObject` **ساخته نشد** چون هیچ مصرف‌کننده‌ای نداشت (همان قاعده‌ای که
  flags را موکول کرد).
- **[`backup-run.ts`](scripts/backup-run.ts)** (بدونِ اثرِ جانبی، تله‌ی سومِ «ورودی با `await main()`»):
  آینه‌ی استریمی با hashِ حینِ عبور و `sha256` در مانیفست؛ dumpِ استریمی. `backup-db.ts`/`backup-storage.ts`
  ورودی‌های نازک شدند. **[`backup-all.ts`](scripts/backup-all.ts)**: جفتِ dump↔آینه با یک stamp.
- **[`restore-storage`](scripts/restore-storage.ts)** با ۶ چک و خودآزمونِ ۷ سناریویی، **[چکِ ششمِ
  مشق](scripts/restore-drill.ts)** (`bytes`، با گاردِ vacuous و سناریوی ششم)، sweep روی صفحه‌بندی،
  **گیتِ depsِ بازگشتی**، مرحله‌ی in-imageِ `images.yml`، بازچینیِ CI، دو سرویسِ compose، RUNBOOK §۴٫۱،
  `docs/backup-restore.md`، `infra/README`.

### ★★ اولین اجرای واقعی، مثلِ اولین اجرای sweep در M5، زباله پیدا کرد

`restore-storage` روی سرویس‌های زنده دو چک قرمز داد و هر دو **راست** بودند: یک ردیفِ `board_snapshots`
با کلیدی که در هیچ باکتی بایت نداشت (`catalog`)، و ردیفی که بایتش ۵۹ بایتِ غیرِ Yjs بود (`opens`).
هر دو از ۲۷ مرداد و از یک probeِ دستیِ M3 («board bogus key»/«board with snapshot» — در هیچ کامیتی
نیست). حذف شدند و همه‌چیز سبز شد. ★ و همین دو ردیف نشان دادند که چکِ `bytes`ِ مشق (که فقط وجود و
اندازه را می‌بیند) دومی را **نمی‌گیرد** — چون بایت هست، فقط سند نیست؛ آن کارِ `opens` است. تفکیکِ چک‌ها
عمدی است و هر کدام یک کلاسِ شکست دارد.

### ⚠️ سه انتظارِ خودم که اندازه‌گیری اصلاحشان کرد

۱. خودآزمونِ «آینه‌ی بریده» را با «`size` و `integrity` قرمز» نوشتم؛ واقعی فقط `size` است — putِ طولِ
   ناهم‌خوان همان‌جا رد می‌شود و sha اصلاً محاسبه نمی‌شود. دقیق‌تر از انتظار؛ خودآزمون به همان عوض شد.
۲. اجرای واقعیِ مشق بعد از حذفِ زباله **باز هم قرمز** بود: dumpِ آخر پیش از حذف گرفته شده بود و کاتالوگش
   کلیدِ حذف‌شده را می‌شناخت — یعنی چکِ `bytes` دقیقاً همان کاری را کرد که باید. یک `backup-all`ِ تازه سبزش کرد.
۳. `docker run --env-file .env` کامنتِ انتهای خط را جزوِ مقدار می‌خوانَد (`DATABASE_SSL=false  # …` ⇒
   config قرمز). محیط، نه کد؛ برای اجراهای in-image متغیر صریح داده شد.

### ★ گیتِ deps با شکستنِ عمدیِ **واقعی** آزموده شد

`yjs` را روی درختِ واقعی به `devDependencies` برگرداندم: `✖ اسکریپتِ production به وابستگیِ dev-scope تکیه
دارد: yjs — scripts/restore-storage.self-test.ts`. برگرداندم، سبز. ⊕ چهار خودآزمونِ نو روی فایل‌سیستمِ
ساختگی، از جمله «فایلِ `apps/realtime` در بستار ⇒ قرمز» — چون آن فایل اصلاً در ایمیجِ api نیست.

### تصمیم‌هایی که گرفتم

- **چکِ `bytes`ِ مشق روی آینه‌ی پشتیبان، نه باکتِ زنده:** سوالِ مشق «از پشتیبان به‌تنهایی برمی‌گردد؟» است.
- **vacuous ⇒ قرمز** برای `bytes` (مثلِ `rows`): تا اولین فشرده‌سازی، مشق محتوای هیچ بوردی را اثبات
  نمی‌کند و همین را می‌گوید. روزِ صفرِ production یک هفته قرمزِ صادقانه بهتر از سبزِ بی‌معناست.
- **`opens` بدونِ importِ realtime:** همان بازخوانی‌ای که compactor بعد از put می‌کند (Y.applyUpdate +
  state vector) — پس `yjs` تنها وابستگیِ نو شد (`devDependencies` → `dependencies`؛ MIT).
- **مانیفستِ قدیمیِ M5 در `integrity` قرمز است**، نه سبز — «نمی‌دانم» ابهام است (ADR-056).

### قدم بعد

⏸ **تاییدِ فاز ۲.** بعدش **فاز ۳ (اسکلتِ پنل)**: `/admin` در `api-prefixes` + ادغامِ zone در مولد + `nginx -t`
(۳٫۱)، `requireStaff` + step-up (۳٫۲)، `internal` + `INTERNAL_SCHEMAS` (۳٫۳)، `admin-grant-staff` (۳٫۴)،
`GET /admin/me` + لینکِ پنل (۳٫۵)، زیرشاخه‌ی lazy `/panel` + متنِ «۳۰ روز» (۳٫۶)، گیتِ ۱۶ (۳٫۷).
⚠️ ۱٫۰ (کلیدِ sms.ir در `.env`) همچنان بی‌پاسخ.

### ✅ فاز ۲ تایید شد (۱۴۰۵/۰۶/۲۱) — نقطه‌ی توقف پیش از فشرده‌سازیِ context

اسناد به‌روز است (TODO/PROGRESS/CLAUDE.md/RUNBOOK/backup-restore/infra README/ADR-065…069). **فاز ۳ شروع
نشده.** sessionِ بعدی از این‌جا: [TODO-M6 فاز ۳](TODO-M6-admin.md) (۳٫۱ تا ۳٫۷) با تاییدِ صریحِ مالک؛ پیش از
هر کد `pnpm db:up && pnpm db:migrate` و بعد از هر گام `pnpm verify`. تغییراتِ فازهای ۰–۲ در working tree
هستند (۴۱ فایل) و **کامیت نشده‌اند** — کامیت فقط با درخواستِ مالک.

⚠️ سه چیزِ باز که sessionِ بعد نباید فراموش کند: ۱٫۰ (کلیدِ sms.ir در `.env` هنوز پیشوندِ لو‌رفته) ·
`--prune`/نگهداشتِ آینه عددِ مالک · `--to-live`ِ restore-storage روی داده‌ی واقعی اجرا نشده.

---

## ۱۴۰۵/۰۶/۲۱ (ادامه) — فاز ۳: اسکلتِ پنل و گیتِ staff

**چه شد:** `/admin` حالا یک سطحِ واقعیِ محافظت‌شده است — پشتِ nginx با ناحیه‌ی خودش، با گیتی که هر
درخواست از **دیتابیس** می‌خوانَد، step-upِ per-user روی همان زیرساختِ OTP، و اولین پنلِ lazy در وب. هر ادعا
یا با شکستنِ عمدی قرمز شد یا روی **ایمیجِ واقعی پشتِ nginx** با curl اندازه گرفته شد. `pnpm verify`
**۱۶ گیت** سبز (گیتِ ۱۶ نو)؛ `sdk:contract` ۲۰/۲۰؛ `db:store-test` ۱۳/۱۳؛ `db:smoke`/`db:fk-test` سبز.

### آنچه ساخته شد (جزئیات و اعداد در [TODO فاز ۳](TODO-M6-admin.md))

- **لبه:** `/admin` در `API_PREFIXES`؛ مولدِ nginx ناحیه‌ی هم‌کلید با پیشوند را در **همان** بلوک ادغام
  می‌کند (دو خودآزمونِ نو، `nginx -t` در سه حالت روی خروجیِ تولیدشده، و بلوکِ دومِ عمدی ⇒ `duplicate
  location`). `hb_admin` ۵r/s رگبار ۲۰ — روی استک: رگبارِ ۴۰ ⇒ ۲۲ عبور/۱۸×۴۲۹؛ `/me` ۴۰×۲۰۰.
- **گیت:** [`admin-guard.ts`](apps/api/src/admin-guard.ts) — `requireStaff` (یک SELECT PK؛ نبود/غیرِ
  staff/معلق همه ۴۰۳ی **یک‌شکل**، علت فقط در لاگ) و `requireStepUp` (۴۲۸ `STEP_UP_REQUIRED` با
  `details.stepUpSeconds`؛ زمانِ آینده = کهنه). [`routes/admin.ts`](apps/api/src/routes/admin.ts):
  `GET /admin/me`، `POST /admin/step-up/{request,verify}` — شماره از ردیفِ خودِ staff، همان سقفِ نرخِ OTP.
- **OTP با هدف:** `createPgOtpStore(db, purpose)` — `purpose` روی **store** است نه روی پورتِ auth-core
  (که دست نخورد). سناریوی conformanceِ «دو هدف روی یک شماره مستقل‌اند» روی memory (حامل) و **PG** (اثبات).
- **migration `0008`** (ستونِ step-up + ایندکس‌های ۴٫۱) — یک‌جا، تا `0009` برای استرداد بماند.
- **OpenAPI:** `internal`، `INTERNAL_SCHEMAS`، دو تابعِ خالصِ `routeDrift`/`publicSpecProblems`؛ سه
  (+۱) شکستنِ عمدی در تست و **همان چک روی سندِ واقعی داخلِ `gen-openapi --check`**.
- **[`admin-grant-staff`](scripts/admin-grant-staff.ts):** تنها نویسنده‌ی `is_staff`؛ خودآزمونِ ۶ چکی روی
  PGِ زنده که یکی‌اش **INSERTِ audit را عمداً می‌شکند** و پرچم برنمی‌گردد؛ از **ایمیج** با `compose run`
  اعطا و سلب شد. compose `grant-staff`، RUNBOOK (روزِ صفر ردیفِ ۱۰، §۵ دو ردیف، §۷٫۱)، CI.
- **sdk/web:** `sdk.admin.*`؛ `/panel`ِ lazy از یک chunk (`panel-chunk.ts`)؛ `RequireStaff` با `Navigate`؛
  لینکِ «مدیریت» در سایدبار؛ `PanelTable`؛ step-up در مرورگر؛ متنِ «۳۰ روز» در سطل.
- **گیتِ ۱۶:** [`check-admin-audit.ts`](scripts/check-admin-audit.ts) — collectorِ `onRoute` + `audited()`.

### ★ سه چیز که اندازه‌گیری عوضشان کرد

۱. **chunkِ ورودی اول +۱٬۴۵۲ B شد** (کارتِ «دسترسی ندارید» با `Link`، دو chunkِ جدا، دو `Suspense`).
   `RequireStaff` به `Navigate` تبدیل شد، هر دو صفحه از یک ماژول lazy شدند، Suspenseِ دوم حذف شد
   ⇒ **+۷۲۳ B** برای خودِ پنل (< ۱KB) و +۴۲۶ B برای لینکِ سایدبار و متنِ سطل که مالِ ورودی‌اند. هر دو
   عدد ثبت شد، نه فقط اولی.
۲. **خودآزمونِ گیتِ ۱۶ اول با شکستنِ عمدی «غلط» قرمز شد:** `audited()` را از `step-up/verify` برداشتم
   و به‌جای `✖ POST /admin/step-up/verify`، **خودآزمون** افتاد («collector مسیرِ عمدی را می‌بیند» با
   `length === 1`). قرمز بود ولی پیامش گمراه می‌کرد. به `includes` عوض شد و همان شکستن حالا نامِ مسیرِ
   واقعی را می‌گوید.
۳. **`admin-grant-staff` env را پیش از آرگومان می‌خواند** ⇒ از داخلِ ایمیجِ بدونِ `DATABASE_URL` به‌جای
   «--phone لازم است» `ConfigError` می‌داد. ترتیب عوض شد تا گاردِ `--phone` به دیتابیس وابسته نباشد — و
   همین چک به `images.yml` رفت.

### تصمیم‌هایی که گرفتم

- **`purpose` روی adapter، نه پورت.** ADR-066 گفته بود «`OtpStore` پارامترِ `purpose` می‌گیرد»؛
  store-به‌ازای-هدف همان اثر را با صفر لمسِ auth-core می‌دهد و `requestOtp`/`verifyOtp` بی‌خبر می‌مانند.
  اثباتش روی PG است (دو store، یک جدول، فقط ستونِ `purpose`).
- **۴۲۸ روی استکِ واقعی به ۵٫۲ رفت.** فاز ۳ عملِ مخربی ندارد؛ ساختنِ یک مسیرِ الکی برای اثبات همان
  «کدِ بی‌مصرف‌کننده» است. گارد در تست با مسیرِ عمدی اثبات شد و اولین مسیرِ مخربِ واقعی (تعلیق) آن را
  پشتِ nginx می‌سنجد.
- **صفحه‌بندیِ cursor و تاییدِ مخرب با اولین مصرف‌کننده** (۴٫۳ audit، ۵٫۲ تعلیق) — همان قاعده‌ی D7.
- **`audited()` در فاز ۳ فقط اعلام است.** نوشتنِ ردیف در همان تراکنش با `recordAudit` می‌آید (۴٫۲) و
  پیش از آن redactِ pino (ADR-067 §۳). این را کامنتِ `audit.ts` و گیت صریح می‌گویند؛ `grant-staff`
  استثناست چون خودش تراکنشِ خودش را دارد و ردیفش را می‌نویسد.
- **گیتِ ۱۶ یک ورودیِ verify است** (خودآزمون + چک در یک پروسه) تا شمارش «۱۵ → ۱۶» بماند، نه ۱۷.
- **`0008` در فاز ۳** با ایندکس‌های ۴٫۱ — ستونِ step-up لازم بود و شماره‌ی `0009` برای ADR-068 رزرو مانْد.
- **RequireStaff = `Navigate`، نه کارت** — کاربرِ غیرِ staff لینکی ندیده که به `/panel` برسد؛ کارت فقط
  chunkِ ورودی را سنگین می‌کرد.

### قدم بعد

⏸ **تاییدِ فاز ۳.** بعدش **فاز ۴ (`audit_logs`)**: `recordAudit(tx, …)` + redactِ `ip/phone/user_agent/email`
(۴٫۲؛ ۴٫۱ در همین فاز نوشته شد)، `GET /admin/audit` با cursor (۴٫۳ — اولین مصرف‌کننده‌ی صفحه‌بندیِ پنل)،
`infra:purge-audit` با `AUDIT_RETENTION_DAYS` (۴٫۴). ⚠️ ۱٫۰ (کلیدِ sms.ir در `.env`) همچنان بی‌پاسخ.

---

## ۱۴۰۵/۰۶/۲۶ — فاز ۳ تایید شد؛ فاز ۴ (`audit_logs`): نویسنده و نگهداشت تمام، خواننده منتظرِ DTO

**چه شد:** `audit_logs` بعد از سه ماژول اولین نویسنده‌اش را گرفت — و در **همان تراکنشِ** عمل، با
اثباتِ اتمیک‌بودن روی PGِ واقعی. نگهداشتش با عددِ سیاستیِ مالک (۳۶۵) و بدونِ هیچ پیش‌فرضی سیم‌کشی
شد. خواندنش (۴٫۳) تا لایه‌ی سرویس رفت و به DTO رسید — که طبقِ D12 پیشنهادش پایین است و توقف.

### ۴٫۲ — یک نویسنده، همان تراکنش

- [`recordAudit(tx, entry)`](apps/api/src/audit.ts): یک INSERT روی executorِ داده‌شده؛ هیچ لاگ، هیچ
  `catch`. `auditActor(req)` = staffِ درخواست + `req.ip` (پشتِ nginx واقعی، `TRUST_PROXY`) + UAی
  بریده. IPِ نامعتبر ⇒ `null` (ستونِ `inet` وگرنه کلِ عمل را می‌انداخت — forensics نباید عمل را بکُشد).
- هر دو مسیرِ step-up در `withTransaction` می‌نویسند. ⚠️ درخواستِ کد یعنی **ارسالِ پیامک داخلِ تراکنش**
  — همان الگوی درگاه در `settlePayment` (ADR-057): سقفِ sms.ir ۱۰s < ۳۰sِ `idle_in_transaction`. شکستِ
  ارسال ⇒ rollback ⇒ نه چالش، نه ردیف.
- `sdk:contract` ۲۰ → **۲۲**: ردیف‌های واقعی با actor/target/ip، و `recordAudit` داخلِ تراکنشی که بعدش
  عمداً می‌شکند ⇒ شمارش ثابت. شکستنِ عمدی (برداشتنِ recordAudit از verify) ⇒ چکِ ۲۱ قرمز با نامِ عمل.

### ★ redact — تستِ نشتِ عمدی اول قرمز شد

`LOG_REDACT_PATHS` برای `ip/phone/user_agent/email` گسترش یافت (ADR-067 §۳) و تستِ نشتِ عمدی یک
`AuditEntry` را لاگ کرد: `203.0.113.77` **رد شد**. علت: `{ actor: { ip } }` دو سطح تو است و wildcardِ
pino یک‌سطحی است (`*.ip` فقط `entry.ip` را می‌بیند) — همان چیزی که ADR-067 هشدار داده بود و من با
وجودِ خواندنش یک‌سطحی نوشتم. رفع: `*.*.k` برای هر پنج کلید. `req.remoteAddress`ِ fastify عمداً
دست‌نخورده (IPِ اتصال در لاگِ دسترسی، نه داده‌ی یک شخص در یک ردیفِ ممیزی).

### ۴٫۴ — نگهداشت بدونِ پیش‌فرض، و یک `:?` که کلِ استک را می‌انداخت

- `auditRetentionEnvSchema` جداست و **بدونِ پیش‌فرض**؛ `purge-audit` بدونِ آن با `ConfigError` می‌افتد
  (رشته‌ی خالی هم — همان تله‌ی `SMS_IR_TEMPLATE_ID=""`، این‌بار به نفعِ ما). خودآزمون روی PGِ زنده:
  ۴۰۰روزه می‌رود، ۳۶۵روزه (روی مرز) و ۱۰روزه می‌مانند.
- ⚠️ نگارشِ اولِ compose `${AUDIT_RETENTION_DAYS:?…}` بود تا «بدونِ عدد بالا نیاید» در compose هم
  باشد — و `config` **بدونِ profile** هم افتاد: compose کلِ فایل را در بوت interpolate می‌کند، پس یک
  متغیرِ سرویسِ ماهانه `up -d`ِ کلِ استک را می‌انداخت. `:-` شد؛ گاردِ واقعی schemaی خودِ اسکریپت است.
- cronِ ماهانه در RUNBOOK (۰۴:۴۵ یکمِ ماه)، compose `purge-audit`، CI، `PRODUCTION_SCRIPTS`، README.

### ۴٫۳ — تا لایه‌ی سرویس

[`services/audit-log.ts`](apps/api/src/services/audit-log.ts): keyset روی `(created_at, id)` با
`limit+1`، cursorِ base64url، فیلترِ پیشوندیِ action با escapeِ LIKE، `maskIp`. ۸ تستِ خالص + یک
اجرای واقعی روی PG (دو صفحه‌ی یک‌ردیفی، cursorِ درست). ⚠️ cursorِ خراب **خطا** می‌دهد، نه «از اول»:
سکوت یعنی صفحه‌ی تکراری برای کاربری که نمی‌فهمد چرا.

### ⏸ توقفِ D12 — پیشنهادِ DTO برای `packages/shared-types` (ADR-021)

```ts
// src/api/admin.ts (افزوده)
/** یک ردیفِ audit_logs برای پنل — ip فقط ماسک‌شده (ADR-067 §۳)؛ actor/team ممکن است NULL باشند. */
export const auditLogEntry = z.object({
  id: z.number().int(),                       // bigserial، زیرِ 2^53 (int8 → number، ADR-015)
  actorUserId: uuid.nullable(),               // NULL = سیستم/CLI (admin-grant-staff)
  teamId: uuid.nullable(),
  action: z.string(),                         // واژگانِ dotted (staff.grant، user.suspend، …)
  targetType: z.string().nullable(),          // user | team | board | payment | subscription | staff
  targetId: z.string().nullable(),
  ipMasked: z.string().nullable(),            // «203.0.x.x» / «2001:db8::…» — هرگز کامل
  userAgent: z.string().nullable(),           // بریده به ۲۵۶
  metadata: z.record(z.string(), z.unknown()),
  createdAt: isoDateTime,
});
/** کوئریِ GET /admin/audit — همه اختیاری، AND؛ action پیشوندی؛ صفحه‌بندیِ cursor (pageQuery). */
export const auditLogQuery = pageQuery.extend({
  actor: uuid.optional(),
  action: z.string().min(1).max(60).optional(),
  targetType: z.string().min(1).max(40).optional(),
  targetId: z.string().min(1).max(200).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});
// پاسخ: paginated(auditLogEntry) — { items, nextCursor }
```

مصرف‌کننده‌ها: `GET /admin/audit` (internal، `INTERNAL_SCHEMAS` += `AuditLogEntry`, `AuditLogQuery`)،
`sdk.admin.audit(query)`، صفحه‌ی `/panel/audit` (اولین مصرف‌کننده‌ی صفحه‌بندیِ cursor در پنل). هیچ DTOی
موجودی تغییر نمی‌کند؛ فقط افزوده. **تا تایید، هیچ فایلی از shared-types دست نخورده.**

### قدم بعد

⏸ **تاییدِ DTO** ⇒ ۴٫۳ تمام می‌شود (مسیر + sdk + پنل + `sdk:contract`) ⇒ تاییدِ فاز ۴ ⇒ فاز ۵
(کاربران و تیم‌ها؛ بازبینیِ خصمانه‌ی جدا). ⚠️ ۱٫۰ همچنان بی‌پاسخ.

### ✅ ۴٫۳ تمام شد — DTO تایید شد (۱۴۰۵/۰۶/۲۶)، خواننده تا مرورگر

- shared-types: `auditLogEntry`/`auditLogQuery` دقیقاً همان پیشنهاد (فقط افزوده). `sdk:contract` **۲۵/۲۵**:
  DTO روی سیمِ واقعی، IP ماسک، keyset دو صفحه، پیشوندِ action، cursorِ خراب ⇒ ۴۰۰.
- `GET /admin/audit` فقط‌خواندنی است ⇒ `audited()` ندارد و گیتِ ۱۶ همین را می‌خواهد (فقط جهش). ردیف فقط از
  `toAuditLogEntry(r, maskIp)` به DTO می‌رسد — یک مسیر، تا «ip کامل» هیچ راهی به بیرون نداشته باشد.
- پنل: `useInfiniteQuery` با `nextCursor` — در مرورگر با ۳۰ ردیفِ seedِ موقت (پاک شد): ۲۵ → «بیشتر» → ۳۳ یکتا،
  دکمه می‌رود؛ فیلترِ `staff.revoke` ⇒ ۱۶. ⚠️ **Enter در ورودیِ فیلتر از ابزارِ مرورگرِ این محیط submit نکرد** (مقدار
  تایپ شد، فرم ارسال نشد) — دکمه‌ی submitِ صریح همان درسِ ۸٫۳ است و با آن اثبات شد؛ در مرورگرِ واقعی Enter کار
  می‌کند (فرمِ استاندارد)، ولی این‌جا ادعا نمی‌شود.
- chunkِ ورودی +۷۶۳ B برای route و lazyِ صفحه‌ی نو؛ chunkِ پنل ۷٫۶KB.

### قدم بعد

⏸ **تاییدِ فاز ۴.** بعدش **فاز ۵ (کاربران و تیم‌ها)**: جست‌وجو و جزئیات (۵٫۱)، ★★ تعلیقِ D4-الف با سنجه‌ی زنده
(۵٫۲ — اولین مسیرِ مخرب: ۴۲۸ روی استکِ واقعی)، staff→viewer (۵٫۳)، نمای پشتیبانی (۵٫۴)، و **بازبینیِ خصمانه‌ی
جدا**. ⚠️ ۱٫۰ همچنان بی‌پاسخ.

### ✅ فاز ۴ تایید شد (۱۴۰۵/۰۶/۲۷) — نقطه‌ی توقف پیش از فشرده‌سازیِ context

اسناد به‌روز است (TODO/PROGRESS/CLAUDE.md ریشه، api، web، sdk؛ RUNBOOK cron و §۵/§۷٫۱؛ infra/README؛
`.env*.example`؛ compose؛ CI). **فاز ۵ شروع نشده.** sessionِ بعدی از این‌جا: [TODO-M6 فاز ۵](TODO-M6-admin.md)
(۵٫۱ جست‌وجو/جزئیات · ۵٫۲ ★★ تعلیقِ D4-الف با سنجه‌ی زنده و **اولین ۴۲۸ روی استکِ واقعی** · ۵٫۳ staff→viewer در
`roles.ts` (لمسِ auth-core، تاییدِ تک‌تک طبقِ جدولِ لمس) · ۵٫۴ نمای پشتیبانی) + **بازبینیِ خصمانه‌ی جدا**، با تاییدِ
صریحِ مالک؛ پیش از هر کد `pnpm db:up && pnpm db:migrate` و بعد از هر گام `pnpm verify` (۱۶ گیت).
تغییراتِ فازهای ۰–۴ در working tree هستند (**۸۵ فایل**) و **کامیت نشده‌اند** — کامیت فقط با درخواستِ مالک.

⚠️ چیزهای باز: ۱٫۰ (کلیدِ sms.ir در `.env`ِ محلی) · عددِ `--prune`/نگهداشتِ آینه · `--to-live` روی داده‌ی واقعی ·
DTOهای فاز ۵ (`AdminUserSummary` و …) طبقِ D12 با توقفِ ثبت‌شده در PROGRESS پیشنهاد می‌شوند.

---

## ۱۴۰۵/۰۶/۲۷ (ادامه) — فاز ۵: کاربران و تیم‌ها — شروع (تاییدِ مالک: «برو فاز ۵»)

### ✅ ۵٫۱ تا سرویس — فقط خواندن، کوئری‌های خودش، اثبات روی PGِ زنده

[`services/admin-users.ts`](apps/api/src/services/admin-users.ts): `classifyQuery` (ارقامِ فارسی/عربی نرمال؛ `09…`
پیشوندِ شماره، UUID شناسه، بقیه متن)، `searchUsers`/`searchTeams` (trgm روی `display_name`/`teams.name` با
ترتیبِ `similarity`، پیشوندِ `slug`)، `readUserDetail` (تیم‌ها با نقش و پلن، بوردهای ساخته‌شده، **نشست‌های زنده** از
`auth_sessions`)، `readTeamDetail` (همان `TEAM_BILLING_COLUMNS` — ظرفیت با `count(*)`ِ زنده، ADR-053؛ اعضا با
`status`؛ اشتراکِ زنده)، `listUserBoards` (۵٫۴: سه منبعِ `effectiveBoardRole`، بی‌لینک، حذف‌شده‌ها هم) و
`readPhone` (فقط برای مسیرِ ممیزی‌شده‌ی reveal). ۱۱ تستِ خالص. روی PGِ dev: `۰۹۱۲` ⇒ ۵ کاربر، `09121000002` ⇒ ۱،
`کاربر` ⇒ trgm، `personal-` ⇒ ۵ تیم با `m=1 b=…` و پلن، جزئیاتِ کاربر `boards=2 sessions=1`، تیم
`max_boards=-1 usage=2`، `usage_storage_bytes` **number** (نه رشته — `::bigint`ِ B-2)؛ همه در **۹۲ms**.
واژگانِ audit +۴: `user.phone.reveal`، `user.suspend`، `user.unsuspend`، `support.board.view`.

⚠️ شماره در سرویس **خام** است و در DTO ماسک می‌شود — یک نقطه‌ی نگاشت (`toAdminUserSummary`)، مثلِ `ip` در فاز ۴.

### ⏸ توقفِ D12 — پیشنهادِ shared-types برای کلِ فاز ۵ (یک توقف، نه چهار)

همه **افزودنی** در [`admin.ts`](packages/shared-types/src/api/admin.ts)، بدونِ تغییرِ هیچ شکلِ موجود:

```ts
export const userStatus = z.enum(["active", "suspended", "deleted"]);           // همان CHECKِ users.status
export const adminSearchQuery = z.object({ q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20) });                  // GET /admin/search
export const adminUserSummary = z.object({ id: uuid, displayName: z.string(),
  phoneMasked: z.string().nullable(),          // «0912***45» — هرگز کامل؛ کامل فقط با reveal (ممیزی‌شده)
  status: userStatus, isStaff: z.boolean(), createdAt: isoDateTime, lastSeenAt: isoDateTime.nullable() });
export const adminTeamSummary = z.object({ id: uuid, slug: z.string(), name: z.string(), isPersonal: z.boolean(),
  ownerUserId: uuid, memberCount: int≥0, boardCount: int≥0, planCode: z.string(),
  subscriptionStatus: teamSubscriptionStatus, createdAt: isoDateTime });
export const adminSearchResult = z.object({ users: z.array(adminUserSummary), teams: z.array(adminTeamSummary) });
export const adminUserDetail = adminUserSummary.extend({
  teams: z.array(z.object({ teamId: uuid, slug, name, isPersonal, role: teamRole, planCode, joinedAt })),
  boardCount: int≥0, activeSessions: int≥0 });                                  // GET /admin/users/:id
export const adminTeamDetail = adminTeamSummary.extend({ limits: planLimits, usage: planUsage,
  subscription: subscription.nullable(),
  members: z.array(z.object({ userId: uuid, displayName, role: teamRole, status: userStatus, joinedAt })) });
export const phoneRevealResult = z.object({ phone: z.string() });               // POST /admin/users/:id/phone/reveal
export const suspendRequest = z.object({ reason: z.string().trim().min(3).max(200) }); // POST …/suspend
export const adminUserBoard = z.object({ id: uuid, title, teamId: uuid, teamName, accessMode: boardAccessMode,
  role: boardRole /* نقشِ خودِ کاربر، نه staff */, lastActivityAt: isoDateTime, deletedAt: isoDateTime.nullable() });
                                                                                 // GET /admin/users/:id/boards → { items }
```

مسیرها (همه `internal`؛ جهش‌ها با `audited()`): `GET /admin/search` · `GET /admin/users/:id` · `GET /admin/teams/:id` ·
`POST /admin/users/:id/phone/reveal` (staff + audit، **بدونِ step-up** — خواندن است نه تخریب؛ پرسشِ بازبینیِ ۵٫۵) ·
`POST /admin/users/:id/suspend` و `…/unsuspend` (**step-up** + audit؛ staff را نمی‌شود از پنل معلق کرد — اول
`admin-grant-staff --revoke` از ایمیج، تا یک تاشوی staffِ لو‌رفته بقیه‌ی staff را بیرون نیندازد) · `GET /admin/users/:id/boards`.
sdk: `admin.search`، `admin.users.{get, revealPhone, suspend, unsuspend, boards}`، `admin.teams.get`.

### ⏸ و لمس‌های بیرونِ M6 که تاییدِ تک‌تک می‌خواهند (جدولِ لمسِ TODO §۰) — همه برای ۵٫۲/۵٫۳

| # | فایل | چه | چرا این شکل |
|---|---|---|---|
| ۱ | `packages/auth-core/src/roles.ts` (+ `roles.test.ts`) | `BoardAccessInput.isSuspended: boolean` (**اجباری**) ⇒ `null`؛ `isStaff` ⇒ `viewer` | ADR-066 §۱/§۴؛ اجباری چون اختیاری همان fail-openِ `developmentOnly` است (M5 فاز ۴) |
| ۲ | `packages/auth-core/src/refresh.ts` | `SessionStore.revokeAllForUser(sub): Promise<number>` + memory | ADR-066 §پیامدها؛ روی adapter تنها نمی‌شود چون conformance هر دو طرف را می‌خواهد |
| ۳ | `packages/auth-core/src/board-authority.ts` (+ test) | `roleToInput` ⇒ `isSuspended: false` | مکانیکی، لازمه‌ی ۱ |
| ۴ | `packages/board-access-db/src/index.ts` | `u.status` در SELECT ⇒ `isSuspended` | همان reader برای api **و** realtime — یک تغییر، دو مصرف‌کننده |
| ۵ | `apps/realtime/src/auth/auth-core-authority.test.ts` | یک literal `isSuspended: false` | فقط typecheck؛ صفر تغییرِ رفتار در realtime |
| ۶ | `packages/sdk/src/client.ts` | `onSessionEnded(reason?: { code })` — افزودنی | تا web «حساب معلق» را از «نشست تمام شد» تشخیص دهد |
| ۷ | `apps/api`: `routes/auth.ts` · `routes/boards.ts` · `adapters/session-store.ts` + conformance · `dto.ts` | OTP ۲۰۰ی بی‌صدا، refresh ۴۰۱ `USER_SUSPENDED` + clearCookie · `u.status` در کوئریِ inline + audit `support.board.view` در rt-token · `revokeAllForUser` · mapperها | همان ردیف‌های جدولِ لمس، فازِ ۵ |

بعد از تایید: DTO → مسیرها/sdk/`sdk:contract` → پنل (۵٫۱) → ۵٫۲ (سنجه‌ی زنده = `admin:probe-access` با انتظارِ
برعکس، ۴۲۸ روی استکِ واقعی) → ۵٫۳ → ۵٫۴ → ۵٫۵ بازبینیِ خصمانه.

✅ **هر دو توقف تایید شد («تایید شد»، ۱۴۰۵/۰۶/۲۷).** ادامه پایین.

### ✅ ۵٫۱–۵٫۴ تمام شد — اعداد در [TODO فاز ۵](TODO-M6-admin.md)

- **shared-types:** ده DTO دقیقاً همان پیشنهاد (فقط افزودنی). `AdminUserSummary` **`phone` ندارد**، فقط `phoneMasked` —
  و `sdk:contract` ۲۶ روی سیم `"phone" in u === false` را می‌سنجد، نه فقط parse.
- **auth-core (لمسِ تاییدشده):** `BoardAccessInput.isSuspended` **اجباری** — و همین اجباری‌بودن، کوئریِ inlineِ `GET /boards` را
  در typecheck گرفت (`Property 'isSuspended' is missing`)؛ اگر اختیاری بود آن مسیر بی‌صدا fail-open می‌مانْد (همان درسِ
  `developmentOnly`). staff ⇒ `viewer`؛ عضویت/مالکیتِ خودِ staff مثلِ هر کاربر بالاترش می‌برد. `revokeAllForUser` روی
  پورت + memory + pg + conformance (شکستنِ عمدیِ pg ⇒ `t1 بعد از revokeAll باید null`).
- **تعلیق** یک تراکنش با `FOR UPDATE` روی کاربر: `status` + سوزاندنِ **همه‌ی** نشست‌ها (از پورت، نه SQLِ جدا) + ردیفِ audit
  با `reason`/`sessionsRevoked`. refresh پیش از چرخش صاحبِ توکن را **مستقل از `revoked_at`** می‌سنجد ⇒ `USER_SUSPENDED`ِ
  راست‌گو + کوکی پاک، حتی وقتی توکن سوخته است (بدونِ این چک، کاربرِ معلق فقط «refresh نامعتبر» می‌دید و به صفحه‌ی ورود می‌رفت
  که آن‌جا OTPِ بی‌صدا سردرگمش می‌کرد). بعد از رفعِ تعلیق همان refresh ۴۰۱ی **عادی** است (نشست‌ها برنمی‌گردند) — ۳۴ همین را assert می‌کند.
- **نمای پشتیبانی:** `support.board.view` با de-dupeِ **۱۰ دقیقه** (کلاینت هر ۴۵s rt-token می‌گیرد ⇒ بدونِ de-dupe یک ساعت
  پشتیبانی = ۸۰ ردیف که `user.suspend`ها را غرق می‌کرد). ★ اول فقط در mintِ rt-token بود؛ چکِ ۲۹ (بازچینی‌شده: اول `GET /boards/:id`
  **بدونِ** rt-token) **قرمز شد** — staff می‌توانست متادیتا/snapshot/اعضا را با REST بخواند بی‌ردیف. رفع: داخلِ `requireBoardRole`
  (همه‌ی خواندن‌های REST) + `GET /boards/:id` که reader را مستقیم می‌خوانَد. ⚠️ این یک لمسِ **اضافه** بر فهرستِ تاییدشده است:
  `apps/api/src/services/boards.ts` (تابعِ افزودنی + پارامترِ اختیاریِ `actor`؛ ۱۴ فراخوانِ موجود دست‌نخورده، سه خواندنِ viewerِ
  `boards.ts` actor می‌دهند؛ در `assets.ts`/`board-access.ts` ردیف نوشته می‌شود ولی `ip` آن `null` است تا آن دو فایل با تایید لمس شوند).
- **سنجه‌ی [`admin:access`](scripts/admin-access-gauge.ts)** = همان probe با انتظارِ برعکس، ۸ انتظار، در CI بعد از هفت سنجه‌ی rt.
  ★ اجرای اول **۱٫۲e قرمز** شد: «دست‌دادنِ نو ACCEPTED» — نه چون رد نمی‌شد، چون probeِ فاز ۱ `open` را «پذیرش» می‌شمرد؛ ردِ
  دست‌دادن **بعد از** upgrade با `FORBIDDEN` + بستنِ ۱۰۰۸ می‌آید. سنجه حالا خطا/بستن را می‌سنجد. و cleanup به FKِ
  `audit_logs.actor_user_id` خورد (ردیف‌های `support.board.view`ِ staffِ سنجه) ⇒ ردیف‌های audit پیش از کاربر پاک می‌شوند.
- **استکِ واقعی (`m6p5`، پشتِ nginx) ۱۱/۱۱** — اولین ۴۲۸ روی استک. ⚠️ اجرای اول ۶ قرمز داشت که **همه مالِ probeِ من** بود:
  `content-type: application/json` بدونِ بدنه ⇒ Fastify `FST_ERR_CTP_EMPTY_JSON_BODY` که errorHandler به‌جای ۴۰۰، **۵۰۰ی بی‌کد**
  می‌دهد (M3؛ sdk هرگز چنین درخواستی نمی‌فرستد — ثبت شد). دومین اجرا یک ۴۲۹ی درست از سقفِ OTP (پنج درخواست در دقیقه از یک IP)؛
  سومی با شماره‌های تازه بعد از پنجره ۱۱/۱۱.
- **مرورگر:** جست‌وجو با ارقامِ فارسی، صفحه‌ی کاربر، reveal، **۴۲۸ ⇒ فرمِ step-up در جا ⇒ تایید ⇒ suspend ۲۰۰**، confirm دو بار
  (پیش از ۴۲۸ و پیش از اجرای واقعی — عمدی)، رفعِ تعلیق، بازکردنِ بوردِ خصوصیِ کاربر با «فقط‌خواندنی · ذخیره شد» و ردیفِ
  `support.board.view`؛ کاربرِ معلق (staffِ dev با SQL) بعد از رفرش «حساب معلق شده است»؛ بعد از رفعِ تعلیق کوکی پاک ⇒ `/login`.
  `window.confirm` برای ابزارِ مرورگر با یک stubِ شمارنده جایگزین شد (متنِ هر دو confirm ثبت شد).

### ★ چیزهایی که اندازه‌گیری عوضشان کرد یا پیدا کرد

۱. **`GET /boards/:id` reader را مستقیم می‌خوانَد، نه از `requireBoardRole`** — پس audit در `requireBoardRole` به‌تنهایی کافی نبود؛
   چکِ ۲۹ی بازچینی‌شده گرفتش. اگر چک به همان شکلِ اول (اول rt-token) مانده بود، سبز می‌مانْد و حفره می‌مانْد.
۲. **«خروج»ِ web نشست را در سرور نمی‌بندد** (M3): `signOut` فقط توکنِ حافظه را پاک می‌کند؛ کوکیِ refresh می‌مانَد و بارگذاریِ
   بعدی همان کاربر را برمی‌گردانَد. برای تعلیقِ کاربرِ دیگر در همان مرورگر مجبور شدم staffِ dev را با SQL معلق کنم. بیرونِ M6،
   ولی کاندیدِ `POST /auth/logout` (burnFamily + clearCookie).
۳. **سنجه‌های `rt:*` کاربرانِ `seed-member` را جا می‌گذارند** — ۷۴ ردیف (+۳۵ `seed-owner`) در DBِ dev بود؛ `cleanupSeed` فقط
   مالک را می‌بَرد و `addMember` جفتی ندارد. پاک شد؛ رفعِ `rt-seed.ts` (M2/M3) با تایید.
۴. **chunkِ ورودی +۲٬۹۵۳ B** — نه فقط سه route/lazy: کارتِ «حساب معلق» و متدهای نوی `sdk.admin.users.*` در ورودی می‌نشینند
   (sdk یک شیء است). معیارِ «< ۱KB» مالِ خودِ پنل بود و هنوز برقرار است (پنل lazy است، ۱۸٫۵KB)؛ این عدد جدا ثبت می‌شود.

### تصمیم‌هایی که گرفتم

- **reveal بدونِ step-up** (خواندن؛ ممیزی‌شده) · **staff از پنل معلق نمی‌شود** (۴۰۹؛ اول `--revoke` از ایمیج) ·
  **de-dupeِ ۱۰ دقیقه‌ی `support.board.view`** · **نقشِ بوردهای کاربرِ معلق با `isSuspended:false`** («اگر فعال بود چه داشت») ·
  **`phone/reveal` POST است** با اینکه چیزی عوض نمی‌کند (زیرِ گیتِ ۱۶، بدونِ کشِ GET) · **`unsuspend` هم step-up می‌خواهد**.
- **رد‌شدنِ خودکارِ عمل بعد از step-up نه** — staff دوباره می‌زند و دوباره confirm می‌بیند.
- **probe → سنجه با تغییرِ نام** (`admin-access-gauge.ts`، `pnpm admin:access`)؛ `admin:probe-access` حذف شد (مرجع‌های تاریخی در
  TODO/PROGRESS می‌مانند).

### ★★ ۵٫۵ — بازبینیِ خصمانه‌ی جدا (auth): ۱۴ یافته، ۷ رفع، ۳ محدودیتِ ثبت‌شده، ۴ تکراری/ادغام

**روش:** workflow با سه یابنده‌ی مستقل با سه لنز (نشست/احراز · مجوز/ممیزی · داده/PII/رابط) روی همه‌ی فایل‌های فاز ۵،
سپس دو ردکننده‌ی خصمانه به‌ازای هر یافته. ⚠️ **ردکننده‌ها همه به سقفِ نشست خوردند** (۲۸ عامل، «session limit») —
همان تله‌ی فاز ۰ (memory: fan-outِ پهن). سه یابنده کامل برگشتند (~۲٫۵M توکن)، پس راستی‌آزمایی **دستی روی کد** انجام شد و هر
یافته‌ی پذیرفته‌شده یک چکِ قراردادی/تست گرفت — نه «ردکننده گفت». درسِ ثبت‌شده: یابنده‌ی کم + منتقدِ تک‌عاملی؛ ردِ خودکارِ
۲×N هزینه‌اش از خودِ بازبینی بیشتر است.

| # | یافته | حکم | چه شد |
|---|---|---|---|
| ۱ | `/auth/otp/verify` هیچ چکِ `status` ندارد ⇒ چالشی که پیش از تعلیق ساخته شده (TTL ۱۲۰s) **بعد** از تعلیق نشست و access-token می‌سازد | **واقعی، high** (سه یابنده مستقل گرفتندش) | `userSuspendedForShare(tx)` پیش از `startSession` در همان تراکنش ⇒ `401 USER_SUSPENDED` (کاربر مالکِ شماره است؛ enumeration نیست) + تعلیق چالش‌های ورودِ همان شماره را مصرف می‌کند (`challengesConsumed` در metadata). چکِ ۳۲b (چالشِ پیش از تعلیق) و **۳۲c (چالشِ کاشته‌شده بعد از تعلیق = شبیه‌سازیِ مسابقه‌ی request↔suspend)** — شکستنِ عمدیِ چک ⇒ ۳۲ قرمز |
| ۲ | مسابقه‌ی suspend↔refresh: چکِ status **بیرونِ** تراکنشِ چرخش بود ⇒ چرخشِ هم‌زمان یک نشستِ زنده جا می‌گذاشت | واقعی، medium | `refreshOwnerSuspended` حالا روی `client`ِ تراکنش با **`FOR SHARE OF u`** — یا پشتِ `FOR UPDATE`ِ تعلیق می‌ایستد و «معلق» می‌بیند، یا تعلیق پشتِ آن می‌ایستد و ردیفِ نو را هم می‌سوزاند |
| ۳ | زمانِ پاسخِ OTPِ بی‌صدا (یک SELECT) از روند‌سفرِ پیامک قابلِ تمایز است ⇒ ضدِ enumerationِ §۴ کامل نیست | واقعی، **ثبت شد، رفع نه** | «شکل/کد/سقفِ نرخ» یکسان است، «زمان» نه؛ رفعِ درست تاخیرِ مصنوعیِ وابسته به فراهم‌کننده است که خودش تصمیمِ سیاستی است. در RUNBOOK §۷٫۲ صادقانه نوشته شد |
| ۴ | `/` و `/login` وضعیتِ `suspended` را anonymous می‌گرفتند ⇒ کاربرِ معلق به فرمِ ورود می‌رفت و «کد فرستاده شد»ی که هرگز نمی‌آید | واقعی، low | `SuspendedNotice` مشترک، در `RequireAuth`/`IndexRedirect`/`LoginPage` |
| ۵ | جست‌وجوی **پیشوندیِ** شماره: ماسکِ ۵ رقمی با ≤۵۰ جست‌وجو رقم‌به‌رقم بازسازی می‌شد، بی‌هیچ ردیفِ `user.phone.reveal` | **واقعی، high** (سیاستِ TODO §۰ را دور می‌زد) | شماره فقط **کامل** و تطبیقِ دقیق؛ پیشوندِ ۴–۱۰ رقمی متن است (چکِ ۲۶: پیشوندِ ۱۰رقمی ⇒ صفر) |
| ۶ | `GET /admin/search?q=<شماره>` شماره‌ی کامل را در لاگِ api (`incoming request`)، لاگِ nginx و تاریخچه‌ی مرورگر می‌نشانْد (P7) | **واقعی، high** | `POST /admin/search` با بدنه + ممیزی‌شده (`user.search` با `{kind, users, teams}`، بدونِ عبارت) · عبارت از URLِ پنل حذف شد (state) · سریالایزرِ `req`ِ pino `url` را **بدونِ query string** می‌نویسد (تستِ نشتِ عمدی؛ روی استکِ واقعی صفر url با `?` در لاگ) |
| ۷ | `sessionsRevoked` ردیف‌های چرخانده/منقضی را هم می‌شمرد (با `activeSessions`ِ پنل نمی‌خوانْد) | واقعی، low | `revokeAllForUser` همه را می‌سوزاند ولی فقط **زنده‌ها** را می‌شمارد (`RETURNING … AS live`؛ memory هم)؛ conformance: ردیفِ چرخانده می‌سوزد، شمرده نمی‌شود؛ چکِ ۳۱ `=== 1` |
| ۸ | کشِ صفحه‌ی تیم بعد از تعلیق ۳۰s «فعال» نشان می‌داد | واقعی، low | `invalidateQueries(["admin","teams"])` |
| ۹ | ردیفِ support از `board-access.ts`/`assets.ts` بدونِ ip/UA | واقعی، low — **ثبت شد** | دو خطِ M3 (`auditActor(req)` به `requireBoardRole`)؛ ردیف نوشته می‌شود، فقط ip آن `null` است. با تاییدِ مالک |
| ۱۰ | یک ردیفِ `support.board.view` می‌تواند WSِ بازِ چندساعته را بپوشاند (سرور re-mint را اجبار نمی‌کند) | واقعی، low — **ثبت شد** | همان گزینه‌ی بازِ M2 در ADR-066 §⏳ (بستنِ سوکت روی refreshِ ردشده)؛ اولین mint همیشه ردیف دارد و نوشتن رد است — «چه‌قدر تماشا کرد» ثبت نمی‌شود |
| ۱۱ | ورودیِ جست‌وجو با Back/Forward با URL هم‌خوان نمی‌مانْد | واقعی، low | با حذفِ `q` از URL (#۶) موضوعیت ندارد |
| — | سه یافته تکرارِ #۱ و #۲ بودند (لنزهای مختلف، همان کد) | — | ادغام |

⚠️ **دو یافته‌ی جانبیِ همین بازبینی/اجرا (بیرونِ M6، ثبت):** «خروج»ِ web نشست را در سرور نمی‌بندد (`signOut` فقط
توکنِ حافظه؛ کاندیدِ `POST /auth/logout`) · Fastify `FST_ERR_CTP_EMPTY_JSON_BODY` (content-type json بدونِ بدنه) در
errorHandler به ۵۰۰ی بی‌کد می‌رسد نه ۴۰۰.

**بعد از رفع‌ها:** `sdk:contract` **۳۵/۳۵** (چک‌های ۲۶/۳۱/۳۲ سخت‌تر شدند) · conformance ۱۴/۱۴ · `admin:access` ۸/۸ · استکِ
واقعی (ایمیجِ `m6p5` بازساخته) **۱۱/۱۱** و در لاگِ کانتینر **صفر** url با `?` · `pnpm verify` ۱۶ گیت سبز.

### ✅ فاز ۵ تایید شد (۱۴۰۵/۰۶/۲۷) — نقطه‌ی توقف پیش از فشرده‌سازیِ context

اسناد به‌روز است (TODO/PROGRESS/CLAUDE.md ریشه، api، web، sdk؛ RUNBOOK §۵/§۷٫۲؛ infra/README؛ CI `admin:access`؛
memory). **فاز ۶ شروع نشده.** sessionِ بعدی از این‌جا: [TODO-M6 فاز ۶](TODO-M6-admin.md) (پرداخت‌ها: verifyِ دستی،
sweepِ دستی، انقضای مشروط، فرزندخواندگی، **مدلِ استرداد** در migrationِ جدای `0009` + `refundPayment(tx)` +
Mock refund/reverse + `REFUND_UNAVAILABLE` — [ADR-068](ARCHITECTURE_DECISIONS.md#adr-068)) + **بازبینیِ خصمانه‌ی جدا**
(کدِ پول)، با تاییدِ صریحِ مالک؛ DTOهای فاز ۶ (`PaymentAdminView`، …) طبقِ D12 با توقفِ ثبت‌شده؛ لمس‌های
`services/billing.ts`، `services/reconcile.ts` و `packages/billing-core` طبقِ جدولِ لمسِ TODO §۰ با تاییدِ تک‌تک. پیش از هر
کد `pnpm db:up && pnpm db:migrate`، بعد از هر گام `pnpm verify` (۱۶ گیت).
تغییراتِ فازهای ۰–۵ در working tree هستند (**۱۰۶ فایل**) و **کامیت نشده‌اند** — کامیت فقط با درخواستِ مالک.

⚠️ چیزهای باز: ۱٫۰ (کلیدِ sms.ir در `.env`ِ محلی) · عددِ `--prune`/نگهداشتِ آینه · `--to-live` روی داده‌ی واقعی ·
سه محدودیتِ ثبت‌شده‌ی ۵٫۵ (زمانِ پاسخِ OTPِ بی‌صدا؛ یک ردیفِ support برای WSِ چندساعته — گزینه‌ی M2؛ ip/UA در دو مسیرِ M3
با تایید) · «خروج»ِ web نشست را در سرور نمی‌بندد (M3) · خطای بدنه‌ی خالیِ Fastify ⇒ ۵۰۰ (M3) · `rt-seed` کاربرانِ
`seed-member` را پاک نمی‌کند (M2/M3).

## ۱۴۰۵/۰۶/۲۷ (ادامه) — فاز ۶: پرداخت‌ها و مدلِ استرداد — شروع (تاییدِ مالک: «برو قدم بعد، فاز 6 شروع کن»)

### ✅ ۶٫۱ تا سرویس + migrationِ `0009` — فقط خواندن، اثبات روی PGِ زنده

- [`0009_refunds.sql`](apps/api/migrations/0009_refunds.sql) (ADR-068) **روی DBِ dev اعمال شد** — قابلِ برگشت پیش از انجماد
  (drop ستون‌ها + حذفِ ردیفِ `schema_migrations`): `payments.refunded_at/refund_ref/refund_amount_rial`؛
  `payments_refunded_ck` (`refunded ⇔ refunded_at ∧ refund_amount_rial`)؛ `payments_refund_full_ck` (`refund_amount_rial = amount_rial`
  — استردادِ جزئی = ADRِ جدا = تغییرِ همین CHECK)؛ `payments_paid_at_ck` (`paid|refunded ⇔ paid_at`)؛ `invoices.refunded_at`؛
  `DROP invoices_paid_at_ck` → `(status IN ('paid','refunded')) = (paid_at IS NOT NULL)` + `invoices_refunded_ck`؛ و
  `payments_requested_idx (requested_at DESC, id DESC)` برای فهرستِ بی‌فیلترِ پنل. همه‌ی نویسنده‌های موجود با CHECKهای نو
  سازگارند (grep روی `SET status`/`paid_at`: `settlePayment`، `voidFailedCheckout`، `expireAbandonedPayment`، `db-fk-test`،
  `probe-db`) — **تنها** ناسازگار چکِ ۶ی `billing:settle` است که `status='refunded'` را با UPDATEِ خام می‌نویسد (⇒ بعد از
  تایید از `refundPayment` استفاده می‌کند و «اشتراک canceled» را assert می‌کند، نه «صفر اشتراک»).
- [`services/admin-payments.ts`](apps/api/src/services/admin-payments.ts): `buildPaymentQuery` (team/ref_id دقیق، authority پیشوندی
  با escape، status؛ keyset `(requested_at, id) < ($a::timestamptz, $b::uuid)`؛ `limit+1`)، `listPayments`، `readPaymentDetail`
  (ردیف + فاکتور + اشتراکِ `activated_by_payment_id`)، `expireBlockedReason` (نردبانِ ADR-056 پله‌ی ۳ — **همان سقفِ ۷۲ ساعت**؛
  یتیم هرگز؛ `failure_code IS NULL` هرگز). ۱۱ تستِ خالص. روی PGِ dev (۶۱ پرداخت): دو صفحه‌ی ۵تایی بی‌هم‌پوشانی، فیلترِ تیم
  ۵۰/۵۰، paid ۳۳/۳۳، ref_id دقیق ۱، پیشوندِ authority ۱، `'%'` escape ⇒ ۰، جزئیات با فاکتور و اشتراکِ active، cursorِ خراب ⇒
  خطا — **۷۲ms**؛ با `enable_seqscan=off` keyset روی `payments_requested_idx` **Index Scan بدونِ Sort**.

### ★ منتقدِ خصمانه روی **خودِ طرح** (یک عامل، ۲۳۸k توکن) — ۷ یافته، پیش از آنکه مالک طرح را ببیند

همان روشِ فاز ۰ (یک منتقد کافی است؛ fan-outِ پهن به سقفِ نشست می‌خورد). دو یافته **money-loss/correctness** و طرح را عوض کردند:

| # | یافته | چه شد |
|---|---|---|
| ۱ | ★★ **انقضای دستی با آستانه‌ی ۲۰ دقیقه** (نه سقفِ ۷۲ ساعتِ پله‌ی ۳): کاربرِ کُند در دقیقه‌ی ۲۱ باطل می‌شد و در ۲۴ پول می‌داد؛ ردیفِ `canceled` از ایندکسِ sweep بیرون است ⇒ پول برای همیشه پیشِ درگاه — **و** callback برای `alreadySettled` با اشتراکِ null `?status=ok` می‌دهد (باگِ M4) | ✅ `expireBlockedReason` به `expireAfterMs` (۷۲h) — همان پله‌ی ۳، نه شل‌تر (تست + PG)؛ طرح: **انقضا = اول یک verifyِ تازه زیرِ همان قفل** (paid ⇒ فعال، notPaid ⇒ باطل، gatewayError ⇒ دست‌نخورده) در **هر دو** مسیرِ دستی و sweep؛ callback فقط برای `status='paid'` `ok` می‌دهد |
| ۲ | ★★ **استردادِ پرداختِ تمدید** اشتراکِ زنده را لغو می‌کند و باقی‌مانده‌ی دوره‌ی **قبلیِ پرداخت‌شده** (که `upsertSubscription` زودتر `expired` کرده) دور ریخته می‌شود — تیم فوراً free | ✅ طرح: بعد از لغوِ هدف، آخرین اشتراکِ `expired`ِ همان تیم با `current_period_end > now()` **و پرداختِ هنوز `paid`** (تنها تولیدکننده‌ی «expired با پایانِ آینده» جایگزینیِ تمدید است) دوباره `active` می‌شود، در همان تراکنش؛ `subscriptionRestored` در audit؛ چکِ نو در سنجه |
| ۳ | assertِ درگاه فقط `gateway`، نه `gateway_mode`؛ کانالِ gatewayِ استرداد بی‌assert (ردیفِ zarinpal روی استکِ mock ⇒ `MOCKRF` بدونِ جابه‌جاییِ پول) | ✅ طرح: `gateway ∧ gateway_mode` در settle (by-id و WHEREی by-authority) و در `refundPayment` پیش از هر تماس ⇒ ۴۰۹؛ `MockGateway.refund` روی authorityِ ناشناخته ⇒ `rejected` |
| ۴ | sweepِ دستی همگام است و با ۵۰ ردیف × ۱۵s از `proxy_read_timeout=60s`ِ nginx رد می‌شود؛ ردیفِ auditِ خلاصه ناچار بیرونِ تراکنش‌های ردیف‌هاست | ✅ طرح: `batchSize` از بدنه (پیش‌فرض ۱۰، سقف ۲۵)؛ ۵۰۴ sweep را متوقف نمی‌کند و هر expire/adopt auditِ داخلِ تراکنشِ خودش دارد — خلاصه‌ی `payment.reconcile` صادقانه «پس از اجرا» است؛ ۴۰۹ با پیامِ «نودِ دیگری/تایمر در حالِ اجراست» |
| ۵ | cursorِ keyset با `Date.toISOString()` (ms) ردیفِ هم‌میکروثانیه را بینِ دو صفحه **گم می‌کند** — در `audit-log.ts`ِ فاز ۴ هم | ✅ **رفع شد** در هر دو: `created_at::text`/`requested_at::text` در cursor و `::timestamptz` در مقایسه. اثبات روی PG: سه ردیف در **یک** دستور (یک `now()`)؛ cursorِ قدیمی صفحه‌ی دوم **۰** ردیف (گپ بازتولید شد)، cursorِ نو ۳/۳؛ audit هم ۳/۳ |
| ۶ | `rejected`ِ درگاه ⇒ ۵۰۲ یعنی «دوباره تلاش کن» برای یک ردِ قطعی | ✅ طرح: کدِ نو `REFUND_REJECTED` (۴۰۹، با کد/پیامِ درگاه در `details`)؛ ۵۰۲ فقط `gatewayError` |
| ۷ | مصرفِ کوپن بعد از استرداد می‌مانَد (همان تیم دوباره نمی‌تواند با همان کوپن بخرد) — سیاست | ⏳ سوالِ مالک (پیش‌فرض: **برنمی‌گردد**، در پاسخ/audit گفته می‌شود) |

حکمِ منتقد: مدل درست است (refund و settle هر دو `FOR UPDATE` روی همان ردیف ⇒ refund↔callback، دو refund، refund↔sweep، refund↔expire
همه سریالی؛ هر خواننده‌ی «اشتراکِ زنده» `canceled` را بیرون می‌گذارد؛ CHECKهای ۰۰۰۹ با هر نویسنده‌ی موجود سازگار؛ DTO چیزی جز PANِ
ماسک در جزئیات لو نمی‌دهد؛ `pg_sleep` داخلِ `onSettled` هم‌پوشانیِ واقعی می‌سازد).

### ⏸ توقفِ D12 — پیشنهادِ shared-types برای کلِ فاز ۶ (یک توقف)

همه **افزودنی** در [`admin.ts`](packages/shared-types/src/api/admin.ts) و یک کدِ خطا به **انتهای** `apiErrorCodes`:

```ts
export const paymentStatus = z.enum(["pending","paid","failed","canceled","refunded","verify_failed"]); // = payments_status_ck
export const adminPaymentQuery = pageQuery.extend({ teamId: uuid.optional(),                  // GET /admin/payments
  refId: z.string().trim().min(1).max(80).optional(), authority: z.string().trim().min(1).max(80).optional(),
  status: paymentStatus.optional() });
export const adminPaymentSummary = z.object({ id: uuid, teamId: uuid, teamName: z.string(), initiatedBy: uuid,
  invoiceId: uuid.nullable(), invoiceNumber: z.string().nullable(), gateway: z.string(), gatewayMode: z.string(),
  amountRial: rial, status: paymentStatus, authority: z.string().nullable(), refId: z.string().nullable(),
  failureCode: z.string().nullable(), requestedAt: isoDateTime, paidAt: isoDateTime.nullable(),
  verifiedAt: isoDateTime.nullable(), refundedAt: isoDateTime.nullable() });
export const adminPaymentDetail = adminPaymentSummary.extend({       // = «PaymentAdminView»ِ TODO ۶٫۱
  cardPanMasked: z.string().nullable(), feeRial: rial.nullable(), refundRef: z.string().nullable(),
  refundAmountRial: rial.nullable(),
  requestPayload: z.record(z.string(), z.unknown()).nullable(),      // نیّتِ خرید (plan/period/seats/unitPrice/coupon)
  callbackPayload: z.record(z.string(), z.unknown()).nullable(),     // {Authority, Status} — از این فاز نوشته می‌شود
  verifyPayload: z.record(z.string(), z.unknown()).nullable(),       // آخرین verdictِ نرمال‌شده، **بدونِ** کارت (P7)
  invoice: invoice.nullable(), subscription: subscription.nullable(), // اشتراکِ activated_by_payment_id (هدفِ استرداد)
  expireBlocked: z.string().nullable() });                           // null = دکمه‌ی انقضا فعال؛ وگرنه دلیل (سرور، چون سقف configی است)
export const paymentSettleResult = z.object({                        // POST …/verify و …/expire
  outcome: z.enum(["activated","alreadySettled","notPaid","unknown","expired"]), message: z.string().nullable(),
  payment: adminPaymentSummary });
export const expireRequest = z.object({ reason: z.string().trim().min(3).max(200) });
export const refundRequest = z.discriminatedUnion("channel", [      // POST /admin/payments/:id/refund
  z.object({ channel: z.literal("manual"), refundRef: z.string().trim().min(1).max(80), reason: z.string().trim().min(3).max(200) }),
  z.object({ channel: z.literal("gateway"), reason: z.string().trim().min(3).max(200) }) ]);
export const reconcileRequest = z.object({ adoptOrphans: z.boolean().default(false), dryRun: z.boolean().default(false),
  batchSize: z.coerce.number().int().min(1).max(25).default(10) });  // POST /admin/payments/reconcile
export const reconcileReport = z.object({ scanned, skipped, activated, alreadySettled, stillPending, unknown, expired,
  orphans, adopted, subscriptionsEnded /* همه int≥0 */, errors: z.array(z.string()) });
// error.ts — به انتها: "REFUND_REJECTED" (درگاه استرداد را قطعی رد کرد؛ ۴۰۹ با کد/پیامِ درگاه در details)
```

مسیرها (همه `internal`؛ جهش‌ها `audited()` + **step-up**): `GET /admin/payments` (paginated؛ cursorِ خراب ۴۰۰) · `GET /admin/payments/:id` ·
`POST /admin/payments/:id/verify` (`payment.verify`؛ همان `settlePayment` با hookِ audit در همان تراکنش؛ ۲۰۰ با `outcome` برای هر
حالت — برای staff «-51» اطلاعات است نه خطا؛ ردیفِ درگاه/modeِ دیگر ۴۰۹) · `POST /admin/payments/:id/expire` (`payment.expire`؛
`FOR UPDATE` → نردبان زیرِ قفل (۴۰۹ `INVALID_TRANSITION` با همان دلیل) → **verifyِ تازه** → paid ⇒ `activated`، notPaid ⇒
`canceled/EXPIRED` + فاکتور `void` ⇒ `expired`، gatewayError ⇒ `unknown` و هیچ) · `POST /admin/payments/:id/refund`
(`payment.refund`؛ §بعد) · `POST /admin/payments/reconcile` (`payment.reconcile`؛ `withAdvisoryLock(runReconcile)` با سیاستِ config +
بدنه؛ قفل دستِ نودِ دیگر/تایمر ⇒ ۴۰۹ CONFLICT؛ auditِ خلاصه پس از اجرا). sdk: `admin.payments.{list, get, verify, expire, refund, reconcile}`.

**`refundPayment(tx, paymentId, source)`** در `services/billing.ts` (ADR-068 §۱ + یافته‌های ۲/۳): `SELECT … FOR UPDATE` → assertِ
`gateway ∧ gateway_mode` → فقط از `paid` (وگرنه `INVALID_TRANSITION`) → `gateway` ⇒ `gateway.refund({authority, amountRial})` داخلِ
تراکنش (`unavailable` ⇒ ۴۰۹ `REFUND_UNAVAILABLE`، `rejected` ⇒ ۴۰۹ `REFUND_REJECTED`، `gatewayError` ⇒ ۵۰۲) · `manual` ⇒ `refund_ref` از بدنه →
`payments: refunded, refunded_at, refund_ref, refund_amount_rial = amount_rial` (هرگز بازمحاسبه) → `invoices: refunded, refunded_at`
(`paid_at` می‌مانَد) → اشتراکِ هدف (`activated_by_payment_id` + زنده، `FOR UPDATE`) ⇒ `canceled`؛ سپس **بازگرداندنِ** آخرین
`expired`ِ همان تیم با `current_period_end > now()` و پرداختِ `paid` ⇒ `active` (یافته‌ی ۲؛ اگر هیچ، هیچ — اشتراکِ زنده‌ی
دیگرِ تیم دست نمی‌خورد) → `recordAudit(payment.refund, {channel, refundRef, amountRial, subscriptionCanceled, subscriptionRestored, reason})`.
idempotency در دیتابیس (`paid` زیرِ قفل). ⚠️ درگاه استرداد کرد و commitِ ما شکست ⇒ ردیف `paid` مانده؛ staff با «ثبتِ دستی» و
همان مرجع می‌بندد — همان کلاسِ ریسکِ settle، مستند.

### ⏸ و لمس‌های بیرونِ M6 که تاییدِ تک‌تک می‌خواهند (جدولِ لمسِ TODO §۰)

| # | فایل | چه | چرا این شکل |
|---|---|---|---|
| ۱ | `apps/api/src/services/billing.ts` | (الف) `settlePayment(deps, locator, hooks?: { onSettled?(tx, outcome); callbackPayload? })` — hook داخلِ تراکنش پیش از commit برای هر outcome؛ (ب) assertِ `gateway ∧ gateway_mode` (by-id و WHEREی by-authority) ⇒ ۴۰۹ CONFLICT پیش از تماس؛ (ج) `verify_payload` روی هر verdict (بدونِ `cardPanMasked/cardHash`) و `callback_payload`؛ (د) `alreadySettled` وضعیتِ ردیف را برمی‌گردانَد (callback فقط برای `paid` `ok`)؛ (ه) هسته‌ی verify+activate به `settleLocked(tx, …)` جدا می‌شود تا مسیرِ انقضا همان را زیرِ قفلِ خودش صدا بزند (یک تعریف از «یک‌بار»)؛ (و) `refundPayment(tx, …)` نو | ADR-068 §۱؛ ADR-067 §۱؛ TODO ۶٫۱–۶٫۴؛ یافته‌های ۱/۲/۳ |
| ۲ | `apps/api/src/routes/billing.ts` | callback `callbackPayload` را می‌دهد و `ok` را فقط برای `paid` می‌سازد (دو خط) | ۶٫۱؛ یافته‌ی ۱ |
| ۳ | `apps/api/src/services/reconcile.ts` | `ReconcileDeps.actor?` (پیش‌فرض سیستم)؛ `expireAbandonedPayment` = **verifyِ تازه زیرِ قفل** و فقط روی notPaid باطل (`applyExpiry(tx,row)` مشترک با مسیرِ دستی)؛ expire/adopt در همان تراکنش `payment.expire`/`payment.adopt` می‌نویسند | TODO ۶٫۳؛ یافته‌ی ۱ |
| ۴ | `packages/billing-core/src/gateway.ts` | `refund?(RefundInput): Promise<RefundOutcome>` (امروز `Promise<VerifyOutcome>` — نوعِ غلط)؛ `reverse?(ReverseInput): Promise<ReverseOutcome>`؛ `RefundOutcome = refunded{refundRef} \| unavailable{message} \| rejected{code,message} \| gatewayError{code,message}` | ADR-068 §۲ |
| ۵ | `packages/billing-core/src/mock-gateway.ts` | `refund` (verify‌شده و استردادنشده ⇒ `refunded` با `MOCKRF…`؛ ناشناخته/دوباره ⇒ `rejected`) و `reverse` (verify‌نشده ⇒ `reversed`؛ وگرنه `rejected`) | P3؛ یافته‌ی ۳ |
| ۶ | `packages/billing-core/src/zarinpal-gateway.ts` | `refund` ⇒ `{status:"unavailable"}` **بدونِ fetch**؛ `reverse` پیاده **نمی‌شود** | ADR-068 §۲ |
| ۷ | `packages/billing-core/src/{index,gateway.test}.ts` | export + تست | مکانیکی |
| ۸ | `scripts/billing-probe-settle.ts` (سنجه‌ی M4) | چکِ ۶ از `refundPayment` (UPDATEِ خام را CHECKِ ۰۰۰۹ رد می‌کند؛ assert «canceled» نه «صفر»)؛ چکِ نو: دو verifyِ ادمینِ هم‌زمان با `pg_sleep` داخلِ `onSettled` ⇒ یک اشتراک، دو ردیفِ audit | TODO ۶٫۲ |

بدونِ لمس: `apps/api/src/plugins/reconcile.ts`، `scripts/billing-reconcile.ts`، realtime، auth-core، `packages/config`.

سنجه‌ی نو `billing:refund` (`scripts/billing-probe-refund.ts`): ۱ ★★ refund ↔ callbackِ دیرهنگام هم‌پوشان (`pg_sleep` زیرِ قفلِ refund) ⇒
یک حقیقت · ۲ ★★ refunded با ۱۰۱ فعال **نمی‌شود** (T6 از مسیرِ واقعی) · ۳ تمدید: استردادِ پرداختِ نو ⇒ اشتراکِ قبلی **برمی‌گردد**؛
استردادِ پرداختِ قدیم ⇒ اشتراکِ زنده‌ی نو دست‌نخورده · ۴ مبلغ همیشه `amount_rial` حتی بعد از تغییرِ `plans.price_*` · ۵ استردادِ دوباره
⇒ `INVALID_TRANSITION`، بدونِ ردیفِ auditِ دوم · ۶ zarinpal ⇒ `REFUND_UNAVAILABLE`، صفر fetch · ۷ ردیفِ zarinpal روی درگاهِ mock/mode
دیگر ⇒ ۴۰۹، دست‌نخورده · ۸ شکستِ عمدی بعد از UPDATE ⇒ نه استرداد نه audit · ۹ `paid_at` می‌مانَد. خودآزمون: برداشتنِ `FOR UPDATE`/چکِ
`paid` ⇒ ۱ یا ۵ قرمز.

پنل (بعد از تایید): `/panel/payments` (فیلترها + «آشتی‌دهیِ دستی») · `/panel/payments/$paymentId` (payloadها، فاکتور، اشتراک؛ verify /
expire (غیرفعال با `expireBlocked`) / refund با `channel`؛ ۴۲۸ ⇒ `StepUpForm` در جا) · لینک از `/panel/teams/$teamId`.

⏳ **سوال‌های سیاستی (بلاک نمی‌کنند؛ پیش‌فرضِ من در پرانتز):** کوپن بعد از استرداد (برنمی‌گردد) · بستنِ ردیفِ یتیم — هیچ مسیرِ دستی، فقط
فرزندخواندگی (هرگز باطل نمی‌شود) · `adoptOrphans` از پنل حتی با `BILLING_ADOPT_ORPHANS=false` (مجاز — عملِ انسانیِ ممیزی‌شده است، نه
sweepِ خودکار) · step-up روی `reconcile`ِ دستی حتی با `dryRun` (بله).

✅ **هر دو توقف تایید شد («تایید شد، برو ادامه»، ۱۴۰۵/۰۷/۰۱).** ادامه پایین.

### ✅ ۶٫۱–۶٫۴ تمام شد — اعداد در [TODO فاز ۶](TODO-M6-admin.md)

- **shared-types:** ده DTO + کدِ خطای `REFUND_REJECTED`، دقیقاً همان پیشنهاد. `adminPaymentSummary` عمداً **بدونِ**
  `cardPanMasked`/payloadهاست و `sdk:contract` ۳۶ روی سیم `"cardPanMasked" in p === false` را می‌سنجد، نه فقط parse.
- **billing-core:** `refund` نوعِ درستش را گرفت (`RefundOutcome` با چهار حالت؛ `unavailable` ≠ `rejected`) و `reverse` جایش روی
  پورت باز شد. Mock هر دو را دارد و **روی authorityِ ناشناخته `rejected` می‌دهد** — با شکستنِ عمدی آزموده شد (یک خط عوض شد ⇒
  تست قرمز)؛ زرین‌پال `unavailable` **بدونِ هیچ fetchی** (سنجه شمارنده‌ی تماس دارد: صفر).
- **api:** `settleLocked`/`lockPaymentForSettle`/`assertGatewayMatches` + قلابِ `onSettled(tx)` + نوشتنِ `verify_payload`
  (بدونِ کارت) و `callback_payload`؛ `refundPayment(tx)`؛ انقضا = verifyِ تازه زیرِ قفل (`expireStalePayment`/`applyExpiry`،
  مشترکِ دستی و sweep)؛ پنج مسیرِ `/admin/payments` (چهار جهش پشتِ step-up، همه در گیتِ ۱۶).
- **پنل:** `/panel/payments` (+`:id`) — chunkِ ورودی **+۳۴۴ B**، chunkِ پنل ۱۸٫۵ → **۳۰٫۱KB**.
- **گیت‌ها:** `pnpm verify` ۱۶ سبز · `sdk:contract` **۴۳/۴۳** · `billing:refund` **۱۰/۱۰** (نو، در CI) · `billing:settle`
  **۱۱/۱۱** · `billing:probe-reconcile` **۱۰/۱۰** · `billing:quota` ۶/۶ · `db:fk-test` سبز با CHECKهای `0009`.

### ★ چیزهایی که اندازه‌گیری عوضشان کرد (فاز ۶)

| چه | چه شد |
|---|---|
| ★★ **سنجه‌ی استرداد با برداشتنِ `FOR UPDATE` سبز مانْد** | چکِ ۱ هرگز قفلِ **استرداد** را نمی‌سنجید: `settlePayment` زودتر همان ردیف را قفل می‌کند و `UPDATE`ِ استرداد پشتِ آن سریالی می‌شود. چکِ ۱۰ اضافه شد — **دو استردادِ هم‌زمان** با درگاهی که داخلِ استرداد ۳۰۰ms کُند است؛ بدونِ قفل دو ردیفِ audit و دو لغوِ اشتراک ⇒ قرمز. (همان درسِ سه‌بارتکرارشده‌ی M4، این‌بار روی استرداد.) |
| ★★ **انقضایی که به فعال‌سازی می‌رسید هیچ auditی نمی‌نوشت** | در **مرورگر** دیده شد: یک جهشِ مالی (اشتراک فعال شد) با actorِ نامعلوم. مسیر حالا برای هر outcomeِ غیرِ `notPaid` ردیفِ `payment.verify` با `via:"expire"` می‌نویسد؛ ابطالِ واقعی ردیفِ `payment.expire`ِ خودش را از `applyExpiry` می‌گیرد. |
| ★★ **قاعده‌ی بازگرداندنِ اشتراک، بارِ اول زیادی پهن بود** | «آخرین `expired`ِ تیم با پایانِ آینده» یک اشتراکِ **بی‌ربطِ کهنه** را از اجرای قبلیِ قرارداد زنده کرد و `sdk:contract` ۴۳ قرمز شد. پیوندِ دقیق در خودِ داده بود: `جایگزین‌شده.current_period_end === لغوشده.current_period_start` (لنگرِ `upsertSubscription`). ⚠️ محدودیتِ صادقانه: تمدید با **پلنِ دیگر** از `now()` لنگر می‌اندازد ⇒ چیزی برنمی‌گردد. |
| cursorِ keyset با `Date`ِ میلی‌ثانیه‌ای | روی PG بازتولید شد: سه ردیف در **یک** دستور ⇒ cursorِ قدیمی صفحه‌ی دوم را **خالی** داد. `created_at::text`/`requested_at::text` + `::timestamptz`؛ `audit-log.ts`ِ فاز ۴ هم همان اصلاح را گرفت. |
| یک اجرای قرمزِ **گذرا**ی `sdk:contract` | چکِ ۴۳ یک درخواستِ OTPِ اضافه می‌زد و در اجراهای پشتِ‌سرِ هم به cooldown می‌خورد. تازه‌کردنِ step-up آن‌جا **فیکسچر** است (مسیرِ واقعی در چک‌های ۱۹–۲۱ اثبات شده) ⇒ با SQL؛ دو اجرای پیاپی سبز. |
| ⚠️ **پورتِ api باز هم جابه‌جا شد** | ۳۴۱۰ داخلِ رنجِ excludedِ ویندوز (۳۳۷۶–۳۴۷۵) افتاد و preview بالا نیامد ⇒ **۱۵۴۰۲** (`.env`، `apps/web/.env.local`، `.claude/launch.json`). همان تله‌ی مستندِ CLAUDE.md، بارِ پنجم. |

### تصمیم‌هایی که گرفتم (فاز ۶)

- **`alreadySettled` وضعیتِ ردیف را برمی‌گردانَد** و callback فقط برای `paid` `?status=ok` می‌دهد — پیش از این یک پرداختِ
  باطل/مسترد به کاربر صفحه‌ی «پرداخت موفق» نشان می‌داد.
- **`verify_payload` روی `gatewayError` هم نوشته می‌شود ولی `failure_code` نه:** «درگاه جواب نداد» پاسخِ درگاه نیست، و کلِ
  نردبانِ ADR-056 روی همان ستون می‌ایستد.
- **auditِ خلاصه‌ی sweepِ دستی پس از اجراست** و این در کد نوشته شده: هر ردیف تراکنشِ خودش را دارد؛ پاسخ‌گوییِ ردیف‌به‌ردیف
  از `payment.expire`/`payment.adopt`ِ داخلِ همان تراکنش‌ها می‌آید.
- **`adoptOrphans` از پنل مجاز است** حتی وقتی `BILLING_ADOPT_ORPHANS=false` است: آن پرچم برای **خودکار** است؛ این‌جا یک
  عملِ انسانیِ ممیزی‌شده با step-up است.
- **کوپن بعد از استرداد برنمی‌گردد** (پیش‌فرضِ ثبت‌شده؛ اگر مالک خواست، یک ADR/گام جدا).

### ★★ ۶٫۵ — بازبینیِ خصمانه‌ی جدا (کدِ پول): ۱۰ یافته، ۸ رفع، ۲ ثبت‌شده

دو بازبینِ مستقل با دو لنز (سرویس/دیتابیس · مسیر/sdk/رابط)، ۴۱۱k توکن، **صفر تکراریِ گیت‌ها**. جدولِ کامل در
[TODO فاز ۶](TODO-M6-admin.md). چهار موردی که بیشترین ارزش را داشتند:

- ★★ **یک پول‌سوزِ M4 که هیچ گیتی نمی‌دیدش:** `activateFromPayment` شمارنده‌ی کوپن را **بی‌قید** `+1` می‌کرد، حتی
  وقتی ردیفِ مصرف با `ON CONFLICT DO NOTHING` درج نشده بود. با کوپنِ سقف‌دار، دومین پرداختِ **پرداخت‌شده**ی همان تیم
  به `coupons_redemptions_ck` می‌خورد ⇒ کلِ تسویه rollback ⇒ ردیف `pending` می‌مانْد و هر verifyِ بعدی هم می‌شکست.
  **چرا نامرئی بود:** جدولِ `coupons` روی این ماشین خالی است و هیچ سنجه‌ای کوپن نمی‌ساخت. حالا `billing:settle` یک چکِ
  کوپنِ سقف‌دار دارد که با شکستنِ عمدی قرمز می‌شود.
- ★★ **بازگردانیِ اشتراک شرطِ `p.status='paid'` را بدونِ قفل می‌خواند:** دو استردادِ هم‌پوشان یک اشتراکِ **زنده‌ی
  بی‌پشتوانه** می‌ساختند. `FOR UPDATE OF s, p` + چکِ ۱۱ با تاخیرِ واقعی داخلِ تراکنشِ رقیب (بدونِ قفل ⇒ قرمز).
- ★★ **دسته‌ی sweep می‌توانست برای همیشه پر بماند** — یک اثرِ جانبیِ خودِ فاز ۶: `assertGatewayMatches` روی حالتِ
  ناهم‌خوان پرتاب می‌کند ولی کوئریِ sweep فقط `gateway` را فیلتر می‌کرد. حالا `gateway_mode` هم فیلتر است و شمارشِ
  ردیف‌های کنارگذاشته در `errors` می‌آید.
- **security:** `GET /admin/payments?refId=…` شماره‌ی پیگیریِ بانکیِ مشتری را در لاگِ nginx می‌نشاند — همان الگویی که
  فاز ۵ بسته بود و کامنتِ خودِ من خلافش را ادعا می‌کرد. حالا `POST /admin/payments/search` با بدنه و ممیزی‌شده
  (`payment.search`: فقط **نوعِ** فیلتر، نه مقدارش). در مرورگر اثبات شد: دو POST، صفر query string در لاگِ api.

★ و دو مورد **عمداً رفع نشد**: کوپن بعد از استرداد برنمی‌گردد (سیاستِ تاییدشده — حالا در RUNBOOK §۷٫۳ و در
`metadata`ی audit دیده می‌شود) · و ردیفی که به دلیلی **غیر** از حالتِ درگاه همیشه می‌شکند، هنوز یک اسلاتِ دسته
می‌گیرد (ستونِ `sweep_attempts` ⇒ فازِ بعد).

⚠️ **سومین سبزِ دروغینِ این فاز:** چکِ «دو استردادِ هم‌زمان»ِ خودم قفلِ **بازگردانی** را نمی‌سنجید — تازه وقتی
بازبین یافته‌ی ۲ را داد و چکِ ۱۱ نوشته شد، معلوم شد آن مسیر اصلاً پوشش نداشت. الگو تکرار شد: **هر چکِ همزمانی
تا وقتی با برداشتنِ همان قفل قرمز نشود، فقط یک ادعاست.**

### ✅ فاز ۶ تمام شد (۱۴۰۵/۰۷/۰۲) — **تایید شد**

همه‌ی گیت‌ها بعد از رفع‌های ۶٫۵ دوباره اجرا شدند: `pnpm verify` **۱۶ گیت سبز** · `sdk:contract` **۴۳/۴۳** ·
`billing:refund` **۱۱/۱۱** · `billing:settle` **۱۱/۱۱** · `billing:probe-reconcile` **۱۰/۱۰** · `billing:quota` ۶/۶ ·
`db:fk-test` ۱۱/۱۱ · `admin:access` ۸/۸ (رگرسیونِ فاز ۵). در مرورگر: جست‌وجوی POST بدونِ query string، برچسبِ
گزارشِ آزمایشی، دو متنِ تاییدِ متفاوت، ۴۲۸ ⇒ step-up ⇒ استرداد، و **ابطالی که به فعال‌سازی رسید** (`activated`).

⏭ **قدمِ بعد: فاز ۷ (آمار و وضعیتِ سیستم) — هنوز شروع نشده؛** با تاییدِ صریحِ مالک. DTOهای آن فاز
(`AdminStats`، `SystemStatus`) طبقِ D12 با توقفِ ثبت‌شده می‌آیند.

⚠️ **چیزهای بازِ این فاز:** ستونِ `sweep_attempts` برای ردیفِ همیشه‌شکست · کوپنِ سوخته بعد از استرداد (سیاست) ·
`batchSize`ِ همگام در برابرِ مهلتِ nginx (۲۰۲ + polling اگر روزی لازم شد) · و از قبل: کلیدِ sms.ir، `--prune`،
`--to-live`، سه محدودیتِ ۵٫۵، «خروج»ِ web، خطای بدنه‌ی خالیِ Fastify، `rt-seed`.

### ✅ فاز ۶ تایید شد (۱۴۰۵/۰۷/۰۲) — نقطه‌ی توقف پیش از فشرده‌سازیِ context

اسناد به‌روز است (TODO/PROGRESS، CLAUDE.mdِ ریشه و api/web/sdk، RUNBOOK §۵ و §۷٫۳، infra/README، CI با
`billing:refund`). **فاز ۷ شروع نشده.** کارِ فازهای ۰–۶ در یک کامیت روی `main` ثبت شد (پیش از آن، ۱۲۰ فایلِ
کامیت‌نشده در working tree بود).

sessionِ بعدی از این‌جا: [TODO-M6 فاز ۷](TODO-M6-admin.md) — آمارِ محصول با **SQLِ خالص** (`::bigint`، بدونِ جدولِ
شمارنده — درسِ B-5) و `GET /admin/system` (DB · S3 روی هر سه باکت · Redis با RESP PING روی `node:net` · سنِ
آخرین پشتیبان با آستانه‌ی **۳۰ ساعت** · وضعیتِ آشتی‌دهی)، به‌علاوه‌ی `last_seen_at` که از M3 هرگز نوشته نشده.
DTOهای آن فاز (`AdminStats`، `SystemStatus`) طبقِ D12 با یک توقفِ ثبت‌شده می‌آیند؛ `/readyz` **دست‌نخورده**
می‌مانَد (ADR-067). پیش از هر کد: `pnpm db:up && pnpm db:migrate`؛ بعد از هر گام: `pnpm verify` (۱۶ گیت).

⚠️ چیزهای باز (هیچ‌کدام فاز ۷ را بلاک نمی‌کند): ستونِ `sweep_attempts` برای ردیفِ همیشه‌شکستِ sweep · کوپنِ
سوخته بعد از استرداد (سیاستِ ثبت‌شده) · `batchSize`ِ همگامِ sweep در برابرِ مهلتِ ۶۰ثانیه‌ای nginx · ۱٫۰ (کلیدِ
sms.ir در `.env`ِ محلی) · عددِ `--prune`/نگهداشتِ آینه · `--to-live` روی داده‌ی واقعی · سه محدودیتِ ۵٫۵ ·
«خروج»ِ web نشست را در سرور نمی‌بندد (M3) · خطای بدنه‌ی خالیِ Fastify ⇒ ۵۰۰ (M3) · `rt-seed` کاربرانِ
`seed-member` را پاک نمی‌کند (M2/M3).
