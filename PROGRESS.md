# PROGRESS — realtime-sync

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۵/۱۲ (2026-08-04)
**گام فعلی: ۰٫۱ و ۰٫۲ تمام ✅ — ۰٫۳ ساخته شد ولی تاییدِ زنده‌اش بلوکه است (پایین).**
**بعدی: رفعِ بلوکِ محیطی، سپس فاز ۱ (گام ۱٫۱ — دروازه).**

M1 (`canvas-core`) تحویل و push شد. این ماژول M2 است. تاریخچه‌ی M1 در
[PROGRESS-M1-canvas-core.md](PROGRESS-M1-canvas-core.md) و [TODO-M1-canvas-core.md](TODO-M1-canvas-core.md)
بایگانی است — **قبل از هر تصمیمی درباره‌ی رفتارِ موتور، جدولِ تله‌های
[`canvas-core/CLAUDE.md`](packages/canvas-core/CLAUDE.md) را بخوان.**

---

## انجام شد

### برنامه‌ریزیِ M2 (۱۴۰۵/۰۵/۱۲)

- **[TODO.md](TODO.md) نوشته شد** — ۶ فاز، ۳۰ گام، هر گام با معیارِ پذیرشِ قابل‌سنجش.
  ترتیب: اسکلت → **سه probeِ ریسک** → `ydoc-schema` → binder → سرور → تاب‌آوری → تحویل.
  دلیلِ ترتیب در خودِ فایل: **binder قبل از سرور** آزمودنی است (دو `Y.Doc` مستقیم، بدون شبکه)،
  پس هیچ باگی پشتِ لایه‌ی شبکه پنهان نمی‌شود.
- **کشفِ مهم حین برنامه‌ریزی:** PLAN فرض کرده بود M2 بعد از M3 و M5 می‌آید، ولی **هیچ‌کدام
  ساخته نشده‌اند** — نه `apps/`، نه `infra/`، نه `packages/{config,auth-core,storage}`.
  یعنی `rt-token`، `effectiveBoardRole` (ADR-012) و Object Storage برای snapshot (ADR-009)
  وجود ندارند. این مرزِ M2 را عوض کرد و به تصمیم‌های D-1..D-5 انجامید.
- **دو ناسازگاری در خودِ اسناد پیدا شد** (نه در کد) و هر دو به گام تبدیل شدند:
  - PLAN بخش ۸ binder را در `ydoc-schema` می‌گذارد، ولی PLAN بخش ۲ می‌گوید
    `ydoc-schema → canvas-core ❌`. → [ADR-029](ARCHITECTURE_DECISIONS.md#adr-029)
  - PLAN بخش ۷٫۳ متن را `Y.Text` می‌خواهد، `shared-types` نوشته `text: z.string()`.
    → با نظر حل نمی‌شود؛ **گام ۱٫۳** تجربی حلش می‌کند.

### گام ۰٫۱ — ثبتِ تصمیم‌های مرزی ✅

سه ADR نوشته شد. هیچ کدی در این گام نوشته نشد (عمدی — دروازه‌ی فاز ۰).

| ADR | تصمیم | نکته‌ی کلیدی |
|---|---|---|
| [ADR-029](ARCHITECTURE_DECISIONS.md#adr-029) | `ydoc-schema` خالص + `canvas-sync` برای binder | `import type` رد شد چون هزینه‌اش در **typecheck و ضعیف‌شدنِ گیت** است، نه runtime |
| [ADR-030](ARCHITECTURE_DECISIONS.md#adr-030) | `ws` پشتِ یک seam | دلیل کارایی **نیست**: uWS خارج از npm نصب می‌شود (از گیتِ P1 رد می‌شود) و روی ویندوز P3 را می‌شکند |
| [ADR-031](ARCHITECTURE_DECISIONS.md#adr-031) | پورت‌های `BoardAuthority` و `SnapshotStore` | P4 با **ساخت** حفظ می‌شود نه با قول — M2 اصلاً SDK را نمی‌بیند |

**یک خطر که حین نوشتنِ ADR-031 بیرون آمد و در TODO نبود:** `DevBoardAuthority` یک پیاده‌سازیِ
توسعه است که هرکس `RT_DEV_JWT_SECRET` را بداند می‌تواند برای خودش نقشِ owner صادر کند. اگر
روزی در production زنده بماند، کلِ ADR-012 از پشت دور زده می‌شود. → **گیتِ runtime** به
گام ۴٫۱ اضافه شد: با `APP_ENV=production` سرور باید **بالا نیاید**، نه اینکه هشدار بدهد.

**در حاشیه رفع شد:** ADR-027 و ADR-028 در فهرستِ `ARCHITECTURE_DECISIONS.md` نبودند و
ADR-028 لنگرِ `<a id>` نداشت — یعنی همه‌ی لینک‌های `#adr-028` از PROGRESS/TODO/CLAUDE
شکسته بودند. هر دو درست شد.

### گام ۰٫۲ — اسکلت سه پکیج + گیتِ مرزها ✅

سه واحدِ ADR-029 ساخته شدند: `packages/ydoc-schema` (خالص)، `packages/canvas-sync`
(binder)، `apps/realtime` (سرور) — هر کدام با `CLAUDE.md`، Vitest، و تستِ دودی که
یک ادعای **معماری** می‌آزماید نه یک منطقِ محصولی (مثلاً: سرور می‌تواند `ydoc-schema`
را در Nodeِ خالص مصرف کند؛ `canvas-sync` نگهبانِ echo را از M1 **قرض می‌گیرد**).

**گیت‌های مرزی در منبعِ واحد** (`eslint-config/boundaries.js`) با **خودآزمونِ سه‌لایه**
(۵۰ تست در [`eslint-config/test/boundaries.test.js`](packages/eslint-config/test/boundaries.test.js)):

| لایه | چه چیزی را می‌گیرد | چرا لازم است |
|---|---|---|
| ۱ — الگوها | فهرستِ `forbid` روی خروجیِ **واقعیِ** factory | اگر فهرست عوض شود |
| ۲ — سیم‌کشی | lintِ واقعی روی `eslint.config.js`ِ خودِ پکیج | اگر factory صدا زده **نشود** یا `files` غلط باشد، لایه‌ی ۱ سبز می‌ماند و گیت عملاً وجود ندارد |
| ۳ — manifest | وابستگی‌های اعلام‌شده در `package.json` | گیتِ import فقط `src/` را می‌بیند؛ یک وابستگیِ ممنوعِ اعلام‌شده از چشمش می‌افتد |

**★ لایه‌ی ۲ همان اول یک باگ گرفت:** `apps/realtime/eslint.config.js` مستقیم `globals`
را import می‌کرد، ولی `globals` وابستگیِ `@hamboom/eslint-config` است نه اپ — زیر pnpm
resolve نمی‌شد و **`pnpm lint` آن اپ می‌شکست**. رفع: `nodeGlobals` از `eslint-config/base`
صادر می‌شود. **لایه‌ی ۱ این را نمی‌گرفت** — مصداقِ اینکه چرا هر دو لازم است.

**دو تصحیح نسبت به متنِ اولیه‌ی گام (هر دو در TODO ثبت شد):**

1. **`canvas-sync` فقط `import type` نیست.** گام ۳٫۱ باید `assertEmittable` را
   **به‌صورت مقدار** از M1 صدا بزند، وگرنه مجبور است نگهبانِ echo را از نو بنویسد —
   خلافِ ADR-024. یک تستِ `allowed` این را قفل کرد.
2. **`@hamboom/storage` و `@hamboom/auth-core` برای `apps/realtime` بسته نشدند.**
   ممنوعیت روی `@aws-sdk/*`ِ **خام** است. خودِ P4 مسیرِ `packages/storage` را تجویز
   می‌کند و ADR-012 صریحاً می‌خواهد realtime و API از **یک** `effectiveBoardRole`
   مشترک استفاده کنند؛ بستنشان یعنی بستنِ همان مسیری که ADR تجویز کرده.

**probeِ ثبت‌شده (خلافِ شهود):** در `no-restricted-imports` علامتِ `*` **از `/` عبور
می‌کند** — `@aws-sdk/*` زیرمسیرِ عمیق را هم می‌گیرد و ورودیِ بدونِ گلاب (`@hamboom/sdk`)
هم `@hamboom/sdk/client` را. پس الگوها ساده می‌مانند؛ افزودنِ `/**` زائد است. در
`boundaries.js` مستند و با تست pin شد تا کسی «اصلاحش» نکند.

**وابستگی‌ها:** `yjs` ۱۳٫۶٫۳۲ · `lib0` ۰٫۲٫۱۱۷ · `y-protocols` ۱٫۰٫۷ — هر سه MIT،
`license:check` سبز (۶۸۵ پکیج)، ثبت در `docs/dependencies.md`. **`uWebSockets.js`
افزوده نشد** (ADR-030)؛ `ws` در گام ۴٫۱ می‌آید.

### گام ۰٫۳ — برشِ حداقلیِ زیرساخت ⏳ ساخته شد، تاییدِ زنده بلوکه

ساخته شد: compose (فقط postgres+redis، با `docker compose config` اعتبارسنجی‌شده)،
`.env.example`، `packages/config` (zod، ترکیب‌پذیر، ۱۱ تست)، migrationِ SQL خام،
اجراکننده‌ی migration با **checksum**، و `scripts/db-smoke.ts`.

**دو تصمیمِ ریز که ارزش ثبت دارند:**

1. **`boards` ساخته نشد و FKها گذاشته نشد** (انحراف از PLAN بخش ۶، با دلیل): اگر M2
   خودش `CREATE TABLE boards` بزند، `0001_init.sql`ِ خودِ M3 بعداً روی جدولِ موجود
   می‌افتد و می‌شکند. M3 دو FK را با `ALTER TABLE` اضافه می‌کند → گام ۶٫۴.
2. **`db:smoke` اسکریپت است نه تستِ vitest**: اگر تست بود، یا `pnpm test` روی ماشینِ
   بدونِ داکر قرمز می‌شد یا خودش را skip می‌کرد — و skip یک **سبزِ دروغین** است.
3. **`.env.example` عمداً ناقص است**: فقط بخش‌هایی که الان مصرف‌کننده دارند. یک
   `.env.example` پر از متغیرِ SMTP و زرین‌پال برای اپ‌هایی که وجود ندارند، اولین
   چیزی است که از واقعیت واگرا می‌شود.

**★ تله‌ی جدید (اولین مصرف‌کننده‌ی Nodeِ خالصِ پروژه):** `canvas-core/CLAUDE.md`
پیش‌بینی کرده بود «اگر روزی یک مصرف‌کننده‌ی Node خالص اضافه شد…» — همان امروز شد.
Node برخلاف Vite پسوندِ importهای نسبی را حدس نمی‌زند و `ERR_MODULE_NOT_FOUND`
می‌دهد. رفع: `allowImportingTsExtensions` در چهار tsconfigِ M2 + ریشه، و پسوندِ `.ts`
صریح. در `packages/config/CLAUDE.md` مستند شد و از دو CLAUDE.mdِ دیگر به آن ارجاع داده شد.

### ⛔ بلوکِ محیطی (نه کدی) — تاییدِ زنده‌ی ۰٫۳

`pnpm db:up && pnpm db:migrate && pnpm db:smoke` هنوز اجرا نشده، به دو دلیل:

1. **daemonِ داکر بالا نیست** — CLI هست (Docker 29.6.2، Compose v5.3.1) و
   `docker compose config` سبز است، ولی `dockerDesktopLinuxEngine` در دسترس نیست.
2. ★ **پورت ۵۴۳۲ اشغال است** — یک **PostgreSQL 18 بومی** به‌عنوان سرویسِ ویندوز
   (`postgresql-x64-18`، PID 8140) روی همان پورت گوش می‌دهد. `pnpm db:migrate` واقعاً
   تا آن رسید و `auth_failed` گرفت (یعنی مسیرِ کد درست کار می‌کند، فقط دیتابیسِ
   اشتباهی است). با پیش‌فرضِ PLAN، `docker compose up -d` تعارضِ پورت می‌دهد.

**رفع پیشنهادی:** در `.env`ِ **محلی** (که gitignore است، نه `.env.example`)
`POSTGRES_PORT=5433` و `DATABASE_URL=...localhost:5433/hamboom`. compose از قبل
پارامتری است، پس هیچ تغییرِ کدی لازم نیست.

**آنچه با همین بلوک هم تایید شد:** مسیرِ «بدونِ داکر crash نکن» — `pnpm db:migrate`
روی `ECONNREFUSED` پیامِ فارسیِ صریح با دستورِ docker می‌دهد (در عمل دیده شد).

---

## تصمیم‌های گرفته‌شده

**پنج تصمیمِ مرزی — تاییدِ مالک ۱۴۰۵/۰۵/۱۲** (جدولِ کامل در صدرِ [TODO.md](TODO.md)):

| # | تصمیم |
|---|---|
| D-1 | M2 یک **برشِ حداقلی** از زیرساخت می‌سازد: compose فقط با postgres+redis، `.env.example`، `packages/config`. M5 بعداً کاملش می‌کند. |
| D-2 | پورتِ `BoardAuthority` + `DevBoardAuthority`. ★ **claimهای `rtToken` داخلِ پورت، نه `shared-types`.** |
| D-3 | پورتِ `SnapshotStore` + `FsSnapshotStore`. ★ گیتِ ESLintِ `@aws-sdk/*` و `@hamboom/sdk` باید **با `RuleTester` خودآزمون** باشد. |
| D-4 | `ws` به‌جای `uWebSockets.js`. |
| D-5 | پکیجِ سومِ `canvas-sync` برای binder. |

### ★ دو قیدِ فعال که تا پایانِ M2 باید رعایت شوند

۱. **M2 بدونِ هیچ تغییری در `shared-types` تمام می‌شود.** اگر جایی لازم شد، یعنی از تعریفِ
   تصمیم‌های تاییدشده خارج شده‌ایم → **توقف و پرسش از مالک**، نه ادامه دادن.
   - مسیرِ ممنوعِ مشخص در گام ۱٫۳: اگر دیفِ متن کافی نبود، **قرارداد را پهن نکن**
     (مثلاً `textDelta` در `ElementChangeSet`) — آن تغییرِ `shared-types` است.
۲. **گام ۱٫۱ (probeِ StrictMode): اگر شکست خورد، هیچ تغییری در `canvas-core` نده.** با
   **گزینه‌ها و هزینه‌ی هرکدام** برگرد، نه با یک راه‌حلِ آماده (قیدِ صریحِ مالک). سه گزینه‌ی
   نامزد از قبل در گام ۱٫۱ فهرست شده‌اند.

---

## بلوکه (نیاز به اقدام مالک)

- **تاییدِ زنده‌ی گام ۰٫۳** — بالا. دو مانعِ محیطی: daemonِ داکر پایین است، و
  PostgreSQL 18ِ بومی پورت ۵۴۳۲ را گرفته. **هیچ‌کدام باگِ کد نیست.**

---

## قدم بعدی

۱. **رفعِ بلوکِ محیطی و بستنِ ۰٫۳:** `pnpm db:up && pnpm db:migrate && pnpm db:smoke`.
۲. سپس **فاز ۱ — که دروازه است**: تا probeِ StrictMode (گام ۱٫۱) سبز نشود، هیچ خطی
   از binder نوشته نمی‌شود. اگر آن probe شکست خورد، **در `canvas-core` دست نبر** —
   با گزینه‌ها و هزینه‌شان برگرد پیش مالک (قیدِ بالا).

---

## وضعیت گیت‌ها

`pnpm typecheck` (۷/۷) · `pnpm lint` + `lint:root` (بدون خطا) · `pnpm test` (۸/۸ task،
۶۴۰ تست) · `pnpm license:check` (۶۹۹ پکیج، self-test ۱۷/۱۷) — همه سبز.

تست‌ها: ۴۷۴ canvas-core + ۴۴ shared-types + ۴۲ i18n (همه از M1، دست‌نخورده) +
۶۱ گیتِ مرزی + ۱۱ config + ۸ دودِ سه پکیجِ جدید.
E2E (۱۶ تستِ M1) اجرا نشد — چیزی در `canvas-core` تغییر نکرده.

**یک قرمزِ ثبت‌شده و بی‌ربط:** `pnpm format:check` روی `.claude/settings.local.json`
هشدار می‌دهد. فایل untracked و محلی است؛ ربطی به M2 ندارد و دست نزدم.
