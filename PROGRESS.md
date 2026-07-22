# PROGRESS — canvas-core

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۴/۳۱ (2026-07-22)
گام فعلی: ۰٫۱ تمام شد → بعدی ۰٫۲

## انجام شد

**گام ۰٫۱ — اسکلت مونوریپو (کامل، معیار پذیرش محقق):**

- `pnpm-workspace.yaml` (`apps/*`, `packages/*`) + `turbo.json` (۶ task با `^build`)
- `tsconfig.base.json` سخت‌گیرانه: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`,
  `verbatimModuleSyntax`, `moduleResolution: bundler`, `target: ES2022`
- `packages/tsconfig` — چهار پیش‌تنظیم: `base`, `node-app`, `react-lib`, `vite-app`
- `packages/eslint-config` — ESLint 9 flat config، سه export: `base`, `react`, `boundaries`
- `scripts/license-check.ts` + `scripts/license-exceptions.json` — گیت اصل P1
- `.gitignore`, `.editorconfig`, `.nvmrc`, `.prettierrc.json`, `.prettierignore`
- `git init -b main` (بدون commit — منتظر تصمیم مالک)
- `CLAUDE.md` ریشه

**راستی‌آزمایی (اجرا شد، همه سبز):**

```
pnpm install       → ۱۱۷ پکیج، بدون خطا
pnpm typecheck     → tsc روی scripts/ سبز + turbo سبز
pnpm lint:root     → exit 0
pnpm format:check  → All matched files use Prettier code style
pnpm license:check → self-test ۱۷/۱۷ سبز، ۱۹۶ پکیج همه مجاز
```

توزیع لایسنس درخت وابستگی فعلی: MIT ۱۴۴، Apache-2.0 ۲۴، BSD-2-Clause ۱۲، ISC ۱۱،
Python-2.0 ۲، BSD-3-Clause ۲، BlueOak-1.0.0 ۱ — هیچ موردی نیازمند استثنا نیست.

## تصمیم‌های گرفته‌شده (کاندید ADR — هنوز ثبت نشده‌اند چون سطحشان پیاده‌سازی است، نه معماری)

1. **`license-check` سه‌سطحی به‌جای allow/deny دوسطحی.** سطح میانی `REVIEW`
   (MPL-2.0، EPL-2.0، LGPL، …) لایسنس‌هایی را که ذاتاً ممنوع نیستند ولی شرط دارند،
   به‌جای رد خودکار، وادار به ثبت صریح در `license-exceptions.json` با دلیل و تاییدکننده می‌کند.
   دلیل: رد کامل این‌ها بعداً به دور زدن گیت منجر می‌شود؛ ثبت اجباری، تصمیم را قابل‌ردیابی نگه می‌دارد.
2. **گیت لایسنس `--self-test` دارد.** یک گیت امنیتی/انطباقی که هرگز آزموده نشده، وجود ندارد.
   ۱۷ مورد SPDX (شامل `MIT AND GPL-3.0-only` → denied و `BSD-3-Clause OR GPL-2.0` → allowed)
   در هر اجرای `pnpm license:check` قبل از خود بررسی، اجرا می‌شوند.
3. **دو-پله‌ای بودن بررسی prod/dev.** وابستگی‌های production خطا می‌دهند، dev فقط هشدار
   (مگر با `--strict`). دلیل: ابزارهای build گاهی لایسنس‌های عجیب دارند ولی در محصول نهایی نمی‌روند.
4. **ESLint بدون type-checking فعلاً.** `recommendedTypeChecked` به `projectService` در هر پکیج
   نیاز دارد و کند است. وقتی کدبیس پایدار شد، ارتقا به‌عنوان یک ADR جدا ثبت شود.
5. **اسناد فارسی از prettier مستثنا شدند.** هم‌ترازی ستون جدول بر اساس تعداد کاراکتر،
   برای متن RTL نتیجه‌ی بدتری می‌دهد.

## بلوکه (نیاز به تصمیم مالک)

هیچ موردی. تصمیم‌های بیزینسی (قیمت پلن، VAT، موجودیت حقوقی، درگاه پیامک) طبق توافق
تا قبل از M4 معلق می‌مانند و مانع پیشرفت M1 نیستند.

**یک مورد کوچک برای اطلاع:** `git init` انجام شد ولی هیچ commit ای زده نشده.
هر وقت خواستی، commit اولیه زده می‌شود.

## قدم بعدی

**گام ۰٫۲ — پکیج `canvas-core` و اپ دمو:**

- `packages/canvas-core/package.json` با نام `@hamboom/canvas-core`
- ساختار پوشه: `engine/ elements/ tools/ ui/ text/ theme/ sync/`
- اپ دمو داخلی با Vite در `packages/canvas-core/dev/`
- Vitest + `@testing-library/react` + jsdom
- `packages/canvas-core/CLAUDE.md`
- معیار پذیرش: `pnpm --filter @hamboom/canvas-core dev` یک صفحه‌ی راست‌چین با متن «هم‌بوم» بیاورد

بعد از آن، **فاز ۱ که دروازه‌ی ریسک پروژه است** شروع می‌شود (spike متن فارسی، گام ۱٫۳).

## پله‌ی فعلی ADR-003

**A — بسته‌ی npm.** هنوز `@excalidraw/excalidraw` نصب نشده (گام ۱٫۱)، هیچ patch و هیچ فورکی وجود ندارد.
