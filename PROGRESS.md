# PROGRESS — realtime-sync

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۵/۱۲ (2026-08-03)
**گام فعلی: ۰٫۱ تمام شد ✅ — بعدی: ۰٫۲ (اسکلت سه پکیج + گیتِ مرزها).**

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

**گام ۰٫۲ — اسکلت سه پکیج + گیتِ مرزها:**

- `packages/ydoc-schema` (خالص: yjs + lib0 + shared-types)، `packages/canvas-sync`
  (binder)، `apps/realtime` (سرور) — هر سه با tsconfig/eslint مشترک، Vitest و `CLAUDE.md`.
- سه گیتِ ESLint **هر کدام با `RuleTester` خودآزمون + probeِ نقضِ واقعی در پکیج** — چون
  `RuleTester` فقط خودِ قاعده را می‌آزماید، نه سیم‌کشی‌اش به `eslint.config.js`ِ پکیج
  (در M1 هر دو لایه لازم شد).
- `pnpm license:check` بعد از افزودنِ `yjs`/`lib0`/`y-protocols` و ثبت در `docs/dependencies.md`.

بعدش ۰٫۳ (compose حداقلی + migration) و سپس **فاز ۱ — که دروازه است**: تا probeِ StrictMode
سبز نشود، هیچ خطی از binder نوشته نمی‌شود.

---

## وضعیت گیت‌ها

بدون تغییرِ کد در این session (فقط سند). آخرین اجرا: `typecheck` · `lint` · `test` سبز
(۵۶۰ تستِ واحد + ۱۶ E2E از M1، دست‌نخورده).
