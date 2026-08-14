# `@hamboom/ydoc-schema`

مدلِ سندِ Yjs یک بورد، codecِ عنصر، migrationِ نسخه، و پروتکلِ سیم.
**پایین‌ترین لایه‌ی ماژول M2 — و تنها لایه‌ای که هم کلاینت و هم سرور مصرفش می‌کنند.**

> برای کار کردن **روی** این پکیج، [`CLAUDE.md`](CLAUDE.md) را بخوان (خط قرمزها،
> جدولِ تله‌ها، نحوه‌ی افزودنِ migration). این فایل برای **مصرف‌کننده** است.

## چرا این پکیج جدا است

[PLAN بخش ۸](../../PLAN.md) binder را داخلِ همین پکیج گذاشته بود، ولی
[PLAN بخش ۲](../../PLAN.md) صریحاً `ydoc-schema → canvas-core` را ممنوع می‌کند.
ناسازگاری به نفعِ قاعده‌ی لایه‌بندی حل شد
([ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029)): این پکیج **نه UI می‌بیند**
(React/Excalidraw/canvas-core) **و نه وابستگیِ سرور** (ws/pg/ioredis). یک قاعده‌ی
ESLint اعمالش می‌کند.

نتیجه‌اش این است که سرور می‌تواند سند را بفهمد بدونِ اینکه گرافِ تایپِ موتورِ رندر
را بکِشد.

## ساختارِ سند

پنج ریشه، دقیقاً مطابقِ [PLAN بخش ۷٫۱](../../PLAN.md):

| ریشه | نوع | چیست |
|---|---|---|
| `elements` | `Y.Map<Y.Map>` | هر عنصر **خودش یک `Y.Map`** است — ADR-007 |
| `assets` | `Y.Map` | فقط **متادیتا**؛ باینری هرگز اینجا نمی‌آید |
| `appState` | `Y.Map` | وضعیتِ **مشترکِ** بورد (نه شخصی) |
| `commentPins` | `Y.Map` | مختصاتِ سنجاق؛ متنش در Postgres (M3) |
| `meta` | `Y.Map` | `schemaVersion` و کلیدهای سطحِ سند |

```ts
import { boardRoots, createBoardDoc, readDocument, writeElement } from "@hamboom/ydoc-schema";

const doc = createBoardDoc();               // فقط برای بوردِ واقعاً نو
doc.transact(() => {                        // ★ transact کارِ صداکننده است
  writeElement(boardRoots(doc).elements, element);
}, myNamedOrigin);
const snapshot = readDocument(doc);         // { elements, assets, appState }
```

### سه چیزی که شکلِ این مدل را تعیین کرد

**۱. عنصر per-property نوشته می‌شود، نه یک‌جا**
([ADR-007](../../ARCHITECTURE_DECISIONS.md#adr-007)). دو نفر باید بتوانند همزمان
رنگ و موقعیتِ یک استیکی را عوض کنند و **هر دو تغییر بماند**. نوشتنِ آبجکتِ کامل
این را بی‌صدا از بین می‌برد — و همین با probe اثبات شد، هم ادعا هم ضدش.

**۲. `customData` هم بازگشتی `Y.Map` می‌شود**
([ADR-033](../../ARCHITECTURE_DECISIONS.md#adr-033)). `customData.hb` قلبِ مدلِ
دادهٔ محصول است (`kind`، پالت، جهتِ متن، برچسب‌ها)؛ گم‌شدنِ داده آنجا همان باگِ
ADR-007 است، فقط یک لایه پایین‌تر و نامرئی‌تر.

**۳. `originalText` یک `Y.Text` است، `text` نیست**
([ADR-034](../../ARCHITECTURE_DECISIONS.md#adr-034)). `text` **مشتق** است و بعد از
هر ادغام باید بازمحاسبه شود. دیفِ متن همیشه علیهِ `ytext.toString()`ِ **لحظه‌ی
تراکنش** گرفته می‌شود — با پایه‌ی کهنه، بازه‌ی `delete` به ایندکسِ اشتباه می‌افتد و
متن **مخدوش** می‌شود، نه فقط ناقص.

## پروتکلِ سیم

هر ۷ کدِ پیامِ [PLAN بخش ۵٫۳](../../PLAN.md) با `encodeMessage`/`decodeMessage`:

```
SYNC · AWARENESS · HB_EPHEMERAL · HB_ROOM_INFO · HB_PERMISSION · HB_ERROR · HB_AUTH_REFRESH
```

**دو قاعده‌اش شکسته نمی‌شود:**

۱. **پیامِ ناشناخته بی‌صدا نادیده گرفته می‌شود** (`decodeMessage` → `null`) و
**بایتِ اضافه در انتها خطا نیست**. با هم یعنی نسخه‌ی بعدی می‌تواند هم پیامِ تازه
اضافه کند و هم به پیامِ موجود فیلد اضافه کند، بدونِ شکستنِ تبِ بازِ کاربر.
⚠️ ولی پیامِ **خرابِ** نوعِ شناخته‌شده `ProtocolError` می‌دهد — «هنوز بلد نیستم» با
«یک طرف باگ دارد» قاطی نمی‌شود.

۲. **fail closed:** نقشِ ناشناخته → `viewer`، وضعیتِ ذخیره‌ی ناشناخته → `unsaved`.

⚠️ `BOARD_ROLES` و `SAVE_STATUSES` **با ایندکس** روی سیم می‌روند — فقط می‌شود به
**انتهایشان** اضافه کرد.

## Migration

`SCHEMA_VERSION` یکی بالا می‌رود و یک ورودی با `to = from + 1` به **انتهای**
رجیستری اضافه می‌شود. تابعِ migration فقط روی خودِ سند کار می‌کند — بدونِ I/O و
بدونِ زمانِ جاری، چون ممکن است ماه‌ها بعد اجرا شود و باید همان نتیجه را بدهد.

`migrateDocument` خودش زنجیره را بازرسی می‌کند: پرشِ نسخه، گسستگی، و **migrationِ
اضافه‌شده بدونِ بالابردنِ `SCHEMA_VERSION`** — آخری رایج‌ترین اشتباه است و بدونِ
نگهبان، migration **هرگز اجرا نمی‌شد** و کسی نمی‌فهمید.

★ **سنجشِ نسخه کارِ خودِ کلاینت است**
([ADR-040](../../ARCHITECTURE_DECISIONS.md#adr-040)): سرور نسخه‌ی کلاینت را نمی‌داند،
و سندِ **جلوتر** می‌تواند از IndexedDB بیاید و اصلاً از سرور رد نشود.

## ★ فهرستِ تله‌های کشف‌شده

شرحِ کاملِ هرکدام در [`CLAUDE.md`](CLAUDE.md).

| تله | نشانه |
|---|---|
| **فقط `Uint8Array` باینریِ واقعی است** | `ArrayBuffer`/`Blob`/`DataView` **تودرتو در یک آبجکتِ ساده** پذیرفته می‌شوند و در sync به `{}` تبدیل می‌شوند — روی کلاینتِ نویسنده سالم به نظر می‌رسد و فقط برای بقیه گم می‌شود. تنها نگهبانِ ممکن، بررسی **قبل از نوشتن** است |
| **codec خودش `transact` نمی‌کند** | بدونِ `doc.transact(fn, origin)`ِ صداکننده، Yjs هر `set` را جدا و با originِ `null` می‌فرستد — هم ترافیکِ چندبرابر، هم دقیقاً originی که `UndoManager` پیش‌فرض ردیابی می‌کند |
| **`createBoardDoc()` فقط برای بوردِ واقعاً نو** | هر بار صدا زدنش یک `meta.schemaVersion` با `clientID`ِ تازه می‌نویسد → رشدِ بی‌کرانِ state vector در فشرده‌سازی |
| **پسوندِ `.ts` روی importهای نسبی اجباری است** | این پکیج در سرور مستقیماً با Node اجرا می‌شود؛ بدونِ پسوند `ERR_MODULE_NOT_FOUND` |
| **نمونه‌ی دستیِ تست می‌تواند بی‌صدا از schema واگرا شود** | تست‌ها قبل از هر ادعا با `hbElement.parse` اعتبارسنجی می‌کنند |

## دستورات

```bash
pnpm --filter @hamboom/ydoc-schema test
pnpm --filter @hamboom/ydoc-schema test:coverage   # گیتِ ۶۰٪ — داخلِ pnpm verify هم هست
pnpm --filter @hamboom/ydoc-schema typecheck
pnpm --filter @hamboom/ydoc-schema lint
```

## آنچه اینجا انجام نمی‌شود

binder و هر تماسی با `canvas-core` → [`canvas-sync`](../canvas-sync/) ·
شبکه، اتاق، پایداری، احراز هویت → [`apps/realtime`](../../apps/realtime/).
