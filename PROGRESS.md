# PROGRESS — canvas-core

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۴/۳۱ (2026-07-22)
گام فعلی: ۰٫۲ تمام شد → بعدی ۱٫۱ (شروع فاز ۱ — دروازه‌ی ریسک)

## انجام شد

**گام ۰٫۱ — اسکلت مونوریپو** (کامل، commit `d697903`)

- `pnpm-workspace.yaml` + `turbo.json` + `tsconfig.base.json` سخت‌گیرانه
- `packages/tsconfig` (۴ پیش‌تنظیم) و `packages/eslint-config` (۳ export)
- `scripts/license-check.ts` — گیت سه‌سطحی SPDX با `--self-test`
- `.gitignore`, `.editorconfig`, `.nvmrc`, prettier, `CLAUDE.md` ریشه
- `.gitattributes` با `eol=lf` (commit `767b15c`) — چون ریپو روی ویندوز توسعه
  و داخل کانتینر لینوکسی اجرا می‌شود و اسکریپت شل با CRLF می‌شکند

**گام ۰٫۲ — پکیج `canvas-core` و دمو** (کامل)

- `@hamboom/canvas-core` با نگاشت `exports` دومدخلی (`.` و `./sync`)
- ساختار `src/{engine,text,sync,elements,theme,tools,ui}/` — هرکدام با README مسئولیت
- اپ دموی Vite در `dev/` (root روی همان پوشه، ریشه‌ی پکیج تمیز می‌ماند)
- Vitest + jsdom + testing-library، ۶ تست دود سبز
- `CLAUDE.md` و `README.md` پکیج
- `.claude/launch.json` برای بالا آوردن دمو

**راستی‌آزمایی (همه اجرا شد):**

```
pnpm install       → ۴ پروژه، بدون خطا
pnpm typecheck     → tsc ریشه + turbo (canvas-core) سبز
pnpm lint          → سبز
pnpm test          → ۶/۶ سبز
pnpm format:check  → سبز
pnpm license:check → self-test ۱۷/۱۷ + همه‌ی پکیج‌ها مجاز
دموی مرورگر        → dir=rtl، lang=fa، «هم‌بوم» راست‌چین، بدون overflow افقی
probe مرز وابستگی  → import yjs و @hamboom/sdk هر دو خطا می‌دهند ✓
```

## تصمیم‌های گرفته‌شده (کاندید ADR)

**از گام ۰٫۱:**

1. **`license-check` سه‌سطحی** (ALLOWED / REVIEW / denied). سطح میانی لایسنس‌های
   شرط‌دار (MPL-2.0، LGPL، …) را وادار به ثبت صریح در `license-exceptions.json` می‌کند
   به‌جای رد خودکار — چون رد کامل بعداً به دور زدن گیت منجر می‌شود.
2. **گیت لایسنس `--self-test` دارد.** ۱۷ مورد SPDX در هر اجرا قبل از خود بررسی می‌دوند.
3. **prod خطا، dev هشدار** (مگر `--strict`) — ابزارهای build در محصول نهایی نمی‌روند.
4. **ESLint بدون type-checking فعلاً.** ارتقا به `recommendedTypeChecked` وقتی کدبیس
   پایدار شد، به‌عنوان ADR جدا.
5. **اسناد فارسی از prettier مستثنا.** هم‌ترازی ستون جدول برای RTL بدتر است.

**از گام ۰٫۲:**

6. **`canvas-core` یک پکیج JIT است** — `exports` مستقیم به `src/*.ts`، بدون build.
   همه‌ی مصرف‌کننده‌ها Vite هستند و خودشان transpile می‌کنند. الگوی internal package
   در Turborepo. اگر روزی مصرف‌کننده‌ی Node خالص اضافه شد، آن‌وقت build لازم می‌شود.
7. **دو فایل پیکربندی Vite جدا.** `vite.config.ts` با `root: dev/` برای دمو،
   `vitest.config.ts` با root پکیج برای تست. ادغامشان باعث می‌شود تست‌ها ریشه‌ی
   اشتباه بگیرند.
8. **`packages/tsconfig` خودبسنده است** — هیچ `extends` به بیرون پکیج، چون از
   طریق symlink پنپی‌ام مصرف می‌شود و مسیر نسبی به بیرون شکننده است. حالا
   `tsconfig.base.json` ریشه است که از آن extends می‌کند، نه برعکس.
9. **`vitest` بدون `globals`.** import صریح خواناتر است، ولی به‌ازایش cleanup
   باید دستی در `test/setup.ts` ثبت شود.
10. **`ENGINE_STAGE` در `src/index.ts`** پله‌ی ADR-003 را به‌صورت کد نگه می‌دارد و
    یک تست آن را چک می‌کند — تا عبور به fork نتواند بی‌سروصدا اتفاق بیفتد.

## بلوکه (نیاز به تصمیم مالک)

هیچ موردی. تصمیم‌های بیزینسی طبق توافق تا قبل از M4 معلق‌اند.

## قدم بعدی — فاز ۱، دروازه‌ی ریسک پروژه

**گام ۱٫۱:** نصب `@excalidraw/excalidraw` با نسخه‌ی **pin شده** (بدون `^` — تا patch های
احتمالی گام ۱٫۴ تصادفی نشکنند)، ثبت لایسنس در `docs/dependencies.md`، و یک wrapper
مینیمال `<HamboomCanvas />` در `src/engine/`.

**گام ۱٫۲:** فونت Vazirmatn خودمیزبان + gate اندازه‌گیری (`awaitFontsReady`).

**گام ۱٫۳ — مهم‌ترین گام ماژول:** spike متن فارسی. خروجی‌اش یک جدول ۶×۷ در
`docs/spike-persian-text.md` است و جمع‌بندی صریح «پله‌ی A کافی است» یا «باید به B برویم».
اگر نتیجه «فورک لازم است» شد، **متوقف شو و تایید مالک بگیر** — این تصمیم معماری است.

## پله‌ی فعلی ADR-003

**A — بسته‌ی npm.** `@excalidraw/excalidraw` هنوز نصب نشده (گام ۱٫۱)، هیچ patch و
هیچ فورکی وجود ندارد. مقدار در `packages/canvas-core/src/index.ts` → `ENGINE_STAGE`.
