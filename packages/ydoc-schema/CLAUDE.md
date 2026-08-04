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

## ساختار (فاز ۲ پرش می‌کند)

| فایل | مسئولیت | گام TODO |
|---|---|---|
| `src/index.ts` | نسخه‌ی schema، نام ریشه‌ها | ۰٫۲ |
| `src/doc.ts` | سازنده‌ی `Y.Doc` با پنج ریشه | ۲٫۱ |
| `src/element-codec.ts` | `writeElement`/`readElement` — **per-property** | ۲٫۱ |
| `src/assets.ts` · `src/app-state.ts` | متادیتای دارایی، وضعیتِ مشترکِ بورد | ۲٫۲ |
| `src/migrations/` | `migrateV1toV2` و رجیستریِ ترتیبی | ۲٫۳ |
| `src/protocol.ts` | کدهای پیامِ PLAN بخش ۵٫۳ | ۲٫۴ |

## دستورات

```bash
pnpm --filter @hamboom/ydoc-schema test
pnpm --filter @hamboom/ydoc-schema typecheck
pnpm --filter @hamboom/ydoc-schema lint
```

## چیزهایی که اینجا انجام نمی‌شوند

binder و هر تماسی با `canvas-core` (کارِ [`canvas-sync`](../canvas-sync/))؛ شبکه،
اتاق، پایداری، احراز هویت (کارِ [`apps/realtime`](../../apps/realtime/)).
