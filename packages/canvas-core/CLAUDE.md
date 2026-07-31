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
7. **نوشتن به صحنه فقط از `commitGesture`/`commitSystemUpdate`**
   ([engine/scene-commit.ts](src/engine/scene-commit.ts)) یا با `captureUpdate`
   صریح. قاعده‌ی ESLint `require-capture-update` نوشتنِ خامِ بدونِ انتخاب را خطا
   می‌کند (ADR-026) — سه‌بار همین باگ ظاهر شد، آخری‌اش را همین قاعده در
   `sticky-tool` گرفت.

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
pnpm --filter @hamboom/canvas-core dev           # دموی لوکال روی 127.0.0.1:5180
pnpm --filter @hamboom/canvas-core test          # vitest یک‌بار
pnpm --filter @hamboom/canvas-core test:watch
pnpm --filter @hamboom/canvas-core test:coverage # پوشش + گیتِ ۶۰٪ (elements/text/sync)
pnpm --filter @hamboom/canvas-core test:e2e      # Playwright — مرورگرِ واقعی (نیاز: playwright install chromium)
pnpm --filter @hamboom/canvas-core typecheck
pnpm --filter @hamboom/canvas-core lint
```

## تله‌های شناخته‌شده‌ی موتور

این‌ها را در مرورگر یاد گرفتیم، نه در تست. jsdom هیچ‌کدام را نمی‌گیرد.

| تله | نشانه | راه درست |
|---|---|---|
| `.excalidraw` هنگام `excalidrawAPI` هنوز در DOM نیست | ابزار بی‌صدا ساخته نمی‌شود | به `document` گوش بده و در لحظه با `closest()` فیلتر کن |
| `api.onChange` برای `updateScene` **برنامه‌ای** صدا زده نمی‌شود | نمایشگر صفر می‌ماند در حالی که صحنه پر است | بعد از هر نوشتن برنامه‌ای، خودت refresh کن |
| بعد از `updateScene`، `getAppState()` هنوز قدیمی است | انتخاب ست شده ولی پنل ظاهر نمی‌شود | یک تیک با `setTimeout(fn, 0)` صبر کن |
| **`getAppState()` درست بعد از pan/zoom (چرخِ ماوس هم) یک فریمْ کهنه است** | لایه‌ای که از getAppState پروجکت می‌کند (مثلِ مکان‌نمای حضور) روی **panِ خالص** جا می‌ماند؛ `onChange` هم که fire شود کمک نمی‌کند چون همان مقدارِ کهنه را می‌خواند | مقادیرِ نما را از خودِ `onScrollChange` در state بگذار و از آن پروجکت کن، نه از getAppState (گام ۴٫۴/Q1) |
| **`requestAnimationFrame` در تب پس‌زمینه اجرا نمی‌شود** | به‌روزرسانی تا برگشت کاربر معلق می‌ماند | برای منطق (نه انیمیشن) `setTimeout` استفاده کن |
| موتور رویداد اشاره‌گر مصنوعی را نمی‌پذیرد | تست خودکار وارد حالت ویرایش نمی‌شود | ورودی واقعی لازم است |
| **موتور صفحه‌کلید را روی خودِ `canvas` گوش می‌دهد، نه `document`** | `dispatch` کردنِ `Ctrl+Z` روی `document` بی‌اثر است → ممکن است اشتباهاً نتیجه بگیری «عملیات اصلاً undo نمی‌شود» (نزدیک بود در z-order همین شود) | رویدادِ صفحه‌کلید را روی `canvas.excalidraw__canvas` (یا کانتینرش) بفرست؛ در آزمونِ مرورگری هم همان‌جا |
| **تغییر `version` بدون `versionNonce`** | تغییر ورودی undo جدا نمی‌سازد؛ یک Ctrl+Z کل عملیات قبلی را برمی‌گرداند | همیشه `bumpVersion()` که هر دو را بالا می‌برد (ADR-026) |
| گروه‌کردن چند تغییر زیر یک undo | — | همه در **یک** `updateScene({ captureUpdate: "IMMEDIATELY" })` (ADR-026) |
| **`NEVER`/`EVENTUALLY` خطِ پایه‌ی تاریخچه را جلو می‌برند** | در جریان دو-مرحله‌ای (مثلاً تصویرِ pending→saved)، اگر مرحله‌ی اول `NEVER` باشد و دوم `IMMEDIATELY`، یک undo فقط مرحله‌ی دوم را برمی‌گرداند نه کل ساخت را | **creation** را در مرحله‌ی اول `IMMEDIATELY` بگذار و به‌روزرسانی‌های بعدیِ همان ژست را `NEVER` (گام ۳٫۶) |

## تله‌های تستِ E2E (Playwright — گام ۶٫۱)

Playwright یک Chromiumِ **واقعی** اجرا می‌کند که composite می‌کند و رویدادِ **trusted**
می‌سازد — همان چیزی که موتور می‌پذیرد. این‌ها را حین ساختِ harness یاد گرفتیم:

| تله | نشانه | راه درست |
|---|---|---|
| **`getImageData` روی canvasِ موتور بلانک است** | خواندنِ مستقیمِ پیکسل همیشه سفید برمی‌گردد (canvas روی GPU composite می‌شود) | برای پیکسل، **اسکرین‌شاتِ Playwright** بگیر (`toHaveScreenshot`/`screenshot`)، نه `getImageData` |
| **`ctx.direction` در canvas پیکسلی سنجش‌پذیر نیست** | خروجیِ `fillText` با ltr/rtl فرقی نمی‌کند؛ run‌های دوجهته بازچینش نمی‌شوند | جهتِ متن را با **شمارنده‌ی فراخوانیِ wrapper** بسنج (نگهبانِ ADR-025)، نه diff پیکسلی |
| **golden از canvas ناپایدار است** | rough.js هر شکل را با seedِ تازه می‌کشد → diff بینِ اجراها | golden فقط برای رابطِ **CSSـیِ قطعی** (مثلِ پالت)؛ برای canvas از ادعای رفتاری استفاده کن |
| **کلیکِ ماوس روی canvas، کیبورد را به موتور نمی‌رساند** | `Ctrl+Z` بعد از کلیک بی‌اثر است (undo کار نمی‌کند) با اینکه activeElement کانتینر است | کانتینرِ `.excalidraw-container` را **صریح focus** کن، بعد `page.keyboard.press("Control+KeyZ")` |
| **canvasِ وصل‌نشده `ctx.direction` را نادیده می‌گیرد** | canvasِ `createElement`نشده در DOM، در هدلس direction را اعمال نمی‌کند | برای probeِ رندر، canvas را به DOM append کن |

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
