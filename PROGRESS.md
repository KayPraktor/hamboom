# PROGRESS — realtime-sync

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۵/۱۲ (2026-08-04)
**گام فعلی: ۰٫۱ و ۰٫۲ تمام شدند ✅ — بعدی: ۰٫۳ (زیرساختِ لوکالِ حداقلی).**

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

## بلوکه (نیاز به تصمیم مالک)

- هیچ موردِ بازی نیست. (پنج تصمیمِ D-1..D-5 پاسخ گرفتند.)

---

## قدم بعدی

**گام ۰٫۳ — برشِ حداقلیِ زیرساخت (D-1):**

- `infra/docker/docker-compose.yml` با **فقط** postgres + redis (healthcheck، همان
  نام‌ها و متغیرهای PLAN بخش ۳ تا M5 بتواند ادامه‌اش دهد).
- `.env.example` (تنها منبعِ حقیقتِ نامِ متغیرها) + `packages/config` با zod —
  **تنها نقطه‌ی `process.env` در کل ریپو**، با خطای فارسیِ صریح روی متغیرِ گم‌شده.
- migrationِ SQL خامِ ترتیبی برای `board_updates` و `board_snapshots` (ADR-005).
- ⚠️ روی ویندوز تایید شود؛ و `pnpm dev` بدونِ داکر نباید crash کند — باید پیامِ
  صریحِ «دیتابیس بالا نیست» بدهد.

بعدش **فاز ۱ — که دروازه است**: تا probeِ StrictMode (گام ۱٫۱) سبز نشود، هیچ خطی از
binder نوشته نمی‌شود.

---

## وضعیت گیت‌ها

`pnpm typecheck` (۶/۶) · `pnpm lint` (بدون خطا) · `pnpm test` (۷/۷ task) ·
`pnpm license:check` (۶۸۵ پکیج، self-test ۱۷/۱۷) — همه سبز.
تست‌ها: ۵۶۰ از M1 (دست‌نخورده) + ۵۰ گیتِ مرزی + ۸ تستِ دودِ سه پکیجِ جدید.
E2E (۱۶ تستِ M1) در این گام اجرا نشد — چیزی در `canvas-core` تغییر نکرده.

**یک قرمزِ ثبت‌شده و بی‌ربط:** `pnpm format:check` روی `.claude/settings.local.json`
هشدار می‌دهد. فایل untracked و محلی است؛ ربطی به M2 ندارد و دست نزدم.
