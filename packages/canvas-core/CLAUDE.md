# CLAUDE.md — `@hamboom/canvas-core`

موتور بوم هم‌بوم. ماژول **M1** — اولین و پرریسک‌ترین ماژول پروژه.

**قبل از کار بخوان:** [TODO.md](../../TODO.md) (نقشه‌ی گام‌به‌گام) و
[ARCHITECTURE_DECISIONS.md](../../ARCHITECTURE_DECISIONS.md) — به‌ویژه
ADR-003، ADR-007، ADR-008، ADR-010، ADR-016، ADR-017، ADR-022.

## خط قرمزها

1. **بدون شبکه.** این پکیج نباید `yjs`، `y-*`، `@hamboom/sdk`، `@hamboom/storage`،
   `@hamboom/auth-core`، `axios` یا هر HTTP client دیگری را import کند. ESLint
   (`canvasCoreBoundaries`) این را خطا می‌کند. ارتباط با بیرون **فقط** از طریق
   `CanvasSyncAdapter` در [src/sync/](src/sync/).
2. **بوم RTL نیست.** مختصات بوم ریاضی است؛ `x` همیشه به راست افزایش می‌یابد.
   RTL فقط به متنِ داخل عناصر و به [src/ui/](src/ui/) مربوط است. این تفکیک را
   با هیچ «اصلاح»ی خراب نکن — نتیجه‌اش یک کلاس گیج‌کننده از باگ هندسی است.
3. **`element.type` را مستقیم نخوان.** همیشه `getKind(element)`. تنها استثنا
   `elements/mapping.ts` است (ADR-010).
4. **داده‌ی در حال شکل‌گیری وارد سند نمی‌شود.** استروک قلم، پیش‌نمایش کشیدن،
   لیزر پوینتر → `emitEphemeral`. فقط نتیجه‌ی نهایی در `pointerup` (ADR-022).
5. **مسیر کانکتور مشتق‌شده است، نه ذخیره‌شده.** `routeConnector` باید خالص و
   قطعی باشد — ورودی یکسان، خروجی بیت‌به‌بیت یکسان در هر مرورگر (ADR-008).
6. **`packages/shared-types` را بدون تایید مالک تغییر نده** (ADR-021).

## ساختار

| پوشه | مسئولیت | گام TODO |
|---|---|---|
| [src/engine/](src/engine/) | wrapper موتور رندر، gate فونت | ۱٫۱ |
| [src/text/](src/text/) | bidi، shaping، اندازه‌گیری فارسی | ۱٫۲–۱٫۴ |
| [src/sync/](src/sync/) | قرارداد `CanvasSyncAdapter` + آداپتور لوکال | ۲٫۲ |
| [src/elements/](src/elements/) | سازنده و نگاشت انواع عنصر | ۲٫۳، ۳٫۲–۳٫۶ |
| [src/theme/](src/theme/) | پالت استیکی، توکن میرو-استایل | ۳٫۱ |
| [src/tools/](src/tools/) | ابزارهای تعاملی بوم | ۳٫۲–۳٫۷ |
| [src/ui/](src/ui/) | نوار ابزار، پنل‌ها، منوها (RTL) | ۴٫۲–۴٫۴ |
| `dev/` | اپ دموی Vite — دیپلوی نمی‌شود | ۰٫۲ |
| `test/` | تست دود و یکپارچه | ۰٫۲، ۶٫۱ |

هر پوشه‌ی `src/` یک `README.md` با جزئیات مسئولیت و قواعدش دارد.

## دستورات

```bash
pnpm --filter @hamboom/canvas-core dev        # دموی لوکال روی 127.0.0.1:5180
pnpm --filter @hamboom/canvas-core test       # vitest یک‌بار
pnpm --filter @hamboom/canvas-core test:watch
pnpm --filter @hamboom/canvas-core typecheck
pnpm --filter @hamboom/canvas-core lint
```

## نکات فنی

- **پکیج JIT است:** `exports` مستقیماً به `src/*.ts` اشاره می‌کند و build ندارد.
  مصرف‌کننده‌ها (همه Vite هستند) خودشان transpile می‌کنند. الگوی internal package
  در Turborepo. اگر روزی یک مصرف‌کننده‌ی Node خالص اضافه شد، آن‌وقت build لازم می‌شود.
- **دو فایل پیکربندی Vite:** `vite.config.ts` (root روی `dev/`) برای دمو و
  `vitest.config.ts` (root روی ریشه‌ی پکیج) برای تست. ادغام نکن.
- **`ENGINE_STAGE` در [src/index.ts](src/index.ts)** پله‌ی فعلی ADR-003 را نگه می‌دارد.
  عبور از `"patch"` به `"fork"` نیاز به تایید مالک دارد.

## چیزهایی که اینجا انجام نمی‌شوند

اتصال به سرور، Yjs، احراز هویت، ذخیره‌سازی، متن کامنت‌ها، گالری قالب،
export سمت سرور، داشبورد. فهرست کامل در انتهای [TODO.md](../../TODO.md).
