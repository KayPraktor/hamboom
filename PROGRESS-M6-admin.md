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

---

## ◑ فاز ۷ — آمار و وضعیتِ سیستم (شروع ۱۴۰۵/۰۷/۰۳، تاییدِ مالک)

### ★★ ۷٫۰ — آنچه **پیش از کد** روی دیتابیس و انبارِ زنده اندازه گرفته شد

پنج خواننده‌ی موازی روی کد (۹۵۸k توکن) + شش probeِ مستقل روی PG/MinIOِ واقعی. هفت چیز عوض شد یا
جلوی یک اشتباه را گرفت:

| # | اندازه‌گیری | چرا مهم است |
|---|---|---|
| ۱ | **`subscriptions.plan_code` است، نه `plan_id`** (FK به `plans(code)`) | کوئریِ «اشتراک به تفکیکِ پلن»ِ نقشه اصلاً کامپایل نمی‌شد |
| ۲ | **`users.last_seen_at`: ۱۹ کاربر، صفر مقدار** | ادعای فاز ۰ روی دیتابیسِ زنده تایید شد؛ «کاربرِ فعال» پیش از ۷٫۱ یک **صفرِ راست‌گونما** بود |
| ۳ | **B-2 زنده:** `sum(x)` → OID **۱۷۰۰** (رشته) · `sum(x)::bigint` و `count(*)` → OID **۲۰** · `avg` → ۱۷۰۰ | هر تجمیعِ پولی باید `::bigint` بخورد؛ `avg` اصلاً استفاده نشود |
| ۴ | **سطلِ روزانه‌ی UTC با روزِ تهران نمی‌خواند: ۴ از ۱۶ سطل** روی همین داده | معیارِ پذیرشِ ۷٫۲ («گروه‌بندیِ UTC») برچسبِ جلالی را ۳٫۵ ساعت دروغ می‌کند — **پیشنهادِ تغییر، پایین** |
| ۵ | **ایندکس لازم نیست:** روی جدولِ ۳۰۰هزار ردیفی، سریِ ۳۰ روزه **۱۶ms** بدونِ ایندکس و **۵ms** با آن (۳٫۶×)، و ایندکس ۶٫۱MB روی جدولِ ۱۳MB | `0010` نوشته **نمی‌شود**؛ تریگرش ثبت می‌شود |
| ۶ | ★★ **`headObject` روی باکتِ ناموجود هم `null` می‌دهد** (۶٫۹ms) — فقط `iteratePrefix` صادقانه `NoSuchBucket` پرتاب می‌کند (۲٫۵ms) | چکِ سلامتِ S3 با `headObject` یک **سبزِ دروغین** تمام‌عیار بود |
| ۷ | **RESP PING روی `node:net` کار می‌کند بدونِ هیچ وابستگی:** زنده `+PONG` ۱۵٫۸ms · پورتِ بسته `ECONNREFUSED` ۲٫۶ms · IPِ سیاه‌چاله **۱۵۰۷ms (مهلت)** · میزبانِ ناموجود هم **مهلت**، نه `ENOTFOUND` | نجات‌دهنده **مهلتِ خودمان** است نه کدِ خطا — همان درسِ ۲۱ثانیه‌ایِ `/readyz`ِ M5 |

چیدمانِ واقعیِ باکتِ `backups` هم دیده شد: `pg/<db>-<stamp>.dump` + `pg/<db>-<stamp>.json` کنارِ هم،
آینه زیرِ `storage/<bucket>/<key>` و مانیفستش `storage/manifest-<stamp>.json`.

### ✅ ۷٫۱ — `last_seen_at` نوشته می‌شود (M6-D8)

[`touchLastSeen(db, userId)`](apps/api/src/routes/auth.ts) — گلو **در خودِ `WHERE`** است نه در کد:
`last_seen_at IS NULL OR last_seen_at < now() - $2::interval` با `$2 = '15 minutes'`. حداکثر یک UPDATE
هر ۱۵ دقیقه به‌ازای هر کاربر، هرچند بار که refresh بزند.

★★ **و عمداً بیرونِ تراکنشِ چرخش صدا زده می‌شود — این را probe تعیین کرد، نه سلیقه.** آن تراکنش روی
همان ردیفِ `users` قفلِ `FOR SHARE` دارد (یافته‌ی بازبینیِ ۵٫۵)، پس یک UPDATE داخلش **ارتقای قفل**
است. روی PGِ زنده با دو نشستِ هم‌پوشان سنجیده شد:

| کجا نوشته شود | نتیجه |
|---|---|
| **داخلِ** تراکنشِ `FOR SHARE` | ⛔ `40P01 deadlock detected` برای یکی از دو نشست — یعنی ۵۰۰ و از دست رفتنِ توکنِ چرخیده |
| **بیرون** (طرحِ اجرا‌شده) | ✅ هر دو commit؛ یکی ۱ ردیف می‌نویسد، دیگری ۰ — خودِ گلو سریالی‌شان می‌کند |

⚠️ دورِ اولِ همین probe **خودش سبزِ دروغین بود**: سناریوی «بیرون» هر دو نشست ۰ ردیف زدند، چون
سناریوی قبلی مقدار را ست کرده بود و گلو جلوی هر دو را گرفت — یعنی هیچ UPDATEی واقعاً قفلی نگرفت و
«بن‌بست ندارد» چیزی را ثابت نمی‌کرد. با یک ریست بینِ دو سناریو دوباره اجرا شد.

⊕ **فراتر از D8، یک خط:** ورود (`/auth/otp/verify`) هم همین را صدا می‌زند. بدونش نشستِ کوتاه‌تر از
۱۵ دقیقه هرگز به refresh نمی‌رسد و هیچ ردی نمی‌گذارد ⇒ «کاربرِ فعالِ امروز» سیستماتیک کم می‌شمارد.
اگر مالک بخواهد، برداشتنش یک خط است.

**اثبات:** تستِ واحدِ [`auth.test.ts`](apps/api/src/routes/auth.test.ts) (۳ تست، شکلِ SQL و گلو) که با
برداشتنِ عمدیِ شرطِ گلو **فقط چکِ درستش** قرمز شد · و چکِ **۴۴**ی `sdk:contract` روی PGِ زنده: ورود
می‌نویسد ⇒ refreshِ بلافاصله **نمی‌نویسد** ⇒ بعد از عقب‌بردنِ ۲۰ دقیقه‌ای دوباره **می‌نویسد**.
`sdk:contract` **۴۴/۴۴**، سه اجرای پیاپی.

### ★★ ۷٫۱ یک باگِ ۴۲۸ی حلقه‌ای در فاز ۳ پیدا کرد (رفع شد)

هنگامِ پایدارسازیِ `sdk:contract` دو شکستِ «گذرا» دیده شد که گذرا نبودند: یک‌بار ۴۲۸ روی تعلیق
(چکِ ۳۱) و یک‌بار «`stepUpVerifiedAt` تازه نیست: **-2ms**» (چکِ ۱۹).

علت در [`stepUpFresh`](apps/api/src/admin-guard.ts) بود: `age >= 0 && age <= window`.
مهرِ `step_up_verified_at` را **Postgres** با `now()` می‌زند ولی تازگی را **Node** با `Date.now()`
می‌سنجد — دو ساعتِ متفاوت (در production دو کانتینرِ جدا). اندازه‌گیری روی همین ماشین: ساعتِ PG
**۰ تا ۲ میلی‌ثانیه جلوتر**. یعنی یک میلی‌ثانیه اختلاف کافی بود تا step-upِ تازه‌ی تازه «کهنه» شمرده
شود: staff کد را وارد می‌کرد و عملِ بعدی‌اش **باز ۴۲۸** می‌گرفت. حلقه‌ی بی‌پایان، بدونِ هیچ پیامِ
قابلِ فهم — و روی یک VM با دریفتِ NTP بدتر.

رفع: رواداریِ صریحِ `CLOCK_SKEW_TOLERANCE_MS = 2_000`. عمداً کوچک است (کانتینرهای یک میزبان در حدِ
میکروثانیه اختلاف دارند) و پنجره را عملاً باز نمی‌کند؛ بزرگ‌تر از این دیگر skew نیست بلکه **خرابیِ
ساعت** است — و `GET /admin/system` در ۷٫۴ خودِ اختلاف را نشان می‌دهد تا نامرئی نماند.
تستِ نو (skewِ ۲ms تازه است · ۲٬۰۰۱ms نیست · آینده‌ی دور نیست) با برگرداندنِ `age >= 0` **قرمز** شد و
بقیه سبز ماندند.

⚠️ **درسِ روش:** «گذرا» یک تشخیص نیست. دو قرمزِ نامرتبط در سه اجرا، یک باگِ واقعیِ تولید بود که هیچ
گیتی قطعی نمی‌گرفتش چون فقط وقتی شلیک می‌شد که ساعتِ دیتابیس تصادفاً جلو می‌افتاد.

### ⏸ توقفِ D12 — پیشنهادِ shared-types برای کلِ فاز ۷ (یک توقف)

همه **افزودنی** در [`admin.ts`](packages/shared-types/src/api/admin.ts)، **هیچ کدِ خطای نو** لازم نیست:

```ts
// ── فاز ۷ — آمار و وضعیتِ سیستم ──
export const adminStatsQuery = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) });
const statPoint      = z.object({ date: isoDateTime, count: nonNegative });  // date = شروعِ **روزِ تهران**
const statMoneyPoint = z.object({ date: isoDateTime, rial });
export const adminPlanUsage = z.object({
  planCode: z.string(), planName: z.string(),          // عمداً رشته — پلنِ نو نباید قرارداد را بشکند
  period: z.enum(["monthly","yearly"]).nullable(),     // null = تیمِ بی‌ردیفِ اشتراک (free/personal)
  teams: nonNegative, seats: nonNegative });
export const adminStats = z.object({
  generatedAt: isoDateTime, windowDays: nonNegative,
  users: z.object({ total, suspended, staff, active1d, active7d, active30d, newInWindow,
    activityTracked: z.boolean() }),   // ★ false ⇒ هنوز هیچ ردیفی last_seen_at ندارد: سه عددِ فعال «نامعلوم»اند، نه صفر
  boards: z.object({ live, trashed, newInWindow }),
  teams:  z.object({ total, personal, newInWindow }),
  plans: z.array(adminPlanUsage),
  revenue: z.object({ grossRial: rial, refundedRial: rial,
    netRial: z.number().int(),         // ⚠️ **علامت‌دار**: استردادِ پرداختی از پیش از پنجره می‌تواند منفی‌اش کند
    windowGrossRial: rial }),
  series: z.object({ boards: z.array(statPoint), users: z.array(statPoint), revenue: z.array(statMoneyPoint) }) });
export const systemCheckState = z.enum(["ok","warn","fail","unknown"]);
export const systemCheck = z.object({ key: z.string(), state: systemCheckState,
  detail: z.string(),                  // فارسیِ کوتاه — هرگز رشته‌ی اتصال یا راز (P7)
  latencyMs: nonNegative.nullable() });
export const systemStatus = z.object({
  generatedAt: isoDateTime, state: systemCheckState,   // بدترینِ چک‌ها
  checks: z.array(systemCheck),                        // db · s3:assets · s3:snapshots · s3:backups · redis
  backup: z.object({ lastDumpAt: isoDateTime.nullable(), lastMirrorAt: isoDateTime.nullable(),
    ageHours: z.number().nullable(), staleAfterHours: nonNegative }),   // آستانه ۳۰ ساعت (عددِ سیاستیِ فاز ۰)
  reconcile: z.object({ enabled: z.boolean(), intervalSeconds: nonNegative, lastRunAt: isoDateTime.nullable(),
    runs, activated, expired, orphans, adopted, errors }),             // همه int≥0
  clockSkewMs: z.number().nullable() });                // ★ ساعتِ PG منهای ساعتِ api — همان چیزی که باگِ ۴۲۸ را ساخت
export const adminFeatureFlag = z.object({ key: z.string(), enabled: z.boolean(),
  rolloutPct: z.number().int().min(0).max(100), teamIds: z.array(uuid), updatedAt: isoDateTime });
```

**مسیرها (هر سه `internal`، هر سه `GET` و فقط `staffOnly`):** `GET /admin/stats?days=30` ·
`GET /admin/system` · `GET /admin/feature-flags`. هیچ‌کدام `audited()` ندارند — گیتِ ۱۶ فقط جهش را
می‌خواهد و یک GETِ ممیزی‌شده با هر بار باز‌کردنِ داشبورد یک ردیفِ audit می‌نویسد.
**sdk:** `admin.stats(query)` · `admin.system()` · `admin.featureFlags()`.
**پنل:** `/panel/stats` و `/panel/system` (پرچم‌ها در همان صفحه‌ی system).

### ⏸ چهار انحراف از معیارهای نوشته‌شده‌ی TODO که تاییدِ مالک می‌خواهند

| # | نوشته بود | پیشنهاد، با عدد |
|---|---|---|
| الف | ۷٫۲: «گروه‌بندیِ روزانه **UTC**، جلالی در نما» | **گروه‌بندی با روزِ تهران** (`AT TIME ZONE 'Asia/Tehran'`). چون `@hamboom/i18n` در نما `Asia/Tehran` را **پین** کرده، سطلِ UTC یعنی برچسبِ «۱۴۰۵/۰۷/۰۱» روی بازه‌ی ۰۳:۳۰ تا ۰۳:۳۰. روی همین داده **۴ از ۱۶** سطل روزِ دیگری می‌افتد |
| ب | ۷٫۳: «`formatToman`/`formatJalaliDate`/`toPersianDigits`» | **هر سه از قبل در [`@hamboom/i18n`](packages/i18n/src/) هستند** (ADR-024). ۷٫۳ فقط نمودارِ SVG می‌مانَد. ⚠️ و یک ناسازگاری: `panel/payment-fa.ts` محلی `Math.round` دارد و i18n `Math.trunc` — پیشنهاد: پنل هم `formatToman` بخورد (یک خط، فقط نمایش) |
| ج | ۷٫۴: «S3 **head** روی هر سه باکت» | **`iteratePrefix`، نه `headObject`** — چون `headObject` روی باکتِ ناموجود هم `null` می‌دهد (اندازه‌گیری‌شده) و چکِ سلامت سبزِ دروغین می‌شد |
| د | (نانوشته) `REDIS_URL`/`S3_BUCKET_BACKUPS` برای api | **اختیاری**، نه اجباری. `redisEnvSchema` پیش‌فرض ندارد؛ افزودنش به `apiEnvSchema` یعنی api **همه‌جا** بدونِ آن بوت نمی‌شود (`.env.example`ِ CI، انکرِ `x-api-env`ِ compose). برای یک چکِ سلامت، «پیکربندی نشده» جوابِ درست است نه مرگِ سرور — برعکسِ `AUDIT_RETENTION_DAYS` که سیاستِ مخرب بود |

⊕ و دو چیزِ ثبت‌شده که **کاری نمی‌خواهند**: ایندکسِ آمار لازم نیست (۱۶ms روی ۳۰۰هزار ردیف؛ تریگرش
وقتی است که این عدد از ~۲۰۰ms رد شود) · و `ObjectStore.copyObject` که M6-D11/ADR-069 وعده داده بود
**هرگز اضافه نشد** (آینه با `getObjectStream`→`putObjectStream` کپی می‌کند) — دریفتِ سند، نه باگ.

### ⏸ جدولِ لمسِ فاز ۷ (قانونِ ۱)

| فایل | چه | وضع |
|---|---|---|
| `apps/api/src/routes/auth.ts` | `last_seen_at` در ورود و refresh | ✅ در جدولِ تاییدشده‌ی TODO (فاز ۷) |
| `apps/api/src/admin-guard.ts` | رواداریِ skewِ ساعت (باگِ ۴۲۸) | ✅ کدِ خودِ M6 |
| `apps/api/src/{dto,openapi,app}.ts` · `packages/sdk/src/client.ts` · `packages/config/src/sections.ts` | mapper · `internal`+`INTERNAL_SCHEMAS` · ثبتِ registrar · `admin.*` · envِ نو | ✅ در جدولِ تاییدشده (فازهای ۳–۷) |
| `packages/shared-types/src/api/{admin,index}.ts` | DTOهای بالا | ⏸ **همین توقفِ D12** |
| `apps/api/src/metrics.ts` | فقط **خواندنِ** `ReconcileSnapshot` (تزریق به registrar) | ⏸ تاییدِ لمس |
| `.env.example` · `.env.production.example` · `infra/docker/docker-compose.prod.yml` (انکرِ `x-api-env`) · `.github/workflows/ci.yml` | سیم‌کشیِ `REDIS_URL`/`S3_BUCKET_BACKUPS`ِ اختیاری | ⏸ تاییدِ لمس |
| `apps/web/src/{router.tsx,panel/*,styles/app.css}` | دو صفحه‌ی نو + نمودارِ SVG | ✅ دامنه‌ی خودِ M6 |
| `apps/web/src/panel/payment-fa.ts` | یکی‌کردنِ گِردکردنِ تومان با i18n | ⏸ انحرافِ «ب» |

⚠️ **باز و بی‌ربط به فاز ۷:** `reconcileRecorder` فقط مسیرِ **تایمر** را می‌شمارد (sweepِ دستیِ فاز ۶
به آن دست نمی‌زند) و `lastRunAt = 0` سه معنیِ متفاوت دارد (خاموش · هنوز نوبتش نرسیده · قفل را باخته)؛
`GET /admin/system` باید هر سه را جدا بگوید، نه «هشدار».

### ✅ D12 و چهار انحراف تایید شدند (۱۴۰۵/۰۷/۰۳) — و ۷٫۲ تا ۷٫۵ ساخته شد

DTOها همان شکلِ پیشنهادی نشستند؛ **هیچ کدِ خطای نویی** لازم نشد. سه مسیرِ `GET`ِ `internal`
(`/admin/stats`، `/admin/system`، `/admin/feature-flags`) همه فقط `staffOnly` و **بدونِ**
`audited()` — گیتِ ۱۶ فقط جهش را می‌خواهد و یک GETِ ممیزی‌شده با هر بار باز‌کردنِ داشبورد ممیزیِ
واقعی را زیرِ نویز دفن می‌کند.

**۷٫۲ — [`services/admin-stats.ts`](apps/api/src/services/admin-stats.ts):** سه سازنده‌ی کوئریِ
**خالص** (`buildTotalsQuery`/`buildPlansQuery`/`buildSeriesQuery`) + یک `readStats` با سه
رفت‌وبرگشتِ موازی. روی دیتابیسِ زنده **۳۵ms** و **هر مقدار `number`**.
★ «تیم‌ها به تفکیکِ پلن» از `teams` شروع می‌شود و `subscriptions` را LEFT JOIN می‌کند: شروع از
`subscriptions` هر تیمِ رایگان و شخصی را بی‌صدا حذف می‌کرد — یعنی **۱۸ از ۲۰** تیمِ این ماشین.
سری‌ها با `generate_series` **صفر‌پُر**اند (نمودارِ با روزهای غایب شیب را عوض می‌کند).

**۷٫۳ — [`BarChart.tsx`](apps/web/src/panel/BarChart.tsx):** ~۹۰ خط SVG، صفر وابستگی، رنگ از
توکن‌های `--hb-*` (پس حالتِ تیره مجانی است)، tooltip با `<title>`ِ بومیِ SVG و بدونِ یک خط
جاوااسکریپت. ⚠️ **بدونِ `xmlns`** — JSXِ درون‌خطی لازمش ندارد و نوشتنش یک میزبانِ `http://…` به
سورسِ runtime اضافه می‌کرد که گیتِ P2 قرمزش می‌کند.
★ زمان **از راست به چپ** می‌رود (قدیمی‌ترین سمتِ راست) — رابط فارسیِ native است، و استثنای P6
مالِ **مختصاتِ بوم** است نه نمودار. در مرورگر با خواندنِ `x`ِ هر `rect` اثبات شد.

**۷٫۴ — [`services/system-status.ts`](apps/api/src/services/system-status.ts):** هشت چک،
همه **موازی** و هر کدام با مهلتِ خودش، پس سقفِ زمانِ درخواست ≈ یک مهلت است نه جمعشان.
روی استکِ واقعی: db **۴ms** · سه باکت **۷/۱۰/۱۱ms** · Redis **۵ms (PONG)** با `node:net` و
**صفر وابستگیِ نو** · اختلافِ ساعت ۳–۱۲ms · سنِ پشتیبان **۲۸۹٫۸ ساعت ⇒ هشدار** (وضعِ واقعیِ همین
ماشین، نه یک نمونه‌ی ساختگی) · آشتی‌دهی **نامعلوم** چون خاموش است.

**۷٫۵ —** نمای فقط‌خواندنیِ `feature_flags` در همان صفحه. جدول امروز **خالی** است و همان
نوشته می‌شود؛ پرچمِ نمایشیِ ساختگی ساخته نشد.

### ★★ سه سبزِ دروغین که در گیت‌های **خودم** پیدا شدند (فاز ۷)

قانونِ ۴ («هر گیت با یک شکستنِ عمدی قرمز شده باشد») این فاز سه بار جواب داد، و هر سه بار
مقصر گیتِ خودم بود، نه کد:

| # | ادعا | شکستنِ عمدی نشان داد |
|---|---|---|
| ۱ | چکِ ۴۵ی قرارداد «افتادنِ `::bigint` را می‌گیرد» | **نگرفت.** `toAdminStats` هر مقدار را از `Number()` رد می‌کند، پس رشته پیش از رسیدن به قرارداد عدد می‌شود. ⇒ کامنت اصلاح شد و شکلِ **کوئری** در [`admin-stats.test.ts`](apps/api/src/services/admin-stats.test.ts) قفل شد (همان شکستن آن‌جا قرمز می‌شود) |
| ۲ | همان چک «سطلِ UTC را می‌گیرد» | **نگرفت.** با سطلِ UTC مجموعِ سری و برچسبِ سطل‌ها **هر دو** همان می‌مانند؛ فقط ردیف‌ها به روزِ دیگری می‌افتند. ⇒ چکِ **۴۹**: بوردی با `created_at` = ۱:۰۰ بامدادِ تهران (= ۲۱:۳۰ی دیروزِ UTC) باید در **آخرین** سطل بنشیند. با UTC قرمز شد: «آخری ۰، قبلی ۱» |
| ۳ | probeِ بن‌بستِ ۷٫۱ «سناریوی بیرونِ تراکنش را می‌سنجد» | **نمی‌سنجید.** هر دو نشست ۰ ردیف زدند (گلو از سناریوی قبلی پر بود) یعنی هیچ UPDATEی قفلی نگرفت. با یک ریست بینِ دو سناریو دوباره اجرا شد |

⊕ و یک ناوردای متقاطع اضافه شد که ارزشِ مستقل دارد: **مجموعِ هر سری = مجموعِ همان پنجره**
(`series.boards` ↔ `boards.newInWindow` و همتایانش). بدونِ آن، یک سریِ سراسر صفر — مثلاً وقتی
کلیدِ joinِ `generate_series` با سطل نخوانَد — از همه‌ی چک‌های شکلی سبز رد می‌شد.

⊕ و یک سبزِ دروغینِ چهارم **پیش از کد** گرفته شد (۷٫۰): `headObject` روی باکتِ **ناموجود** هم
`null` می‌دهد، پس چکِ سلامتی که نقشه نوشته بود روی باکتِ گم‌شده یا نامِ غلط سبز می‌مانْد.
تستِ واحد با برگرداندن به `headObject` **دقیقاً همان یک تست** را قرمز می‌کند.

### اندازه‌گیری‌های فاز ۷

| چه | عدد |
|---|---|
| `readStats` روی دیتابیسِ زنده | **۳۵ms** (۳ کوئریِ موازی) |
| سریِ ۳۰ روزه روی جدولِ **۳۰۰هزار ردیفی** | **۱۶ms** بدونِ ایندکس · **۵ms** با ایندکسِ جزئی (۳٫۶×، به قیمتِ ۶٫۱MB روی جدولِ ۱۳MB) ⇒ **ایندکس اضافه نشد**؛ تریگرِ بازنگری: عبور از ~۲۰۰ms |
| `GET /admin/system` روی استکِ واقعی | db ۴ms · assets ۷ms · snapshots ۱۰ms · backups ۱۱ms · redis ۵ms |
| PINGِ RESP با `node:net` (۷٫۰) | زنده **۱۵٫۸ms** · پورتِ بسته `ECONNREFUSED` **۲٫۶ms** · IPِ سیاه‌چاله **۱۵۰۷ms = خودِ مهلت** · میزبانِ ناموجود هم **مهلت**، نه `ENOTFOUND` |
| اختلافِ ساعتِ PG↔Node | probeِ مستقیم **۰–۲ms** · از راهِ `/admin/system` **۳–۱۲ms** (تخمین است؛ خطایش ≈ نصفِ رفت‌وبرگشت — در نما هم همین نوشته شده) |
| chunkِ ورودیِ web | ۱٬۷۵۶٬۵۲۷ → **۱٬۷۵۷٬۰۴۱** بایت (**+۵۱۴ B**، معیارِ ۳٫۶ < ۱KB) |
| chunkِ پنل | ۳۱٬۴۹۵ → **۴۲٬۲۹۰** بایت (+۱۰٫۵KB برای دو صفحه + نمودار) |
| P2 روی chunkِ پنلِ ساخته‌شده | **صفر** میزبانِ خارجی |
| `sdk:contract` | **۴۹/۴۹** |

### اثباتِ مرورگر (staff واقعی، استکِ واقعی)

`/panel/stats`: ارقامِ فارسی، تومان، برچسبِ جلالی، ۳۰ میله با tooltip، کلیدِ پنجره ۷/۳۰/۹۰ با
`aria-pressed` و درخواستِ `GET /admin/stats?days=7` ⇒ ۷ میله و عددِ درآمدِ متفاوت ·
جدولِ پلن‌ها با «فضای شخصی ۱۶ / رایگان ۲ / حرفه‌ای ۱ / پلنِ قرارداد ۱».
`/panel/system`: نشانِ کلیِ **هشدار** (به‌خاطرِ پشتیبانِ ۲۸۹ ساعته)، هشت چک با زمانِ پاسخ،
Redis **PONG**، و پرچم‌های خالی با متنِ صادق.
⚠️ یک نکته حین همین اثبات دیده شد و رفع شد: ارقامِ داخلِ `detail` لاتین می‌ماندند (سرور آن‌ها را
می‌سازد و **نباید** فارسی‌شان کند — آن‌جا لایه‌ی نمایش نیست)، پس تبدیل در خودِ نما انجام می‌شود (P6).

### ✅ فاز ۷ تمام شد (۱۴۰۵/۰۷/۰۳) — **تایید شد**

همه‌ی گیت‌ها بعد از کلِ کار دوباره اجرا شدند: `pnpm verify` **۱۶ گیت سبز** (exit 0، صفر OOM،
`Tasks:` سالم) · `sdk:contract` **۴۹/۴۹** · `admin:access` **۸/۸** (رگرسیونِ فاز ۵ — چون ۷٫۱ به
`routes/auth.ts` و ۷٫۱b به `admin-guard.ts` دست زد) · `billing:refund` · `billing:settle` ·
`billing:probe-reconcile` · `billing:quota` · `db:fk-test` همه سبز.

⚠️ **یک قرمزِ آموزنده در همین اجرای پایانی:** چکِ ۱۷ («کاربرِ عادی ⇒ ۴۰۳») افتاد — نه به‌خاطرِ کد،
بلکه چون برای اثباتِ مرورگر به همان شماره‌ی کاربرِ قرارداد دستی staff داده بودم. `finally`ی خودِ
اسکریپت آن را پاک می‌کرد و اجرای بعدی سبز می‌شد، ولی مسئله سرِ جایش می‌مانْد: **یک گیت نباید به
حالتِ محیطی که خودش نساخته تکیه کند.** حالا پیش از آن چک یک فیکسچرِ صریحِ `is_staff = false` هست.

⏭ **قدمِ بعد: فاز ۸ (E2E و سخت‌سازی) — هنوز شروع نشده؛** با تاییدِ صریحِ مالک.

⚠️ **چیزهای بازِ این فاز (هیچ‌کدام فاز ۸ را بلاک نمی‌کند):**
شمارنده‌های آشتی‌دهی فقط مسیرِ **تایمر** را می‌شمارند (sweepِ دستیِ فاز ۶ به آن‌ها دست نمی‌زند، و
نودی که قفلِ رهبری را باخته هیچ‌وقت ثبت نمی‌کند) ·
`ObjectStore.copyObject` که M6-D11/ADR-069 وعده داده بود **هرگز اضافه نشد** (آینه با
`getObjectStream`→`putObjectStream` کپی می‌کند) — دریفتِ سند، نه باگ ·
`restore-drill` همان تله‌ی `sort().at(-1)` را روی کلیدِ `pg/<db>-<stamp>.dump` دارد (با یک نامِ
دیتابیس بی‌اثر است، با دو تا نه؛ `system-status` از مهرِ داخلِ نام استفاده می‌کند و این تله را ندارد) ·
ایندکسِ آمار وقتی سریِ ۳۰ روزه از ~۲۰۰ms رد شد ·
و از قبل: ستونِ `sweep_attempts` · کوپنِ سوخته بعد از استرداد · کلیدِ sms.ir (۱٫۰) · عددِ `--prune` ·
`--to-live` · سه محدودیتِ ۵٫۵ · «خروج»ِ web · خطای بدنه‌ی خالیِ Fastify · `rt-seed`.
### ✅ فاز ۷ تایید شد (۱۴۰۵/۰۷/۰۳)

اسناد به‌روزند (TODO/PROGRESS، CLAUDE.mdِ ریشه و api/web، RUNBOOK §۵ و §۷٫۴/۷٫۵، `.env.example`،
`.env.production.example`، انکرِ `x-api-env`ِ composeِ production). **فاز ۸ شروع نشده.**

⏭ sessionِ بعدی از [TODO-M6 فاز ۸](TODO-M6-admin.md): E2Eِ playwright روی استکِ واقعی · رگبار روی
`/admin` ⇒ ۴۲۹ی nginx · P2 روی باندلِ واقعی + `license:check --strict` · E2Eِ «چسباندنِ لینکِ ویدیو» ·
اندازه‌گیریِ CSP (بدونِ enforce).

---

## ★★ اولین استقرارِ واقعی روی آروان (۱۴۰۵/۰۷/۰۳) — و شش چیزی که فقط همین‌جا دیده شد

> ⚠️ این بخش **کارِ فاز نیست** — ثبتِ یک استقرار است. فاز ۸ هنوز شروع نشده.

جمله‌ای که از M5 در همه‌ی اسناد مانده بود («هیچ‌چیز هنوز روی VMِ آروان اجرا نشده») دیگر
درست نیست. `https://hamboom.ir` با TLS زنده است و کلِ استک روی VMِ آروان بالا آمد.

**مشخصاتِ VM (اولین عددِ ثبت‌شده — RUNBOOK تا امروز هیچ عددی نداشت):**
۲ هسته · **۱٫۹ GiB رم** · ۳۰ GB دیسکِ آزاد · Ubuntu (کرنل ۶٫۸) · Docker 29.8 + Compose v5.5.
با ۲ گیگ swap و `vm.swappiness=10`. در حالتِ بی‌کار ~۴۷۴MB مصرف شد، یعنی ~۱٫۵Gi آزاد.

**probeِ شبکه‌ی VM — تصمیمِ بازِ [ADR-063](ARCHITECTURE_DECISIONS.md#adr-063) بسته شد:**
`postgres:16-alpine` در **۳۴ ثانیه** از Docker Hub کشیده شد ⇒ `--base` لازم نیست.
مقصدهای runtime هم همه باز: `api.sms.ir` **۴۰۴** · `payment.zarinpal.com` **۳۰۲** ·
`s3.ir-thr-at1.arvanstorage.ir` **۲۰۰**. (۴۰۴ و ۳۰۲ «باز»اند — فقط `000` یعنی نرسید؛ همان
چیزی که خودِ `probe-vm.sh` با اندازه‌گیری ثبت کرده بود.)

`infra:ship` بدونِ ایراد کار کرد: آرشیوِ **۱۸۶MB**، و هر سه ایمیج در مقصد **هم‌شناسه** با مبدأ.

### شش یافته — هیچ‌کدام را یک گیتِ محلی نمی‌گرفت

| # | چه | چرا هیچ گیتی نمی‌گرفتش |
|---|---|---|
| ۱ | ★★ **رمزِ داخلِ رشته‌ی اتصال باید هگز باشد** — رمزِ حاویِ `@`/`:`/`#` بی‌صدا URL را می‌شکند و `28P01` می‌دهد | رمز را اپراتور می‌سازد، نه کد. هیچ تستی رشته‌ی اتصالِ واقعی را نمی‌بیند |
| ۲ | ★ **آزمونِ تفکیک‌کننده‌ی `28P01`**: اگر `PGPASSWORD` مستقیم وصل شود ولی `DATABASE_URL` نه ⇒ **رشته‌ی اتصال** خراب است نه رمز؛ اگر هیچ‌کدام ⇒ دیتابیس با رمزِ دیگری initialize شده (`POSTGRES_PASSWORD` فقط در initdb اثر دارد) | یک تشخیصِ اپراتوری، نه یک ادعای کد |
| ۳ | ⚠️ **`WEB_BASE_URL` گاردِ بوت ندارد** در حالی که همسایه‌اش `ZARINPAL_CALLBACK_URL` دارد. هر دو با اسکیمِ دوتایی (`https://https://hamboom.ir/…`) پر شده بودند؛ دومی بلند شکست، اولی **بی‌صدا** می‌مانْد و تازه لحظه‌ی بازگشتِ کاربر از درگاه خودش را نشان می‌داد | گاردِ فاز ۹ی M5 فقط برای callback نوشته شد. ⇒ کارِ فاز ۸ |
| ۴ | ★★ **کانتینرِ در حلقه‌ی ری‌استارت از دیدِ `up -d` «در حال اجرا» است** و envِ نو را برنمی‌دارد. `.env` را درست کردیم، `up -d` زدیم، و همان خطای قدیمی ادامه داشت — `--force-recreate` لازم بود | رفتارِ compose، نه کدِ ما. فقط با یک کانتینرِ crash-loopingِ واقعی دیده می‌شود |
| ۵ | ★★ **مشقِ بازیابی روی هر استقرارِ تازه قرمز است — و باید باشد.** چکِ ششم (`bytes`) و دو چکِ «بازیابیِ هیچ»ِ `restore-storage` وقتی `board_snapshots` صفر است قرمز می‌شوند. این همان گاردی است که M6 فاز ۲ ساخت تا سبزِ **بی‌محتوا** ندهد | عمدی است، ولی RUNBOOK نمی‌گفت چطور اولین فشرده‌سازی را عمداً بسازی ⇒ ردیفِ نو در §۱٫۵ |
| ۶ | ⚠️ **باگِ تصویر روی بوم** — پایین، جداگانه | — |

### ✅ نسخه‌ی کاملِ روزِ صفر، بعد از رفعِ پنج مورد

ورودِ واقعی با پیامکِ sms.ir ✓ (کلید **چرخانده شد** — بندِ بازِ ۱٫۰ بسته شد) ·
`grant-staff` از داخلِ ایمیج ✓ · `/panel` و صفحه‌ی **وضعیتِ سیستم** روی زیرساختِ واقعی ✓
(اولین اثباتِ دسترسیِ api به object storageِ آروان) · بورد با `wss` از پشتِ TLS ✓ ·
`backup-all` + `restore-drill` **هر شش چک** + `restore-storage` ✓.

★ TLS: گواهیِ Let's Encrypt با webrootِ خودِ nginx (مسیرِ ACME در **هر دو** حالت سرو می‌شود)،
۳۰۱ ✓ HSTS ✓ و — نکته‌ی مهم — **حالتِ https را وجودِ فایلِ گواهی انتخاب می‌کند، نه `APP_ENV`**،
پس `staging` هم TLSِ کامل دارد و تاییدِ زرین‌پال منتظرِ `production` نمی‌مانَد.

### ★ دستورالعملِ «اولین فشرده‌سازی» — بدونِ آن، مشقِ بازیابی روی هر استقرارِ نو قرمز است

شرطِ فشرده‌سازی `pending >= RT_SNAPSHOT_EVERY_UPDATES || now() - sinceAt >= RT_SNAPSHOT_EVERY_MS`
است و ⚠️ **فقط روی خودِ update سنجیده می‌شود، نه با تایمر** — بوردِ ساکت هرگز فشرده نمی‌شود.
`sinceAt` هم از **لحظه‌ی بازشدنِ اتاق** شمرده می‌شود (`compactedAt: Date.now()`).

پس لازم نیست env را دست بزنی: **بورد را باز کن، چند ویرایش بکن، بیش از ۷۰ ثانیه صبر کن
(بورد باز بماند)، بعد یک ویرایشِ دیگر بکن.** همان یک update شرطِ ۶۰ثانیه‌ای را فعال می‌کند.

⚠️ اولین تلاشِ ما با پایین‌آوردنِ آستانه به ۲۰ بود و **باز هم شلیک نکرد** — چون ۱۸ ویرایش
انجام شد (یک قدم مانده) و هر ۱۸ تا هم داخلِ ۶۰ ثانیه بودند، پس هیچ‌کدام از دو شاخه برقرار نشد.

### ⚠️ باگِ باز: تصویر آپلود می‌شود ولی روی بوم نمی‌آید (اولین استقرار، آروان)

**نشانه:** در بورد، دکمه‌ی تصویر → انتخابِ فایل → **هیچ تصویری روی بوم ظاهر نمی‌شود.**

★★ **ولی این «آپلود نشد» نیست:** بعد از همان کار، `files` در دیتابیس **ناصفر** شد و
`backup-all` هم اشیاءِ `hamboom-assets` را دید. یعنی presign و commit **کار کرده‌اند** و
بایت‌ها در باکتِ آروان هستند — چیزی که نمی‌آید، **رندرِ عنصر روی بوم** است.

⚠️ **علت اندازه‌گیری نشده و حدس نمی‌زنیم.** سه نامزد، به ترتیبِ احتمال:

۱. **مسیرِ resolve/presign-GET روی آروان** — تا امروز فقط روی MinIO اجرا شده بود، و
   [ADR-013](ARCHITECTURE_DECISIONS.md#adr-013)/probe ۳٫۰ ثبت کرده که **رفتارِ presign بین
   سرویس‌های S3 فرق می‌کند**. CORS برای `POST` تنظیم شد؛ اینکه برای `GET`ِ presign‌شده هم
   درست باشد **جدا** باید سنجیده شود.
۲. **رگرسیون یا حالتِ چهارمِ همان سه باگِ نمایشِ M3 فاز ۱۱٫۲** (`sdk.resolveBlob` با
   `redirect:manual`ِ opaque · `createCanvasBinding` بدونِ resolver = «قابِ خالی» · `data:URI`).
۳. خطای سمتِ کلاینت که در لاگِ سرور هیچ ردی ندارد.

**چطور تشخیص داده شود (کارِ فاز ۸):** کنسول و تبِ Networkِ مرورگر حینِ همان ژست — آیا
`POST`ِ presign ۲۰۴/۲۰۰ می‌گیرد؟ آیا `GET`ِ بعدی به باکت CORS می‌خورد؟ آیا عنصر اصلاً به
صحنه اضافه می‌شود (بومِ خالی در برابرِ «قابِ خالی»)؟ لاگِ api/nginx **چیزی نشان نمی‌دهد** —
همان کلاسِ نقصی که RUNBOOK §۵ برایش ردیف دارد.

⛔ **بیرونِ دامنه‌ی M6** (بوم و آپلود مالِ M1/M3‌اند) ⇒ به‌عنوانِ **۸٫۶** ثبت شد تا گم نشود.

---

## ✅ بستنِ عملیاتیِ استقرار (۱۴۰۵/۰۷/۰۳)

**cron نصب شد** (RUNBOOK §۶، با مسیرِ `/opt/hamboom` نه `/srv`): پشتیبانِ جفتِ شبانه با
`--prune=14`، مشقِ بازیابی و `restore-storage`ِ هفتگی، سطلِ بازیافت + جاروبِ یتیم، نگهداشتِ
ممیزیِ ماهانه، و هرسِ ایمیج. ⏳ عددِ `--prune=14` هنوز **تصمیمِ مالک نیست** (پیش‌فرضِ سند است).

**ری‌استارتِ کرنل انجام شد و آزمونِ بازگشتِ خودکار پاس شد:** هر پنج سرویس خودشان برگشتند و
`(healthy)` شدند. این چیزی است که بهتر بود امروز بفهمیم تا شبِ حادثه.

---

## ⏸⏸ تصمیمِ بازِ بزرگ: جایگزینیِ زرین‌پال با کارت‌به‌کارتِ خودکار (پیشنهادِ مالک، ۱۴۰۵/۰۷/۰۳)

> ⛔ **هنوز تصمیم گرفته نشده.** این‌جا فقط پیشنهاد + ارزیابی ثبت شده. پذیرشش یک **ADRِ نو**
> می‌خواهد (قانونِ ۷) و ADR-049/۰۵۵/۰۵۶ را دست می‌زند.

### پیشنهاد

بدونِ آپلودِ رسید · تاییدِ **کاملاً خودکار** از راهِ خواندنِ پیامکِ واریزِ بانک · **مبلغِ یکتا**
(پایه + ۴ رقمِ تصادفی) به‌عنوانِ کلیدِ تطبیق · پول مستقیم به کارتِ مالک · فعال‌سازیِ فوری.
فلو: انتخابِ پلن → تولیدِ مبلغِ یکتا → نمایشِ مبلغ/کارت/نام/مهلتِ ۲۰ دقیقه → واریزِ کاربر →
رسیدنِ پیامک → استخراجِ مبلغ و تطبیق با فاکتورهای باز → فعال‌سازی → انقضا اگر نیامد.

### ارزیابی — چهار مورد، به ترتیبِ شدت

**۱. ⚠️ ریسکِ بانکی/مالیاتی — بیرونِ تخصصِ این نشست.** دریافتِ درآمدِ کسب‌وکار روی کارتِ
**شخصی** در ایران دسته‌ی ریسکِ شناخته‌شده‌ای دارد (قواعدِ حسابِ تجاری، سقفِ کارت‌به‌کارت،
علامت‌خوردن/مسدودیِ حساب بابتِ فعالیتِ شبه‌درگاه). ⛔ عددها و آخرین قواعدش **دانسته نیست و
حدس زده نشد**؛ باید با حسابدار/مشاورِ مالیاتی سنجیده شود. اگر حساب مسدود شود کلِ کسب‌وکار
می‌ایستد. ⊕ و فاکتورِ رسمی + `VAT_PERCENT` روی پولِ کارتِ شخصی معنای روشنی ندارد.

**۲. ★★ مبلغِ «تصادفی» طرح را می‌شکند — ولی رفعش ساده است.** با ۴ رقم، ۱۰٬۰۰۰ مبلغِ ممکن.
پارادوکسِ تولد (محاسبه‌شده): ۱۰ فاکتورِ هم‌زمان ⇒ **۰٫۴۵٪** · ۲۰ ⇒ **۱٫۸۸٪** · ۵۰ ⇒ **۱۱٫۵٪** ·
۱۰۰ ⇒ **۳۹٪**. و نتیجه‌ی تصادف فاجعه است: **کاربر الف پول می‌دهد، کاربر ب اشتراک می‌گیرد** —
همان کلاسی که [ADR-055](ARCHITECTURE_DECISIONS.md#adr-055) برای حذفش نوشته شد.
✅ رفع: مبلغ **تخصیص‌یافته** باشد نه تصادفی — `UNIQUE` روی مبلغِ فاکتورهای **باز** (+ تازه‌منقضی،
چون پیامک دیر می‌رسد) و گرفتنِ عددِ بعدی در تصادم؛ همان الگوی `payments_idem_uq`.

**۳. ⚠️⚠️ نردبانِ [ADR-056](ARCHITECTURE_DECISIONS.md#adr-056) می‌میرد و جبران‌پذیر نیست.**
کلِ ایمنیِ پرداخت روی این جمله بنا است: «هیچ ردیفی پیش از دستِ‌کم **یک پرسش از درگاه** باطل
نمی‌شود». با کارت‌به‌کارت **هیچ‌کس نیست که پرسیده شود** — فقط انتظارِ پیامکی که شاید نیاید.
یعنی انقضا دوباره **صرفاً زمانی** می‌شود، همان چیزی که آن ADR صریحاً ناامن اعلامش کرد.
⇒ مهلتِ ۲۰ دقیقه‌ای خطرناک است؛ هر انقضا باید مهلتِ لطف داشته باشد و ردیف را طوری نبندد که
پیامکِ دیررس نتواند نجاتش دهد.

**۴. ⚠️ سطحِ حمله‌ی نو + تک‌نقطه‌ی خرابی.** «خواندنِ پیامک» یعنی endpointی که یک اپِ اندروید یا
مودم به آن POST می‌کند: بدونِ احراز، **هر کسی با یک POST اشتراکِ رایگان می‌گیرد**. لازم:
رازِ مشترک + allowlistِ فرستنده + ضدِ replay (هر پیامک یک‌بار) + سقفِ نرخ. و آن گوشی/مودم
خودش تک‌نقطه‌ی خرابی است (خاموشی، شارژ، آنتن، کشته‌شدنِ اپ توسطِ اندروید) — بی‌صدا.

### ★★ آنچه از قبل ساخته شده (و پیشنهادِ مرحله‌بندی)

پنلِ فاز ۶ **از قبل** دارد: دیدنِ پرداخت‌ها، **تاییدِ دستی که اشتراک را فعال می‌کند**، ابطال،
استرداد، و ردیفِ ممیزی برای هرکدام. یعنی کارت‌به‌کارتِ **دستی** فقط یک صفحه‌ی نو می‌خواهد
(«مبلغِ یکتا + شماره‌ی کارت + مهلت»). بخشِ گران و پرریسک، **اتوماسیونِ پیامک** است نه کارت‌به‌کارت.

| گام | چه | هزینه |
|---|---|---|
| ۱ | چکِ حقوقی/مالیاتی | صفر کد، **بلاک‌کننده** |
| ۲ | ★ دیدنِ **یک پیامکِ واریزِ واقعی** (ماسک‌شده) | صفر کد، **پیش‌نیازِ طراحی** |
| ۳ | کارت‌به‌کارت با **تاییدِ دستی** + مبلغِ تخصیص‌یافته | کوچک (یک صفحه + یک migration) |
| ۴ | اتوماسیونِ پیامک | ADRِ نو + یک فازِ کامل |

★★ **چرا گامِ ۲ پیش از هر طراحی:** اگر پیامکِ بانک **۴ رقمِ آخرِ کارتِ مبدأ** را بدهد، کلیدِ
تطبیق می‌شود «مبلغ + کارت»، تصادف عملاً صفر می‌شود و راهِ استرداد هم پیدا می‌شود. اگر ندهد،
تنها کلید مبلغ است. **این حدس‌زدنی نیست — باید یک نمونه‌ی واقعی دیده شود.**

### پیامد برای وضعیتِ فعلی

⚠️ تا روشن‌شدنِ این تصمیم، جمله‌ی «زرین‌پال تنها بلاک‌کننده‌ی `APP_ENV=production` است» **معلق**
است: اگر کارت‌به‌کارت جایگزین شود، گیتِ `assertGatewayAllowed` و merchant idِ اجباری باید
بازنگری شوند و مسیرِ production شکلِ دیگری پیدا می‌کند. ★ ولی امروز چیزی را بلاک نمی‌کند —
`APP_ENV=staging` با TLSِ کامل زنده است و فاز ۸ کاملاً مستقل از این تصمیم جلو می‌رود.

### ⏸ نقطه‌ی توقف پیش از فشرده‌سازیِ context (۱۴۰۵/۰۷/۰۳)

**وضعیت:** فاز ۰–۷ی M6 تمام و تایید شده · **اولین استقرارِ واقعی انجام شد** و
`https://hamboom.ir` با TLS روی VMِ آروان زنده است (`APP_ENV=staging`، درگاهِ mock) ·
cron نصب · ری‌استارت و بازگشتِ خودکار آزموده شد · اسناد به‌روزند.
`pnpm verify` **۱۶ گیت سبز** · `sdk:contract` **۴۹/۴۹**.

**سه کامیتِ این نشست:** `c6bfe6e` (کدِ فاز ۷) · `0ab9871` (ثبتِ استقرار و شش یافته‌اش) ·
و همین کامیتِ اسناد. ⚠️ هیچ‌کدام push نشده‌اند مگر مالک بخواهد.

**قدمِ بعد — هر سه منتظرِ تصمیمِ مالک‌اند:**

۱. ⏸ **انتخابِ درگاه** — بالا. دو کارِ صفرکد اول: چکِ حقوقی/مالیاتی، و **دیدنِ یک پیامکِ
   واریزِ واقعی** (بدونِ آن هیچ طراحی‌ای ممکن نیست — تعیین می‌کند کلیدِ تطبیق فقط «مبلغ»
   است یا «مبلغ + ۴ رقمِ کارت»).
۲. ⏸ **فاز ۸ (E2E و سخت‌سازی)** — کاملاً مستقل از تصمیمِ درگاه و آماده‌ی شروع. دو ردیفش را
   همین استقرار ساخت: **۸٫۶** (تصویر آپلود می‌شود ولی روی بوم رندر نمی‌شود — `files` ناصفر
   است پس presign/commit سالم‌اند؛ دامنه‌اش M1/M3 و لمسش تاییدِ جدا می‌خواهد) و **۸٫۷**
   (گاردِ بوتِ `WEB_BASE_URL`). و ۸٫۲ حالا روی **استکِ واقعی** قابلِ اجراست.
۳. ⏳ عددِ `--prune` در cronِ پشتیبان.

⚠️ **چیزی که در فشرده‌سازی نباید گم شود:** سه سبزِ دروغینِ فاز ۷ و شش یافته‌ی استقرار
همه در همین فایل ثبت‌اند؛ خلاصه‌شان در [`CLAUDE.md`](CLAUDE.md) §وضعیت. **فاز ۸ را بدونِ
تاییدِ صریح شروع نکن** (یک فاز به‌ازای هر تایید).

---

## ✅ M6-D13 — ADR-070 نوشته و **پذیرفته** شد (۱۴۰۵/۰۷/۰۳)

مالک **گامِ ۳ی مرحله‌بندی** را انتخاب کرد: کارت‌به‌کارت/شبا با **تاییدِ دستی**، و اتوماسیونِ
پیامک موکول به «اگر مشتری زیاد شد». [ADR-070](ARCHITECTURE_DECISIONS.md#adr-070) نوشته شد —
**تاییدِ مالک همان روز گرفته شد و پیاده‌سازی شروع شد.**
⚠️⚠️ **پذیرش پیش از چکِ حقوقی/مالیاتی انجام شد** — بندِ «آنچه این ADR تصمیم نمی‌گیرد» صریحاً پیش از
تایید مطرح شد و مالک با علم به آن تایید کرد. ⇒ **ساخت** جلو می‌رود، **گرفتنِ پولِ واقعی** نه؛ و این
حرفِ روی کاغذ نیست: گاردِ بوت تا وقتی مقصدی تنظیم نشده، production را با این درگاه بالا نمی‌آورد.

### ★★ دو چیزی که اندازه‌گیریِ مالک عوض کرد

**۱. اعتراضِ «مبلغِ تصادفی» باطل شد.** صورت‌حسابِ بانکِ مالک **شماره‌ی پیگیری، شماره‌ی مرجع،
شماره‌ی سند (پایا)، ۴ رقمِ آخرِ کارتِ مبدأ و نامِ فرستنده** را می‌دهد و فرستنده همان شماره‌ها را
می‌بیند. جدولِ تصادفی که محاسبه کرده بودم (۱۰ ⇒ ۰٫۴۵٪ · ۵۰ ⇒ ۱۱٫۵٪ · ۱۰۰ ⇒ ۳۹٪) روی این فرض
بنا بود که **مبلغ تنها کلیدِ تطبیق است** — که فقط برای فلوی **خودکار** درست بود. ⇒ مبلغِ یکتا
**حذف شد**، و جایش `UNIQUE (gateway, transfer_ref)` نشست که خطرِ واقعیِ باقی‌مانده را می‌بندد:
**بازپخشِ شماره‌ی مرجع** (کاربر ب همان شماره‌ی الف را ثبت کند).

**۲. نردبانِ ADR-056 نمی‌میرد.** اعتراضِ قبلی‌ام («هیچ درگاهی برای پرسیدن نیست») در یک جزء غلط
بود: درگاه می‌تواند از **جدولِ خودمان** بپرسد. و مهم‌تر، `settleLocked` روی `gatewayError` عمداً
`failure_code` را دست نمی‌زند ([billing.ts:270](apps/api/src/services/billing.ts:270)) — پس
ردیفی که کاربر رویش ادعای پرداخت ثبت کرده **هرگز خودکار باطل نمی‌شود**، و نردبانِ خالصِ
`reconcile.ts` **صفر تغییر** می‌خواهد. ⚠️ این برای **پایا** حیاتی است که چرخه‌ای تسویه می‌شود و
می‌تواند روزِ کاری بعد بنشیند.

### ⚠️ یک تصحیح در گزارشِ قبلیِ خودم

نوشته بودم «پنلِ فاز ۶ از قبل **تاییدِ دستی که اشتراک را فعال می‌کند** دارد ⇒ گامِ ۳ فقط یک صفحه
است». **غلط بود.** آنچه هست `payment.verify` است — دکمه‌ای که **دستی زده می‌شود** ولی جوابش را از
**درگاه** می‌گیرد ([admin.ts:527](apps/api/src/routes/admin.ts:527)). هیچ مسیری برای «دیدم پول
آمد، فعالش کن» وجود ندارد، و این عمدی است (ADR-055: `settlePayment` تنها مسیرِ فعال‌سازی).
⇒ هزینه‌ی واقعیِ گامِ ۳: یک migration + یک درگاه + دو مسیر + یک سنجه — نه «یک صفحه».

### ⏳ سه چیزی که پذیرش آن‌ها را نبست

| چه | چرا |
|---|---|
| ⛔ چکِ حقوقی/مالیاتی | **بلاک‌کننده‌ی گرفتنِ پول، نه ساختن.** عددهایش دانسته نیست و حدس زده نشد |
| سقفِ کارت‌به‌کارتِ مالک | تعیین می‌کند پلنِ تیمِ سالانه (**۴٬۹۹۰٬۰۰۰ تومان**) کارت می‌خواهد یا شبا |
| کارت / شبا / هر دو + پنجره‌ی ادعا | مقدارِ پیکربندی؛ شماره‌ها **فقط** در `.env.production` |

★ و **توقفِ D12** جداگانه لازم است (قاعده ۲): DTOهای نو در `shared-types`.

### ✅ یک چیز که همین امروز رد شد

CORSِ باکتِ assets روی آروان **مقصرِ باگِ ۸٫۶ نیست**: preflightِ `GET` از `https://hamboom.ir`
جوابِ `200` با `access-control-allow-origin`ِ درست داد (اگر GET مجاز نبود ۴۰۳ می‌داد)، و PUT هم
اثباتاً کار می‌کند چون `files` ناصفر شد. ⇒ ۸٫۶ یک باگِ **واقعی** است و تشخیصش کنسول/Networkِ
مرورگر می‌خواهد، نه تنظیماتِ باکت.

---

## ✅ پیاده‌سازیِ ADR-070 — کارت‌به‌کارت با تاییدِ دستی (۱۴۰۵/۰۷/۰۴)

**وضعیت:** کد کامل، `pnpm verify` **۱۶/۱۶**، `sdk:contract` **۵۲/۵۲**، سنجه‌ی نوِ
`billing:transfer` **۸/۸** روی Postgresِ زنده.
⛔ **هنوز فعال نیست:** `PAYMENT_PROVIDER` همچنان `mock` است و تا چکِ حقوقی و مقادیرِ واقعیِ
`CARD_TRANSFER_*` روشن نشود، روشن نمی‌شود.

### آنچه ساخته شد

| کجا | چه |
|---|---|
| [`0010_card_transfer.sql`](apps/api/migrations/0010_card_transfer.sql) | گشادکردنِ `payments_gateway_ck` · هفت ستونِ انتقال · **`payments_transfer_ref_uq`** · چهار CHECK · ایندکسِ صف |
| [`card-transfer-gateway.ts`](packages/billing-core/src/card-transfer-gateway.ts) | سومین `PaymentGateway`؛ `decideTransfer` **خالص** و بدونِ ساعتِ محلی؛ authority از Web Crypto |
| [`transfer-destination.ts`](packages/billing-core/src/transfer-destination.ts) | Luhn + mod-97 + «همه‌ی ایرادها با هم» |
| [`services/card-transfer.ts`](apps/api/src/services/card-transfer.ts) | خواننده‌ی **tx-محدود** · `claimTransfer` · `approveTransfer` (قفل → assert مبلغ → نوشتن → `settleLocked` → audit، همه در یک تراکنش) |
| routeها | `GET /billing/transfer/:authority` · `POST …/claim` · `POST /admin/payments/:id/approve-transfer` (step-up + `audited`) |
| رابط | [`TransferPage`](apps/web/src/billing/TransferPage.tsx) روی `/payment/transfer/$authority` · بخشِ دوسمتیِ واریز در [`PanelPayment`](apps/web/src/panel/PanelPayment.tsx) |
| سنجه | [`billing:transfer`](scripts/billing-probe-transfer.ts) — ۸ چک |

### ★★ سه چیزی که **اندازه‌گیری** تغییرشان داد، نه طراحی

**۱. ⚠️⚠️ دو سبزِ دروغین در سنجه‌ی خودم، پشتِ سرِ هم، در **یک** چک.**
چکِ «بازپخشِ شماره‌ی مرجع» با `DROP INDEX payments_transfer_ref_uq` روی دیتابیسِ زنده **سبز
مانْد** — چون پیش‌چکِ برنامه‌ایِ `approveTransfer` زودتر می‌گرفتش و ایندکس هرگز آزموده نمی‌شد.
چکِ ۸ را افزودم (دو تاییدِ هم‌زمان با یک شماره)، و آن هم **باز سبز مانْد** — این‌بار چون هر دو
پرداخت مالِ **یک تیم** بودند و `23505`ی که می‌دیدم از `subscriptions_active_uq` می‌آمد نه از
ایندکسِ مرجع. با دو تیمِ جدا **و** یک سدِّ صریح (تراکنشِ دوم فقط بعد از **نوشتنِ** تراکنشِ اول
شروع شود، نه بعد از commitش) بالاخره واقعی شد: با ایندکس یکی رد می‌شود، بدونِ ایندکس **هر دو
تایید می‌شوند و یک واریز دو اشتراک می‌خرد**.
★ این چهارمین بارِ همین درس در این ریپو است: **یک چکِ همزمانی هم‌زمان نیست مگر ثابت شود** — و
این‌بار حتی «ثابت شد» هم کافی نبود، چون قیدِ **دیگری** زودتر شلیک می‌کرد.

**۲. ⚠️ مسیرِ صفحه و مسیرِ api را یک ثابت گرفته بودم.**
`TRANSFER_PAGE_PATH` را `/billing/transfer` نوشتم و همان را هم برای ثبتِ routeِ api به کار بردم.
ولی [`router.tsx`](apps/web/src/router.tsx) صریح ثبت کرده که **هیچ مسیرِ SPA با `/billing` شروع
نمی‌شود** — آن پیشوند در dev و پشتِ nginx کاملاً به api می‌رود. یعنی `redirectUrl`ی که به
مرورگرِ کاربر می‌دادیم، به‌جای صفحه یک JSON نشان می‌داد. همان کلاسِ نقصِ `MOCK_CHECKOUT_PATH`ِ
M4 فاز ۹. ⇒ دو ثابتِ جدا (`TRANSFER_API_PATH` / `TRANSFER_PAGE_PATH`) + **گاردِ بوت** + چکِ ۵۰ی
قرارداد که هر دو جهت را assert می‌کند.

**۳. ⚠️ سنجه‌ی من به دیتابیسِ تمیز وابسته بود.** شماره‌های ثابت بینِ اجراها تصادم می‌کردند، پس
یک اجرای شکسته اجرای بعدی را هم می‌شکست (پیش‌چک ردیفِ جامانده را می‌دید و پیش از رسیدن به
چیزی که می‌سنجیم `TRANSFER_REF_TAKEN` می‌داد). ⇒ شناسه‌ی یکتای اجرا + پاک‌سازیِ آغازین.
⊕ و همین کلاس یک بار دیگر خورد: بلوکِ نوِ `sdk:contract` حالتِ مشترک (`is_staff`، step-up،
ردیف‌های ممیزی) را برمی‌نگرداند و **اجرای دومِ همان اسکریپت** روی چک‌های ۱۸/۲۱/۲۴/۲۵ قرمز
می‌شد. حالا کاملاً بازمی‌گرداند و با **دو اجرای پشتِ سرِ هم** اثبات شد.

### شکستن‌های عمدی (هر کدام باید چکِ **خودش** را قرمز کند)

| شکستن | نتیجه |
|---|---|
| ادعای کاربر ⇒ `notPaid` به‌جای `gatewayError` | ✅ فقط چکِ ۲ قرمز |
| `DROP INDEX payments_transfer_ref_uq` | ✅ فقط چکِ ۸ قرمز (بعد از دو بار اصلاحِ خودِ چک) |
| برداشتنِ `FOR UPDATE` از `lockPaymentForSettle` | ✅ فقط چکِ ۱ قرمز (دو اشتراک، دو ردیفِ ممیزی) |
| جابه‌جاییِ ادعا و مشاهده در mapper | ✅ چکِ ۵۲ی قرارداد قرمز |
| Luhn و mod-97 «همیشه درست» | ✅ ۴ و ۲ تستِ واحد قرمز |

### تصمیم‌های کوچکی که ثبت می‌شوند

- **مبلغ در فرمِ تایید از پیش پر نمی‌شود.** پرکردنش چکِ مبلغ را به یک کلیک تبدیل می‌کرد و کلِ
  نگهبان را بی‌اثر. staff باید عددی را که در صورت‌حساب **دیده** تایپ کند.
- **ادعای تکراری مجاز است** (تصحیحِ شماره‌ی اشتباه)، و `transfer_claimed_ref` عمداً یکتا **نیست**:
  یکتاکردنش یک انکارِ سرویسِ مجانی می‌ساخت (مهاجم شماره را زودتر «ادعا» کند).
- **`alreadyVerified` همیشه `false`** — این درگاه هرگز مستقلاً capture نمی‌کند.
- **`refund`/`reverse`/`listUnverified` پیاده نشدند** ⇒ `REFUND_UNAVAILABLE` و همان مسیرِ
  دستیِ ADR-068، بدونِ یک خط کدِ نو.
- **پنجره‌ی ادعا ۲۴ ساعت** (نه ۲۰ دقیقه‌ی زرین‌پال) چون پایا چرخه‌ای تسویه می‌شود؛ و فاکتورِ
  ادعاشده **هرگز** خودکار منقضی نمی‌شود، هر چقدر هم کهنه شود.

### ⏳ آنچه هنوز باز است

⛔ **چکِ حقوقی/مالیاتی** — بلاک‌کننده‌ی گرفتنِ پول، نه ساختن · سقفِ کارت‌به‌کارتِ مالک (پلنِ تیمِ
سالانه ۴٬۹۹۰٬۰۰۰ تومان است) · مقادیرِ واقعیِ `CARD_TRANSFER_*` در `.env.production` ·
⚠️ و چیزی که هیچ گاردی نمی‌گیردش: **شماره‌ای که معتبر است ولی مالِ کسِ دیگری است** — پیش از
اولین مشتری یک واریزِ آزمایشیِ واقعی لازم است.

---

## ◑ فاز ۸ — شروع شد (۱۴۰۵/۰۷/۰۴)

**✅ ۸٫۷ — گاردِ بوتِ `WEB_BASE_URL`.**

یافته‌ی سومِ اولین استقرار این بود که `WEB_BASE_URL=https://https://hamboom.ir` در
`.env.production` نشست و **هیچ‌چیز نشکست**. دلیلش را حالا با عدد می‌دانیم: آن رشته یک URLِ
**کاملاً معتبر** است و `new URL` بدونِ شکایت `hostname="https"` و `pathname="//hamboom.ir"`
می‌دهد. پس `z.url()` هرگز نمی‌توانست بگیردش.

★ رفع: [`envOrigin`](packages/config/src/sections.ts) — سه قاعده، هر سه از همان خرابی:
پروتکل فقط `http`/`https` · میزبان نباید خودش نامِ یک scheme باشد (**امضای دقیقِ اسکیمِ
دوتایی**) · و مسیر باید خالی باشد (مبدأ مسیر ندارد).
⊕ **در schema نشست، نه در `production-guards`**: این خطا مالِ یک فایلِ `.env` است نه مالِ یک
محیط، و در dev هم همان‌قدر بی‌صدا خراب می‌کند.

⚠️ **و همین گارد امروز یک بارِ دوم به کار آمد:** هنگامِ پیاده‌سازیِ ADR-070 دقیقاً همان کلاس
دوباره ظاهر شد — مسیرِ صفحه‌ی کارت‌به‌کارت را زیرِ `/billing` گذاشته بودم که کاملاً به api
پروکسی می‌شود. دو نقص، یک ریشه: **رشته‌ای که شکلش درست است ولی به جای غلط اشاره می‌کند.**

آزمون: [`sections.test.ts`](packages/config/src/sections.test.ts) — و با بازگرداندن به
`z.url()`ِ قبلی هر سه assert **قرمز** شد (اسکیمِ دوتایی · مسیرِ ناخالی · پروتکل/میزبان).

### ⏳ شش ردیفِ باقی‌مانده‌ی فاز ۸ و آنچه هرکدام لازم دارد

| # | لازمه |
|---|---|
| ۸٫۱ (E2Eِ پنل) | استکِ داکری + playwright — قابلِ اجرا، بزرگ‌ترین ردیف |
| ۸٫۲ (رگبار ⇒ ۴۲۹) | ★ حالا روی **استکِ واقعیِ آروان** قابلِ اجراست |
| ۸٫۳ (P2 روی باندل) | قابلِ اجرا |
| ۸٫۴ (لینکِ ویدیو) | مرورگر |
| ۸٫۵ (اندازه‌گیریِ CSP) | مرورگر |
| ۸٫۶ (باگِ تصویر) | ⚠️ مرورگر روی سایتِ **زنده**، و CORSِ باکت امروز **تبرئه شد** (preflightِ GET با مبدأ درست ۲۰۰ داد). دامنه‌اش M1/M3 ⇒ لمسش **تاییدِ جدا** می‌خواهد |

---

## ✅ فاز ۸ ردیفِ ۸٫۱ — E2Eِ پنل روی استکِ واقعی (۱۴۰۵/۰۷/۰۴)

**سه تست، ۳/۳:** کاربرِ غیرِ staff روی `/panel` به داشبورد برمی‌گردد · staff: جست‌وجو →
تعلیق (با ۴۲۸ و step-upِ درجا) → نمای پشتیبانی → رفعِ تعلیق · verifyِ دستیِ یک پرداختِ mock.

**چطور چیده شد:** playwright به `apps/web` اضافه شد (همان نسخه‌ی `canvas-sync`، پس هیچ پکیجِ
نو به درخت نیامد) با **دو `webServer`ِ واقعی** — `apps/api` و `apps/web`. هیچ mockی از api
نیست؛ تنها چیزهای ساختگی درگاه و پیامک‌اند، هر دو با تصمیمِ ثبت‌شده‌ی خودشان.
★ **ورود از فرمِ واقعی** انجام می‌شود نه با تزریقِ کوکی: توکنِ دسترسی فقط در حافظه‌ی sdk است و
تزریقِ کوکی همان چیزی را دور می‌زد که باید اثبات شود.
★ و پرچمِ staff **فقط** با [`admin:grant-staff`](scripts/admin-grant-staff.ts) گرفته می‌شود
(ADR-066) — یک `UPDATE`ِ دستی تست را از مسیرِ واقعیِ محصول جدا می‌کرد.

### ⚠️ پنج چیزی که خودِ نوشتنِ این تست پیدا کرد

**۱. `isVisible()` صبر نمی‌کند** — و این جدی‌ترینشان بود. درست بعد از کلیکِ «تعلیق» می‌پرسیدم
آیا فرمِ step-up آمده؛ پاسخِ ۴۲۸ هنوز در پرواز بود (کادرِ دلیل `disabled`) و تست می‌گفت
«نپرسید». رفع: انتظار روی **یکی از دو مقصد** (`prompt.or(settled)`) و بعد تصمیم. نه تایمر، نه حدس.

**۲. ★★ تازگیِ step-up per-**user** است، نه per-session** (ADR-066 §۳ — در ستونِ
`users.step_up_verified_at`). تستِ سومِ همین سوئیت ۴۲۸ **نمی‌گیرد** چون تستِ دوم همان staff را
تازه کرده. پس helper شرطی است و دلیلش نوشته شده؛ اگر `toBeVisible`ِ سخت می‌گذاشتم، تست به
**ترتیبِ اجرا** گره می‌خورد.

**۳. `POST /admin/payments/:id/verify` هم پشتِ step-up است.** «پرسیدن از درگاه» یک خواندن
به‌نظر می‌رسد ولی می‌تواند یک اشتراک را **فعال** کند — پس گیتش درست است، و انتظارِ اولیه‌ی من غلط.

**۴. سقفِ OTP (۵/دقیقه/IP) کلِ سوئیت را می‌شکست** — شش ورود از یک لوپ‌بک. `RATE_LIMIT_OTP_MAX`
فقط برای سرورِ این تست بالا می‌رود، با همان استدلالِ ثبت‌شده‌ی `sdk:contract`؛ خودِ سقف در
ردیفِ ۸٫۲ روی استک سنجیده می‌شود.

**۵. ★ گیتِ `test`ِ verify قرمز شد و حق داشت:** vitestِ `apps/web` هیچ `include`ی نداشت و
فایل‌های `e2e/*.spec.ts`ِ playwright را هم برمی‌داشت. `include: ["src/**/*.test.{ts,tsx}"]`
اضافه شد — قرینه‌ی `canvas-sync`.

⊕ و دو selectorِ حدسی‌ام شکست (نامِ نمایشیِ خودکارِ «کاربر ۶۰۷۹» و شناسه‌ی بورد در جدول). ادعاها
به **hrefِ لینک** منتقل شدند: `a[href="/panel/users/…"]` و `a[href="/b/…"]` — همان چیزی که
واقعاً باید درست باشد و به متنِ تصادفی گره نمی‌خورد.

### شکستن‌های عمدی

| شکستن | نتیجه |
|---|---|
| `RequireStaff` بی‌اثر شود | ✅ تستِ ۱ قرمز (غیرِ staff به پنل می‌رسد) |
| `requireStepUp` از تعلیق برداشته شود | ✅ تستِ ۲ قرمز (۴۲۸ هرگز نمی‌آید) |

### ✅ و ردیفِ VPS بسته شد

مالک تایید کرد که چکِ فایروال درست بود. ⇒ سختی‌سازیِ VMِ روزِ صفر کامل است: فقط ۲۲/۸۰/۴۴۳،
`.env.production` با دسترسیِ محدود، و هیچ سرویسی بدونِ پورتِ هاست بیرون نیست.
⏳ تنها چیزِ عملیاتیِ بازمانده **دیدنِ اولین اجرای cron** است (نصب شد ولی هنوز شلیک‌شدنش
دیده نشده — cronی که ندیدی اجرا شود، پشتیبان نیست).

---

## ✅ فاز ۸ ردیفِ ۸٫۲ — ناحیه‌ی `hb_admin` اندازه‌گیری شد (۱۴۰۵/۰۷/۰۴)

ناحیه‌ی `hb_admin` در فاز ۳ ساخته شد و **هرگز اندازه‌گیری نشده بود** — سقفِ لبه‌ی M5 فاز ۹
روی `/auth/otp` سنجیده شده بود، نه این یکی.

### ⚠️ و اولین اندازه‌گیری یک سبزِ دروغینِ تمام‌عیار بود

استک را با ایمیج‌های **موجودِ** `:local` بالا آوردم و `GET /admin/me` **۲۰۰** داد. اگر همان‌جا
رگبار می‌زدم، عددی می‌گرفتم که هیچ ربطی به `/admin` نداشت: آن ایمیج از پیش از فاز ۳ بود، بلوکِ
`location /admin` را نداشت، و درخواست به **SPA** می‌رفت (`grep -c hb_admin` داخلِ کانتینر: **صفر**).
★ ایمیجِ web از درختِ فعلی بازساخته شد؛ بعدش `/admin/me` **۴۰۴** داد — یعنی واقعاً به api پروکسی
می‌شود. **درسِ تکراری: ایمیجِ کهنه یک mockِ ناخواسته است.**

### اعداد (استکِ productionِ محلی، nginx واقعی)

| سنجش | نتیجه |
|---|---|
| ۴۰ درخواستِ هم‌زمان روی `/admin/me` | **۲۳ × ۴۰۴ · ۱۷ × ۴۲۹** |
| همان، با ۴۰ هدرِ `X-Forwarded-For`ِ **متفاوتِ جعلی** | **۲۳ × ۴۰۴ · ۱۷ × ۴۲۹** — بی‌تفاوت |
| ★ کنترلِ منفی: همان رگبار روی مسیرِ **غیرِ** admin | **۴۰ × ۴۰۱ · صفر ۴۲۹** |
| ⚠️ شکستنِ عمدی: `limit_req zone=hb_admin` برداشته شد | **۴۰ × ۴۰۴ · صفر ۴۲۹** |

★★ **کنترلِ منفی چیزی را اثبات می‌کند که خودِ عددِ ۱۷ نمی‌تواند:** بدونِ آن، «۱۷ تا ۴۲۹» ممکن بود
از ناحیه‌ی **عمومیِ** `hb_api` (با `burst=60`) آمده باشد. صفر ۴۲۹ روی مسیرِ غیرِ admin می‌گوید
سقفِ سخت‌تر واقعاً روی همان پیشوند نشسته است.

★ و هدرِ جعلی بی‌اثر است چون ناحیه روی `$binary_remote_addr` کلید می‌خورد — آدرسِ **واقعیِ**
همتا، نه چیزی که کلاینت می‌گوید (ADR-064). این مکملِ اندازه‌گیریِ M5 فاز ۹ است: آن‌جا ثابت شد nginx
هدر را **بازنویسی** می‌کند تا سقفِ نرخِ خودِ api هم فریب نخورد؛ این‌جا ثابت می‌شود سقفِ **لبه** از
اول هدر را نمی‌خوانَد.

⊕ استک با یک `.env`ِ یک‌بارمصرفِ بیرونِ ریپو (`--env-file`) و `APP_ENV=staging` بالا آمد و در
پایان با `down -v` و حذفِ ایمیج‌های `:burst` پاک شد — هیچ رازِ ساختگی در درختِ کار نماند.

---

## ◑ فاز ۸ ردیفِ ۸٫۳ — P2 روی باندلِ واقعی، و **سه** سبزِ دروغینِ پشتِ سرِ هم (۱۴۰۵/۰۷/۰۴)

### ✅ بخشِ لایسنس — قطعی

`license:check` (با خودآزمونِ ارزیابِ SPDX): **۱۰۰۶ پکیج، همه مجاز** — **دقیقاً** همان عددِ خطِ
پایه‌ی ۱٫۶. یعنی افزودنِ `@playwright/test` به `apps/web` در ردیفِ ۸٫۱ **صفر** پکیج به درخت
آورد (همان `^1.62.1`ی که `canvas-sync` داشت). ⇒ «صفر depِ نو» با عدد اثبات شد، نه با ادعا.

### ⚠️ بخشِ رفتاری — و سه سبزِ دروغین که یکی‌یکی گرفته شدند

**۱. ایمیجِ کهنه یک mockِ ناخواسته است** (همان درسِ ۸٫۲، دوباره): اولین اجرا روی ایمیجِ موجود بود
و `/admin/me` **۲۰۰** می‌داد چون آن باندل بلوکِ `/admin` را نداشت. هر دو ایمیج از درختِ فعلی
بازساخته شدند.

**۲. ★★ ادعای ضعیف، تستِ پوچ.** probe شش صفحه‌ی پنل را بازدید می‌کرد و
`getByRole("heading").first()` را assert می‌کرد. ولی هر شش بازدید به `/login` ریدایرکت می‌شد
(بارگذاریِ سرد بعد از `reload`، پیش از بازسازیِ نشست) و آن ادعا سرتیترِ **«ورود به هم‌بوم»** را
هم می‌پذیرفت. نتیجه: «۷۶ درخواست، همه هم‌مبدأ» — عددی **درست** درباره‌ی صفحه‌ای که هرگز بار
نشد. رفع: انتظار برای دکمه‌ی «خروج» بعد از reload، و assertِ **نامِ صریحِ سرتیترِ هر صفحه**
(`h1` سطح ۱). حالا پوچ‌شدنِ دوباره ناممکن است.

**۳. ⚠️⚠️ و مهم‌ترینش: خودِ ابزار قابلِ اعتماد نبود و باید اثبات می‌شد.** برای شکستنِ عمدی یک
`<img src="https://…">` در `PanelHome` گذاشتم؛ رشته در باندلِ سرو‌شده بود، عنصر در DOM بود، و
probe **هیچ درخواستی ندید**. با `fetch`ِ صریح هم همان. علت: **مرورگرِ این محیط egress ندارد** و
درخواست به میزبانِ واقعاً خارجی حتی رویدادِ `request` تولید نمی‌کند.
⇒ ابزار با یک مبدأِ **قابلِ دسترسِ متفاوت** (`http://127.0.0.1:15402`) اعتبارسنجی شد: گرفتش و
تست **قرمز** شد. پس سنجه کور نیست، **شبکه** است.

### اعداد

| سنجش | نتیجه |
|---|---|
| درخواست‌های مرورگر در شش صفحه‌ی پنل (باندلِ ساخته‌شده، پشتِ nginx) | **۹۸ درخواست · همه `http://localhost` · صفر مبدأِ دیگر** |
| اعتبارسنجیِ ابزار با مبدأِ متفاوتِ قابلِ دسترس | ✅ گرفت و قرمز شد |
| `license:check` | **۱۰۰۶ پکیج، صفر تخلف** = خطِ پایه‌ی ۱٫۶ |
| chunkِ پنل در باندل | **۴۵٬۲۵۵ بایت** (فاز ۷: ۴۲٬۲۹۰ ⇒ +۲٬۹۶۵ برای کارت‌به‌کارت) |
| میزبانِ **غیرِ لوکال** به‌شکلِ رشته در باندل | **۳۷** |

### ⚠️ چرا این ردیف **◑** است و نه ✅

معیارِ «صفر میزبان» تحت‌اللفظی **محقق نشد و نمی‌شود**: باندل ۳۷ میزبانِ غیرِ لوکال به‌شکلِ
**رشته** دارد — namespaceِ XML (`w3.org` ×۶۴)، متنِ لایسنس و لینکِ مستندات، و قابلیتِ
**embedِ ویدیوی excalidraw** (`youtube.com`، `player.vimeo.com`) و چند سرویسِ خودِ excalidraw
(`*.excalidraw.com`، یک `cloudfunctions.net`).
★ ادعای واقعیِ P2 «رشته‌ای در فایل نیست» نبود، «در runtime صدا زده نمی‌شود» بود — و آن، برای
هر مبدأِ **قابلِ دسترس** اثبات شد. برای میزبانِ غیرقابلِ‌دسترس، این محیط نمی‌تواند حکم بدهد؛
گیتِ دائمیِ `check-p2.ts` روی **سورس** همان شکاف را می‌پوشاند.
⏭ و تفکیکِ نهاییِ رشته از تماس برای youtube/vimeo کارِ **ردیفِ ۸٫۴** است — که دقیقاً همین را
می‌پرسد («کدام میزبان‌ها صدا زده می‌شوند»).

⊕ اجرا: `pnpm --filter @hamboom/web test:e2e:p2` با استکِ productionِ محلیِ بالا و
`E2E_COMPOSE_ENV_FILE`. ⚠️ Docker Desktop وسطِ همین ردیف یک بار از کار افتاد — استکِ
`hamboom-p2` باید با `down -v` پاک شود وقتی daemon برگشت.

---

## ✅ فاز ۸ ردیفِ ۸٫۴ — «چسباندنِ لینکِ ویدیو»: زنجیره‌ی کامل، از کد (۱۴۰۵/۰۷/۰۴)

ارثیه‌ی handoff §۴ می‌پرسید «کدام میزبان‌ها صدا زده می‌شوند». جواب از **کدِ واقعی** درآمد، نه حدس.

### ۱. فهرستِ مجازِ embedِ excalidraw (از باندلِ shippedِ خودش)

`youtube.com` · `youtu.be` → `www.youtube.com/embed/…` · `vimeo.com` → `player.vimeo.com/video/…` ·
`figma.com` → `www.figma.com/embed` · `twitter.com` → `twitter.com/x/status/…` · `gist.github.com` ·
`link.excalidraw.com`.

★★ **مکانیزم `<iframe src>` است، نه `fetch`.** یعنی خودِ مرورگر میزبان را صدا می‌زند — با همه‌ی
چیزهایی که یک iframeِ طرفِ سوم می‌آورد (کوکی، fingerprint، رفرر). یک `fetch` را می‌شد با CSP یا
پروکسی مهار کرد؛ این یکی نه.

### ۲. چقدر در دسترس است

⛔ **هیچ دکمه‌ای در نوارِ ابزارِ ما نیست** و chromeِ نیتیوِ excalidraw هم از فاز ۹٫۱ی M3 پنهان شده.
تنها راهِ رسیدن به این عنصر **چسباندن** (paste) یک لینک است — یعنی نه کشفش آسان است و نه تصادفی.

### ۳. ⚠️ و دو یافته‌ی جانبی که خواندنِ کد لو داد

**۳الف. `try/catch`ِ `BoardPage` برای این حالت مرده است.** کامنتش می‌گوید «نوعی که به مدلِ سند
نگاشت نمی‌شود رد شود»، ولی `fromExcalidraw` صریحاً **اعتبارسنجی نمی‌کند** و پرتاب هم نمی‌کند —
پس عنصرِ `embeddable` **emit می‌شود** و به سند می‌رسد. آن catch فقط برای خطاهای دیگر است.

**۳ب. ★★ نگهبانِ واقعی سرور است.** `quarantineInvalid` هر عنصرِ سند را با
`hbElement.safeParse` می‌سنجد و ردشده را از سند **حذف** می‌کند و لاگ می‌زند
(«عنصرِ نامعتبر قرنطینه شد»). `embeddable` در اتحادِ `hbElement` نیست ⇒ حذف می‌شود.

### نتیجه‌ی P2 — دقیق، بی‌گردکردن

| کی | آیا youtube را صدا می‌زند؟ |
|---|---|
| مرورگرِ کاربری که لینک را **چسبانده** | **بله** — تا لحظه‌ای که قرنطینه برسد |
| مرورگرِ **همتاها** | **نه** — عنصر هرگز به آن‌ها نمی‌رسد |
| سرورِ ما | نه — هیچ تماسی نمی‌گیرد |

⊕ و یک نکته‌ی UX که ثبت می‌شود نه رفع: از دیدِ آن کاربر عنصر **بی‌توضیح ناپدید می‌شود**
(قرنطینه ساکت است، فقط در لاگِ سرور). رفعش یک پیامِ پروتکل می‌خواهد (ADR-047) و بیرونِ M6 است.

### قفلِ آزمونی

[`element.test.ts`](packages/shared-types/src/canvas/element.test.ts) دو تست گرفت: `embeddable` رد
می‌شود، **و** همان شکل با نوعِ مجاز پذیرفته می‌شود (کنترل — وگرنه قرمزیِ تستِ اول می‌توانست هر
دلیلِ دیگری داشته باشد).
⚠️ با افزودنِ عمدیِ `embeddable` به اتحاد، تستِ اول **قرمز** شد — پس اگر روزی کسی این نوع را
اضافه کند، همان‌جا یادش می‌آید که یک **سرویسِ خارجیِ runtime** را وارد دامنه‌ی P2 می‌کند.

---

## ⏸ نقطه‌ی توقف پیش از فشرده‌سازیِ context (۱۴۰۵/۰۷/۰۴)

**وضعیت:** M6 فاز ۰–۷ تمام · **فاز ۸: پنج ردیف از هفت** · ADR-070 پذیرفته و **پیاده** شد.
`pnpm verify` **۱۶/۱۶** بعد از هر ردیف · `sdk:contract` **۵۲/۵۲** · `billing:transfer` **۸/۸** ·
`billing:settle`/`billing:refund` بی‌تغییر · E2Eِ پنل **۳/۳** (دو اجرای پشتِ سرِ هم).

### شش کامیتِ این نشست

| | |
|---|---|
| `776c1db` | پذیرشِ ADR-070 |
| `75e5a12` | کارت‌به‌کارت، کامل (migration ۰۰۱۰ + درگاه + دو مسیر + پنل + صفحه‌ی کاربر + سنجه) |
| `09b4df8` | ۸٫۷ — گاردِ `WEB_BASE_URL` |
| `046c693` | ۸٫۱ — E2Eِ پنل روی استکِ واقعی |
| `cf633f8` | ۸٫۲ — ناحیه‌ی `hb_admin` |
| `f91bba1` · `9b50dcf` | ۸٫۳ (P2 روی باندل) · ۸٫۴ (میزبان‌های embed) |

⚠️ **هیچ‌کدام push نشده‌اند** مگر مالک بخواهد.

### ⏭ دو ردیفِ مانده — **بعد از فشرده‌سازی**

**۸٫۵ — اندازه‌گیریِ CSP.** «کدام دایرکتیوها بوم را می‌شکنند»، فقط **سند**، بدونِ enforce.
⊕ نقطه‌ی شروع در [`security-headers.conf`](infra/nginx/security-headers.conf) نوشته شده:
CSP عمداً نیست چون بومِ Excalidraw استایلِ inline و workerِ `blob:` دارد و یک CSPِ نادرست
**فقط در مرورگر** معلوم می‌شود. مستقل از هر تصمیمِ دیگری، آماده‌ی شروع.

**⏸ ۸٫۶ — باگِ تصویر روی بوم.** دو چیز لازم دارد که دستِ این نشست نیست:
۱. **مرورگر روی سایتِ زنده** (`https://hamboom.ir`) — کنسول/Network حینِ همان ژست.
۲. ⛔ **تاییدِ جدا** برای لمس، چون دامنه‌اش **M1/M3** است (قاعده ۱).
★ آنچه تا امروز **رد شده**: CORSِ باکتِ آروان (preflightِ `GET` با مبدأِ درست ۲۰۰ داد) و
«آپلود نشد» (`files` ناصفر است). پس مظنون‌ها: presign-**GET** سمتِ ما، رگرسیونِ یکی از
سه باگِ نمایشِ M3 ۱۱٫۲، یا خطای کلاینت.

### ⚠️ چیزی که در فشرده‌سازی نباید گم شود

★★ **فاز ۸ شش سبزِ دروغینِ خودم را گرفت** — بیش از هر فازِ دیگری در این ریپو. همه در
PROGRESS ثبت‌اند، و سه‌تایشان یک الگوی مشترک دارند که باید **پیش‌فرض** شود:

| الگو | کجا خورد |
|---|---|
| **ایمیجِ کهنه یک mockِ ناخواسته است** | ۸٫۲ و ۸٫۳ — استک با ایمیجِ موجود بالا آمد و چیزی را می‌سنجید که در آن باندل **نبود** |
| **ادعای ضعیف ⇒ تستِ پوچ** | ۸٫۳ — `getByRole("heading").first()` سرتیترِ **صفحه‌ی ورود** را هم می‌پذیرفت |
| **ابزار هم باید اثبات شود** | ۸٫۳ — probeِ شبکه هیچ درخواستِ خارجی نمی‌دید چون **محیط egress ندارد**؛ با یک مبدأِ *قابلِ دسترس* اعتبارسنجی شد |
| **چکِ همزمانی هم‌زمان نیست مگر ثابت شود** (بارِ چهارم) | ADR-070 — دو بار پشتِ سرِ هم، و بارِ دوم `23505` از قیدِ **اشتباهی** می‌آمد |
| **سنجه نباید به دیتابیسِ تمیز وابسته باشد** | `billing:transfer` و بلوکِ نوِ `sdk:contract` — هر دو اجرای بعدیِ خودشان را می‌شکستند |

⊕ و یک تله‌ی ابزاری: `grep -c` با شمارشِ **صفر** exit 1 می‌دهد و زنجیره‌ی `&&` را قطع می‌کند —
یک بار یک شکستنِ عمدی را بی‌صدا اجرا **نکرد**.

### ⏳ بازمانده‌های عملیاتی و تصمیمی

⛔ **چکِ حقوقی/مالیاتیِ کارت‌به‌کارت** (بلاک‌کننده‌ی گرفتنِ پول، نه ساختن) · سقفِ کارت‌به‌کارتِ
مالک · مقادیرِ واقعیِ `CARD_TRANSFER_*` · **دیدنِ اولین اجرای cron** روی VM ·
عددِ `--prune` · قالبِ تولیدیِ sms.ir.
★ و یک واریزِ **آزمایشیِ واقعی** پیش از اولین مشتری — هیچ گاردی نمی‌فهمد شماره‌ی معتبر
مالِ کسِ دیگری است.

---

## ✅ فاز ۸ ردیفِ ۸٫۵ — CSP: از **حدس** به **عدد** (۱۴۰۵/۰۷/۰۷)

سالِ گذشته در [`security-headers.conf`](infra/nginx/security-headers.conf) نوشته بودیم CSP
عمداً نیست چون «بومِ Excalidraw استایلِ inline و workerِ blob: دارد». این ردیف همان جمله را
سنجید. ⚠️⚠️ **هر دو نیمه‌اش غلط بود.**

### ابزار

[`apps/web/e2e/csp-measure.spec.ts`](apps/web/e2e/csp-measure.spec.ts) +
[`playwright.csp.config.ts`](apps/web/playwright.csp.config.ts) — `pnpm --filter @hamboom/web test:e2e:csp`
روی **استکِ productionِ محلی** (ایمیج‌های همین درخت، nginxِ واقعی). برای هر پالیسی یک بوردِ
**واقعی** باز می‌شود، استیکی کشیده می‌شود، فونت **به‌زور** load می‌شود، و هر
`securitypolicyviolation` با دایرکتیوِ **موثر** و `sourceFile` جمع می‌شود.

★ چرا حتماً باندلِ build و نه سرورِ dev: سرورِ dev خودش یک `<script type="module">`ِ **inline**
برای preambleِ react-refresh تزریق می‌کند و CSS را `<style>`ِ inline می‌دهد — یعنی دقیقاً
`script-src` و `style-src`، همان دو چیزی که این ردیف درباره‌شان است، جوابِ **Vite** را می‌دادند.

### جدول — ۹ پالیسی، دو کنترل، یک خودآزمون

| پالیسی | بوم | اتصال | تخلف |
|---|---|---|---|
| ۰ بدونِ CSP (کنترل) | ✓ | ذخیره شد | **۰** |
| ۱ `default-src 'self'` | ✗ | — | `script-src-elem`×۱ (inline) · `img-src`×۴ (data) · `script-src`×۱ (eval) |
| ۲ نامزد − هشِ inline | ✗ | — | `script-src-elem`×۱ · `script-src`×۱ |
| ۳ **نامزد** | ✓ | ذخیره شد | ۲۳۱ = `script-src`×۱ (eval) + `font-src`×۲۳۰ |
| ۴ نامزد − `'unsafe-inline'` | ✓ | ذخیره شد | ۲۳۱ — **صفر `style-src`** |
| ۵ نامزد − `data:`/`blob:` | ✓ | ذخیره شد | ۲۳۵ (+`img-src`×۴) |
| ۶ نامزد − `blob:` worker | ✓ | ذخیره شد | ۲۳۱ — **صفر `worker-src`** |
| ۷ نامزد − `connect-src 'none'` (خودآزمون) | ✗ | — | `connect-src`×۱ ← `/auth/refresh` |
| ۸ بدونِ CSP (کنترلِ **پایانی**) | ✓ | ذخیره شد | **۰** |

### آنچه معلوم شد

★★ **۱. تنها چیزی که بوت را می‌شکند، اسکریپتِ inlineِ `index.html` است** — همان سه خطی که
`window.EXCALIDRAW_ASSET_PATH` را می‌گذارد. بدونش موتور صریحاً می‌اندازد
(«مسیر دارایی‌های Excalidraw تنظیم نشده است») و بوم **اصلاً** نمی‌آید. ⇒ پیش‌نیازِ هر enforceی
این است که آن اسکریپت به یک **فایلِ جدا** برود، وگرنه پالیسی به یک `sha256` گره می‌خورد که با
هر ویرایشِ آن اسکریپت بی‌صدا باطل می‌شود.

★★ **۲. `style-src 'unsafe-inline'` لازم نیست.** ادعای قدیمی غلط بود: React و excalidraw استایل
را از راهِ **CSSOM** می‌نویسند (`node.style.setProperty`)، و CSP فقط صفتِ `style`ِ **متنی** را
می‌بیند. سطرِ ۴: صفر تخلفِ style، بوم و نوار سالم.

★★ **۳. `worker-src blob:` هم لازم نیست** — در مسیرهای آزموده‌شده هیچ workerی ساخته نشد.

**۴. `img-src data:` واقعاً لازم است** (۴ تخلف): آیکون‌های SVGِ خودِ excalidraw، و مسیرِ تصویرِ
**ما** که blob را به `data:URI` تبدیل می‌کند (`asset-transport`، درسِ M3 ۱۱٫۲).

**۵. `connect-src 'self'` وب‌سوکتِ هم‌مبدأ را می‌پذیرد** — با پالیسیِ نامزد وضعیت «ذخیره شد» شد.

**۶. `'unsafe-eval'` لازم نیست.** دقیقاً **یک** تماسِ eval بلاک می‌شود
(`index-*.js:270` — شیمِ `Function("return this")`ِ سبکِ lodash) و هیچ‌چیز نمی‌شکند.

⚠️ **۷. `font-src 'self'` کار می‌کند ولی ۲۳۰ تخلف در هر بازکردنِ بورد چاپ می‌کند.** excalidraw به
`src`ِ **هر** فونت یک `ASSETS_FALLBACK_URL`ِ `https://esm.sh/...` می‌چسبانَد. ⊕ و این برای P2
**خطر نیست**: اندازه‌گیری شد که هر ۲۳۰ فقط **اعلام**‌اند — `duration=0`، `transferSize=0`،
`responseStatus=0` — و با `document.fonts.load()`ِ اجباری، فونت از `/excalidraw-assets/` با
**۲۰۰** و ۲۵٬۲۵۶ / ۵۶٬۴۵۶ بایت آمد. ولی کنسولِ پر از خطا هر خطای واقعی را دفن می‌کند.

### ⚠️⚠️ سه سبزِ دروغینِ خودِ این ابزار (هفتم، هشتم و نهمِ فاز ۸)

| چه بود | چطور لو رفت |
|---|---|
| **`route.fulfill` رفتار را عوض می‌کرد:** پاسخِ ساختگیِ playwright IP ندارد ⇒ فضای نشانیِ سند «عمومی» می‌شود ⇒ `ws://localhost` می‌شود public→local و کروم با **`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`** می‌بنددش. نتیجه: «وب‌سوکت با هر CSPی می‌افتد» — که خیلی راحت به `connect-src` نسبت داده می‌شد | **کنترلِ پایانی** (بی‌CSP در انتهای فهرست) که سالم بود، و بعد **دُمِ** پیامِ کنسول. ⇒ ابزار به یک پروکسیِ **واقعی** عوض شد |
| **مسیرِ فایلِ پالیسی در دو پروسه دو جا بود** (playwright TS را از پوشه‌ی کش اجرا می‌کند؛ cwdِ `webServer` هم همانِ ورکر نیست) ⇒ هدر هرگز نمی‌نشست ⇒ **همه‌ی** پالیسی‌ها «صفر تخلف» | خودآزمونِ `connect-src 'none'` (که **باید** تخلف بدهد) قرمز شد |
| **کشِ مرورگر:** پروکسی فقط وقتی هدر می‌گذاشت که پاسخ `text/html` باشد؛ مرورگر با `If-None-Match` می‌آمد، nginx **۳۰۴** می‌داد (بی `content-type`)، پس صفحه با بدنه‌ی کش‌شده و **بدونِ CSP** بالا می‌آمد | همان خودآزمون، **دوباره**. ⇒ معیار به «درخواستِ سند است؟» عوض شد + `no-store` |

★ و به همین دلیل یک ادعای صریحِ نو اضافه شد: **«هدرِ CSP روی پاسخِ سند نشست»** — تنها چیزی که
«تخلفِ صفر» را از «پالیسی اصلاً نرسید» جدا می‌کند.

### ⊕ و یک ردیفِ دیگر را هم بست: ۸٫۳ از ◑ به ✅

سطرِ ۸٫۳ نوشته بود «مرورگرِ این محیط egress ندارد، پس نمی‌شود «تماس نگرفت» را از «شبکه بست»
تفکیک کرد». **دوباره سنجیده شد و برقرار نبود:** یک `fetch`ِ عمدی به `https://example.com/`
پاسخِ **opaque** با **۹۹۹ms** و یک entryِ واقعیِ resource timing داد. پس همان کنترلِ مثبت حالا
**داخلِ خودِ تست** است: اول «صفر درخواستِ غیرِ هم‌مبدأ» assert می‌شود، بعد یک تماسِ خارجیِ عمدی
که **باید** دیده شود. اگر روزی شبکه بسته باشد، تست قرمز می‌شود — و همان درست است.
(اجرا: **۹۸ درخواست، همه هم‌مبدأ** + کنترل سبز.)

---

## ◑ فاز ۸ ردیفِ ۸٫۶ — باگِ تصویر: سه نامزد حذف شد، و **سکوت** رفع شد (۱۴۰۵/۰۷/۰۷)

### مسیرِ واقعی (از کد)

`resolve(fileId)` → `sdk.assets.resolveBlob` → `fetch("/assets/:id", { redirect: "follow" })`
با Bearer → api یک **۳۰۲** به URLِ امضاشده‌ی انبار می‌دهد → مرورگر دنبال می‌کند → بایت‌ها →
`data:URI` → `addFiles`.

### ❌ سه نامزد که با **اندازه‌گیری** حذف شدند

**۱. «ری‌دایرکتِ بین‌مبدأ `Origin: null` می‌فرستد»** — فرضیه‌ی اولِ خودم بود و **غلط** از آب
درآمد. با دو سرورِ محلی روی دو پورت و مرورگرِ واقعی:

| سناریو | نتیجه |
|---|---|
| مستقیم، ACAO = مبدأِ ما | ✅ ۲۰۰ |
| **ری‌دایرکت**، ACAO = مبدأِ ما | ✅ ۲۰۰ — و انبار `Origin`ِ **واقعی** را دید، نه `null` |
| ری‌دایرکت، ACAO = `*` | ✅ ۲۰۰ |
| ری‌دایرکت، **بدونِ** ACAO | ❌ `TypeError: Failed to fetch` |
| ری‌دایرکت، ACAO = مبدأِ دیگر | ❌ `TypeError: Failed to fetch` |
| ری‌دایرکت، **۴۰۳** با ACAO | ◑ resolve می‌شود، `ok=false`، `status=403` |

⊕ و `Authorization` روی هاپِ بین‌مبدأ **حذف** شد — همان‌طور که کامنتِ sdk ادعا می‌کرد.

**۲. «CORSِ باکتِ آروان روی `GET`ِ واقعی نیست»** — نه. `GET`ِ بی‌امضا به باکتِ زنده با
`Origin: https://hamboom.ir` پاسخِ ۴۰۳ **با** `access-control-allow-origin: https://hamboom.ir`
داد. یعنی قاعده روی پاسخِ **واقعی** هم اعمال می‌شود، نه فقط preflight.

**۳. «`/assets` به api پروکسی نمی‌شود»** — نه. `https://hamboom.ir/assets/<uuid>` **۴۰۱ JSON**
می‌دهد (نه `index.html`)، و `/excalidraw-assets/...` هم ۲۰۰ `font/woff2` — یعنی مسیرها درست‌اند.

### ✅ آنچه **رفع** شد: باگ دیگر بی‌صدا نیست

⚠️⚠️ ریشه‌ی «نه لاگِ api چیزی داشت نه کنسول» خودِ کدِ ما بود: `resolve` یک
`catch { return "" }`ِ **کاملاً خاموش** داشت. عمدی بودنِ نینداختنِ خطا درست است (مسیرِ رندر)،
ولی خاموشی نه. حالا علت را چاپ می‌کند و سه علت شکلِ متفاوتی دارند:

| در کنسول | یعنی |
|---|---|
| `api 404 NOT_FOUND` | ردیفِ `files` هنوز `ready` نیست ⇒ **commit** نخورده یا خورده — مالِ **ما** |
| `api 403/401 …` | دسترسیِ بورد |
| `TypeError: Failed to fetch` | پاسخِ انبار CORS نداشت یا مسدود شد |
| چیزِ دیگر با status | انبار پاسخِ ناموفق داد (مثلاً امضای presign-GET) |

[`asset-transport.test.ts`](apps/web/src/board/asset-transport.test.ts) **۳ تست**؛ با برداشتنِ
`console.error` **دو**تاشان قرمز شدند.

### ⏳ چه چیزی هنوز مانده — و ارزان‌ترین راهِ بستنش

دو چیزِ باقی‌مانده هیچ‌کدام از این ماشین قابلِ آزمون نیستند (ورود به سایتِ زنده پیامکِ واقعی
می‌خواهد):

1. **ردیفِ `files` چه وضعیتی دارد؟** یک کوئریِ فقط‌خواندنی روی VM فضای باقی‌مانده را **نصف** می‌کند:

   ```
   docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production exec postgres \
     psql -U hamboom -d hamboom -c "SELECT id, status, mime_type, size_bytes, created_at FROM files ORDER BY created_at DESC LIMIT 5;"
   ```

   `pending`/`failed` ⇒ مشکل در **commit** (سرور بایت را در باکت پیدا نکرد یا sha نخواند).
   `ready` ⇒ مشکل در **خواندن** ⇒ سراغِ سطرِ بعد.

2. **یک بازِ دیگرِ تصویر روی سایتِ زنده، با کنسولِ باز** — حالا دیگر پیامِ ما آن‌جا هست و
   مستقیماً می‌گوید کدام سطرِ جدولِ بالا است.

⛔ **و عمداً چیزی «برای احتیاط» عوض نشد.** گزینه‌ی ساختاری (استریمِ بایت‌ها از خودِ api به‌جای
۳۰۲، که `getObjectStream`ِ ADR-069 امکانش را داده) کلِ وابستگی به CORS/presign را حذف می‌کند —
ولی حالا که CORS **اثبات شده سالم است**، این تغییر مسیرِ داده‌ی همه‌ی تصویرها را به api می‌بَرد
بی‌آنکه بدانیم اصلاً مشکل همان بوده. اول تشخیص، بعد درمان.

### ✅ و یک نامزدِ چهارم هم حذف شد: «باگ فقط در باندلِ build است»

این فرضیه جدی بود — باگ **فقط** در اولین استقرارِ واقعی دیده شد و در توسعه هرگز، و ردیفِ ۸٫۵
همین هفته نشان داد dev و build در چیزهای مهمی فرق دارند. پس مسیرِ تصویر روی **باندلِ ساخته‌شده
پشتِ nginx** سنجیده شد ([`asset-upload.spec.ts`](apps/web/e2e/asset-upload.spec.ts)،
`pnpm --filter @hamboom/web test:e2e:assets`)، و هر چهار حلقه **جدا** assert شد:

| حلقه | نتیجه |
|---|---|
| `POST …/assets/presign` | **۲۰۰** |
| POSTِ مستقیم به انبار | **۲۰۴** |
| `POST …/assets/:id/commit` | **۲۰۰** (یعنی سرور بایتِ واقعی را دید و sha را تایید کرد) |
| `GET /assets/:id` | **۳۰۲** |
| دنبال‌کردنِ ری‌دایرکت به انبار | **۲۰۰** |
| پیامِ «بایتِ تصویر … خوانده نشد» | **صفر** |

★★★ **و خودِ این سنجه یک شکستنِ عمدیِ دائمی دارد:** بعد از ادعای «صفر خطا»، خواندنِ
`/assets/:id` عمداً قطع می‌شود و تست انتظار دارد پیامِ خطا **بیاید** و **علت** را بگوید.
⚠️ نگارشِ اولِ همین شکستن روی نشانیِ **انبار** بود و بی‌صدا هیچ نشد — پاسخِ انبار کش‌پذیر است و
بعد از reload اصلاً درخواستی نمی‌رفت. روی مسیرِ هم‌مبدأ (که `no-store` دارد) درست شد.
⊕ و ایمیجِ web پیش از اجرا بازساخته شد و **حضورِ رشته‌ی نو در باندل** مثبت چک شد
(`grep -c` روی `index-*.js` = ۱) — درسِ «ایمیجِ کهنه یک mockِ ناخواسته است» (۸٫۲/۸٫۳).

⇒ **کدِ ما روی یک انبارِ سالم و روی باندلِ production درست کار می‌کند.** پس آنچه در تولید
می‌شکند یا رفتارِ **آروان** است یا **وضعیتِ داده‌ی** همان‌جا — و همان دو سطرِ بالا (کوئریِ
`files` و یک بازِ زنده با کنسولِ باز) تفکیکش می‌کنند.

### ⚠️ یک قرمزِ گذرا که ثبت می‌شود، نه توجیه

یکی از اجراهای `pnpm verify` روی گیتِ `test` قرمز شد؛ اجرای کاملِ `turbo run test` بلافاصله بعدش
**هر ۱۳۲ فایلِ تست** را سبز داد و دو `verify`ِ بعدی هم سبز بودند (exit 0، `out of memory` صفر،
`Tasks:` چهار). سیگنال‌های همان اجرای قرمز ذخیره نشده بود، پس **ادعایی درباره‌ی علت نمی‌کنیم** —
فقط اینکه استکِ داکر همان لحظه بالا بود و سقفِ commitِ ویندوز همان چیزی است که CLAUDE.md برای
این نشانه می‌گوید اول نگاه کنی.

---

## ✅ فاز ۸ — تاییدِ مالک (۱۴۰۵/۰۷/۱۷)

مالک گزارشِ فاز ۸ را **تایید کرد**. وضعیتِ تاییدشده: **شش ردیف ✅** (۸٫۱ · ۸٫۲ · ۸٫۳ · ۸٫۴ · ۸٫۵ · ۸٫۷) و
**`[!]` ۸٫۶ ◑** که باز می‌مانَد و منتقل می‌شود.

**چه تصمیمی گرفتم:** ۸٫۶ با تاییدِ فاز **تیک نخورد**. معیارِ پذیرشش مشاهده‌ی مرورگر روی سایتِ زنده است و آن
محقق نشده (قاعده‌ی ۴)؛ بلوکه‌اش بیرونی است — ورود به `hamboom.ir` پیامکِ واقعی به گوشیِ مالک می‌خواهد
(قاعده‌ی ۵). دو قدمی که می‌بندَدَش همان است که در بخشِ ۸٫۶ بالا نوشته شده:

1. `SELECT id, status, … FROM files ORDER BY created_at DESC LIMIT 5` روی VM — `pending`/`failed` ⇒ **commit**؛ `ready` ⇒ **خواندن**.
2. یک درجِ تصویرِ دیگر روی سایتِ زنده با کنسولِ باز — ⚠️ **بعد از استقرارِ ایمیجِ webِ تازه**، چون پیامِ
   «بایتِ تصویر … خوانده نشد» فقط از کامیتِ `850b59c` به بعد در باندل هست؛ ایمیجِ فعلیِ روی VM هنوز ساکت است.

**قدمِ بعد:** فاز ۹ (تحویل) — **شروع نشده**، با تاییدِ مالک. ⊕ ورودی‌هایی که فاز ۸ برایش گذاشت:
سه سنجه‌ی E2Eِ نو (`test:e2e:p2`/`csp`/`assets`) باید در فهرستِ گیتِ نهاییِ ۹٫۴ بیایند، و ۸٫۶ی باز باید در
`m7-handoff` (۹٫۳) به‌عنوانِ بازمانده ثبت شود. ⚠️ ده کامیت روی `main`ِ محلی است و هیچ‌کدام push نشده.

---

## ✅ فاز ۹ ردیفِ ۹٫۱ — `docs/admin.md`: مرجع، از کدِ فعلی (۱۴۰۵/۰۷/۱۷)

[`docs/admin.md`](docs/admin.md) نوشته شد — گاردها، step-up، ۲۱ مسیر، ۱۶ عملِ ممیزی، جریان‌های مخرب، و
شش محدودیتِ مستند. **روش:** هیچ جدولی از حافظه یا از نقشه نیامد؛ مسیرها و `audited()`ها از
`routes/admin*.ts`، واژگان از `AuditAction` و همه‌ی فراخوان‌های `recordAudit`، عددها از schemaهای
`shared-types` و `config`.

⚠️ **همین «از کد بخوان» دو دریفتِ درونِ خودِ ریپو را گرفت:**

| کجا | چه می‌گفت | کد چه می‌گوید |
|---|---|---|
| کامنتِ `routes/admin.ts` روی sweepِ دستی | «پیش‌فرض ۱۰، سقفِ schema ۲۵» | `reconcileRequest`: پیش‌فرض **۵**، سقف **۱۰** (بازبینیِ ۶٫۵ پایینش آورده بود و کامنت جا مانده بود) |
| `apps/web/CLAUDE.md` | «عددِ پنجره به کلاینت نمی‌رسد» | ۴۲۸ آن را در `details.stepUpSeconds` می‌فرستد؛ رابط فقط **استفاده نمی‌کند** |

هر دو اصلاح شد. ⊕ و یک چیز که نوشتنِ جدولِ واژگان روشن کرد: `payment.verify` **سه** نویسنده دارد (دکمه‌ی
verify · ابطالی که به فعال‌سازی رسید، با `via: "expire"` · و sweep)، نه یکی.

---

## ✅ فاز ۹ ردیفِ ۹٫۲ — RUNBOOK: هر دستور یک بار **واقعاً** اجرا شد (۱۴۰۵/۰۷/۱۷)

معیارِ این ردیف درسِ فاز ۱۰ی M5 بود: چهار خطِ سند که هرگز کار نکرده بودند. پس هر خطِ M6 با **همان
متنِ RUNBOOK** روی یک استکِ productionِ محلی اجرا شد: ایمیج‌های همین درخت، nginxِ واقعی،
`APP_ENV=staging`، و ★ **سه باکتِ جدا** (`p9-*`) تا حذف‌کننده‌ها (`sweep-orphans --delete`،
`--prune`) هرگز به داده‌ی dev نرسند.

### داده‌ی آزمون — با رویه‌ی خودِ RUNBOOK

«چطور اولین فشرده‌سازی را عمداً بسازی» (§۱٫۵) عیناً اجرا شد: بورد + سه استیکی + یک تصویر → **۷۵ ثانیه**
صبر → یک ویرایشِ دیگر. کوئریِ تاییدِ همان بخش: `boards|files|snapshots|updates` = **`1|1|1|0`**.

### جدولِ اجرا

| خطِ RUNBOOK | خروجیِ واقعی |
|---|---|
| §۱٫۵ ردیفِ ۱۰ — `grant-staff … --phone=` | «✔ 0912\*\*\*40 staff شد (audit: staff.grant)» |
| همان، بارِ دوم | «⊘ از قبل staff بود — هیچ ردیفی نوشته نشد» |
| همان، بدونِ `--phone` | exit **۱** |
| §۷٫۱ — `… --revoke` | «✔ staff … گرفته شد (audit: staff.revoke؛ step-up پاک شد)» · `is_staff=f` · `step_up` تهی |
| §۵ «پنل ۴۰۳ می‌دهد» | `GET /admin/me` ⇒ **۴۰۳** · لاگ: `"staffDenied":"not_staff"` · اعطای دوباره ⇒ **همان توکن** ⇒ ۲۰۰ |
| §۷٫۲ — تعلیق از پنل (دو مرورگر) | ۴۲۸ → step-up → تعلیق · refreshِ کاربر **۴۰۱ `USER_SUSPENDED`** · کارتِ «حساب معلق شده است» · رفعِ تعلیق ⇒ ورودِ دوباره با پیامک |
| §۶ cron ۱ — `backup-all … --prune=14` | dump ۸۵٬۵۴۵ بایت، ۱۱ migration، ۳۰ جدول · آینه ۱+۱ شیء · جفتِ پیوندخورده |
| §۶ cron ۲ — `restore-drill` | **۶/۶** |
| §۶ cron ۳ — `restore-storage` | **۶/۶** برای هر دو باکت |
| §۶ cron ۴ — `purge --delete` && `sweep-orphans --delete` | «چیزی برای پاک‌سازی نیست» · «دارای مرجع ۱ · یتیم ۰» |
| §۶ cron ۵ — `purge-audit … --delete` | «ردیفِ کهنه‌تر از مرز: ۰» |
| §۵ — `reconcile … --dry-run` | همه‌ی شمارنده‌ها صفر، exit ۰ |

ردیف‌های ممیزیِ تعلیق، خوانده از دیتابیس — دقیقاً همان `metadata`ی [`docs/admin.md`](docs/admin.md) §۵:

```
user.search            {"kind": "phone", "teams": 0, "users": 1}
staff.step_up.request  {}
staff.step_up          {}
user.suspend           {"from": "active", "reason": "…", "sessionsRevoked": 1, "challengesConsumed": 0}
user.unsuspend         {"from": "suspended"}
```

### ★★ تمرینِ کاملِ حادثه‌ی ترکیبی — و سبزِ دروغینی که پیدا کرد

بعد از `backup-all`، **حادثه ساخته شد**: `DELETE FROM boards` و خالی‌کردنِ هر دو باکتِ زنده
(`0|0|0`، صفر شیء). بعد §۴ و §۴٫۱ خط‌به‌خط:

| گام | نتیجه |
|---|---|
| `stop api realtime` | ✓ |
| `restore-drill … --key=… --keep` | **۶/۶** |
| `restore-storage … --database=hamboom_restore_drill` | **۶/۶** هر دو باکت |
| `restore-storage … --to-live` | سبز (★ اولین اجرای واقعیِ این مسیر) |
| جابه‌جاییِ نام (خطِ `sh -c`ِ RUNBOOK، بی‌تغییر) | `ALTER DATABASE` ×۲ |
| `up -d api realtime` | هر پنج سرویس healthy · `/readyz` **۲۰۰** |
| شمارش‌ها | برگشت به **`1|1|1`** · ممیزی ۶ ردیف |
| `migrate` روی دیتابیسِ برگشته | «همه‌ی migrationها از قبل اعمال شده‌اند (11 فایل)» |
| ★ مرورگر | همان کاربر وارد شد، **همان بورد** باز و وصل شد، تصویر: `GET /assets/<همان fileId>` → ۳۰۲ → ۲۰۰ |

⚠️⚠️ **و خطِ `--to-live`ِ RUNBOOK یک سبزِ دروغین داشت که فقط همین تمرین نشانش داد.** آن خط `--database`
ندارد، پس کاتالوگ را از `DATABASE_URL` می‌خوانَد — که در حادثه‌ی ترکیبی همان دیتابیسِ **خراب** است:

```
✔ ★ هر snapshotی که دیتابیس می‌شناسد، در مقصد بایت دارد
    0 ردیف، همه با بایت
✔ ★ بایت‌های هر snapshot یک Y.Docِ معتبر با همان state vectorِ ردیف می‌سازند
    0 سند بازخوانی شد
```

دو چک از شش، سبز، و هیچ‌چیز را نسنجیده. بدتر: `catalog` دقیقاً چکی است که باید جفتِ ناهم‌خوانِ
dump↔آینه را بگیرد. چکِ `vacuous` از فاز ۲ فقط «مانیفستِ تهی» را می‌دید، نه «کاتالوگِ تهی در برابرِ
آینه‌ی ناتهی».

**رفع، به ترتیبِ درست:** اول سناریوی هشتم به خودآزمون اضافه شد و روی کدِ قبلی **قرمز** دیده شد
(«انتظار قرمز: catalog,opens · واقعی: هیچ»)، بعد `restore-storage-core.ts` اصلاح شد (۸/۸)، بعد ایمیج
بازساخته شد و **همان خطِ RUNBOOK** روی همان استک دوباره اجرا شد:

| | `catalog` / `opens` | exit |
|---|---|---|
| `--to-live` روی دیتابیسِ خراب | ✖ «دیتابیسِ اشتباه؟ … `--database=hamboom_restore_drill`» | **۱** |
| همان + `--database=hamboom_restore_drill` | ✔ «۱ ردیف، همه با بایت» · «۱ سند بازخوانی شد» | **۰** |

RUNBOOK §۴٫۱ حالا ترتیبِ حادثه‌ی ترکیبی را **صریح** دارد (پیش‌تر دو بخشِ جدا بود و ترتیبشان با هم گفته
نشده بود).

### چهار چیزِ دیگر که اجرای واقعی اصلاح کرد

۱. **RUNBOOK §۸ کهنه بود:** «هیچ‌کدام از بخش‌های ۱ تا ۴ هنوز روی VM اجرا نشده» — در حالی که روزِ صفر
   ۱۴۰۵/۰۷/۰۳ روی VM اجرا شده. حالا می‌گوید چه روی VM اجرا شده و چه نه.
۲. **مرزِ `--prune` اندازه‌گیری شد:** با `--prune=1`، «۲ شیء حذف شد» (dump + `.json`) ولی هر دو
   `storage/manifest-*.json` ماندند. یعنی `--prune=14` باکتِ پشتیبان را **ثابت** نگه نمی‌دارد — هر شب
   یک مانیفستِ تازه. عمدی است (عددِ نگهداشتِ آینه تصمیمِ بازِ مالک است) ولی هیچ‌جا با عدد نوشته نشده بود.
۳. ⚠️ **یک استدلالِ خودم در ۸٫۶ ناقص بود.** نوشته بودم «`files` ناصفر ⇒ آپلود موفق بوده». ولی `presign`
   **پیش از** آپلود یک ردیفِ `pending` می‌نویسد — پس `count(*)` اثباتِ آپلود نیست؛ **`status`** است:
   `pending` ⇒ آپلودِ مستقیم در مرورگر شکست خورده · `failed` ⇒ commit اجرا شد و راستی‌آزمایی رد کرد
   (۴۲۲ در لاگِ api، با متنِ علت) · `ready` ⇒ مشکل در خواندن. ردیفِ §۵ی RUNBOOK با همین سه‌تکه بازنویسی شد.
۴. **ردیفِ ۹ی روزِ صفر** می‌گفت تصویر «روی آروان اثبات نشده»؛ حالا می‌گوید روی آروان **افتاده** و باز است.

### آنچه این ردیف **ادعا نمی‌کند**

همه‌ی این‌ها روی استکِ productionِ **محلی** است: MinIO نه آروان، دیتابیسِ یک‌بوردی نه داده‌ی واقعی. روی
VM تا امروز فقط بخشِ ۱ اجرا شده؛ بخشِ ۲ (استقرارِ نسخه‌ی دوم)، rollback، جابه‌جاییِ نام، `--to-live` و
**اولین اجرای cron** هنوز نه — همه در RUNBOOK §۸ با ⏳.

---

## ✅ فاز ۹ ردیفِ ۹٫۳ — `docs/m7-handoff.md`، و تمرینِ همان استقراری که سند درباره‌اش است (۱۴۰۵/۰۷/۱۷)

[`docs/m7-handoff.md`](docs/m7-handoff.md): وضعیت در یک نگاه · هشت چیزِ بی‌صدا‌شکننده · آنچه تحویل
گرفته می‌شود (استقرارِ نسخه‌ی دوم، باگِ تصویر، مسیرِ پول، cron، CSP، گیتِ قرمزِ M2، تصمیم‌های باز) ·
پیکربندیِ تازه · درس‌های روشی · دستورها · گیتِ نهایی با عدد.

⚠️ **«M7» در PLAN نیست** — شش ماژولِ PLAN تمام شده‌اند. سند این را صریح می‌گوید و دامنه را به مالک می‌سپارد.

### چون سند می‌گفت «قدمِ بعدی استقرارِ نسخه‌ی دوم است»، همان استقرار تمرین شد

RUNBOOK §۲ و §۳ از M5 «اجرانشده» بودند. ایمیج‌های `c6bfe6e` (همان تگِ روی VM) هنوز روی این ماشین بودند،
پس «دنیای VM» بازسازی شد: ایمیج **و** composeِ همان کامیت، دیتابیسِ تازه با **۱۰** migration، و یک
کاربر + بورد + تصویر که روی **نسخه‌ی قدیم** ساخته شد.

| گام | اندازه‌گیری |
|---|---|
| پشتیبانِ پیش از استقرار | ✔ |
| ★ ایمیجِ نو + composeِ **قدیم** (`git pull` فراموش شد) | `migrate`: «✔ 0010_card_transfer.sql · ✔ 1 migration اعمال شد» · پنج سرویس سالم · `/readyz` ۲۰۰ · ⚠️ ولی api **۰** متغیرِ `CARD_TRANSFER_*` دید |
| مرورگر، بعد از migration روی داده | همان کاربر، همان بورد، وصل، همان تصویر (`/assets/47abb109…` → ۳۰۲ → ۲۰۰) |
| ایمیجِ نو + composeِ **نو** | api **۵** متغیرِ `CARD_TRANSFER_*` |
| ★ rollback: تگِ `c6bfe6e` روی schemaی ۱۱-migrationی | `migrate`ِ قدیم: «همه‌ی migrationها از قبل اعمال شده‌اند (10 فایل)»، exit ۰ · پنج سرویس سالم · `/readyz` ۲۰۰ |
| مرورگر، کدِ قدیم روی schemaی نو | همان بورد، همان تصویر |

دو نتیجه که پیش از این فقط «از خواندنِ کد» می‌دانستیم و حالا عدد دارند:
**رانرِ migration یک migrationِ ناشناخته‌ی جلوتر را رد نمی‌کند** (پس rollbackِ §۳٫۱ بعد از یک migrationِ
افزایشی واقعاً فقط تعویضِ تگ است)، و **فراموش‌کردنِ `git pull` بی‌صدا است** — تا روزی که درگاه عوض شود.
`git pull` به RUNBOOK §۲ اضافه شد.

### پنجمین مظنونِ ۸٫۶ هم حذف شد — و جدولِ تشخیص دقیق‌تر شد

- **CORSِ `POST` روی باکتِ زنده اندازه‌گیری شد:** preflight برای `GET`/`POST`/`PUT`/`HEAD` هر چهار ۲۰۰ با
  `access-control-allow-origin: https://hamboom.ir`؛ `POST`ِ بی‌امضا ۴۰۰ **با** همان هدر. پس «آپلود انجام شد
  ولی مرورگر پاسخش را نتوانست بخواند» هم نیست.
- **خواندنِ `image-tool` یک تفکیکِ رایگان داد که هیچ‌وقت پرسیده نشده بود:** اگر `upload()` بشکند **هیچ
  عنصری** درج نمی‌شود و نوتیسِ «درجِ تصویر ناموفق بود» می‌آید (و `console.warn("HB_IMAGE", …)` که در همان
  ایمیجِ `c6bfe6e`ِ روی VM هم هست)؛ اگر فقط **خواندن** بشکند، عنصر درج شده و یک **قابِ خالی** می‌مانَد.
  گزارشِ اولیه می‌گفت «هیچ تصویری ظاهر نمی‌شود» — اگر تحت‌اللفظی درست باشد، مشکل در نیمه‌ی **آپلود/commit**
  است، نه خواندن؛ یعنی نیمه‌ای که کلِ تحلیلِ ۸٫۶ رویش نبود. ⚠️ این یک **استنتاج از کد** است، نه اندازه‌گیری؛
  `status`ِ ردیفِ `files` تاییدش می‌کند یا رد.

### سه ادعای کهنه در CLAUDE.md

«۶۴ تصمیمِ فنی» (۷۰ است) · «۱٫۰ قرمز: کلیدِ sms.ir» و «کلید باید باطل شود» (هر دو با چرخشِ کلید در
۱۴۰۵/۰۷/۰۳ بسته شده بودند و فقط PROGRESS می‌دانست).

---

## ⏸ نقطه‌ی توقف پیش از فشرده‌سازیِ context (۱۴۰۵/۰۷/۱۸) — فاز ۹، سه ردیف از چهار

| ردیف | وضعیت | کامیت |
|---|---|---|
| ۹٫۱ `docs/admin.md` | ✅ | `dd6cf5d` |
| ۹٫۲ RUNBOOK، هر دستور واقعاً اجرا شد | ✅ | `c95f551` |
| ۹٫۳ `docs/m7-handoff.md` + تمرینِ استقرار/rollback | ✅ | همین کامیت |
| ۹٫۴ بازبینیِ خصمانه + گیتِ نهایی | ◑ **گیت ✅ · بازبینی ⛔** | — |

⚠️ مالک گفته **push انجام شده** (تا `25b81cd`). کامیت‌های این فاز هنوز محلی‌اند.

### ✅ گیتِ نهاییِ ۹٫۴ — اجرا شد، با عدد (۱۴۰۵/۰۷/۱۷)

| گروه | نتیجه |
|---|---|
| `pnpm verify` | **۱۶/۱۶** · exit 0 · صفر OOM · `Tasks:` ۴ — در هر اجرای این فاز |
| دیتابیس و دارایی | `db:migrate` (۱۱ فایل) · `db:smoke` · `db:fk-test` · `db:store-test` (۱۴ چک) · `assets:smoke` (۶) |
| **هفت سنجه‌ی realtime** | `durability` (تاخیرِ «ذخیره شد» ۳۷ms) · `compaction` (۵۰۰ update → یک snapshot، ۴۹۹ ردیفِ حذف‌شده) · `permission` · `presence` · `cluster` · `shutdown` · `reconnect` |
| billing | `probe-db` · `probe-idem` · `probe-math` · `settle` (**۱۲** چک) · `quota` (۶) · `probe-reconcile` (۹) · `refund` (**۱۱**) · `transfer` (۸) |
| infra | `probe-lock` (۴) · `probe-metrics` (۳؛ ۱۲ + ۱۵ متریک) · `probe-leader` (۳) · `backup-all` · `restore-drill` (**۶/۶**) · `restore-storage` (**۶/۶** ×۲) |
| خودآزمون‌ها | `restore-drill` (۵ شکستن) · `restore-storage` (**۸** سناریو) · `backup-storage` (۵) · `sweep-orphans` (۶) · `purge-audit` (۴) · `grant-staff` (۶) |
| ادمین و قرارداد | `admin:access` (۸ انتظار) · `sdk:contract` (**۵۲ pass, 0 fail**) |
| E2Eِ وب | پنل **۳/۳** ×۲ · P2: ۹۸ درخواست هم‌مبدأ + کنترلِ مثبت · CSP: ۹ پالیسی، همان جدولِ ۸٫۵ · تصویر: چهار حلقه + شکستنِ عمدی |
| E2Eِ `canvas-sync` | **۲۸/۲۸** · `[!]` `test:e2e:server` **۰/۱** |

**۳۴ سنجه‌ی زنده، هر ۳۴ سبز.** ⚠️ `infra:probe-metrics` بارِ اول ۲ از ۳ قرمز بود — نه رگرسیون: هر دو سرورِ dev
(realtime ۱۵۴۰۱، api ۱۵۴۰۲) باید **از قبل بالا** باشند و هیچ سندی این را نمی‌گفت. با سرورها ۳/۳. در CLAUDE.md ثبت شد.

### ⚠️ دو چیز که فقط «همه را یک بار دیگر بزن» پیدا کرد

**۱. `pnpm --filter @hamboom/web test:e2e` از ردیفِ ۸٫۳ قرمز بود — رگرسیونِ خودم.** `playwright.config.ts`
`testMatch: ["**/*.spec.ts"]` داشت. از ۸٫۳ سه specِ دیگر به همان پوشه آمدند که استکِ **production** می‌خواهند؛
گلابِ باز همه را زیرِ پیکربندیِ **dev** هم اجرا می‌کرد ⇒ ۳ سبز، ۳ شکست، exit 1. سندها همچنان «۳/۳» می‌گفتند
چون بعد از ۸٫۱ هیچ‌کس دوباره نزدش. رفع: `testMatch: ["**/panel.spec.ts"]`؛ دو اجرای پشتِ سرِ هم ۳/۳.

**۲. `[!]` `canvas-sync test:e2e:server` از M3 قرمز است — مالِ M6 نیست، و محصول سالم است.**
spec یک `randomUUID()` به‌عنوانِ بورد می‌دهد و هیچ‌جا ردیفِ `boards` نمی‌سازد؛ `0002_board_fks.sql`
(M3 گام ۵٫۱، ۲۰۲۶-۰۸-۲۲) روی `board_updates.board_id` FK گذاشت؛ آخرین تغییرِ spec ۲۰۲۶-۰۸-۱۳ است. لاگِ
Postgres حینِ همان اجرا: `violates foreign key constraint "board_updates_board_fk"`. همان کلاسِ `db:smoke`ِ
M5 — و سه تحویل از رویش رد شده‌اند چون در CI نیست. `rt:cluster` و شش سنجه‌ی دیگر (که بورد را seed
می‌کنند) سبزند. ⛔ فایلش مالِ **M2** است ⇒ بدونِ تاییدِ مالک دست نخورد. رفعِ پیشنهادی: seedِ بورد با
`scripts/rt-seed.ts` پیش از `startNode`، و پاک‌سازی بعدش.

### ⛔ چرا بازبینیِ خصمانه‌ی اسناد انجام **نشد**

یک workflowِ عمداً کوچک و تک‌مرحله‌ای (سه بازبینِ سند + یک منتقدِ کاملیت، بدونِ مرحله‌ی ردکننده) در **انتهای**
یک نشستِ سنگین اجرا شد. هر چهار عامل با «session limit» مردند: **۱٫۳۳M توکن، ۱۴۹ فراخوانِ ابزار، صفر
نتیجه** (`agents_done: 0`). این **بارِ چهارم** در M6 است، و درسِ قبلی («حداکثر سه یابنده») کافی نبود:
هر بازبین با خواندنِ سندِ فارسیِ بلند + کدی که وصفش می‌کند ~۳۳۰k توکن می‌خواهد، و سهمیه‌ی نشست را کارِ همان
روز خورده بود. ⚠️ **نتیجه‌ی خالی یک حکم نیست** — هیچ سندی «بازبینی‌شده» حساب نمی‌شود.

### ⏭ مانده — به همین ترتیب، وقتی مالک گفت «ادامه بده»

**۱. بازبینیِ خصمانه‌ی سه سند — دستی، یا با دقیقاً یک عامل، در ابتدای نشست:**

| سند | چه چیزی با چه چیزی |
|---|---|
| [`docs/admin.md`](docs/admin.md) | جدولِ ۲۱ مسیر و جدولِ ۱۶ عمل در برابرِ `routes/admin*.ts` و `audit.ts` · هر عدد در برابرِ `shared-types/api/admin.ts` و `config/sections.ts` · جدولِ نقاطِ ورودِ تعلیق در برابرِ `routes/auth.ts` |
| [`infra/RUNBOOK.md`](infra/RUNBOOK.md) §۱٫۵، ۲، ۳، ۴، ۴٫۱، ۵، ۶، ۷٫۱–۷٫۵، ۸ | هر سرویس در `docker-compose.prod.yml` · هر پرچم در parserِ اسکریپتش · هر کدِ خطا در `apps/api/src` · تناقض بینِ بخش‌ها |
| [`docs/m7-handoff.md`](docs/m7-handoff.md) | هر دستور در `package.json` · هر env در config/compose · **جدولِ تشخیصِ ۸٫۶** در برابرِ `image-tool.ts`، `asset-transport.ts`، `routes/assets.ts`، `asset-service.ts` |
| کاملیت | هر `⏳` و `[!]`ِ TODO-M6 و PROGRESS-M6 که به handoff نرفته · تناقضِ عدد بینِ CLAUDE.md، TODO، handoff، RUNBOOK |

**۲. اصلاحِ یافته‌ها** → `pnpm verify` → کامیتِ ۹٫۴.

**۳. بعد از بسته‌شدنِ ۹٫۴:** بنرِ «بازبینی‌نشده» از بالای `m7-handoff.md` برداشته شود · ردیفِ ۹٫۴ی TODO ✅ ·
سطرِ وضعیتِ CLAUDE.md به «فاز ۹ تمام، منتظرِ تاییدِ مالک».

**۴. گزارش به مالک، با دو درخواستِ تایید:** (الف) لمسِ فایلِ M2 برای `test:e2e:server` · (ب) تاییدِ فاز ۹.

⛔ **بعد از ۹٫۴ هیچ فازِ دیگری شروع نشود.** «M7» در PLAN نیست؛ دامنه و ترتیبش با مالک است.

### چیزهایی که فقط در حافظه‌ی این نشست بودند

- **استکِ productionِ محلی** (`hamboom-p9`) پایین آورده و باکت‌های `p9-*` حذف شدند؛ فایل‌های موقتِ seed هم.
  برای بالاآوردنِ دوباره: env از `.env.production.example` با `APP_ENV=staging`، `SMS_PROVIDER=mock`،
  `SMS_IR_TEMPLATE_ID=1`، `OTP_COOLDOWN_SECONDS=1`، `RATE_LIMIT_OTP_MAX=60`،
  `S3_ENDPOINT=http://host.docker.internal:<MINIO_PORT>` (در `hosts`ِ ویندوز هست ⇒ هم کانتینر هم مرورگر
  می‌بینندش) و ★ **باکت‌های جدا** (با `minio/mc` ساخته شوند) تا حذف‌کننده‌ها به داده‌ی dev نرسند. specها
  `E2E_COMPOSE_ENV_FILE` و `E2E_COMPOSE_PROJECT` می‌خواهند؛ کدِ ورود از لاگِ mock خوانده می‌شود.
- ⚠️ `pnpm db:up` از Bashِ این محیط «unknown shorthand flag: 'f'» می‌دهد — از PowerShell بزن. ولی
  `C="docker compose -f …"; $C ps` در Bash کار می‌کند (همان مخففِ RUNBOOK).
- ایمیج‌های `c6bfe6e` هنوز روی این ماشین‌اند — برای تکرارِ تمرینِ استقرار/rollback.
- ⚠️ **باکت‌های dev پس‌مانده دارند** (فقط گزارش گرفته شد، چیزی حذف نشد): ۶ PNGِ یتیمِ ریز در
  `hamboom-assets` از اجراهای فاز ۸ — آن‌موقع استکِ آزمون باکت‌های dev را شریک بود، که اشتباه بود و در فاز ۹
  جدا شد — و ۳۰ snapshotِ یتیم (۶٫۳MB) از سنجه‌ها. `pnpm infra:sweep-orphans` فهرستشان می‌کند.
- رونوشتِ workflowِ مرده (بی‌نتیجه): `…\subagents\workflows\wf_2fead86a-336`.

---

## ✅ فاز ۹ ردیفِ ۹٫۴ — بازبینیِ خصمانه‌ی اسناد: دستی، ۲۱ یافته، دوتایش گپِ محصول (۱۴۰۵/۰۷/۱۸)

مالک بعد از فشرده‌سازی گفت «ادامه بده». بازبینی **دستی** انجام شد — خط‌به‌خط در برابرِ کد، و با **اجرا** برای هر
ادعایی که اجراشدنی بود. بدونِ workflow و بدونِ عامل: چهار بار سقفِ نشست در همین ماژول، و نتیجه‌ی خالیِ بارِ آخر.

| سند | با چه چیزی سنجیده شد |
|---|---|
| [`docs/admin.md`](docs/admin.md) | `routes/admin.ts` و `admin-stats.ts` (۲۱ مسیر، ۱۲ جهشی — شمرده شد) · `audit.ts` (۱۶ عمل) · `admin-guard.ts` · هر `metadata` در برابرِ فراخوانِ `recordAudit`ش (`reconcile.ts`، `card-transfer.ts`، `boards.ts`، `admin-grant-staff.ts`) · هر عدد در `shared-types/api/admin.ts` و `config/sections.ts` · نقاطِ ورودِ تعلیق در `routes/auth.ts` · مسیرهای رابط در `router.tsx` |
| [`infra/RUNBOOK.md`](infra/RUNBOOK.md) | هر سرویس در `docker-compose.prod.yml` · هر پرچم در اسکریپتش · هر کدِ خطا در `apps/api/src` · هر برچسبِ نقل‌شده‌ی رابط در `apps/web/src` · حالتِ TLS در `10-hamboom-mode.sh` · ناحیه‌های نرخ در `zones.conf` |
| [`docs/m7-handoff.md`](docs/m7-handoff.md) | هر دستور در `package.json` · هر env در config/compose · جدولِ ۸٫۶ در برابرِ `image-tool.ts`، `asset-transport.ts`، `routes/assets.ts`، `asset-service.ts`، `errors.ts` · هر تاریخ و مدت در برابرِ `git log` و همین دفتر |
| کاملیت | هر `⏳` و `[!]`ِ TODO-M6 و این دفتر در برابرِ §۸ی handoff · عددها بینِ CLAUDE.md، TODO، handoff، RUNBOOK، `infra/README` |

### ★★ دو گپِ محصول — از یک جمله‌ی RUNBOOK شروع شد

RUNBOOK §۷٫۳الف می‌گفت: «اگر ردیفی واقعاً پولش نیامده، با ابطالِ پرداخت ببندش». خواندنِ کد می‌گفت نمی‌شود؛ پس
**اجرا شد** — روی `buildApp()`ِ واقعی با `PAYMENT_PROVIDER=card_transfer`، از راهِ sdk، همان مسیرهای HTTP:

| سناریو | آنچه دیده شد |
|---|---|
| **A)** ادعا داخلِ پنجره، ردیف ۱۰۰ ساعت کهنه | `expireBlocked`: «درگاه هنوز یک‌بار هم پاسخ نداده (ADR-056) — اول verify کن.» · `expire` ⇒ **۴۰۹ `INVALID_TRANSITION`** · `verify` ⇒ `unknown` («کاربر پرداخت را اعلام کرده و در انتظارِ تاییدِ اپراتور است») · بعد از verify **همان مانع** · ردیف: `pending` / `failure_code = null` |
| **B)** بی‌ادعا تا بعد از پنجره (verify ⇒ `notPaid`، `failure_code = 1001`)، **بعد** ادعا | `expireBlocked: null` (دکمه باز) · `expire` ⇒ **۲۰۰ با `outcome: unknown`** · ردیف `pending` می‌مانَد · یک ردیفِ `payment.verify` با `via: "expire"` |
| **C)** دو ردیفِ ادعاشده‌ی خیلی کهنه + یک ردیفِ رهاشده‌ی بی‌ادعا | `reconcile(batchSize=2)` دو بار: `scanned: 2، unknown: 2، expired: 0` و ردیفِ رهاشده دست‌نخورده · `reconcile(batchSize=10)` دو بار: همان ردیف `notPaid` و بعد **`canceled`** |

یعنی:

۱. ★★ **ردیفِ کارت‌به‌کارتِ ادعاشده‌ای که پولش هرگز نیامد، بستنی نیست.** نه خودکار (عمداً — ADR-070)، نه از پنل
   (ناخواسته). «صفی که فقط آدم خالی‌اش می‌کند» برای این حالت ابزار ندارد. و راهنمای رابط در حالتِ A بن‌بست است:
   می‌گوید «اول verify کن»، و verify هرگز `failure_code` نمی‌نویسد.
۲. ★★ **و همان ردیف‌ها دسته‌ی sweep را پر می‌کنند.** دسته «قدیمی‌ترین N ردیفِ pending» است؛ N ردیفِ این‌چنینی (تایمر:
   `BILLING_RECONCILE_BATCH` = ۵۰ · sweepِ دستی: ≤ ۱۰) آشتی‌دهی را از دیدنِ هر ردیفِ دیگری بازمی‌دارند — همان کلاسِ
   یافته‌ی ۶٫۵ (ردیف‌های حالتِ ناهم‌خوان)، این‌بار بدونِ راهِ خروج. هر کاربرِ واردشده می‌تواند چنین ردیفی بسازد.

**شدت:** پول از دست نمی‌رود (فعال‌سازی فقط از تاییدِ staff می‌آید) و بستنِ اشتراک‌های تمام‌شده هم بیرونِ دسته است و ادامه
دارد. آنچه می‌میرد ابطالِ ردیف‌های رهاشده و خواناییِ فهرستِ `pending` است.

⛔ **رفع ساخته نشد، و این یک تصمیم است:** «ردِ ادعا» یک جهشِ ادمینِ نو روی مسیرِ پول است ⇒ ADR (الحاقیه‌ی ADR-070)،
احتمالاً توقفِ D12، و بازبینیِ خصمانه‌ی جدا (درسِ دومِ M4). فاز ۹ تحویل است. ولی هر دو گپ با سنجه **قفل** شدند —
همان الگوی «WSِ باز» در `admin:access`: محدودیت assert می‌شود تا بی‌صدا عوض نشود، و با رفعش انتظار **برعکس** می‌شود.

پیشنهاد (در `m7-handoff` §۸): **(الف)** ردیف‌های ادعاشده از دسته‌ی sweep بیرون بمانند — یک شرط در یک کوئری ·
**(ب)** عملِ «ردِ ادعا» در پنل، پشتِ step-up، با دلیل، ممیزی‌شده.

### دو رفتارِ درست که هیچ سندی نمی‌گفت — و مسیرِ launch را عوض می‌کنند

۳. **هر ردیفِ پرداخت به درگاه *و حالتِ* ساختش قفل است.** اندازه‌گیری شد: یک پرداختِ `mock`، بعد همان از اپی که با
   `card_transfer` بوت شده — `verify`، `expire` و `refund` هر سه **۴۰۹ `CONFLICT`** («این پرداخت مالِ درگاهِ
   mock/sandbox است…»)، و `reconcile` آن را **نه می‌بیند نه می‌شمارد** (`scanned: 0`، `errors: []` — هشدارِ «حالتِ دیگر»
   فقط ردیف‌های همان درگاه را می‌شمارد). ⇒ ردیف‌های `mock`ِ VM باید **پیش از** تعویضِ درگاه بسته شوند.
۴. **حالتِ کارت‌به‌کارت از `APP_ENV` می‌آید** ([`payment.ts`](apps/api/src/plugins/payment.ts): `production` ⇒
   `production`، بقیه ⇒ `sandbox`). ترتیبِ قبلیِ handoff («اول `card_transfer` زیرِ `staging`، واریزِ آزمایشی، بعد
   `production`») ردیف‌هایی می‌ساخت که بعد از گامِ آخر نه **تایید** می‌شدند نه مسترد (همان قاعده‌ی حالت — چکِ ۴۱).
   مسیرِ پول بازنویسی شد. ⚠️ این یکی **از کد** است، نه از اجرا: بوتِ واقعیِ `production` با این درگاه هنوز روی هیچ
   ماشینی انجام نشده.

### جدولِ ۲۱ یافته

| # | کجا | چه | چه شد |
|---|---|---|---|
| ۱ | محصول | ردیفِ ادعاشده از پنل بسته نمی‌شود | اندازه‌گیری · `sdk:contract` ۵۳ · سندها · ⏳ مالک |
| ۲ | محصول | ردیف‌های ادعاشده دسته‌ی sweep را پر می‌کنند | اندازه‌گیری · `billing:transfer` ۹ · سندها · ⏳ مالک |
| ۳ | رفتار | ردیف به درگاه و حالتِ ساختش قفل است؛ sweep نمی‌شمارد | اندازه‌گیری · `sdk:contract` ۵۴ · handoff §۳، RUNBOOK §۵ |
| ۴ | رفتار | حالتِ کارت‌به‌کارت از `APP_ENV` می‌آید | مسیرِ پول بازنویسی شد |
| ۵ | RUNBOOK §۵ · handoff §۲ | «متنِ علتِ ۴۲۲ی commit در لاگِ api هست» | ❌ اندازه‌گیری: فقط `"statusCode":422`؛ متن در پاسخ است (کنسول/Network) |
| ۶ | RUNBOOK §۵ | «سه مظنون حذف شده» (پنج) · «`pending` ⇒ commit اصلاً صدا نشده» (یا commit با خطای غیرِ راستی‌آزمایی افتاده) | سه ردیفِ تصویر بازنویسی شد، با سه شکلِ `HB_IMAGE` |
| ۷ | RUNBOOK §۱٫۲ | «بدونِ CORS تصویر قابِ خالی می‌شود» | فقط برای `GET`؛ بدونِ `POST` اصلاً درج نمی‌شود |
| ۸ | RUNBOOK سرآغاز · §۱٫۲ | «بعد از certbot `APP_ENV=production`» · گاردها فقط زرین‌پال را می‌گفتند | حالت را **وجودِ گواهی** انتخاب می‌کند ([`10-hamboom-mode.sh`](infra/nginx/10-hamboom-mode.sh))؛ VM خودش staging + TLS است |
| ۹ | RUNBOOK §۷٫۳ · `infra/README` · کامنتِ `routes/admin.ts` | «چهار عملِ پرداخت» · «verify و ابطال برای هر نتیجه ۲۰۰» | پنج · «برای هر **پاسخِ درگاه**»؛ ۴۰۹ وقتی پرسشی رخ نداده |
| ۱۰ | RUNBOOK §۷٫۴ | «در انکرِ `x-api-env` مقدارشان را بده» · «چهار متغیر» (پنج نام) | از قبل سیم‌کشی شده‌اند؛ «نامعلوم» یعنی dev یا composeِ کهنه |
| ۱۱ | admin.md §۶٫۱ | «`otp/verify` و refresh کوکی را پاک می‌کنند» | فقط refresh |
| ۱۲ | admin.md §۵ · کامنتِ `audit.ts` | قاعده‌ی سه نویسنده‌ی `payment.verify` | دکمه: هر نتیجه · ابطال: هر نتیجه‌ی غیرِ `notPaid` (+`reason`) · sweep: فقط فعال‌سازی |
| ۱۳ | handoff · CLAUDE.md | ارجاعِ «§۳٫۶» (سه جا) | بخشِ ۶ است |
| ۱۴ | handoff | دو مدتِ اندازه‌نگرفته: «یک هفته»، «یک سال» | دو هفته (۰۷/۰۳ تا ۰۷/۱۷) · فایل از ۲۰۲۶-۰۹-۱۰ است (M5 ۹٫۲) |
| ۱۵ | handoff | «`ESLint: No issues found` با exit 0 یک بار دیگر هم **دیده شد**» | در رونوشتِ نشست فقط «به آن تکیه نشد» هست؛ دوباره‌اش اثبات نشد — بازنویسی شد |
| ۱۶ | handoff | بلوکِ `bash` با دو دستور در یک خط (`·`) و بلوکِ پیکربندی با برچسبِ `bash` | جدا شد · `text` |
| ۱۷ | RUNBOOK §۶ | مسیرِ cron `/srv/hamboom` | VM روی `/opt/hamboom` است (ثبتِ ۰۷/۰۳) |
| ۱۸ | CLAUDE.md | `infra:restore-drill -- --prune=N` | آن پرچم مالِ `backup`/`backup-all` است |
| ۱۹ | CLAUDE.md | «متنِ ۳۰ روز در نمای سطل» هنوز باز شمرده می‌شد | در فاز ۳ نشسته بود |
| ۲۰ | TODO · `apps/web/CLAUDE.md` | «چهار نامزد» · api روی ۳۴۱۰ · «دو بار سقفِ نشست» · پورت‌های M3 در بلوکِ اجرا | پنج · ۱۵۴۰۲ · چهار بار · هشدار و ارجاع به ریشه |
| ۲۱ | `shared-types/api/admin.ts` | دو کامنتِ کهنه: docblockِ `reconcileRequest` («سقفِ ۲۵، پیش‌فرض ۱۰») و «پاسخِ `GET /admin/search`» | ⏳ **دست نخورد** — قاعده‌ی ۲ (D12)، حتی برای کامنت |

### سه چکِ نو، هر سه با شکستنِ عمدی

| چک | شکستنِ عمدی | نتیجه |
|---|---|---|
| `billing:transfer` ۹ — گرسنگیِ دسته (+ کنترلِ مثبت: با دسته‌ی جادار همان ردیف باطل می‌شود) | `AND transfer_claimed_at IS NULL` در کوئریِ sweep | ✖ «محدودیت دیگر برقرار نیست» — و هشت چکِ دیگر **سبز ماندند** (یعنی پیشنهادِ الف چیزِ دیگری را نمی‌شکند) |
| `sdk:contract` ۵۳ — ردیفِ ادعاشده از پنل بسته نمی‌شود (هر دو لایه: دکمه‌ی بسته و دکمه‌ی باز) | برداشتنِ قاعده‌ی `failure_code` از `expireBlockedReason` | ✖ «دکمه‌ی ابطال روی ردیفِ ادعاشده‌ی بی‌پاسخ باز است» |
| `sdk:contract` ۵۴ — ردیفِ درگاهِ دیگر ⇒ ۴۰۹ | بی‌اثرکردنِ `assertGatewayMatches` | ✖ «SdkError نبود: بدونِ خطا» (و چکِ ۴۱ هم، درست) |
| `sdk:contract` ۵۵ — استردادِ درگاهیِ کارت‌به‌کارت ⇒ ۴۰۹ `REFUND_UNAVAILABLE` | — | ادعای RUNBOOK §۵ که تا امروز فقط برای زرین‌پال سنجیده شده بود |

هر سه فایلِ شکسته‌شده با ویرایشِ معکوس برگشتند؛ `git status` آن‌ها را تغییرکرده نشان نمی‌دهد.

### ⚠️ دو چیز درباره‌ی خودِ همین ردیف

**۱. نگارشِ اولِ چکِ ۵۳ یک سبزِ دروغین می‌شد.** روی ردیفِ **تازه**، پله‌ی «جوان‌تر از ۷۲ ساعت» به‌تنهایی ۴۰۹ می‌دهد؛
پس برداشتنِ قاعده‌ی `failure_code` — همان چیزی که چک ادعا می‌کرد می‌سنجد — سبز می‌مانْد. هنگامِ طراحیِ شکستنِ عمدی
دیده شد، پیش از آنکه «سبز» ثبت شود. حالا ردیف ۱۰۰ ساعت کهنه می‌شود و همان شکستن قرمزش کرد.

**۲. یک قرمز که توضیح داده شد، نه توجیه.** اجرای `sdk:contract` بلافاصله بعد از شکستنِ عمدی، چکِ **۲۴** (keysetِ ممیزی)
را قرمز کرد. علت: با `assertGatewayMatches`ِ بی‌اثر، چکِ ۵۴ واقعاً verify/ابطال زد و ردیف‌های ممیزی‌ای نوشت که
پاک‌سازیِ بلوک نمی‌شناخت؛ اجرای بعدی آن‌ها را در شمارشِ همان عامل دید. سازوکار در کد دنبال شد، دو اجرای پشتِ سرِ هم
**۵۵/۵۵** دادند، صفر ردیفِ جامانده در دیتابیس، و پاک‌سازی حالا آن ردیف‌ها را هم می‌گیرد — یک چکِ قرمز نباید اجرای
بعدی را آلوده کند.

### آنچه این بازبینی ادعا **نمی‌کند**

- ⚠️ **بازبین همان نویسنده است.** چهار تلاشِ چندعاملی در M6 به سقفِ نشست خوردند؛ این یکی دستی بود. بازبینِ مستقل
  چیزهایی می‌بیند که نویسنده نمی‌بیند — و دو گپِ بالا را هم نویسنده در ۹٫۱ تا ۹٫۳ ندیده بود.
- بخش‌های M5ِ RUNBOOK (§۱٫۱ تا ۱٫۴، §۷ی بهداشتِ راز) فقط **خوانده** شدند، نه دوباره اجرا.
- سه شکلِ پیامِ `HB_IMAGE` از خواندنِ `asset-transport.ts` آمده‌اند، نه از اجرا روی آروان.
- گیتِ ۳۴ سنجه‌ای **دوباره کامل اجرا نشد** — عددهایش مالِ ۰۷/۱۷ است. آنچه امروز اجرا شد: `verify` و سنجه‌هایی که
  تغییر کردند یا به فایل‌های شکسته‌شده تکیه دارند.

### گیت (۱۴۰۵/۰۷/۱۸)

`node scripts/verify.mjs` ⇒ exit **۰** · صفر OOM · `Tasks:` ۴ · ۱۶ گیت ·
`billing:transfer` **۹/۹** · `billing:refund` سبز · `sdk:contract` **۵۵ pass, 0 fail** (سه اجرای آخر).

### ⏸ فاز ۹ تمام است — منتظرِ مالک

| از مالک | چرا |
|---|---|
| **تاییدِ فاز ۹** | هر چهار ردیف بسته است |
| تاییدِ لمسِ فایلِ **M2** برای `canvas-sync test:e2e:server` | از M3 قرمز است (FKِ `0002`)؛ رفع: seedِ بورد با `scripts/rt-seed.ts` |
| تاییدِ **D12** برای دو کامنتِ `shared-types` | فقط کامنت، صفر تغییرِ قرارداد |
| ★ تصمیم درباره‌ی **ردیفِ ادعاشده** | پیش از اولین مشتری؛ پیشنهاد در `m7-handoff` §۸ |
| ۸٫۶: «هیچ + نوتیس» یا «قابِ خالی»؟ + `select status, count(*) from files group by 1` | بدونِ استقرار جواب دارد |

⛔ **هیچ فازِ دیگری شروع نشود.** «M7» در PLAN نیست.

⊕ سرویس‌های dev (postgres/redis/minio) برای این بازبینی بالا آورده شدند و بالا مانده‌اند. هیچ ردیفِ آزمونی در
دیتابیس نمانده (`payments`: فقط همان ردیف‌های `mock`ِ تاریخیِ قبلی).

---

## ✅ فاز ۹ — تاییدِ مالک (۱۴۰۵/۰۷/۱۹) — M6 تمام است

مالک فاز ۹ را تایید کرد («تایید شد»). **هر ده فازِ M6 (۰ تا ۹) حالا تاییدشده‌اند.**

همراهِ تایید:

- ✅ **«تاییدِ اصلاحِ دو کامنتِ کهنه»** — توقفِ D12ِ یافته‌ی ۲۱ی بازبینیِ ۹٫۴ برداشته شد. هر دو در
  [`shared-types/src/api/admin.ts`](packages/shared-types/src/api/admin.ts) اصلاح شدند: docblockِ `reconcileRequest`
  («سقفِ ۲۵، پیش‌فرض ۱۰» ⇒ ۱۰ و ۵، همان چیزی که خودِ schema از بازبینیِ ۶٫۵ می‌گوید) و `adminSearchResult`
  («`GET /admin/search`» ⇒ `POST`، از ۵٫۵). فقط کامنت؛ `git diff` سه خط است و هیچ‌کدام کد نیست.
- ★ **مشاهده‌ی ۸٫۶:** «فقط قابِ خالی می‌آمد، و تصویری که آپلود می‌کردی هیچ اتفاقی نمی‌افتاد». طبقِ جدولِ تشخیص: آپلود و
  commit سالم‌اند (وگرنه اصلاً قابی درج نمی‌شد)، و **خواندن** شکسته است. ادامه در بخشِ بعد.
- «برو قدمِ بعد.»

⏳ **دو چیز که در همان پیام جوابی نگرفتند** و باز می‌مانند (هیچ‌کدام چیزی را بلاک نمی‌کنند): تصمیم درباره‌ی ردیفِ
کارت‌به‌کارتِ ادعاشده (`m7-handoff` §۸) · تاییدِ لمسِ فایلِ M2 برای `canvas-sync test:e2e:server`.

---

## ★★★ ردیفِ ۸٫۶ — ریشه‌ی باگِ تصویر پیدا و رفع شد (۱۴۰۵/۰۷/۱۹)

### سرنخ از مالک آمد، نه از اندازه‌گیریِ من

«فقط قابِ خالی می‌آمد.» طبقِ [`image-tool.ts`](packages/canvas-core/src/tools/image-tool.ts) قاب فقط **بعد از**
`requestAssetUpload` درج می‌شود ⇒ presign، آپلودِ مستقیم و commit هر سه سالم بوده‌اند، و قابِ خالی یعنی
`resolve()` رشته‌ی خالی برگردانده: **خواندن** شکسته. پنج مظنونِ قبلی همه درباره‌ی هر دو نیمه بودند؛ این جمله نیمی
از فضا را برید — و دو هفته بود که پرسیده نشده بود.

### ریشه

[`packages/sdk/src/client.ts`](packages/sdk/src/client.ts): `raw()` **هر** درخواست را با `credentials: "include"`
می‌فرستاد (برای کوکیِ refresh)، و `assets.resolveBlob` همان را با `redirect: "follow"` به `/assets/:id` می‌زد. آن مسیر
۳۰۲ می‌دهد و مرورگر تا خودِ انبار دنبالش می‌کند — با همان حالتِ credentials. در آن حالت، چکِ CORSِ مرورگر
`Access-Control-Allow-Credentials: true` می‌خواهد.

هدرهای دو انبار، با درخواستِ **بی‌امضا** از همین ماشین و `Origin`ِ مجاز:

| | MinIO (محلی) | آروان (باکتِ زنده) |
|---|---|---|
| `GET` | ۴۰۳ · `Access-Control-Allow-Origin: <مبدأ>` · **`Access-Control-Allow-Credentials: true`** · `Access-Control-Expose-Headers: …` | ۴۰۳ · `access-control-allow-origin: https://hamboom.ir` · `access-control-allow-methods: GET` · `access-control-max-age: 0` — **بدونِ `…-allow-credentials`** |
| preflightِ `GET` | ۲۰۴ با همان‌ها | ۲۰۰ با همان سه هدر |
| preflightِ `GET` + `Access-Control-Request-Headers: authorization` | ۲۰۴ · `Access-Control-Allow-Headers: authorization` | **۴۰۳، بدونِ هیچ هدرِ CORS** |
| `GET` با مبدأِ بیگانه | — | ۴۰۳، بدونِ هدرِ CORS |

⇒ روی MinIO چکِ CORS رد می‌شود؛ روی آروان نه ⇒ `TypeError: Failed to fetch` ⇒ `resolve()` رشته‌ی خالی ⇒ قابِ خالی.
آپلود سالم می‌مانْد چون `POST`ِ مستقیم به انبار یک `fetch`ِ ساده با حالتِ پیش‌فرضِ credentials است.

### سه اثبات، از ارزان به گران

**۱. مرورگرِ واقعی با همان هدرها** (Chromium ۱۵۱، دو سرورِ محلی: «api» که ۳۰۲ می‌دهد و «انبار» با هدرهای اندازه‌گیری‌شده):

| انبار | `credentials` | نتیجه |
|---|---|---|
| آروان‌مانند | `include` | ✖ `TypeError: Failed to fetch` |
| آروان‌مانند | `same-origin` | ✔ ۲۰۰ |
| MinIO‌مانند | `include` | ✔ ۲۰۰ |
| MinIO‌مانند | `same-origin` | ✔ ۲۰۰ |

در هر هشت حالت (با و بی `Authorization`) انبار `Origin`ِ واقعی دید و `Authorization` **ندید** — مرورگر روی ری‌دایرکتِ
بین‌مبدأ حذفش می‌کند، پس preflightی هم در کار نبود.

**۲. خودِ اپ، روی باندلِ production.** استکِ productionِ محلی (`hamboom-p86`، باکت‌های جدا) با `S3_ENDPOINT` روی
[`storage-cors-proxy.ts`](apps/web/e2e/storage-cors-proxy.ts) — یک پروکسیِ واقعی جلوی MinIO که هدرهایی را که آروان
نمی‌دهد برمی‌دارد و `host` را دست‌نخورده رد می‌کند (SigV4):

| باندل | انبار | `test:e2e:assets` |
|---|---|---|
| پیش از رفع، **specِ دست‌نخورده** | سخت‌گیر | ✖ ۲۰۰ / ۲۰۴ / ۲۰۰ / ۳۰۲ و بعد «‏[hamboom] بایتِ تصویر … خوانده نشد — TypeError: Failed to fetch» |
| بعد از رفع | سخت‌گیر | ✔ ۲۰۰ / ۲۰۴ / ۲۰۰ / ۳۰۲ / **۲۰۰** |
| بعد از رفع | پروکسی در حالتِ **عبوری** (هدرهای MinIO) | ✖ «انبارِ این استک سخت‌گیر نیست» — کنترلِ خودِ ابزار |
| رفع **برداشته**، specِ نهایی | سخت‌گیر | ✖ در کمتر از یک ثانیه، با پیامِ خودِ مرورگر (پایین) |
| رفع برگشته | سخت‌گیر | ✔ دو اجرای پشتِ سرِ هم · و `test:e2e:p2` روی همان باندل ✔ |

پیامِ خودِ مرورگر — همان چیزی که امروز در کنسولِ سایتِ زنده هم هست، مستقل از باندلِ ما:

> Access to fetch at '…' (redirected from '…/assets/<id>') from origin '…' has been blocked by CORS policy: The value of
> the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials
> mode is 'include'.

**۳. تستِ واحدِ sdk** — دو تستِ نو قرارداد را قفل می‌کنند (`resolveBlob` ⇒ `same-origin`، بقیه ⇒ `include`، و retryِ
بعد از ۴۰۱ هم همان). با برداشتنِ همان یک خط هر دو **قرمز** شدند.

### رفع

یک خط در `resolveBlob` (`credentials: "same-origin"`) + فیلدِ `Opts.credentials`. هاپِ اول هم‌مبدأ است و با Bearer
احراز می‌شود؛ به کوکی نیازی ندارد.

⚠️ **این یک لمسِ مسیرِ M3 است** (`packages/sdk` در فهرستِ تاییدشده‌ی M6 هست، ولی برای `sdk.admin.*`). بدونِ توقف
انجام شد چون: دامنه‌ی ۸٫۶ از ابتدا «M1/M3» ثبت شده بود، مالک مشاهده‌ی لازم را داد و گفت «برو قدمِ بعد»، و رفع یک
خط است با بازتولیدِ قرمز→سبز. **در کامیتِ جدا** نشست تا اگر مالک نخواستش، برگرداندنش یک `git revert` باشد.

### چهار چیزِ غلط در کارِ قبلیِ خودم که همین‌جا درآمد

| کجا | چه نوشته بودم | واقعیت |
|---|---|---|
| ۸٫۶، مظنونِ دوم | «CORSِ باکتِ آروان مقصر نیست: `GET`ِ واقعی `access-control-allow-origin` دارد» | اندازه‌گیری درست، نتیجه‌گیری **نیمه‌کاره**: فقط همان یک هدر نگاه شد. ریشه هدری بود که نبود |
| ۸٫۶، مظنونِ چهارم | «کلِ زنجیره روی باندلِ production سبز است» | روی **MinIO** — که با خودِ باگ هم سبز می‌مانَد. «باگ فقط در build نیست» درست بود؛ «مسیر سالم است» نه |
| کامنتِ `asset-upload.spec.ts` | شکستنِ عمدی روی نشانیِ انبار کار نکرد «چون پاسخِ انبار کش‌پذیر است» | حدسِ اندازه‌نگرفته. playwright درخواستِ **ری‌دایرکت‌شده** را اصلاً به `route` نمی‌دهد: از سه درخواستِ انبار (POST، GET، GET) فقط POST رسید |
| کامنتِ `asset-transport.ts` | «نه لاگِ api چیزی داشت نه کنسولِ مرورگر» | کدِ **ما** ساکت بود؛ خودِ مرورگر پیامِ CORS را می‌نویسد. هیچ‌وقت اندازه‌گیری نشده بود |

هر چهار اصلاح شدند. درسِ روشی در [`m7-handoff`](docs/m7-handoff.md) (درسِ ۹): پنج اندازه‌گیریِ قبلی هر کدام یک سوالِ
بله/خیر از **آروان** بودند؛ یک `curl -D -` به **هر دو** انبار، کنارِ هم، همان روزِ اول ریشه را نشان می‌داد.

### گیتِ نو — و چرا لازم بود

`test:e2e:assets` از این به بعد روی انبارِ **سخت‌گیر** اجرا می‌شود و سه ادعای تازه دارد: بایت‌ها واقعاً از هاپِ دوم
رسیدند (۲۰۰) · مرورگر پیامِ CORS ننوشت · و ★ **انبارِ استک سخت‌گیر بود** (هیچ پاسخِ انباری
`Access-Control-Allow-Credentials` نداشت). سومی خودِ ابزار را می‌سنجد: مستقیم روی MinIO این سنجه حالا **قرمز** است،
نه سبزِ پوچ. ⊕ پروکسی به preflightِ دارای `authorization` هم همان ۴۰۳ی آروان را می‌دهد، تا اگر روزی کسی هدری به
هاپِ انبار اضافه کرد، همین‌جا بشکند.

### یافته‌ی جانبی

RUNBOOK §۱٫۲ می‌گوید CORSِ باکت «همه‌ی هدرها» را مجاز کند. روی باکتِ زنده preflightِ دارای `authorization` **۴۰۳**
می‌گیرد — یا تنظیم نشده، یا آروان اعمالش نمی‌کند. امروز به آن نیازی نیست و در همان سطر ثبت شد.

### آنچه این ردیف ادعا **نمی‌کند**

- ◑ **۸٫۶ تیک نخورده.** معیارش مشاهده روی **سایتِ زنده** است. آنچه رفع را دید یک MinIO با هدرهای آروان بود.
- presigned-GETِ SDK پارامترهای `x-amz-checksum-mode` و `x-id` دارد؛ روی آروان از **سمتِ سرور** کار می‌کنند (مشقِ
  بازیابیِ روزِ صفر)، ولی از **مرورگر** هنوز دیده نشده‌اند. اگر بعد از استقرار باز قابِ خالی ماند، این بار کنسول
  می‌گوید چرا.
- هدرهای آروان روی پاسخِ **۴۰۳ی بی‌امضا** و preflight اندازه‌گیری شدند، نه روی یک ۲۰۰ی امضاشده (کلید فقط روی VM است).

### قدمِ بعد — دستِ مالک

۱. ★ **تاییدِ بی‌استقرار (اختیاری، یک دقیقه):** روی سایتِ زنده، بوردی با قابِ خالی، F12 → Console → رفرش. همان پیامِ
   بالا باید باشد.
۲. `git push` (کامیت‌های محلیِ فاز ۹ و این رفع — `git log origin/main..` فهرستشان می‌کند) → CI سبز.
۳. استقرارِ نسخه‌ی دوم — RUNBOOK §۲، با `git pull` روی VM؛ پشتیبانِ پیش از استقرار.
۴. RUNBOOK §۱٫۵ ردیفِ ۹: درجِ تصویر + رفرش. اگر آمد، ۸٫۶ بسته می‌شود.

### محیط

`node scripts/verify.mjs` ⇒ exit ۰ · صفر OOM · `Tasks:` ۴. استکِ `hamboom-p86` پایین آورده و باکت‌های `p86-*` حذف
شدند؛ سرویس‌های dev بالا مانده‌اند. برای تکرار: env مثلِ فاز ۹ ولی `S3_ENDPOINT=http://host.docker.internal:15977`،
و `STORAGE_PROXY_UPSTREAM=http://127.0.0.1:<MINIO_PORT>` هنگامِ اجرای سنجه.

---

## ★★★ CI از اولین پوشِ M6 قرمز بود — و کسی نگاه نکرد (۱۴۰۵/۰۷/۲۰)

> ⚠️ این بخش **کارِ فاز نیست**. مالک گفت «پوش شد، برویم قدمِ بعد» و قدمِ بعد استقرارِ نسخه‌ی دوم بود.
> [RUNBOOK §۲](infra/RUNBOOK.md) استقرار را به «CI سبز روی همان کامیت» بسته — پس اول همان را نگاه کردم.

### چه دیده شد

`origin/main` = `d2ff064` (پوش درست نشسته). ولی هر دو workflow روی آن **قرمز** بودند، و نه فقط روی آن:

| پوش | کامیت | `ci` | `images` |
|---|---|---|---|
| ۱۴۰۵/۰۶/۱۹ | `c09a696` — پایانِ M5 | ✔ | ✔ |
| ۱۴۰۵/۰۷/۰۲ | `4db8ceb` — فاز ۰–۶ | ✖ | ✖ |
| ۱۴۰۵/۰۷/۰۲ | `c6bfe6e` — فاز ۷ · **همان که ۰۷/۰۳ مستقر شد** | ✖ | ✖ |
| ۱۴۰۵/۰۷/۱۷ | `25b81cd` — فاز ۸ | ✖ | ✖ |
| ۱۴۰۵/۰۷/۲۰ | `d2ff064` — فاز ۹ و رفعِ ۸٫۶ | ✖ | ✖ |

در هر چهار پوش **همان دو مرحله** افتاده بود، و jobِ `pnpm verify` هر چهار بار **سبز** بود:

- `ci` ← «سنجه‌های زیرساختِ زنده» ← مرحله‌ی ۷، `pnpm db:up`. هر ۱۸ مرحله‌ی بعدش `skipped`.
- `images` ← مرحله‌ی ۹، «admin-grant-staff از داخلِ ایمیج». سه مرحله‌ی بعدش `skipped`.

⇒ **هیچ سنجه‌ی زنده‌ای در کلِ M6 حتی یک بار در CI اجرا نشد**، و اولین استقرارِ واقعی از کامیتی رفت که CIاش قرمز بود.

### سه ریشه‌ی مستقل، روی هم سوار

**(الف) بیرونی — ایمیج‌های MinIO از رجیستری‌ها رفته‌اند.** لاگِ خودِ runner:
`pull access denied for minio/minio, repository does not exist`. از همین ماشین هم: API ِDocker Hub برای `minio/minio` و
`minio/mc` **۴۰۴**؛ Quay و آینه‌ی gcr هم ندارند (حتی با digestِ کش‌شده). ماشینِ توسعه فقط با ایمیجِ **کش‌شده‌ی
سپتامبرِ ۲۰۲۵** کار می‌کند. جدولِ کامل و پیشنهادِ رفع: [ADR-071](ARCHITECTURE_DECISIONS.md#adr-071) — ⛔ منتظرِ تاییدِ مالک.

**(ب) باگِ شلِ خودم در `images.yml`.** مرحله می‌خواست ثابت کند اسکریپت بدونِ `--phone` با کدِ ۱ می‌ایستد:

```bash
set -uo pipefail
out=$(docker run … admin-grant-staff.ts 2>&1); code=$?
```

گیت‌هاب `run` را با `bash -e` اجرا می‌کند. کدِ خروجِ **درستِ** ۱ همان خطِ اول شل را می‌کشت — پیش از `code=$?` و پیش
از هر `echo`. لاگ فقط «exit code 1» داشت، بی هیچ پیامی. یعنی مرحله دقیقاً وقتی می‌افتاد که اسکریپت **درست** کار می‌کرد.

| اجرا | نتیجه |
|---|---|
| متنِ قبلی با `bash -e` (مثلِ گیت‌هاب) | exit ۱، **صفر خط خروجی** — همان چیزی که در CI بود |
| متنِ قبلی با `bash`ِ ساده (طوری که محلی آزموده بودمش) | ✔ |
| متنِ نو (`… ) \|\| code=$?`) با `bash -e` | ✔ |
| متنِ نو، ماژولی که وجود ندارد | ✖ «بالا نیامد، ولی به دلیلِ دیگری» |
| متنِ نو، فرمانی که موفق می‌شود | ✖ «exit=0 (انتظار ۱)» |
| متنِ نو، کدِ ۱ با پیامِ دیگر (`ConfigError`) | ✖ «بالا نیامد، ولی به دلیلِ دیگری» |

دو مرحله‌ی بعدیِ همان job از ۰۶/۱۹ اجرا نشده بودند؛ هر دو را همین‌جا با `bash -e` زدم: خودآزمونِ انتقالِ ایمیج ✔ ·
لبه‌ی TLS هر سه حالت ✔ (با دو تطبیقِ محیطیِ Git Bash برای مسیرِ mount، نه تغییرِ منطق).

**(ج) مرحله‌ی «بازیابیِ Object Storage» در CI نمی‌توانست سبز شود — و پشتِ (الف) پنهان بود.** پیدا شد چون به‌جای
منتظرماندن برای دورِ بعدیِ پوش، همان job را محلی شبیه‌سازی کردم (پایین). روی استکِ تمیز باکتِ `assets` **خالی** است:
`storage:smoke` و `assets:smoke` باکتِ خودشان را دارند و هیچ سنجه‌ی دیگری در آن چیزی نمی‌گذارد. پس چکِ `vacuous`
درست قرمز می‌شود («مانیفست برای hamboom-assets هیچ ورودی‌ای ندارد»). برای snapshots همین را بازبینِ نقشه‌ی M6 گرفته بود
و ترتیبِ `ci.yml` به خاطرش عوض شد؛ برای assets جا ماند. روی ماشینِ توسعه همیشه سبز بود چون باکتِ dev پر است — همان
درسِ `db:smoke`ِ M5، و همان چیزی که یافته‌ی پنجمِ اولین استقرار («مشق روی استقرارِ تازه قرمز است») گفته بود.

### شبیه‌سازیِ همان job، بدونِ پوش

`git worktree`ِ تمیز روی `d2ff064` · `.env` = `.env.example` با **فقط** پنج جایگزینیِ پورت (۵۴۳۲ روی این ماشین
PostgreSQLِ بومی است) · استکِ جدا با volumeِ خودش (`hamboom-ci`؛ به داده‌ی dev دست نخورد) · مرحله‌ها حرف‌به‌حرف از
`ci.yml`. تنها تطبیق: `PG_TOOLS_CONTAINER` (این ماشین `pg_dump` روی PATH ندارد).

| دور | MinIO | `ci.yml` | نتیجه |
|---|---|---|---|
| ۱ | ایمیجِ رسمیِ کش‌شده | همان که پوش شد | **۱۷ از ۱۸ سبز** · ✖ بازیابیِ Object Storage (ریشه‌ی ج) · `billing:transfer` جدا اجرا شد: ✔ |
| ۲ | **ساخته‌شده از سورس** (پروتوتایپِ ADR-071) | اصلاح‌شده | **۱۹ از ۱۹ سبز** |
| A/B روی همان استک | از سورس | — | شیءِ seed حذف ⇒ ✖ `vacuous` · seed ⇒ ✔ |

⊕ دو چیزِ دیگر که همین شبیه‌سازی نشان داد: `.env`ِ این ماشین ۹ کلید دارد که `.env.example` ندارد (از جمله
`WEB_BASE_URL` و `OTP_DEV_FIXED_CODE`) و ۲۲ کلید را ندارد — **هیچ‌کدام** سنجه‌ای را در محیطِ CI نشکست (هر دو پیش‌فرض
دارند یا سنجه خودش تزریق می‌کند) · و `CARD_TRANSFER_*=`ِ خالی در `.env.example` رشته‌ی تهی می‌دهد، نه «تعریف‌نشده»؛
schema می‌پذیردش.

### آنچه رفع شد (سه کامیتِ محلی، پوش نشده)

| | چه | اثبات |
|---|---|---|
| ب | `images.yml`: `\|\| code=$?` به‌جای `; code=$?` | جدولِ بالا — بازتولید، رفع، سه شکستنِ عمدی |
| ج | [`ci:seed-asset`](scripts/ci-seed-asset.ts) پیش از پشتیبان: یک PNG در باکتِ assets. **فیکسچر است نه سنجه**، و بیرون از `CI=true` بالا نمی‌آید | A/B روی همان استک · بدونِ `CI=true` ⇒ exit ۱ |
| — | `billing:transfer` به `ci.yml` اضافه شد | از روزِ ساختش جا افتاده بود (برخلافِ `billing:refund` که کامنتِ همان مرحله دلیلِ بودنش را می‌گوید). در محیطِ CI: ✔ |

### آنچه رفع **نشد**

- ⛔ **(الف)** — تا [ADR-071](ARCHITECTURE_DECISIONS.md#adr-071) تایید نشود، jobِ سنجه‌ها در CI همچنان روی `db:up` می‌افتد.
  پروتوتایپش ساخته و سنجیده شد (۱۶۲ ثانیه build، `--version` حرف‌به‌حرف مثلِ ایمیجِ رسمی، ۱۹/۱۹)، ولی در ریپو نیست:
  `docker-compose.yml`ِ توسعه فایلِ M2/M3/M5 است و منبعِ سرورِ انبارِ dev یک تصمیم است، نه یک وصله.
- ⏳ **runner:** GitHub خودش در همان اجراها نوشته `ubuntu-latest` از ۲۰۲۶/۱۰/۱۹ به Ubuntu 26 می‌رود. مشقِ بازیابی در CI
  ابزارِ `pg_dump`ِ **خودِ runner** را برمی‌دارد و ناسازگاریِ نسخه با سرور را خطا می‌گیرد. نسخه‌ی کلاینتِ ایمیجِ نو را
  **اندازه نگرفته‌ام**؛ این یک ریسکِ تاریخ‌دار است، نه یافته. پیشنهاد: `runs-on: ubuntu-24.04`.

### دو گپ که سرِ راه دیده شد (پیشنهاد، نه کار)

- **`restore-storage` برای assets چکِ `catalog` ندارد.** برای snapshots می‌پرسد «هر کلیدی که دیتابیس می‌شناسد بایت
  دارد؟»؛ برای assets فقط مانیفست را با مقصد می‌سنجد. پس آینه‌ای که چند asset را جا انداخته باشد، مشق را سبز می‌گذارد —
  و فیکسچرِ همین امروز هم دقیقاً به همین دلیل کافی است. چکِ درستش: هر ردیفِ `files` با `status='ready'` بایت دارد.
- **هیچ سنجه‌ی زنده‌ای مسیرهای asset‌ِ api را روی انبارِ واقعی نمی‌سنجد** (presign → POST → commit → `GET` ۳۰۲).
  `assets:smoke` سرویس را می‌سنجد و `test:e2e:assets` مرورگر را (دستی). `sdk:contract` به `sdk.assets.*` دست نمی‌زند.

### آنچه نوشته بودم و درست نبود

| کجا | چه نوشته بودم | واقعیت |
|---|---|---|
| CLAUDE.md و همین دفتر، فازهای ۲ تا ۶ | «… در CI» برای `admin:access`، `billing:refund`، `backup-all`، `restore-storage`، خودآزمونِ `grant-staff` و `purge-audit` | در `ci.yml` **نوشته** شدند. هیچ‌کدام آن‌جا اجرا نشد |
| RUNBOOK، صدر و §۶ | «با چیزی که … در CI اثبات شده» · «همان‌هایی‌اند که CI هر push اجرا می‌کند» | برای هر چیزِ M6: نه |
| RUNBOOK §۲ | «فقط بعد از CI سبز روی همان کامیت» | قاعده بود؛ کسی اجرایش نکرد. دستوری هم برای دیدنش کنارش نبود |
| CLAUDE.md، M5 فاز ۳ | «خواندنِ لاگِ Actions از API دسترسیِ admin می‌خواهد (۴۰۳)» | امروز `gh run view --log-failed` با توکنِ همین ماشین کار کرد و ریشه‌ی (الف) در یک خطش بود |
| اندازه‌گیریِ همین امروز | «ایمیجِ Chainguard و coollabs شل ندارند» | Git Bash مسیرِ `/bin/sh` را به `C:/Program Files/Git/usr/bin/sh` برگردانده بود. با `MSYS_NO_PATHCONV=1`: هر دو شل و `mc` دارند. پیش از نوشتنِ ADR گرفته شد |

### درس‌ها

1. ★★ **«به `ci.yml` اضافه شد» با «در CI اجرا شد» دو ادعاست.** دومی را فقط بعد از دیدنِ خودِ اجرا می‌شود نوشت.
   بعد از هر پوش: `gh run list --limit 6`. (دستورش حالا در RUNBOOK §۲ است.)
2. ★★ **قرمزی که کسی نگاهش نمی‌کند، قرمزهای بعدی را هم می‌پوشانَد.** سه خرابیِ مستقل روی هم بودند و فقط اولی دیده
   می‌شد. رفعِ اولی، سومی را تازه در دورِ بعدیِ پوش نشان می‌داد؛ شبیه‌سازیِ محلی در دو دقیقه و نیم نشانش داد.
3. **تکه‌ی شلِ CI را با `bash -e` بیازما** — همان‌طور که runner اجرایش می‌کند.
4. **`:latest` روی وابستگیِ توسعه دو چیز را پنهان کرد:** سیزده ماه بود که نسخه عوض نشده بود، و بعد که کلِ مخزن رفت
   هم ماشینِ توسعه چیزی نفهمید، چون کش داشت.

### محیط

checkoutِ موقت (`G:\hamboom-ci-emul`) و استکِ `hamboom-ci` با volumeهایش پاک شدند؛ سه ایمیجی که برای مقایسه کشیده بودم
هم. سرویس‌های dev دست‌نخورده بالا هستند. ایمیجِ پروتوتایپ (`hamboom/minio-dev:proto`) مانده تا اگر ADR تایید شد
دوباره ساخته نشود. ⚠️ تا آن‌وقت `docker image prune -a` نزن: `minio/minio:latest`ِ کش‌شده دیگر از جایی کشیده نمی‌شود.

### قدمِ بعد — دستِ مالک

۱. **ADR-071** — بله/نه (یا یکی از جایگزین‌های جدولش). با «بله» پیاده‌سازی‌اش کوتاه است؛ پروتوتایپ آماده است.
۲. `git push` — با همین سه کامیت `images` باید سبز شود؛ `ci` تا بندِ ۱ قرمز می‌مانَد.
۳. **استقرارِ نسخه‌ی دوم** — دو راه، تصمیم با مالک:
   - صبر تا CI سبز (بندِ ۱ و ۲)، بعد RUNBOOK §۲. قاعده‌ی خودمان همین است.
   - یا همین حالا از `d2ff064`، آگاهانه: jobِ `verify` روی GitHub سبز است و ۱۸ مرحله‌ی سنجه روی همان کامیت در
     محیطِ تمیز اجرا شد (۱۷ سبز؛ هجدهمی خرابیِ سیم‌کشیِ CI بود، نه محصول). چیزی که نداریم اجرای خودِ runner است.

---

## ★★ ADR-071 — تایید و پیاده‌سازی (۱۴۰۵/۰۷/۲۳)

> مالک: «ADR-071 تایید شد، پیاده کن.» دو پرسشِ دیگرِ پیامِ قبل (استقرار همین حالا یا بعد از CI سبز · `ubuntu-24.04`)
> جواب نگرفته‌اند و دست نخوردند.

### آنچه ساخته شد

| فایل | چه |
|---|---|
| [`infra/docker/minio-dev.Dockerfile`](infra/docker/minio-dev.Dockerfile) | دو `go install` سنجاق‌شده (`minio` → `07c3a429bfed` · `mc` → `7394ce0dd2a8`)، پیش از هر کدام گاردِ «شبه‌نسخه و کامیتِ اعلام‌شده یک کامیت‌اند»، چاپِ build info در لاگِ build، و یک alpine با هر دو باینری و شل |
| `infra/docker/minio-dev.Dockerfile.dockerignore` | `*` — Dockerfile چیزی کپی نمی‌کند، پس `tls/` و `acme/`ِ محلی هم به context نمی‌روند |
| [`infra/docker/docker-compose.yml`](infra/docker/docker-compose.yml) | `minio` و `minio-init` روی **یک** ایمیج با `build:` و تگِ release (لنگرِ `x-minio-dev-*`، همان الگوی compose ِproduction)، و `pull_policy: never` (پایین) |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | کشِ ایمیج با `actions/cache/restore` و `save` (کلید = hashِ Dockerfile). `save` جدا از `restore` است تا اگر سنجه‌ای بعدتر افتاد، کش باز هم نوشته شود؛ نامِ ایمیج از خودِ compose خوانده می‌شود، نه از YAML |

### ★★ یافته‌ای که فقط پیاده‌سازی نشانش داد: compose پیش از build، pull می‌کند

اولین `up` روی یک پروژه‌ی جدا (ایمیج غایب) سبز شد، ولی لاگش با این شروع می‌شد:

```text
Image hamboom/minio-dev:RELEASE.2025-09-07T16-13-09Z Pulling
… pull access denied for hamboom/minio-dev, repository does not exist …
Image hamboom/minio-dev:RELEASE.2025-09-07T16-13-09Z Building
```

برای سرویسی که هم `image` دارد هم `build`، سیاستِ پیش‌فرض یعنی «اول بکش، نشد بساز». فضای نامِ `hamboom` در Docker Hub
مالِ ما نیست: هرکس ثبتش کند و همین تگ را push کند، ایمیجش روی هر ماشینِ تازه و هر اجرای CI بالا می‌آمد — یک
جایگزینیِ زنجیره‌ی تأمین که هیچ گیتی نمی‌دید، چون همه‌چیز «سبز» می‌شد. با `pull_policy: never`:

| حالت | تلاشِ pull | build | زمان |
|---|---|---|---|
| بدونِ `pull_policy`، ایمیج غایب | **۲** | بله | ۱۳۴s (کامپایلِ تازه) |
| با `never`، ایمیج غایب | **۰** | بله، از کشِ BuildKit | ۳s |
| با `never`، ایمیج حاضر | **۰** | نه | ۰s |

### اندازه‌ها

- **build از صفر با خودِ compose:** ۱۳۴ ثانیه (`minio` ۱۰۴s با دانلودِ ماژول‌ها، `mc` ۲۴s). compose برای دو سرویس دو build
  می‌فرستد ولی کامپایل **یک بار** است (یک «downloading github.com/minio/minio» در کلِ لاگ)؛ دومی از کش می‌آید.
- `minio-init` از همان ایمیج سه باکت را ساخت («buckets ready»)؛ سرور: `Version: RELEASE.2025-09-07T16-13-09Z (go1.24.6)`،
  کنسولِ وب هم بالا است.
- ★ **گاردِ «شبه‌نسخه = کامیت»، با دو شکستنِ عمدی:** `--build-arg MINIO_COMMIT=000…` ⇒ exit ۱ در یک ثانیه با «✖ MINIO_MODULE
  و MINIO_COMMIT یک کامیت نیستند» و صفر دانلود · `--build-arg MC_COMMIT=111…` ⇒ مرحله‌ی `minio` از کش، مرحله‌ی `mc` با پیامِ
  خودش می‌ایستد · آرگومان‌های پیش‌فرض ⇒ exit ۰.

### همان کد؟ — از داخلِ خودِ باینری

`--version` فقط متنِ ldflags است و چیزی درباره‌ی کد نمی‌گوید؛ این‌بار build infoِ تعبیه‌شده (`go version -m`) خوانده شد:

| | رسمی (کش‌شده) | ساخته‌شده |
|---|---|---|
| ماژولِ اصلی | `v0.0.0-20250907161309-07c3a429bfed`**`+dirty`** · `vcs.revision=07c3a429…` · `vcs.modified=true` | `v0.0.0-20250907161309-07c3a429bfed` با `h1:deu0m9…` |
| وابستگی‌ها (`minio` / `mc`) | ۲۴۱ / ۹۸ | ۲۴۱ / ۹۸ — **صفر خطِ متفاوت**، با hashِ `h1:` |
| Go و پرچم‌ها | go1.24.6 · `-tags=kqueue` · `-trimpath` · `CGO_ENABLED=0` · `GOAMD64=v1` | همان |
| sha256 (`minio` / `mc`) | `7c5bd851…` / `01f866e9…` | `d5ac237f…` / `c24060f9…` |

⇒ همان کامیت، همان گرافِ وابستگی، همان toolchain. ⚠️ بیلدِ **رسمی** از درختی با تغییرِ commit‌نشده ساخته شده بود
(`+dirty`) — نمی‌دانیم چه — پس «بایت‌به‌بایت مثلِ رسمی» نه اثبات شده نه شدنی است.
★ **ولی build تکرارپذیر است:** خروجیِ مرحله‌ی build ِ امروز (متنِ RUNِ متفاوت از پروتوتایپ، دانلودِ تازه) با باینری‌های
پروتوتایپِ ۰۷/۲۰ هم‌sha است، و سه لایه‌ی ایمیجِ نهایی **همان سه لایه‌ی پروتوتایپ‌اند** (`e477571b…`، `04f6fe1d…`،
`27755767…`) — پس ۱۹/۱۹ِ دورِ دومِ شبیه‌سازیِ CI (۰۷/۲۰) روی همین بایت‌ها بود.

### تعویضِ MinIOی ماشینِ توسعه، روی **همان** volume

سرویس‌های dev بعد از ری‌استارتِ ماشین خاموش بودند؛ اول بالا آمدند (پورت‌ها بیرونِ رنجِ excluded بودند). بعد:

| گام | نتیجه |
|---|---|
| فهرستِ همه‌ی اشیا با `mc`ِ **رسمی** (کلید، اندازه، etag) | ۸ باکت، **۱۴۷** شیء |
| `infra:backup-all` با سرورِ **قدیم** | dump + مانیفستِ `storage/manifest-2026-10-15T11-07-51Z.json` |
| tarِ کلِ volume (تورِ ایمنی، در پوشه‌ی موقتِ نشست) | ۳٫۹MB |
| `compose up -d minio minio-init` | Recreate، همان `hamboom_miniodata`، صفر pull، صفر build؛ postgres/redis دست نخوردند |
| همان فهرست با `mc`ِ **ایمیجِ نو** | **یکسان** — ۱۴۷ شیء، همان کلید و اندازه و etag |
| `infra:restore-storage` با مانیفستی که سرورِ **قدیم** نوشت | **۶/۶** برای snapshots (۳۷ ورودی، ۵ ردیفِ `board_snapshots`) و **۶/۶** برای assets (۱۸) — sha256ِ بایت‌هایی که سرورِ **نو** خواند = مانیفست، و Y.Docها باز شدند |
| `infra:restore-drill` | **۶/۶** (dump از باکتِ پشتیبان، از راهِ سرورِ نو) |
| `storage:smoke` · `assets:smoke` | ۱۶/۱۶ · ۶/۶ |
| شبیه‌سازیِ «کشِ CI»: `docker save` (۵۵MB) → حذفِ ایمیج → `docker load` → `compose up` | صفر pull، صفر build؛ هر ۱۴۷ شیء سرِ جا (+ یک شیءِ تازه‌ی `assets:smoke` در باکتِ خودش) |

### آنچه ادعا **نمی‌شود**

- ⏳ **«CI سبز است».** تا اولین اجرا روی runner، نه. زمانِ build روی runner و خودِ گام‌های `actions/cache` اجرا نشده‌اند؛
  فقط مسیرِ save/load روی همین ماشین.
- `test:e2e:assets` (انبارِ سخت‌گیر، مرورگر) و بقیه‌ی ۳۴ سنجه روی **ایمیجِ نهایی** دوباره زده نشدند؛ دلیلِ کافی‌بودنش
  بالاست (همان لایه‌هایی که دورِ دومِ شبیه‌سازی ۱۹/۱۹ رویشان سبز شد)، نه یک اجرای تازه.
- tarِ volume در پوشه‌ی موقتِ نشست است، نه یک پشتیبانِ ماندگار. پشتیبانِ واقعیِ dev همان dump و آینه‌ی باکتِ backups است.
- ایمیج‌های رسمیِ `minio/minio:latest` و `minio/mc:latest` روی این ماشین **مانده‌اند** (حذف نشدند: آخرین نسخه‌ی باینریِ
  رسمی‌اند)؛ دیگر هیچ چیز از آن‌ها استفاده نمی‌کند.

### قدمِ بعد — دستِ مالک

۱. `git push` — کامیت‌های محلیِ ۰۷/۲۰ و این دو (`git log origin/main..` فهرستشان می‌کند).
۲. `gh run list` — اولین اجرا MinIO را می‌سازد (کش خالی است)، پس jobِ سنجه‌ها چند دقیقه طولانی‌تر است؛ دومی باید از کش
   بخوانَد. هر دو workflow باید `success` باشند تا «CI سبز» نوشته شود.
۳. بعد: استقرارِ نسخه‌ی دوم از همان کامیتِ سبز (RUNBOOK §۲)، و تصمیمِ `ubuntu-24.04` — هر دو هنوز با مالک.
