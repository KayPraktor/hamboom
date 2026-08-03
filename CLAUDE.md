# CLAUDE.md — هم‌بوم (Hamboom)

پلتفرم وایت‌بورد همکاری بلادرنگ، فارسی/RTL، میزبانی داخل ایران، پرداخت ریالی. مشابه Miro.
توسعه‌دهنده: یک نفر + Claude Code. کار به ۶ ماژول تقسیم شده که هر کدام در session جدا پیش می‌رود.

## قبل از هر کاری این‌ها را بخوان

| فایل | چه چیزی دارد |
|---|---|
| [PLAN.md](PLAN.md) | ساختار مونوریپو، قرارداد API، schema دیتابیس، مدل Yjs، شرح ۶ ماژول |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) | ۲۲ تصمیم فنی با دلیل. **تغییر هر کدام نیاز به تایید مالک دارد.** |
| [TODO.md](TODO.md) | گام‌های ماژول فعال (الان: `realtime-sync`) با معیار پذیرش |
| [TODO-M1-canvas-core.md](TODO-M1-canvas-core.md) | بایگانیِ TODOِ M1 (تمام‌شده) — مرجعِ تاریخی |
| [docs/iranian-miro-spec.md](docs/iranian-miro-spec.md) | سند محصول |

## اصول غیرقابل‌مذاکره

- **P1 — لایسنس:** فقط MIT / Apache-2.0 / BSD / ISC / 0BSD. `tldraw@>=2` ممنوع. قبل از افزودن هر پکیج: `pnpm license:check`.
- **P2 — بدون سرویس خارجی در runtime:** بدون Google Fonts، Sentry SaaS، Stripe، CDN خارجی. همه assets خودمیزبان.
- **P3 — همه‌چیز لوکال اجرا می‌شود:** `docker compose up && pnpm dev` باید کافی باشد. هیچ feature ای نباید برای توسعه به حساب ابری واقعی نیاز داشته باشد.
- **P4 — Object Storage فقط از پشت `packages/storage`:** هیچ ماژول دیگری `@aws-sdk/client-s3` را import نمی‌کند.
- **P5 — پول همیشه `BIGINT` ریال:** هیچ‌جا float، هیچ‌جا تومان در دیتابیس. تبدیل فقط در لایه نمایش.
- **P6 — RTL واقعی:** فقط logical properties (`margin-inline-start`، نه `margin-left`). فارسی native، نه ترجمه. **استثنا: مختصات بوم هرگز آینه نمی‌شود.**
- **P7 — هیچ PII در لاگ:** شماره موبایل ماسک‌شده، کد OTP هرگز لاگ نشود.

## قواعد کار در این ریپو

1. **دامنه‌ی خودت را رعایت کن.** هر session روی یک ماژول کار می‌کند و به فایل‌های ماژول‌های دیگر دست نمی‌زند.
2. **`packages/shared-types` قرارداد مشترک است** (ADR-021). تغییرش همه‌ی ماژول‌ها را می‌شکند — پیشنهاد را در `PROGRESS.md` بنویس و **متوقف شو** تا مالک تایید کند.
3. **بعد از هر گام:** `pnpm typecheck && pnpm lint && pnpm test` باید سبز باشد.
4. **تیک زدن فقط بعد از تحقق «معیار پذیرش»** در TODO.md. اگر محقق نشد، ننویس انجام شد.
5. **گام بلوکه‌شده:** با `[!]` علامت بزن، دلیل بنویس، برو گام مستقل بعدی. کل loop را متوقف نکن.
6. **پایان هر session:** `PROGRESS.md` را با «چه شد / چه تصمیمی گرفتم / قدم بعد» به‌روز کن.
7. **تصمیم معماری جدید** = یک ADR جدید در `ARCHITECTURE_DECISIONS.md`، نه ویرایش ADR قدیمی.

## دستورات

```bash
pnpm install
pnpm dev              # turbo: همه‌ی اپ‌ها
pnpm typecheck        # tsc روی scripts + turbo روی پکیج‌ها
pnpm lint
pnpm test
pnpm license:check    # گیت اصل P1 — شامل self-test ارزیاب SPDX
pnpm license:list     # فهرست کامل لایسنس‌های درخت وابستگی
pnpm format
```

## وضعیت فعلی

- **ماژول فعال:** M2 — `realtime-sync` (تازه شروع شده)
- **گام بعدی:** ۰٫۱ — نوشتنِ ADR-029/030/031 برای پنج تصمیمِ مرزیِ D-1 تا D-5 که مالک در
  ۱۴۰۵/۰۵/۱۲ تایید کرد (جدولِ صدرِ [TODO.md](TODO.md)). بعدش ۰٫۲ (اسکلت + گیتِ مرزها).
- **قیدِ فعال:** M2 باید **بدون هیچ تغییری در `shared-types`** تمام شود — شکلِ claimهای
  `rtToken` عمداً داخلِ پورتِ `BoardAuthority` می‌ماند. اگر لازم شد، **متوقف شو و بپرس**.
- **M1 تمام و تحویل‌شده:** فازهای ۰ تا ۶ کامل. گپِ بازِ ارث‌رسیده: **G-1** (تستِ دو-نمونه‌ای
  با بومِ واقعی + رندرِ حضور) که در M2 گام‌های ۳٫۷ و ۶٫۱ بسته می‌شود.
- **پله‌ی ADR-003:** **A** (بسته‌ی npm) — هیچ patch و فورکی وجود ندارد و
  spike فارسی ثابت کرد لازم هم نیست ([ADR-025](ARCHITECTURE_DECISIONS.md#adr-025))
- **پکیج‌ها:** `canvas-core`، `shared-types`، `i18n`، `tsconfig`، `eslint-config`
- **هنوز ساخته نشده:** `apps/`، `infra/`، `packages/config`، `packages/auth-core`،
  `packages/storage`، `packages/ydoc-schema`. یعنی M2 وابستگی‌هایی به M3/M5 دارد که وجود
  ندارند — مرزش در تصمیم‌های D-1 تا D-5 مشخص می‌شود.
- **زیرساخت:** فقط لوکال. هیچ حساب آروان/زرین‌پال واقعی خریداری نشده.

## نکات محیط

- Node ۲۴ (فایل `.ts` را مستقیم اجرا می‌کند — اسکریپت‌ها به build نیاز ندارند)
- pnpm ۱۰، Turborepo ۲، ویندوز (PowerShell)
- `pnpm-workspace.yaml` → `apps/*` و `packages/*`
