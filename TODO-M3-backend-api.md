# TODO-M3-backend-api.md — ماژول M3: `backend-api` + اتصالِ `apps/web`

> **وضعیت: پیش‌نویسِ برنامه‌ریزی — منتظرِ تاییدِ مالک.** طبق فرآیندِ پروژه
> ([spec §۷](docs/iranian-miro-spec.md)) این فایل **قبل از هر کدی** نوشته می‌شود و
> باید تایید شود؛ بعد با `/loop` اجرا می‌شود. **تا سبزشدنِ فاز ۰ (تصمیم‌های مرزی) و
> فاز ۱ (probeها) هیچ کدِ محصولی نوشته نمی‌شود** — همان دروازه‌ای که M1 و M2 داشتند.
>
> **نقطه‌ی ورود:** [`docs/m3-handoff.md`](docs/m3-handoff.md) — سندِ تحویلِ M2 به M3.
>
> **قبل از شروع بخوان:** [PLAN.md](PLAN.md) بخش‌های ۴ (env)، ۵ (قراردادِ API)، ۶
> (schema)، ۷ (مدلِ Yjs) و ۸ (ماژول M3) · [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)
> — به‌ویژه **ADR-001، ADR-005، ADR-009، ADR-011، ADR-012، ADR-013، ADR-014،
> ADR-015، ADR-016، ADR-017، ADR-018، ADR-021، ADR-031** · سه README پورت‌ها
> ([canvas-sync](packages/canvas-sync/README.md) §«چهار پورت»،
> [realtime](apps/realtime/README.md)، [ydoc-schema](packages/ydoc-schema/README.md)).
>
> **ماژول‌های تمام‌شده:** [TODO-M1-canvas-core.md](TODO-M1-canvas-core.md) ·
> [TODO.md](TODO.md) (M2، بایگانی). **این فایل فقط M3 است.**

---

## دامنه‌ی M3

طبق [PLAN بخش ۸](PLAN.md): **`apps/api` + `packages/sdk` + `packages/auth-core` +
`packages/storage`**. به‌علاوه‌ی دو چیزی که [`m3-handoff.md`](docs/m3-handoff.md)
صریحاً به گردنِ M3 گذاشت: **اتصالِ واقعیِ چهار پورتِ M2** و **راه‌اندازیِ لایه‌ی
`apps/web`** (احراز → داشبورد → پوسته‌ی بورد)، و در پایان **نوار ابزار عمودی**.

هیچ‌کدام از این‌ها امروز وجود ندارند: `packages/{auth-core,storage,sdk}`،
`apps/{api,web}`. `shared-types` امروز فقط قراردادِ **canvas/text** را دارد (کارِ
M1/M2)؛ **کلِ لایه‌ی DTOهای API را M3 اضافه می‌کند** — و این خودش یک رخدادِ ADR-021
است (فاز ۲).

**چه چیزی در M3 هست:** زیر «تصمیم‌های مرزی M3» (M3-D1) دقیق می‌شود.
**چه چیزی بیرون است (پس از تصمیم‌های مرزی):** قالب/کامنت/نسخه/خروجی (فاز ۱۰) → **به
دورِ بعد** · پرداخت/اشتراک = **M4** · پنل ادمینِ پلتفرم = **M6** · فازِ کاملِ زیرساخت
(Dockerfileهای production، K8s، CI/CD، مانیتورینگ) = **M5** · `apps/worker` (خروجی با
Chromium، thumbnail) = **بعد از M3**.

---

## قوانین اجرای loop (همان انضباطِ M1/M2)

۱. **ترتیب را رعایت کن.** گام‌ها به هم وابسته‌اند. فاز ۰ و ۱ **دروازه‌ی کلِ ماژول‌اند**.
۲. **مبنای تیک‌زدن و کامیت فقط `pnpm verify` است** ([CLAUDE.md](CLAUDE.md) §«چرا
   `pnpm verify`»). `pnpm lint`/`test` برای حلقه‌ی سریعِ کار خوب‌اند، ولی گیت نیستند.
   ⚠️ اگر verify روی `test` افتاد، **اول محیط را ببین** (سقفِ commit ویندوز) — جدولِ
   تشخیصِ CLAUDE.md.
۳. **تیک زدن فقط بعد از تحققِ «معیار پذیرش».** محقق نشد، ننویس انجام شد.
۴. **هیچ dependency ای بدونِ لایسنسِ MIT/Apache-2.0/BSD/ISC/0BSD اضافه نکن**؛ بعد از هر
   افزودن `pnpm license:check` و ثبت در `docs/dependencies.md` (P1).
۵. **دامنه‌ی خودت را رعایت کن.** M3 صاحبِ `apps/{api,web}` و `packages/{auth-core,storage,sdk}`
   است. ⚠️ **دست‌زدن به `canvas-core`/`canvas-sync`/`ydoc-schema`/`realtime` فقط با
   موارد صریحِ M3-D4 مجاز است** (یافته‌های M2 که رفعشان تاییدِ مالک خورده).
۶. ★ **تغییرِ `shared-types` تاییدِ مالک می‌خواهد** (ADR-021). برخلافِ M2 که «صفر
   تغییر» بود، M3 **باید** قراردادِ API را اضافه کند — پس این تاییدِ **دسته‌ای**
   است (فاز ۲)، نه «متوقف شو برای همیشه». ولی دو موردِ **واقعاً باز** (M3-D2a/b)
   جداگانه گیت می‌شوند.
۷. **پایان هر session:** [`PROGRESS-M3-backend-api.md`](PROGRESS-M3-backend-api.md) را
   با «چه شد / چه تصمیمی گرفتم / قدم بعد» به‌روز کن.
۸. **گامِ بلوکه‌شده:** با `[!]` علامت بزن، دلیل بنویس، برو گام مستقلِ بعدی. کل loop را
   متوقف نکن.
۹. ★ **درسِ بزرگِ M1/M2: اول probe، بعد کد.** هر جا رفتارِ S3/JWT/Postgres/Fastify فرض
   شده، قبل از منطق با یک آزمایشِ کوچکِ **واقعی** ثابتش کن.
۱۰. ★★ **یک گیتِ آزموده‌نشده گیت نیست.** هر قاعده‌ی ESLint با `RuleTester`، هر گیتِ
    اسکریپتی با `--self-test`، هر threshold و هر تستِ امنیتی با یک **شکستنِ عمدی** که
    **قرمز** می‌شود. در M2 بارها یک تستِ تازه با برداشتنِ همان چیزی که می‌سنجید سبز مانْد.

---

## قیدهای سختِ M3 (اگر رعایت نشوند، بی‌صدا می‌شکند)

**اصولِ پروژه که در M3 اولین‌بار واقعاً آزموده می‌شوند:**

| اصل | معنای عملی در M3 |
|---|---|
| **P1** | هر پکیجِ جدید قبل از افزودن `license:check`. Fastify، `pg`/Kysely، `@aws-sdk/client-s3`، `jose`/jwt، zod — همه باید MIT/Apache باشند. |
| **P2** | صفر سرویسِ خارجی در runtime. SMS = mock (کاوه‌نگار فقط سوییچِ env)، فونت خودمیزبان (ADR-017)، بدون CDN. |
| **P3** | `docker compose up && pnpm dev` کافی باشد. هیچ فیچری برای **توسعه** به حساب آروان/زرین‌پال واقعی نیاز ندارد. |
| **P4** | ★ **فقط `packages/storage` حق دیدنِ `@aws-sdk/*` را دارد** ([ADR-013](ARCHITECTURE_DECISIONS.md#adr-013)). گیتِ ESLintش از M2 هست و خودآزمون است — M3 فقط پیاده‌سازیِ دوم را اضافه می‌کند، گیت را ضعیف نمی‌کند. |
| **P5** | ★ پول همیشه `BIGINT` **ریال** ([ADR-015](ARCHITECTURE_DECISIONS.md#adr-015)). درایورِ Postgres باید `int8` را به `number` بدهد نه `string` — در **یک** جا تنظیم و مستند شود. (billing خودش M4 است، ولی جدولِ plans/subscriptions در schemaی M3 است.) |
| **P6** | ★ RTL واقعی با logical properties ([ADR-016](ARCHITECTURE_DECISIONS.md#adr-016)). **استثنا: مختصاتِ بوم آینه نمی‌شود** — نوار ابزارِ فاز ۹ باید این مرز را صریح نگه دارد. Stylelintِ `lint (CSS)` داخلِ verify گلابش `**/*.css` است، پس CSSِ `apps/web` را هم می‌گیرد. |
| **P7** | ★ هیچ PII در لاگ ([ADR-020](ARCHITECTURE_DECISIONS.md#adr-020)). موبایل ماسک‌شده، OTP/token هرگز. redactorِ pino در **`packages/config`** مرکزی است، نه در هر اپ. |

**چهار چیزی که [`m3-handoff.md`](docs/m3-handoff.md) گفت M3 اگر رعایت نکند بی‌صدا می‌شکند:**

۱. ★ **الگوی اشتراکِ StrictMode-safe** ([ADR-032](ARCHITECTURE_DECISIONS.md#adr-032)) —
   `apps/web` **باید** `useEffect([api])` با cleanup بزند، نه اشتراک در `onReady`. وگرنه
   binder **بی‌صدا هیچ تغییری emit نمی‌کند**. (فاز ۸)
۲. ★ **`bindUndoShortcuts` اجباری است** ([ADR-035](ARCHITECTURE_DECISIONS.md#adr-035)) —
   بدونش یک `Ctrl+Z` **دو کار** می‌کند. (فاز ۸)
۳. ★ **`fail closed` را نشکن** — و ⚠️ `undefined` («نظری ندارم») با `null` («دسترسی
   برداشته شده») **دو چیزِ متفاوت‌اند**؛ با `??` یکی می‌شوند و کاربرِ اخراج‌شده وصل
   می‌مانَد. این قید هم در `auth-core.effectiveBoardRole` (فاز ۴) و هم در `apps/web`
   (فاز ۸) زنده است.
۴. ★★ **تستِ خودآزمون‌نشده گیت نیست** — قاعده‌ی ۱۰ بالا.

**سقفِ حافظه — ورودیِ برنامه‌ریزی، نه عددِ جانبی** ([realtime-baseline.md](docs/realtime-baseline.md)):
بوردِ ۵۰۰۰ عنصری = **۷۶MB حافظه‌ی اتاق** (نه ۳٫۶۶MBِ سند). پس `RT_MAX_DOC_BYTES` و
`RT_MAX_ROOMS_PER_NODE=۵۰۰` گیتِ موثر **نیستند**. هر برنامه‌ریزیِ ظرفیتِ M3 از **حافظه**
شروع می‌شود → فاز ۱۱ (ADR-006 فاز ۳).

---

## تصمیم‌های مرزی M3 — ★ نیاز به تاییدِ مالک (فاز ۰، بدون کد)

مثلِ D-1..D-5 در M2، این‌ها **قبل از** هر کدی نهایی می‌شوند. هرکدام یک ADR جدید تولید
می‌کند (نه ویرایشِ ADR قدیمی).

| # | موضوع | پیشنهادِ من | تاییدِ لازم |
|---|---|---|---|
| **M3-D1** | **عمقِ دامنه‌ی M3** | «هسته‌ی واقعی‌ساز + نوار ابزار»: فازهای ۰–۹ و ۱۱ در M3؛ **فاز ۱۰ (قالب/کامنت/نسخه/خروجی) دنباله‌ی قابلِ‌حذف** است که بعد از دیدنِ هسته تصمیم گرفته شود. دلیل: هسته محصول را واقعاً کار می‌اندازد؛ دنباله feature است و می‌تواند صبر کند. | ✅ **هسته + نوار ابزار؛ فاز ۱۰ به تعویق** (۱۴۰۵/۰۵/۲۴) |
| **M3-D2** | **جمعیت‌بخشیِ `shared-types`** | DTOهای PLAN §۵٫۱ (User/Team/Board/Template/Comment/Plan/…​ + کدهای خطا + enumها) به‌صورت zod اضافه شوند. شکلشان در PLAN از قبل تثبیت است، پس تاییدِ **دسته‌ای** کافی است (نه گام‌به‌گام). | ⏳ تاییدِ **دسته‌ای** هنگامِ گام ۲٫۲ (نمونه‌ی zod دیده شود) |
| **M3-D2a** ★گیت | **شکلِ claimهای `rtToken`** — امروز داخلِ پورتِ `BoardAuthority` و `DevBoardAuthority` است، عمداً بیرونِ `shared-types` (D-2ی M2، [ADR-031](ARCHITECTURE_DECISIONS.md#adr-031)). حالا هر دو طرف (api صادرکننده، realtime مصرف‌کننده) وجود دارند. | **بردنش به `shared-types`** — چون دلیلِ «هنوز زود است» (طرفِ دومش نبود) دیگر برقرار نیست؛ `{ sub, boardId, role, exp }` قراردادِ واقعیِ سیم است. | ✅ **بله — به `shared-types`** (۱۴۰۵/۰۵/۲۴) |
| **M3-D2b** ★گیت | **تایپِ `CommentPin`** — امروز در `ydoc-schema` است (گام ۲٫۲ی M2). | **مشروط:** اگر فاز ۱۰ (کامنت) در M3 باشد → بردنش به `shared-types` (چون کلاینت و api و سند هر سه سنجاق را می‌بینند). اگر ۱۰ به تعویق افتاد → **همان‌جا در `ydoc-schema` بماند** تا زمانش برسد. | ⛔ **به تعویق — در `ydoc-schema` می‌مانَد** |
| **M3-D3** | **پشته‌ی فنیِ api** | Fastify ([ADR-001](ARCHITECTURE_DECISIONS.md#adr-001) از قبل) + SQL خام با Kysely ([ADR-005](ARCHITECTURE_DECISIONS.md#adr-005)) + zod→OpenAPI. تاییدِ دوباره لازم نیست مگر بخواهی عوض شود. | فقط اگر انحراف بخواهی |
| **M3-D4** ★گیت | **رفعِ سه یافته‌ی M2 که به `canvas-core`/`canvas-sync` دست می‌زند** (تبدیلِ پیکسل→صحنه، انزوای ویرایشگرِ متن، نگهبانِ `createBoardDoc`) — این‌ها **خارج از دامنه‌ی M3** اند و مثلِ B-1 در M2 تاییدِ صریح می‌خواهند. | هر سه در فاز ۸، **قبلش** هرکدام یک تصمیم/ADR. | ✅ **تک‌تک: توقف + گزینه + هزینه، بعد تایید** (۱۴۰۵/۰۵/۲۴) |
| **M3-D5** | **`apps/worker` و خروجی (export)** | به تعویق: SVG/JSON را می‌شود مستقیم از سند ساخت (بدونِ مرورگر)، ولی PNG/PDF به Chromium نیاز دارد (ADR-019) که یک image ~۴۰۰MB و یک Deployment جداست. پیشنهاد: worker و PNG/PDF **بیرونِ M3** (با M5/M4)، و اگر لازم شد فقط SVG/JSON در فاز ۱۰. | ✅ **بعد از M3** (همراهِ فاز ۱۰) |

> ✅ **تصمیم‌ها بسته شد (۱۴۰۵/۰۵/۲۴):** M3 = فازهای ۰–۹ + ۱۱ (فاز ۱۰ و worker به تعویق) ·
> `rtToken` → `shared-types` · `CommentPin` در `ydoc-schema` می‌مانَد · رفعِ M1/M2 **تک‌تک**
> تایید می‌شود (اجازه‌ی کلی نیست). **می‌مانَد برای فاز ۰٫۱:** نوشتنِ ADRهای جدید · و تاییدِ
> **دسته‌ایِ** DTOها هنگامِ گام ۲٫۲.

---

## ترتیب پیاده‌سازی — و چرا

```
فاز ۰  تصمیم‌های مرزی            ← بدون این، بقیه روی فرض ساخته می‌شود
   ↓
فاز ۱  probeهای ریسک             ← ★ دروازه: نقشِ موثر + برابریِ verify (presignِ S3 → گام ۳٫۰)
   ↓
فاز ۲  config + shared-types      ← قرارداد. api و web و realtime رویش سوارند
   ↓
فاز ۳  packages/storage           ← P4. SnapshotStore + AssetTransport واقعی
   ↓
فاز ۴  packages/auth-core         ← نقشِ موثر + JWT + OTP + BoardAuthority واقعی
   ↓
فاز ۵  apps/api                   ← REST + migration کامل + endpointِ rt-token
   ↓
فاز ۶  packages/sdk               ← کلاینتِ typed از shared-types
   ↓
فاز ۷  اتصالِ realtime به پورت‌ها  ← حذفِ dev impl، اجرای دوباره‌ی هر ۷ سنجه
   ↓
فاز ۸  apps/web (احراز→داشبورد→بورد) ← ★ لایه‌ی بورد/تیم/احراز — StrictMode-safe
   ↓
فاز ۹  نوار ابزارِ عمودی          ← ★ بعد از فاز ۸، طبق قیدِ صریحِ مالک
   ↓
فاز ۱۰ ⛔ به تعویق — بیرونِ M3       ← قالب/کامنت/نسخه/خروجی → دورِ بعد
   ↓
فاز ۱۱ ظرفیت + سخت‌سازی + تحویل    ← سقفِ حافظه (ADR-006 فاز ۳) + smoke + M4-handoff
```

**چهار دلیل برای همین ترتیب:**

۱. **پورت‌ها پایین‌ترین لایه‌اند و مصرف‌کننده دارند.** `storage` و `auth-core` قبل از
   `api` ساخته می‌شوند چون api رویشان سوار است، و realtime هم (فاز ۷) به همان‌ها وصل
   می‌شود. اگر api اول ساخته شود، شکلِ پورت را api دیکته می‌کند و realtime بعداً بازش می‌کند.
۲. **api قبل از web.** مثلِ «binder قبل از سرور» در M2: api را می‌شود بدونِ UI با تستِ
   HTTP کامل آزمود. اگر اول web ساخته شود، هر باگِ api پشتِ لایه‌ی مرورگر پنهان می‌شود.
۳. **نوار ابزار بعد از پوسته‌ی بورد** (قیدِ مالک). نوار ابزار روی یک بومِ واقعاً
   وصل‌شده معنا دارد؛ ساختش قبل از احراز/بورد یعنی ساختِ UI روی هوا.
۴. **probeها اول** چون می‌توانند **طراحی** را عوض کنند: اگر presignِ آروان‌گونه با
   MinIO فرق کند، امضای `storage` عوض می‌شود؛ اگر `verify`ی مشترک در دو محیطِ Node
   یکسان رفتار نکند، کلِ ADR-012 بازبینی می‌خواهد.

**تخمینِ کل: ۱۵ تا ۱۸ روزِ کاری** (فاز ۱۰ بیرونِ دامنه شد — M3-D1).

---

## فاز ۰ — تصمیم‌های مرزی (تخمین: ۰٫۵ روز، بدون کد)

### گام ۰٫۱ — نهایی‌کردنِ تصمیم‌های مرزی + ADRها — ✅ (۱۴۰۵/۰۵/۲۴)
- [x] جدولِ «تصمیم‌های مرزی M3» با مالک نهایی شد (عمق، دو گیتِ shared-types، رفعِ M1، worker) —
      نتیجه در همان جدول و در [`PROGRESS-M3-backend-api.md`](PROGRESS-M3-backend-api.md).
- [x] **[ADR-042](ARCHITECTURE_DECISIONS.md#adr-042)** — claimهای `rtToken` به `shared-types`
      (جایگزینِ قیدِ rtTokenِ ADR-031). در فهرست ثبت و لنگر کار می‌کند؛ شمارشِ ADR در CLAUDE.md ۴۱→۴۲.
- [ ] ⏳ **ADRهای مؤخر (عمداً حالا نه):** «تبدیلِ پیکسل→صحنه صادر می‌شود» با **تاییدِ تک‌تکِ**
      گام ۸٫۵ نوشته می‌شود، و «room affinity — فاز ۳ی ADR-006» با تصمیمِ گام ۱۱٫۱ — چون هر دو
      تا آن فاز **تصمیم‌گرفته‌نشده** اند و ADRِ زودهنگام یعنی قفل‌کردنِ حدس.
- **معیار پذیرش:** ✅ ADR-042 در `ARCHITECTURE_DECISIONS.md` (فهرست + لنگر)؛ تصمیم‌ها و تاریخ در
      `PROGRESS-M3-backend-api.md`.

---

## فاز ۱ — ★ دروازه‌ی ریسک: اول probe، بعد کد (تخمین: ۱–۲ روز)

> این فاز کد محصولی تولید نمی‌کند، **شواهد** تولید می‌کند. هر probe می‌تواند طراحی را
> عوض کند. جای probeها: یک پوشه‌ی `probe/` موقت یا تستِ کنارِ خودِ پکیجِ آینده.

### گام ۱٫۱ — probe نقشِ موثر و قراردادِ fail-closed — ✅ (۱۴۰۵/۰۵/۲۴)
> **نتیجه:** جدولِ ۸ردیفی سبز و حفره‌ی `??` بازتولید و بسته شد (۱۰/۱۰). شرح در
> [`PROGRESS-M3`](PROGRESS-M3-backend-api.md) §«فاز ۱». ⚠️ **یافته:** نگاشتِ **تیم→بورد** در
> PLAN صریح نیست (پیش‌فرضِ probe: owner/admin/member→editor، guest→viewer) → تصمیمِ مالک در گام ۴٫۲.
- [x] `effectiveBoardRole(...)` روی جدولِ حالت: staff → owner → `board_members` → نقشِ تیمِ
      نگاشته‌شده → لینک؛ **بیشترین** برنده — سبز ([ADR-012](ARCHITECTURE_DECISIONS.md#adr-012)).
- [x] ★ **تمایزِ `undefined`/`null`**: نشان داده شد `cur ?? tokenRole` کاربرِ اخراج‌شده (`null`)
      را `editor` نگه می‌دارد و تفکیکِ صریح (`cur === null → رد`) می‌بنددش (قیدِ ۳ی handoff).
- **معیار پذیرش:** یک جدولِ تصمیمِ اجراشدنی (تست) که هر ردیفش نقشِ درست را می‌دهد، **به‌علاوه‌ی**
      یک تستِ منفی که با جایگزینیِ منطق با `??` **قرمز** می‌شود. سندِ کوتاه در PROGRESS.

### گام ۱٫۲ — ➡️ **به گام ۳٫۰ منتقل شد** (تصمیمِ مالک ۱۴۰۵/۰۵/۲۴)
> ریسکی که این probe می‌سنجد (رفتارِ presign) مالِ **storage** است نه احراز هویت، و به
> `@aws-sdk` + داکر نیاز دارد که فاز ۲ ندارد. پس «اول probe» اینجا یعنی **قبل از نوشتنِ
> interfaceِ storage** → به **گام ۳٫۰**. فاز ۲ (config/قرارداد) به آن وابسته نیست.

### گام ۱٫۳ — probe برابریِ `verify` (api↔realtime) — ✅ برابری (۱۴۰۵/۰۵/۲۴) · end-to-end → فاز ۷
> **نتیجه:** با verifierِ **واقعیِ** امروزِ realtime، ۷ از ۸ واگرایی fail-closed شد. ★★ **تنها
> حفره‌ی خاموش: واحدِ `exp`** — صادرکننده‌ای که ms به‌جای ثانیه بنویسد توکنی می‌سازد که سنجنده تا
> **~۵۵٬۷۱۵ سال** معتبر می‌بیند. شرح در [`PROGRESS-M3`](PROGRESS-M3-backend-api.md).
- [x] برابریِ **منطقی** اثبات شد: یک schema + یک sign/verify؛ سه واگراییِ شکل (role به‌صورت
      ایندکس، فیلدِ تغییرِ نام، `boardId`ِ غایب) fail-closed، به‌علاوه‌ی چهار ردِ امنیتیِ منبعِ واحد.
- [x] ★★ **قفلِ طراحیِ فاز ۴ (بستنِ «قطعی»ِ حفره‌ی exp که مالک خواست):** schemaی claim در
      `shared-types` با **`exp`=ثانیه**؛ **یک** signer در `auth-core` (تا api نتواند ms بنویسد)؛ و
      `verify` یک **سقفِ آینده** روی `exp` بگذارد (rt-token ۶۰ثانیه‌ای است) — دفاعِ لایه‌ای. پین در گام ۴٫۳.
- [ ] اتصالِ **end-to-end واقعی** (توکنِ `rt-token` روی سرورِ realtime با `AuthCoreBoardAuthority`)
      ذاتاً به auth-coreِ نساخته نیاز دارد → **معیارِ پذیرشش در فاز ۷** (اجرای دوباره‌ی ۷ سنجه).
- **معیار پذیرش (فاز ۱):** ✅ probe نشان داد کدام واگرایی fail-closed و کدام حفره است، و قفلِ طراحی
      ثبت شد؛ سه تستِ حمله‌ی JWT (alg:none/زمان‌ثابت/exp) در فاز ۴ روی `auth-core` سبز می‌شوند.

> **جمع‌بندیِ فاز ۱ — ✅ بسته (۱۴۰۵/۰۵/۲۴):** دو probeِ طراحی‌محور/امنیتی (۱٫۱ نقشِ موثر،
> ۱٫۳ برابریِ verify) سبز و یافته‌هایشان در گام‌های ۴٫۲/۴٫۳ پین شد. probeِ storage (۱٫۲) به
> **گام ۳٫۰** منتقل شد چون ریسکش مالِ storage است و فاز ۲ به آن وابسته نیست. **دروازه‌ی کدِ
> محصولی باز است.**

---

## فاز ۲ — قراردادِ `packages/shared-types` (تخمین: ۱ روز)
> ⚠️ **گام ۲٫۱ (گسترشِ `config`) حذف شد** (تصمیمِ مالک ۱۴۰۵/۰۵/۲۴، گزینه A): فاز ۲ هیچ
> مصرف‌کننده‌ی env ندارد و خط‌قرمزِ `config` «فقط بخشِ دارای مصرف‌کننده» است. `config` **افزایشی**
> با مصرف‌کننده‌اش رشد می‌کند (پایین). پس فاز ۲ فقط قراردادِ `shared-types` است.

### گام ۲٫۱ — ❌ **حذف شد؛ `config` افزایشی رشد می‌کند** (مالک، ۱۴۰۵/۰۵/۲۴ — گزینه A)
> همان اصلِ کلِ پروژه (`.env.example` ناقص، `CommentPin`، باریک‌کردنِ DTO): چیزی بدونِ مصرف‌کننده‌ی
> واقعی اضافه نمی‌شود، و `config/CLAUDE.md` صریحاً منعش کرده. هر بخشِ env با مصرف‌کننده‌اش می‌آید:
> - `s3EnvSchema` → **گام ۳٫۰/۳٫۱** (storage) · `authEnvSchema`+`otpEnvSchema`+`smsEnvSchema` →
>   **فاز ۴** (auth-core) · `rateLimitEnvSchema` + `UPLOAD_MAX_BYTES` → **فاز ۵** (api).
> - کوئرسِ `int8`→number → **گام ۵٫۱** (پلاگینِ db؛ `config` به دیتابیس وصل نمی‌شود) · redactorِ P7
>   → **گام ۵٫۱** (pinoِ api، یکی‌شده با نسخه‌ی realtime؛ نیتِ «لیستِ مرکزی»ِ ADR-020 حفظ).
> - `paymentEnvSchema` → **M4** (خارج از M3).
> هر بخش هنگام افزوده‌شدن: نام‌ها با PLAN §۴، `.env.example` هم‌زمان، `processEnvDiscipline` سبز.

### گام ۲٫۲ — قراردادِ API در `shared-types` (M3-D2) — ✅ (۱۴۰۵/۰۵/۲۴)
> **نتیجه:** ۷ فایلِ `src/api/*` (roles/primitives/user/team/board/error/rt-token) + barrel +
> `api.test.ts`؛ انتقالِ `BoardRole` به shared-types ([ADR-043](ARCHITECTURE_DECISIONS.md#adr-043)).
> `pnpm verify` سبز (تست‌های shared-types + realtime سبز). شرح در [`PROGRESS-M3`](PROGRESS-M3-backend-api.md) §«فاز ۲».
- [x] DTOهای **مصرف‌کننده‌دارِ** §۵٫۱ به‌صورت zod: `User`/`UserPublic`، `Team`/`TeamMember`،
      `Board`/`BoardSummary`/`BoardMember`، enumها (`TeamRole`/`BoardRole`/`BoardAccessMode`/
      `AssignableBoardRole`)، کدهای خطای HTTP، صفحه‌بندیِ cursor. `Template`/`Comment`/`Plan`/… و
      فیلدهای مالیِ `Team` عمداً بیرون (فاز ۱۰/M4).
- [x] typeها با `z.infer`؛ **هیچ تعریفِ موازی** — DTOها مستقیماً *در* shared-types اند.
- [x] ★ **گیتِ عدم‌واگرایی موضوعیت ندارد:** api کپیِ جدا ندارد و مستقیم از shared-types می‌خواند،
      پس چیزی برای واگرایی نیست. نگهبانِ ترتیبِ سیمِ `boardRoles` در `api.test.ts` هست.
- **معیار پذیرش:** ✅ `pnpm verify` سبز؛ هر DTO با `parse` روی معتبر سبز و نامعتبر قرمز؛ مالک
      قرارداد را مرور و با سه اصلاح **تایید** کرد (این session)، ثبت در PROGRESS.

### گام ۲٫۳ — ★ M3-D2a: `rtToken` claims به `shared-types` — ✅ **تمام** (۱۴۰۵/۰۵/۲۴)
- [x] ✅ **تاییدِ مالک: بله** ([ADR-042](ARCHITECTURE_DECISIONS.md#adr-042)).
- [x] `rtTokenClaims` (`{ sub, boardId, role, exp }`، `exp`=ثانیه) در `src/api/rt-token.ts`؛
      `apps/realtime/.../board-authority.ts` تعریفِ محلی را حذف کرد و از همان‌جا می‌خواند —
      **بدونِ تعریفِ موازی**. `role` از `boardRole`ِ shared-types (یک منبع).
- **معیار پذیرش:** ✅ realtime از منبعِ واحد می‌خواند (سه تستِ حمله‌ی JWT هنوز سبز)؛ round-trip در
      `api.test.ts`؛ `pnpm verify` سبز. auth-core (فاز ۴) از همین schema صادر می‌کند.

### گام ۲٫۴ — ⛔ M3-D2b: `CommentPin` — **به تعویق افتاد**
- [!] ⛔ **تصمیمِ مالک (۱۴۰۵/۰۵/۲۴): `CommentPin` در `ydoc-schema` می‌مانَد** — چون فاز ۱۰
      (کامنت) بیرونِ M3 شد. این گام تا آمدنِ کامنت باز است و در `m4-handoff` ارثیه ثبت می‌شود.
- **معیار پذیرش:** یادداشتِ «به تعویق، در `ydoc-schema` ماند» در PROGRESS و `m4-handoff` —
      **کدی اینجا نوشته نمی‌شود.**

---

## فاز ۳ — `packages/storage` (P4) (تخمین: ۱٫۵–۲ روز)

### گام ۳٫۰ — ★ probe رفت‌وبرگشتِ S3 روی MinIO — **✅ کامل (۱۴۰۵/۰۵/۲۸)** (منتقل‌شده از ۱٫۲)
> «اول probe»: این باید **قبل از** گام ۳٫۱ (امضای `storage`) اجرا شود، چون رفتارِ presign
> می‌تواند امضای `presignPut` را عوض کند ([ADR-013](ARCHITECTURE_DECISIONS.md#adr-013): رفتارِ
> presign بین سرویس‌های S3 فرق می‌کند). اینجا `@aws-sdk/client-s3` **افزوده** می‌شود (P1:
> `license:check` باید سبز بدهد — Apache-2.0 ولی transitiveهایش هم بررسی شوند) و MinIO به compose.
>
> **✅ اجرا شد (۱۴۰۵/۰۵/۲۸) — OD-2 بسته:** بلوکه‌ی داکر رفع شد (مالک HTTPS proxy را تنظیم کرد)، MinIO بالا آمد،
> probe به **POST-policy** (`createPresignedPost` + `content-length-range`) بسط یافت و **روی MinIOِ واقعی، هر دو
> حالت** با عدد اثبات شد: زیرِ سقف **۲۰۴**، بالای سقف **۴۰۰ (ردِ خودِ MinIO)**، نوعِ غلط **۴۰۳**. ★ **یافته:**
> presigned PUT مکانیزمِ سقف نیست — PUTِ بدونِ امضای content-length، ۵۰۰۰بایت را **۲۰۰ پذیرفت**. پس مکانیزمِ
> گام ۳٫۱/۳٫۳ = **POST-policy `content-length-range` + `eq $Content-Type`**. جزئیات در PROGRESS §OD-2. `license:check`
> سبز (۷۵۹ پکیج). ⚠️ قیدِ ADR-013: این MinIO است؛ رفتارِ آروان در ۳٫۳/M5 تایید شود.
- [x] **MinIO به `infra/docker/docker-compose.yml` افزوده و بالا آمد** (minio-init + باکت‌ها به گام ۳٫۳؛ probe
      باکتِ `hamboom-probe`ِ خودش را ساخت). `forcePathStyle: true` لازم بود و کار کرد.
- [x] رفت‌وبرگشت: `putObject`→`getObject` بیت‌به‌بیت + `headObject` اندازه‌ی واقعی + `presignGet` (۲۰۰) روی MinIOِ واقعی.
- [x] ★★ **سقفِ اندازه/نوع** (نکته‌ی مالک): با **presigned POST + `content-length-range` + `eq $Content-Type`**
      اثبات شد که **خودِ MinIO** آپلودِ بالای سقف (۴۰۰) و نوعِ غلط (۴۰۳) را رد می‌کند؛ PUTِ بدونِ امضا سقف ندارد.
- **معیار پذیرش:** اسکریپتِ probe (مثلِ `db:smoke`) رفت‌وبرگشت + presign را ثابت می‌کند **و**
      نشان می‌دهد MinIO آپلودِ بزرگ‌تر از سقف/نوعِ غلط را رد می‌کند؛ `license:check` بعد از افزودنِ
      `@aws-sdk` سبز؛ نتیجه + تصمیمِ مکانیزم در PROGRESS.

### گام ۳٫۱ — abstractionِ S3 ([ADR-013](ARCHITECTURE_DECISIONS.md#adr-013)) — ✅ کامل (۱۴۰۵/۰۵/۲۸)
- [x] رابطِ `ObjectStore`: `putObject`، `getObject`(→`null` اگر نباشد)، `deleteObject`، `headObject`(→`null`)،
      `listPrefix`، `presignGet`، و ★ `presignUpload` — **بدونِ نامِ سرویس** در امضا. ⚠️ **`presignPut` شد
      `presignUpload`** (`{url, fields}`ِ POST-policy، نه `{headers}`ِ PUT): probe ۳٫۰ ثابت کرد PUT سقف را اعمال
      نمی‌کند. **پیامد بر گام ۳٫۳:** پاسخِ endpointِ presign از `{uploadUrl, headers}` به `{url, fields}` می‌شود.
- [x] ★ **تنها پکیجی که `@aws-sdk/*` را import می‌کند** — `storageBoundaries()` در eslint-config، وصل به
      `storage/eslint.config.js`. خودآزمونِ سه‌لایه در `boundaries.test.js` (الگو/سیم‌کشی/manifest). ★ ادعای
      اصلی «@aws-sdk **مجاز**» با یک شکستنِ عمدی (افزودنِ `@aws-sdk/*` به forbid) **۵ تست قرمز** شد، بعد revert سبز.
- [x] `S3_FORCE_PATH_STYLE` متغیرِ مستقلِ `s3EnvSchema` در `@hamboom/config` (+ `.env.example`)؛ storage خودش
      `process.env` نمی‌خواند — config می‌سازد، `createS3ObjectStore(config)` می‌گیرد. (بقیه‌ی S3 env هم: endpoint/
      region/کلیدها/TTL + باکتِ assets(۳٫۳)/snapshots(۳٫۲)؛ exports/public-url تا مصرف‌کننده نیامده.)
- **معیار پذیرش:** ✅ `pnpm storage:smoke` روی MinIOِ واقعی (۱۱ سبز): round-trip + head + list + presignGet +
      presignUpload (هر سه حالت: زیرِ سقف ۲۰۴/بالای سقف ۴۰۰/نوعِ غلط ۴۰۳) + قراردادِ null؛ گیتِ P4 با شکستنِ
      عمدی **قرمز** شد؛ `license:check` سبز (۷۵۹)؛ `pnpm verify` سبز (۸ گیت).

### گام ۳٫۲ — `StorageSnapshotStore` (جایگزینِ `FsSnapshotStore` — پورتِ ۲) — ✅ کامل (۱۴۰۵/۰۵/۲۸)
- [x] `createStorageSnapshotStore(objectStore)` در `apps/realtime/src/persistence/` — پیاده‌سازیِ پورتِ
      `SnapshotStore` روی `@hamboom/storage` (bucketِ snapshots). **امضای پورت عوض نشد**؛ آداپتورِ نازک:
      `put`→`putObject`(octet-stream) · `get`→`getObject` · `delete`→`deleteObject`. `@hamboom/storage` به
      deps‌ِ realtime اضافه شد (مجازِ `realtimeBoundaries`؛ ممنوعیت روی `@aws-sdk`ِ خام است، نه abstraction).
- [x] ★ **بازخوانی بعد از `put` جای درستش را دارد — در `compactor.ts` (مرحله‌ی ۴)، نه در store.** یافته‌ی
      مطالعه‌ی کد: هم `FsSnapshotStore` و هم این آداپتورِ تمیزند؛ سدِ «putِ دروغین» بازخوانیِ compactor است
      (state vector را می‌سنجد)، store-agnostic و از M2 اثبات‌شده. readbackِ دومِ store فقط کندی بود، نه امنیت.
- **معیار پذیرش:** ✅ `storage-snapshot-store.test.ts` (۵ سبز): conformance (put→get/null/delete/octet-stream روی
      `MemoryObjectStore`) + ★ **integration:** compactorِ واقعی روی `StorageSnapshotStore(ObjectStoreِ دروغین)`
      → بازخوانی می‌گیردش، `rejects` + **صفر prune**. با شکستنِ عمدی (صادق‌کردنِ دروغ) قرمز شد، بعد revert سبز.
      `MemoryObjectStore` به storage افزوده و خودآزمون شد. اتصالِ end-to-end در فاز ۷. `pnpm verify` سبز.

### گام ۳٫۳ — لایه‌ی دامنه‌ی `AssetService` (پورتِ ۳) — ✅ منطق + DTO کامل (۱۴۰۵/۰۵/۲۸)؛ HTTP/DB → فاز ۵

> ★ **مرزِ «الان» در برابر «فاز ۵»** (تاییدِ مالک ۱۴۰۵/۰۵/۲۸): منطق + DTO الان و روی MinIO تست شد؛
> endpointهای HTTP و ساختِ `apps/api` به فاز ۵ (بدونِ اسکلتِ نصفه). خانه‌ی منطق: **`packages/assets`ِ
> جدا** که **مصرف‌کننده‌ی** storage است نه بخشی از آن ([ADR-029](ARCHITECTURE_DECISIONS.md#adr-029)) —
> تا storage نازک بمانَد (تناظرِ `canvas-sync`↔`ydoc-schema`؛ نشتِ export/pg_dumpِ M5 را می‌بندد).

**✅ الان ساخته و روی MinIO تست شد:**
- [x] **DTOهای shared-types** (تاییدِ ADR-021، ۱۴۰۵/۰۵/۲۸): `assetPresignRequest` (`{mimeType, sizeBytes,
      sha256}`) و `assetPresignResponse` (`{fileId, url, fields}`). `HbAsset`/`HB_ALLOWED_IMAGE_MIME` **بازاستفاده**.
- [x] **`packages/assets` — `createAssetService`:** `presign` (اعتبار + کلیدِ `teams/<t>/boards/<b>/` +
      presigned POST)، `validateUploaded`، `resolve` (presignGet)، و `sniffMime` (magic-bytes).
- [x] ★★ **`validateUploaded` sha256 را مستقلاً روی بایت‌های واقعی بازمحاسبه و با ادعا مقایسه می‌کند** —
      به کلاینت اعتماد نمی‌شود (قیدِ مالک ۱۴۰۵/۰۵/۲۸). نوعِ واقعی با **sniff**، اندازه با **headObject**.
- [x] ★ **`uploadedBy`/`teamId`/`boardId` از `ctx` (توکن)، نه بدنه‌ی کلاینت** — ساختاری در `presign(req, ctx)`.
- [x] ★ **گیتِ P4 `assetsBoundaries` خودآزمون:** برخلافِ storage، `@aws-sdk` **ممنوع** (به S3 فقط از راهِ
      storage). با شکستنِ عمدی (برداشتنِ `@aws-sdk` از forbid) **۴ تست قرمز** شد، بعد revert سبز.
- [x] **مکانیزم = POST-policy** ([ADR-044](ARCHITECTURE_DECISIONS.md#adr-044))؛ `ensureBucket` به storage
      افزوده شد (ادمینِ باکت برای smoke، **بیرونِ** interfaceِ نازکِ `ObjectStore`).
- **معیار پذیرش:** ✅ `pnpm assets:smoke` روی MinIO (۶ سبز): presign → آپلودِ POSTِ واقعی → validateUploaded →
      resolve؛ + امنیت: sha256ِ اعلامیِ غلط **رد**، آپلودِ بزرگ‌تر از declared را **خودِ MinIO رد** (۴۰۰).
      unit (۲۰ سبز: sniff + service). `pnpm verify` سبز.

**⛔ به فاز ۵ (`apps/api`) موکول شد:**
- [ ] endpointهای HTTP: `POST /assets/presign`، `/commit` (مصرفِ `validateUploaded` + **ثبتِ رکورد**)،
      `GET /assets/:id` (۳۰۲ به `resolve`).
- [ ] جدولِ `files` + migration + دی‌دوپِ `sha256`ِ سطحِ تیم + `UPLOAD_MAX_BYTES` در config + سیم‌کشیِ `ctx` از توکن.
- [ ] `w`/`h` (decoder — نمایشی نه امنیتی، مالک موکول کرد) + minio-init (۳ باکت).
- [ ] `resolve()`ِ سمتِ کلاینت **هرگز reject نمی‌کند** (فاز ۸/۶) — فایلِ گمشده کلِ بورد را نمی‌شکند.

---

## فاز ۴ — `packages/auth-core` — ✅ کامل (۱۴۰۵/۰۵/۲۸)

> منطقِ خالص + پورت؛ **پیاده‌سازیِ DBِ پورت‌ها (`BoardAccessReader`/`SessionStore`/`OtpStore`) +
> endpointها = فاز ۵.** جزئیات + دو گیتِ اثبات‌شده (exp، reuse) در [`PROGRESS-M3`](PROGRESS-M3-backend-api.md)
> §فاز ۴. ۴۳ تست. `pnpm verify` سبز.

### گام ۴٫۱ — JWT + refresh چرخشی ([ADR-011](ARCHITECTURE_DECISIONS.md#adr-011)) — ✅
- [x] `signAccessToken`/`verifyAccessToken` (JWT ۱۵دقیقه) + `signRtToken`/`verifyRtToken`؛ refreshِ مات با
      **rotation + reuse detection** (`refresh.ts`، پشتِ پورتِ `SessionStore`؛ استفاده‌ی دوباره کلِ خانواده را می‌سوزاند).
- [x] سه حمله‌ی JWT (`alg:none`، امضای اشتباه، `exp`) روی نسخه‌ی محصولی (jose) — به‌علاوه‌ی ★★ **exp-in-ms**.
- **معیار پذیرش:** ✅ تستِ reuse (با شکستنِ عمدی قرمز شد)؛ حمله‌ها سبز؛ access در حافظه — قید در sdk/web (فاز ۶/۸).
      ⚠️ اتمی‌بودنِ rotate در تراکنشِ DB = فاز ۵.

### گام ۴٫۲ — `effectiveBoardRole` — تنها پیاده‌سازیِ مشترک ([ADR-012](ARCHITECTURE_DECISIONS.md#adr-012)) — ✅
- [x] `effectiveBoardRole(input)` در `roles.ts` — تابعِ خالص؛ api و realtime (فاز ۷) از همین یکی مصرف می‌کنند.
- [x] ★ `undefined`≠`null` حفظ شد — auth-core همیشه نظر دارد (`currentRole` هرگز `undefined` نمی‌دهد).
- [x] ✅ **OD-1 بسته (مالک ۱۴۰۵/۰۵/۲۸):** `access_mode='team'` → owner/admin/member→editor، guest→viewer.
      گیتینگ: مسیرِ تیم فقط `team`؛ `private` فقط مالک+board_members+staff؛ لینک → مسیرِ تیم خاموش. امضای تابع
      `access_mode` را می‌گیرد. ⚠️ **OD-3** (PROGRESS + کامنتِ کد): `member→editor` فقط تا وقتی عضویت عمدی است.
- **معیار پذیرش:** ✅ جدولِ تصمیمِ اجراشدنی (staff/owner/direct/team-gated/link + max + fail-closed)؛ تستِ همان‌ماژول در فاز ۷.

### گام ۴٫۳ — `AuthCoreBoardAuthority` (جایگزینِ `DevBoardAuthority` — پورتِ ۱) — ✅
- [x] `createAuthCoreBoardAuthority`: `verify(token, boardId)` + ★ `currentRole(sub, boardId)` که **نقشِ
      همین‌حالا** را می‌دهد via `effectiveBoardRole` + پورتِ `BoardAccessReader` (نه claimِ توکن).
- [x] ★★ **قفلِ probe ۱٫۳ (سه سد):** claim از schemaِ `shared-types`؛ **یک** signer (exp از ثانیه)؛ و **سقفِ
      آینده** (`exp-now > 2×TTL` → رد). ✅ تستِ «exp-in-ms → رد» با شکستنِ عمدی قرمز شد؛ probeِ jose لزومش را نشان داد.
- [x] ★ `developmentOnly=false` — production بالا می‌آید. ⚠️ گیتِ `assertAuthorityUsable`ِ realtime هنگامِ تزریق (فاز ۷).
- **معیار پذیرش:** ✅ تستِ نقشِ عوض‌شده از `currentRole`؛ `null`≠`undefined`؛ گیتِ production در فاز ۷ (تزریقِ واقعی).

### گام ۴٫۴ — OTP + درگاهِ پیامک ([ADR-011](ARCHITECTURE_DECISIONS.md#adr-011)) — ✅
- [x] `requestOtp`/`verifyOtp` (`otp.ts`، پشتِ پورتِ `OtpStore`): کد **hash** (هرگز plaintext)، `maxAttempts`،
      انقضا، cooldown، تطبیقِ زمان‌ثابت. `SmsProvider` + `createMockSmsProvider`؛ سوییچِ کاوه‌نگار = فاز ۵. `fixedCode` برای dev.
- [x] ★ P7: `maskPhone`؛ کد هرگز لاگ نمی‌شود (تنها به `SmsProvider.send`). تست ثابت می‌کند خام در رکورد نیست.
- **معیار پذیرش:** ✅ جریانِ mock در تست (۹ تست)؛ ضدِ enumeration (`requestOtp` همیشه موفق، cooldown بی‌صدا)؛
      `RATE_LIMIT_OTP_*` + endpointِ `otp/request` = فاز ۵.

---

## فاز ۵ — `apps/api` (Fastify) (تخمین: ۴–۶ روز)

### گام ۵٫۱ — اسکلتِ اپ + پلاگین‌ها + migration
- [~] (۵٫۱-buildApp، ۱۴۰۵/۰۵/۳۱ — پایه ✅: `buildApp` تزریق‌پذیر، `db`+کوئرسِ int8/P5 روی pg خام، redactor/P7، خطای یکسان،
      `/healthz`+`/readyz`، ۸ تست + دو خط‌قرمزِ خودآزمون. **مانده:** `redis`/`s3`/`auth-guard`/`rate-limit`)
      `buildApp()` تست‌پذیر (بدونِ `listen`)؛ پلاگین‌ها: `db` (Kysely+pg، کوئرسِ int8)،
      `redis`، `s3` (از `packages/storage`)، `auth-guard`، `rate-limit`، `request-id`،
      `error` (قالبِ خطای §۵ با `code`/`requestId`)؛ pino + redactorِ P7.
- [x] ✅ (۵٫۱، ۱۴۰۵/۰۵/۳۱) migrationِ `0001_init.sql` — **کلِ schemaی [PLAN §۶](PLAN.md)** (users، auth_sessions،
      otp_challenges، teams، team_members، team_invites، folders، boards، board_members،
      board_favorites، files، templates، comment_threads، comments، board_versions،
      plans، subscriptions، coupons، invoices، payments، usage_counters، audit_logs،
      sms_logs، export_jobs، feature_flags). با اجراکننده‌ی checksumِ M2.
- [x] ✅ (۵٫۱، ۱۴۰۵/۰۵/۳۱ — CASCADE + origin_user→SET NULL، روی DBِ تازه `\d` تایید) **موردِ به‌ارث‌رسیده‌ی ۱ (handoff §۳):** حالا که `boards` ساخته شد، دو FK با
      `ALTER TABLE` اضافه شود: `board_updates.board_id → boards(id)` و
      `board_snapshots.board_id → boards(id)` (در M2 عمداً بدونِ FK ماندند چون `boards`
      نبود). یک migrationِ جدا (نه ویرایشِ `0001_realtime_documents.sql`ی M2).
      ⚠️ **دو نکته‌ی ترتیب (نکته‌ی مالک ۱۴۰۵/۰۵/۲۴):** (۱) FK **بعد از** `CREATE TABLE boards`
      می‌آید — پس در انتهای `0001_init.sql` یا یک migrationِ بعدیِ api. (۲) جدول‌های
      `board_updates`/`board_snapshots` را migrationِ **infra**ی M2 ساخته (`infra/sql/migrations`)،
      پس این `ALTER` به اجرای آن **وابسته** است: روی دیتابیسِ تازه اول `pnpm db:migrate` (infra)
      بعد `migrate:up`ی api. **مالکِ FK-ALTER و ترتیبِ دو-رانر را همین‌جا صریح کن** (یا یک رانرِ واحد).
- **معیار پذیرش:** `pnpm --filter @hamboom/api migrate:up` روی دیتابیسِ واقعی (پورتِ
      **۵۴۳۳** روی این ماشین — CLAUDE.md)؛ `\d board_updates` دو FK را نشان می‌دهد؛
      `/healthz`/`/readyz` سبز؛ یک تستِ integrationِ Fastify سبز.

### گام ۵٫۲ — احراز هویت + کاربر
- [ ] `/auth/otp/request`، `/auth/otp/verify` (→ `{accessToken, user, isNewUser}` + cookie
      refresh)، `/auth/refresh` (rotation + reuse)، `/auth/logout`، `/auth/sessions`؛
      `/me`، `PATCH /me`، `/me/avatar` (presign). ورک‌اسپیسِ شخصی خودکار ساخته شود
      (`is_personal`).
- **معیار پذیرش:** تستِ end-to-endِ ثبت‌نام→توکن؛ reuse detection؛ refresh در cookie با
      `HttpOnly; Secure; SameSite=Lax`؛ audit_log برای ورود.

### گام ۵٫۳ — تیم و عضویت
- [ ] `/teams` (CRUD)، `/teams/:id/members` (+`PATCH role`، حذف)، `/teams/:id/invites`
      (+پذیرش با `/invites/:token/accept`)، `/folders`. نقش‌های `owner|admin|member|guest`.
- **معیار پذیرش:** ماتریسِ نقش (که کی چه می‌تواند)؛ دعوت با mock پیامک/ایمیل؛ حذفِ نرمِ
      تیم با دوره‌ی بازیابی.

### گام ۵٫۴ — بورد + دسترسی + ★ endpointِ `rt-token` (پورتِ ۴)
- [ ] `/boards` (لیست/جستجوی `pg_trgm`/فولدر/favorite/cursor)، `POST /boards`
      (+`templateId`)، `GET /boards/:id` (متادیتا + `myRole`)، `PATCH`/`DELETE`/`restore`/
      `duplicate`/`favorite`، `/boards/:id/access` (حالت‌های اشتراک + `linkToken`)،
      `POST /public/boards/resolve`.
- [ ] ★★ **`GET /boards/:id/rt-token`** — JWTِ ۶۰ثانیه‌ای با `{sub, boardId, role, exp}`
      از `effectiveBoardRole`. این پورتِ چهارم است. کلاینت برای **هر تلاشِ اتصال** یکی
      تازه می‌سازد ([ADR-039](ARCHITECTURE_DECISIONS.md#adr-039)).
- [ ] `GET /boards/:id/snapshot` (octet-stream، بوتِ سریع از `board_snapshots`).
- [ ] ★★ **یافته‌ی M2 شماره ۱ (handoff §۴):** خطای «شکلِ» `boardId` کدِ خودش را داشته
      باشد — `board_id` نوعِ `uuid` است و ورودیِ بدشکل نباید `FORBIDDEN`ِ گنگ بدهد. یک
      کدِ خطای صریح در enum (فاز ۲) + اعتبارسنجیِ UUID در api **و** پیامِ بهترِ realtime
      (فاز ۷).
- **معیار پذیرش:** rt-token ساخته‌شده روی سرورِ realtimeِ واقعی وصل می‌شود (تکرارِ probe
      ۱٫۳ روی مسیرِ محصولی)؛ توکنِ بوردِ دیگر رد؛ جستجوی فارسیِ عنوان کار می‌کند؛ `boardId`ِ
      بدشکل کدِ **خودش** را می‌گیرد نه `FORBIDDEN`.

### گام ۵٫۵ — OpenAPI + محدودیت‌ها
- [ ] schemaهای zod → OpenAPI 3.1 → `docs/api.md` + `/api/v1/docs`؛ rate-limitِ سراسری/OTP؛
      `Idempotency-Key` روی POSTهای ساختِ منبع.
- **معیار پذیرش:** OpenAPI معتبر تولید می‌شود؛ rate-limit با تستِ عبور از سقف **قرمز** می‌دهد.

---

## فاز ۶ — `packages/sdk` (تخمین: ۱ روز)

### گام ۶٫۱ — کلاینتِ typed از `shared-types`
- [ ] fetchِ typed روی همه‌ی endpointها؛ قالبِ خطای §۵؛ صفحه‌بندیِ cursor؛ نگه‌داشتنِ
      access در حافظه + refreshِ خودکار روی ۴۰۱؛ `canvas-core → sdk ❌` (قاعده‌ی PLAN §۲).
- **معیار پذیرش:** یک تستِ قراردادی که sdk را در برابرِ `buildApp()`ِ واقعی (نه mock)
      می‌زند؛ typeها از shared-types می‌آیند، نه تعریفِ موازی؛ `license:check` سبز.

---

## فاز ۷ — اتصالِ `apps/realtime` به پورت‌های واقعی (تخمین: ۱–۲ روز)

> ⚠️ **دامنه‌ی حساس:** این فاز به `apps/realtime` دست می‌زند (M2). فقط **تزریقِ
> پیاده‌سازی** است، نه تغییرِ منطقِ اتاق/پایداری/خوشه — همان مرزی که ADR-031 گذاشت.

### گام ۷٫۱ — تزریقِ `AuthCoreBoardAuthority` + `StorageSnapshotStore`
- [ ] `DevBoardAuthority` و `FsSnapshotStore` با نسخه‌های واقعی جایگزین شوند (تزریق در
      `main.ts`/سیم‌کشی). سه تستِ حمله‌ی JWT به `auth-core` منتقل/تکرار شوند، بعد dev-impl
      حذف شود.
- [ ] گیتِ production: با auth-core، `APP_ENV=production` باید **بالا بیاید** (برعکسِ M2).
- **معیار پذیرش:** سرور با پورت‌های واقعی بالا می‌آید؛ dev-impl حذف شده و تست‌هایش زنده‌اند.

### گام ۷٫۲ — ★★ اجرای دوباره‌ی **هر هفت سنجه‌ی زنده** روی پورت‌های واقعی
- [ ] `pnpm rt:durability · rt:compaction · rt:permission · rt:presence · rt:cluster ·
      rt:shutdown · rt:reconnect` — همه سبز، این‌بار با auth **و** storageِ واقعی. (CLAUDE.md:
      «باگِ گام ۴٫۶ را سنجه‌ی گام ۴٫۴ گرفت» — هر هفت با هم.)
- [ ] `pnpm rt:bench` دوباره؛ عددِ حافظه ورودیِ فاز ۱۱.
- **معیار پذیرش:** هفت سنجه سبز؛ **و** هرکدام با یک شکستنِ عمدی (مثلاً storageی که ناقص
      می‌نویسد) هنوز **قرمز** می‌شود — گیت ضعیف نشده.

---

## فاز ۸ — `apps/web`: احراز → داشبورد → پوسته‌ی بورد (تخمین: ۴–۶ روز)

> ★ **این «لایه‌ی بورد/تیم/احراز هویت» است که نوار ابزار بعدش می‌آید.**

### گام ۸٫۱ — اسکلت + RTL + فونت
- [ ] React 19 + Vite + TS + TanStack Router؛ `<html dir="rtl" lang="fa">`؛ **فقط logical
      properties** ([ADR-016](ARCHITECTURE_DECISIONS.md#adr-016))؛ Vazirmatn **خودمیزبان** با
      `document.fonts.ready` gate قبل از رندرِ بوم ([ADR-017](ARCHITECTURE_DECISIONS.md#adr-017))؛
      QueryClient، error boundary، تم.
- **معیار پذیرش:** `pnpm dev` اپ را بالا می‌آورد؛ Stylelintِ داخلِ verify روی `apps/web/**/*.css`
      یک propertyِ فیزیکیِ عمدی را **قرمز** می‌کند؛ فونت بدونِ درخواستِ خارجی لود می‌شود (P2).

### گام ۸٫۲ — احراز هویت (UI)
- [ ] صفحاتِ شماره موبایل/OTP/refresh؛ access در **حافظه** (نه localStorage)؛ از `sdk`.
- **معیار پذیرش:** ورودِ کاملِ mock در مرورگر؛ رفرشِ صفحه session را از cookie برمی‌گرداند.

### گام ۸٫۳ — داشبورد + تیم (UI)
- [ ] لیستِ تیم/بورد/فولدر/جستجو/favorite/سطلِ بازیافت؛ صفحه‌ی اعضا/دعوت/نقش.
- **معیار پذیرش:** ساختِ بورد → باز شدن؛ تغییرِ نقشِ عضو در UI بازتاب می‌یابد.

### گام ۸٫۴ — ★ پوسته‌ی بورد: اتصالِ `canvas-sync` به سرورِ واقعی
- [ ] `/b/:boardId` → `GET /boards/:id` + `rt-token` → mountِ `HamboomCanvas` +
      `YjsSyncAdapter` با ترابریِ WebSocketِ محصولی و `createIndexeddbDocStore`.
- [ ] ★ **الگوی StrictMode-safe** (ADR-032): `useEffect([api])` با cleanup، **نه** اشتراک
      در `onReady`. نگهبانش `canvas-sync/e2e/strictmode.spec.ts`.
- [ ] ★ **`bindUndoShortcuts`** (ADR-035) وصل شود.
- [ ] ★ **fail-closed**: نقشِ ناشناخته → `viewer`؛ `token()` برای **هر تلاش** تازه ساخته
      شود؛ `undefined`/`null` قاطی نشوند.
- [ ] `user`ِ **واقعی** روی کانالِ حضور؛ `permissions.ts` فقط **advisory** است (گیتِ
      واقعی سرور است).
- [ ] ⚠️ **پیام‌های فارسیِ کلاینت** (handoff §۲): امروز درون‌خطی‌اند (مثلِ `TOO_OLD_MESSAGE`).
      تصمیم: به `packages/i18n` بروند یا بمانند؟ (یک تصمیمِ کوچک + ثبت).
- **معیار پذیرش:** دو تبِ مرورگر روی یک بورد با **توکنِ واقعی و مجوزِ واقعی** همگام
      می‌شوند؛ `viewer` نمی‌تواند بنویسد (سرور رد می‌کند)؛ `Ctrl+Z` فقط کارِ خود کاربر و
      **یک بار**؛ StrictMode اشتراک را نمی‌کُشد.

### گام ۸٫۵ — ★ رفعِ سه یافته‌ی M2 (M3-D4) — ⚠️ **هر سه `[!]`، تک‌تک تایید می‌شوند**
> ⚠️ **قاعده‌ی این گام (تصمیمِ مالک ۱۴۰۵/۰۵/۲۴):** اجازه‌ی کلیِ دست‌زدن به M1/M2 **وجود
> ندارد**. برای **هر** یافته، اول گزینه‌ها و هزینه‌اش را بیاور و **متوقف شو تا تایید**؛ بعد
> اعمال کن و مثلِ B-1 در PROGRESS ثبت کن.
- [!] **یافته‌ی ۳ (handoff §۴):** تبدیلِ **پیکسل→صحنه** از `canvas-core` صادر شود و
      `HamboomCanvas` `onPointerUpdate`ِ موتور را پاس دهد — تا دو نسخه از یک فرمول نداشته
      باشیم (ADR-024). **قبلش تصمیم/ADR + تاییدِ مالک.**
- [!] **یافته‌ی ۴ (handoff §۴):** ویرایشگرِ متنِ موتور تا باز است درجِ همتا را **پاک**
      می‌کند (>۳۰۰۰ms = هرگز). رفعش کارِ M3 است؛ محدودیتِ موتور است نه دیف.
- [!] **یافته‌ی ۲ (handoff §۴):** `createBoardDoc()` روی سندِ بازیابی‌شده از IndexedDB
      یک opِ `meta.schemaVersion` تازه می‌نویسد → فقط برای بوردِ **واقعاً نو** صدا زده شود.
- **معیار پذیرش:** هر سه با تستِ E2E/واحد قفل شوند؛ هیچ‌کدام بدونِ تاییدِ صریحِ مالک روی
      M1/M2 اعمال نشود؛ هر تغییرِ M1/M2 در PROGRESS ثبت شود (مثلِ B-1 در M2).

---

## فاز ۹ — ★ نوار ابزارِ عمودیِ جمع‌وجورِ شبیه‌میرو (تخمین: ۲–۳ روز)

> **بعد از فاز ۸ (قیدِ صریحِ مالک).** روی بومِ واقعاً وصل‌شده معنا دارد.

### گام ۹٫۱ — نوار ابزار
- [ ] نوارِ عمودیِ فشرده (RTL، logical properties): انتخاب/استیکی/شکل/متن/کانکتور/فریم/
      تصویر/قلم/سنجاقِ کامنت/لیزر — گروه‌بندی‌شده، با پالتِ استیکیِ ۱۲رنگه (PLAN §۷٫۳)؛
      میان‌برهای صفحه‌کلید؛ **ابزارِ فعال در کانالِ حضور** بازتاب یابد.
- [ ] ★ P6: مختصاتِ بوم **آینه نمی‌شود** — نوار ابزار و منطقِ نقشه‌ی ابزار این را صریح نگه دارند.
- [ ] از ابزارهای `canvas-core` استفاده کن، از نو نساز (ADR-024).
- **معیار پذیرش:** در دو مرورگرِ همگام: از نوار ابزار یک **استیکیِ فارسی** ساخته شود، یک
      **کانکتور** کشیده شود، یک **فریم** درست شود — همه دیده و همگام شوند؛ ابزارِ فعالِ
      همتا نمایش داده شود؛ Stylelint هیچ propertyِ فیزیکی نگیرد.

---

## فاز ۱۰ — ⛔ به تعویق (بیرونِ M3 — تصمیمِ M3-D1) — قالب/کامنت/نسخه/خروجی

> **به دورِ بعد موکول شد (۱۴۰۵/۰۵/۲۴).** گام‌هایش اجرا **نمی‌شوند** و اینجا فقط برای مرجع
> و ثبت در `m4-handoff.md` می‌مانند. اگر مالک دوباره واردِ دامنه‌ی M3 کرد، از همین‌جا.

### گام ۱۰٫۱ — قالب‌ها
- [ ] `/templates` (لیست/دسته/جستجو)؛ `POST /boards` با `templateId` (کپیِ اولیه از
      `board_snapshots`)؛ ۸–۱۰ قالبِ فارسیِ اولیه.
- **معیار پذیرش:** ساختِ بورد از قالب، محتوای اولیه درست لود می‌شود.

### گام ۱۰٫۲ — کامنت + mention (مقصدِ M3-D2b)
- [ ] `comment_threads`/`comments`؛ سنجاق روی بوم (`commentPins`ِ سند) ↔ متن در Postgres؛
      `@mention`. اگر M3-D2b تایید شد، `CommentPin` از shared-types می‌آید.
- **معیار پذیرش:** سنجاق روی بوم با کامنتِ Postgres همگام؛ mention کار می‌کند.

### گام ۱۰٫۳ — نسخه‌ها
- [ ] `board_versions` (خودکار + نام‌گذاری‌شده)؛ `restore` که خودش یک نسخه‌ی جدید می‌سازد.
- **معیار پذیرش:** ثبت و بازگردانیِ نسخه، بدونِ از دست رفتنِ داده.

### گام ۱۰٫۴ — خروجی (مشروط به M3-D5)
- [ ] SVG/JSON مستقیم از سند (بدونِ مرورگر). PNG/PDF **فقط اگر** worker در دامنه باشد
      (Chromium، ADR-019) — وگرنه به M4/M5.
- **معیار پذیرش:** SVG/JSON معتبر تولید می‌شود؛ PNG/PDF یا کار می‌کند یا صریحاً به تعویق
      ثبت شده.

---

## فاز ۱۱ — ظرفیت + سخت‌سازی + تحویل (تخمین: ۲–۳ روز)

### گام ۱۱٫۱ — ★★ سقفِ حافظه → فاز ۳ی ADR-006 (room affinity)
- [ ] بر اساسِ عددِ **۷۶MB/بوردِ ۵۰۰۰عنصری** ([realtime-baseline.md](docs/realtime-baseline.md))،
      برنامه‌ریزیِ ظرفیت از **حافظه** شروع شود، نه تعدادِ اتاق. فازِ ۳ی
      [ADR-006](ARCHITECTURE_DECISIONS.md#adr-006) (room affinity با hashing) که در M2 عمداً
      ساخته نشد — «حالا عددش هست». تصمیم: پیاده یا ثبتِ trigger؟
- **معیار پذیرش:** یا پیاده‌سازیِ affinity با سنجه، یا یک ADR که آستانه‌ی فعال‌سازی و علتِ
      تعویق را با **عدد** ثبت می‌کند (نه «بعداً»).

### گام ۱۱٫۲ — نقطه‌ی ادغام (smoke کامل) + تحویلِ M4
- [ ] یک session معمولی (نه loop): ورود با OTP → ساختِ تیم/بورد → دو مرورگر با **توکن و
      مجوزِ واقعی** همگام → آپلودِ تصویر از راهِ storageِ واقعی → نوار ابزار.
- [ ] README برای `api`/`auth-core`/`storage`/`sdk`/`web`؛ `PROGRESS-M3` نهایی؛
      `docs/m4-handoff.md` (نقطه‌ی ورودِ **billing** — مدلِ team/subscription که M4 رویش سوار
      است) — و در آن **ارثیه‌های به‌تعویق‌افتاده** ثبت شوند: فاز ۱۰ (قالب/کامنت/نسخه/خروجی)،
      `CommentPin`، `apps/worker`.
- [ ] `pnpm verify` سبز (شاملِ typecheck/lint/CSS/test/coverage/license)؛ هر ۷ سنجه سبز.
- **معیار پذیرش:** سناریوی کامل در مرورگرِ واقعی کار می‌کند؛ verify سبز؛ `m4-handoff.md`
      مثلِ `m3-handoff.md` خودکفا است.

---

## چیزهایی که M3 عمداً **نمی‌کند**

- **پرداخت/اشتراک/فاکتور** = M4 (جدولِ plans/subscriptions/payments در schema هست، منطقش نه).
- **پنل ادمینِ پلتفرم** (`apps/admin`) = M6.
- **فازِ کاملِ زیرساخت** (Dockerfile production، K8s، CI/CD، Prometheus/Grafana) = M5.
- **`apps/worker`** (خروجیِ Chromium، thumbnail، snapshot-compactِ جدا — که M2 در سرور
      انجامش داد) = **بعد از M3** (M3-D5).
- **قالب/کامنت/نسخه/خروجی** (فاز ۱۰) = **به تعویق** (M3-D1)؛ در `m4-handoff.md` ارثیه ثبت می‌شود.
- **تغییرِ منطقِ اتاق/پایداری/خوشه‌ی M2** — فاز ۷ فقط پورت تزریق می‌کند.
