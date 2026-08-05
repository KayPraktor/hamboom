# CLAUDE.md — `@hamboom/ydoc-schema`

مدلِ سندِ Yjs یک بورد. **پایین‌ترین لایه‌ی ماژول M2.**

**قبل از کار بخوان:** [TODO.md](../../TODO.md) (فاز ۲) و
[ARCHITECTURE_DECISIONS.md](../../ARCHITECTURE_DECISIONS.md) — به‌ویژه
ADR-004، ADR-007، ADR-008، ADR-009، ADR-022، ADR-029 — و
[PLAN بخش ۷](../../PLAN.md) که ساختارِ سند را تعریف می‌کند.

## خط قرمزها

1. **این پکیج هم در مرورگر و هم در سرور اجرا می‌شود.** پس نه UI می‌بیند
   (`react`، `@excalidraw/*`، `@hamboom/canvas-core`) و نه وابستگیِ سرور
   (`ws`، `pg`، `ioredis`، `@aws-sdk/*`). قاعده‌ی `ydocSchemaBoundaries` این را
   خطا می‌کند ([ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029)).
2. **اگر به قراردادِ بوم نیاز داری، اینجا جایش نیست.** `CanvasSyncAdapter` و هر
   چیزی که به `canvas-core` وصل است در [`packages/canvas-sync`](../canvas-sync/)
   زندگی می‌کند. این تفکیک تنها چیزی است که سرور را از موتورِ رندر جدا نگه می‌دارد.
3. **باینری هرگز داخل `Y.Doc` نمی‌رود.** فقط متادیتای دارایی
   ([PLAN بخش ۷٫۱](../../PLAN.md)). یک تستِ نگهبان در گام ۲٫۲ این را قفل می‌کند.
4. **داده‌ی ephemeral هرگز داخل سند نمی‌رود** — استروکِ در حالِ کشیدن، لیزر،
   reaction فقط از کانالِ awareness ([ADR-022](../../ARCHITECTURE_DECISIONS.md#adr-022)).
5. **عنصر را per-property بنویس، نه یک‌جا.** کلِ دلیلِ
   [ADR-007](../../ARCHITECTURE_DECISIONS.md#adr-007) این است که دو نفر بتوانند
   همزمان رنگ و موقعیتِ یک عنصر را عوض کنند و هر دو تغییر بماند. نوشتنِ آبجکتِ
   کامل این خاصیت را بی‌صدا از بین می‌برد.
6. **`packages/shared-types` را بدون تایید مالک تغییر نده** (ADR-021).
   ★ قیدِ فعالِ M2: این ماژول باید **بدون هیچ تغییری در `shared-types`** تمام شود.
7. ★ **codec خودش `transact` نمی‌کند — صداکننده موظف است.** `writeElement` باید
   داخلِ یک `doc.transact(fn, origin)` با originِ **نام‌دار** صدا زده شود. بدونش
   Yjs هر `set` را جداگانه و با originِ `null` می‌فرستد: هم ترافیکِ چندبرابر، و
   هم — چون پیش‌فرضِ `Y.UndoManager` دقیقاً `null` را ردیابی می‌کند (سنجیده‌شده در
   گام ۱٫۴) — نشتِ تغییرِ remote به undo stackِ محلی. مقصدِ این قید: گام ۳٫۳.

## ★ تله: پسوندِ `.ts` روی importهای نسبی

این پکیج در **سرور** هم اجرا می‌شود، یعنی مستقیماً با Node. برخلاف Vite، Node پسوند
را حدس نمی‌زند و `import { x } from "./doc"` با `ERR_MODULE_NOT_FOUND` می‌افتد.
همه‌ی importهای نسبی باید `.ts` صریح داشته باشند (`allowImportingTsExtensions` در
`tsconfig.json` روشن است). جزئیات در [`packages/config/CLAUDE.md`](../config/CLAUDE.md).

## ساختار (فاز ۲ پرش می‌کند)

| فایل | مسئولیت | گام TODO |
|---|---|---|
| `src/index.ts` | فقط barrel — صادراتِ عمومی | ۰٫۲ |
| `src/doc.ts` | پنج ریشه، `SCHEMA_VERSION`، `readDocument` | ۲٫۱ ✅ |
| `src/value-codec.ts` | ★ موتورِ نوشتنِ افتراقی — **مشترکِ همه‌ی codecها** | ۲٫۲ ✅ |
| `src/element-codec.ts` | `writeElement`/`readElement` — **per-property** | ۲٫۱ ✅ |
| `src/assets.ts` | متادیتای دارایی — **با اعتبارسنجی** | ۲٫۲ ✅ |
| `src/app-state.ts` | وضعیتِ مشترکِ بورد + نگهبانِ وضعیتِ شخصی | ۲٫۲ ✅ |
| `src/comment-pins.ts` | سنجاقِ کامنت (متنش در Postgres — کارِ M3) | ۲٫۲ ✅ |
| `src/binary-guard.ts` | نگهبانِ «هیچ باینری در سند» | ۲٫۲ ✅ |
| `src/test-fixtures.ts` | نمونه‌ی دستیِ هر ۹ نوع — **صادر نمی‌شود** | ۲٫۱ ✅ |
| `src/migrations/` | `migrateV1toV2` و رجیستریِ ترتیبی | ۲٫۳ |
| `src/protocol.ts` | کدهای پیامِ PLAN بخش ۵٫۳ | ۲٫۴ |

★ **منطقِ نوشتنِ افتراقی یک جاست.** عنصر، `appState` و سنجاقِ کامنت هر سه از
`value-codec.ts` می‌روند. سه کپی یعنی سه رفتاری که واگرا می‌شوند (ADR-024). تنها
تفاوتشان یک پرچمِ `prune` است که **پیش‌فرض ندارد**: شیءِ کامل (عنصر، سنجاق)
`true`، و patch (`appState`) `false`.

## ★★ تله‌ی Yjs: فقط `Uint8Array` باینریِ واقعی است

سنجیده شد در گام ۲٫۲ (تستِ اولم افتاد و علتش همین بود):

| شکل | مستقیم روی `Y.Map` | تودرتو در یک آبجکتِ ساده |
|---|---|---|
| `Uint8Array` | پذیرفته | پذیرفته |
| `ArrayBuffer` · `Float64Array` · `DataView` · `Blob` | **خودِ Yjs رد می‌کند** | ⚠️ **پذیرفته، و در sync به `{}` تبدیل می‌شود** |

ستونِ دوم بدتر از «باینری در سند» است: **روی کلاینتِ نویسنده سالم به نظر می‌رسد**
(Yjs همان شیءِ درون‌حافظه‌ای را برمی‌گرداند) و فقط برای بقیه گم می‌شود — بدونِ خطا.
اسکنرِ سند هم آن‌طرف چیزی نمی‌بیند. پس برای این شکل‌ها **تنها** نگهبانِ ممکن،
بررسیِ **قبل از نوشتن** است: `findBinaryIn`، که `writeAsset` صدایش می‌زند.

## ★ تقسیمِ کارِ تست‌های codec

وفاداری در **دو جا** آزموده می‌شود و هیچ‌کدام جایگزینِ دیگری نیست:

| کجا | با چه نمونه‌ای | چه چیزی را فقط همان‌جا می‌شود گرفت |
|---|---|---|
| [`src/element-codec.test.ts`](src/element-codec.test.ts) | دستی | **`line`** — کانکتورِ محصولی همیشه `arrow` است، پس `line` هیچ سازنده‌ای ندارد |
| [`canvas-sync/src/element-codec.test.ts`](../canvas-sync/src/element-codec.test.ts) | خروجیِ سازنده‌های **واقعیِ** M1 | فیلدهایی که نمونه‌ی دستی ممکن است نداشته باشد + سازگاریِ تایپیِ `readDocument` با `CanvasDocument` |

نمونه‌ی دستی می‌تواند بی‌صدا از schema واگرا شود، پس `element-codec.test.ts` قبل از
هر ادعای دیگری همه‌شان را با `hbElement.parse` اعتبارسنجی می‌کند.

## دستورات

```bash
pnpm --filter @hamboom/ydoc-schema test
pnpm --filter @hamboom/ydoc-schema typecheck
pnpm --filter @hamboom/ydoc-schema lint
```

## چیزهایی که اینجا انجام نمی‌شوند

binder و هر تماسی با `canvas-core` (کارِ [`canvas-sync`](../canvas-sync/))؛ شبکه،
اتاق، پایداری، احراز هویت (کارِ [`apps/realtime`](../../apps/realtime/)).
