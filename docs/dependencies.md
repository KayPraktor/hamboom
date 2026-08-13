# وابستگی‌ها و لایسنس‌ها

> اصل **P1** — هسته‌ی مجاز MIT / Apache-2.0 / BSD / ISC / 0BSD، به‌علاوه‌ی چند
> لایسنسِ permissiveِ معادل که با دلیل به allow-list افزوده شده‌اند (پایین).
> گیت خودکار: `pnpm license:check` (شامل `--self-test` ارزیاب SPDX).
> بخشِ **وابستگی‌های تصمیم‌دار** پایین دستی نگه‌داری می‌شود؛ بخشِ **فهرستِ کاملِ
> لایسنس‌ها** یک snapshotِ تولیدشده از `pnpm license:list` است.

---

## وابستگی‌های runtime

| پکیج | نسخه | لایسنس | چرا |
|---|---|---|---|
| `@excalidraw/excalidraw` | **0.18.1** (pin‌شده) | MIT | موتور رندر بوم — [ADR-003](../ARCHITECTURE_DECISIONS.md#adr-003) |
| `react` / `react-dom` | ^19 | MIT | — |
| `yjs` | 13.6.32 | MIT | CRDTِ سند — [ADR-004](../ARCHITECTURE_DECISIONS.md#adr-004). مصرف‌کننده‌ها: `ydoc-schema`، `canvas-sync`، `apps/realtime` |
| `lib0` | 0.2.117 | MIT | encode/decodeِ پیام‌های پروتکل — [`ydoc-schema/src/protocol.ts`](../packages/ydoc-schema/src/protocol.ts) (گام ۲٫۴) و قاب‌بندیِ sync در [`canvas-sync/src/adapter.ts`](../packages/canvas-sync/src/adapter.ts) (گام ۳٫۱). ⚠️ **در هر پکیجِ مصرف‌کننده باید صریحاً اعلام شود**: زیر pnpm گرافِ node_modules تخت نیست، پس «وابستگیِ Yjs است» یعنی `import "lib0/encoding"` با `ERR_MODULE_NOT_FOUND` می‌افتد |
| `y-protocols` | 1.0.7 | MIT | پروتکلِ sync و awareness — [PLAN بخش ۵٫۳](../PLAN.md). فقط در `canvas-sync` و `apps/realtime` |
| `y-indexeddb` | 9.0.12 | MIT | پایداریِ **محلیِ** سند در مرورگر — گام ۵٫۲. فقط در `canvas-sync`، و پشتِ پورتِ [`LocalDocStore`](../packages/canvas-sync/src/local-store.ts) تا هم تست بتواند جایگزینش کند و هم سرور هرگز آن را نبیند. تنها وابستگی‌اش `lib0` است که از قبل هست |

**ماژول M2 (گام ۰٫۲):** سه پکیجِ بالا افزوده شدند و `pnpm license:check` سبز ماند
(۶۸۵ پکیج). **`uWebSockets.js` عمداً افزوده نشد** — از تارِبالِ گیت‌هاب نصب می‌شود و
از زیرِ همین گیت رد می‌شود؛ ترابری `ws` است
([ADR-030](../ARCHITECTURE_DECISIONS.md#adr-030)، نصب در گام ۴٫۱).
**گام ۵٫۲:** `y-indexeddb` افزوده شد — گیت روی **۷۳۲ پکیج** سبز ماند.

**چرا نسخه pin شده (`0.18.1` نه `^0.18.1`):** طبق [ADR-003](../ARCHITECTURE_DECISIONS.md#adr-003)
ممکن است لازم شود با `pnpm patch` اصلاحات جراحی روی این پکیج بزنیم. patch ها به
هش محتوای نسخه گره می‌خورند و با هر ارتقای خودکار می‌شکنند. ارتقا باید یک تصمیم
آگاهانه باشد، نه یک اثر جانبی `pnpm update`.

---

## وابستگی‌های توسعه/تستِ تصمیم‌دار

| پکیج | لایسنس | چرا |
|---|---|---|
| `@playwright/test` | Apache-2.0 | تستِ E2E در مرورگرِ **واقعی** (گام ۶٫۱) — چیزی که jsdom نمی‌تواند: رندرِ پیکسل، رویدادِ trusted، undoِ موتور، جهتِ متنِ canvas (G-2/ADR-025) |
| `@vitest/coverage-v8` | MIT | گیتِ پوششِ ≥۶۰٪ (گام ۶٫۱) |

**دربارهٔ باینریِ مرورگرِ Playwright (P2/P3):** Playwright هنگام `playwright install`
یک Chromium را از `cdn.playwright.dev` می‌گیرد و در دایرکتوریِ کاربر کش می‌کند — **نه در
درختِ پروژه، نه در runtime**. اصل P2 (بدون سرویسِ خارجی در runtime) نقض نمی‌شود چون این
فقط زمانِ **تست** است، نه اجرا؛ و `docker compose up && pnpm dev` (اصل P3) به آن نیازی
ندارد. تنها اثر: اجرای `pnpm --filter @hamboom/canvas-core test:e2e` یک‌بار به
`pnpm exec playwright install chromium` (با شبکه) نیاز دارد. اگر روزی نصبِ کاملاً آفلاین
لازم شد، مثلِ فونت‌های Excalidraw می‌توان باینری را خودمیزبان کرد — کارِ M5 (infra).

---

## استثناهای لایسنس

| پکیج | گزارش pnpm | واقعیت | وضعیت |
|---|---|---|---|
| `khroma@2.1.0` | `Unknown` | MIT | ثبت‌شده در [`scripts/license-exceptions.json`](../scripts/license-exceptions.json) — **نیازمند تایید نهایی مالک** |

`khroma` فیلد `license` را در `package.json` ندارد، ولی فایل `license` آن با
«The MIT License (MIT)» شروع می‌شود و `readme.md` می‌گوید «MIT © Fabio Spampinato,
Andrew Maney». یک باگ بسته‌بندی است، نه یک تصمیم سیاستی.

زنجیره: `khroma` ← `mermaid` ← `@excalidraw/mermaid-to-excalidraw` ← `@excalidraw/excalidraw`

---

## فهرستِ کاملِ لایسنس‌های درختِ وابستگی

> **snapshotِ تولیدشده** با `pnpm license:list` — تاریخ ۱۴۰۵/۰۵/۰۷ (2026-07-29).
> منبعِ حقیقتِ زنده همان دستور است؛ این جدول برای مرورِ یک‌نگاهه در تحویل است.
> گیت (`pnpm license:check`) هر ۶۸۱ پکیج را می‌سنجد و **همه مجازند** (اصل P1).

| لایسنس | تعداد پکیج | توضیح |
|---|---:|---|
| MIT | ۵۲۸ | هسته‌ی مجاز |
| ISC | ۶۰ | هسته‌ی مجاز |
| Apache-2.0 | ۴۱ | هسته‌ی مجاز (شاملِ Playwright — تستِ E2E) |
| BSD-3-Clause | ۱۷ | هسته‌ی مجاز |
| BSD-2-Clause | ۱۴ | هسته‌ی مجاز |
| BlueOak-1.0.0 | ۶ | permissive، بدون شرطِ سرایت‌کننده |
| MIT-0 | ۴ | MIT بدونِ شرطِ حفظِ نوتیس |
| Python-2.0 | ۲ | permissive |
| CC0-1.0 | ۲ | معادلِ public domain (داده، نه کد) |
| OFL-1.1 | ۱ | فونتِ Vazirmatn — [ADR-017](../ARCHITECTURE_DECISIONS.md#adr-017) |
| (MPL-2.0 OR Apache-2.0) | ۱ | dual؛ شاخه‌ی Apache-2.0 انتخاب می‌شود |
| (MIT AND Zlib) | ۱ | هر دو permissive |
| Unlicense | ۱ | معادلِ public domain |
| 0BSD | ۱ | هسته‌ی مجاز |
| CC-BY-4.0 | ۱ | داده/محتوا (نه کدِ لینک‌شونده) — با گیت مجاز شمرده شد |
| Unknown | ۱ | `khroma` — استثنای مستند (بالا)؛ در واقع MIT |
| **جمع** | **۶۸۱** | — |

**درباره‌ی لایسنس‌های بیرونِ هسته‌ی پنج‌گانه:** allow-listِ گیت عمداً چند لایسنسِ
permissiveِ معادل را هم می‌پذیرد (BlueOak، MIT-0، CC0، Python-2.0، Unlicense،
عبارت‌های `OR`/`AND` که شاخه‌ی آزاد دارند)، و `OFL-1.1` طبق [ADR-017](../ARCHITECTURE_DECISIONS.md#adr-017)
فقط برای فونت. تنها موردِ `Unknown` (khroma) در
[`scripts/license-exceptions.json`](../scripts/license-exceptions.json) با دلیل ثبت
شده. **مرجعِ نهایی، خروجیِ زنده‌ی گیت است، نه این جدول** — اگر درخت عوض شد، دوباره
`pnpm license:list` بگیر.

---

## دو مسئله‌ی شناخته‌شده در `@excalidraw/excalidraw`

### ۱. دانلود فونت از CDN خارجی — **حل شد**

Excalidraw اگر `window.EXCALIDRAW_ASSET_PATH` ست نشده باشد، فونت‌هایش را از
`https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/` می‌گیرد. این هم اصل P2 را
نقض می‌کند و هم از داخل ایران قابل اتکا نیست — و چون **بی‌صدا** اتفاق می‌افتد
(هیچ خطایی نمی‌دهد)، به‌راحتی تا production می‌رسد.

**راه‌حل پیاده‌شده:**

- `packages/canvas-core/scripts/copy-excalidraw-fonts.mjs` فونت‌ها را خودمیزبان می‌کند
  (هوک `predev` / `prebuild:demo`)
- `src/engine/asset-path.ts` → `assertAssetPathConfigured()` که `HamboomCanvas`
  قبل از رندر صدا می‌زند و نبود تنظیم را به خطای صریح تبدیل می‌کند
- چهار تست در `test/smoke.test.tsx` این نگهبان را می‌آزمایند

> **برای `apps/web` در آینده:** همین کپی و همین تنظیم باید در build اپ اصلی هم
> انجام شود. این یک وظیفه‌ی صریح ماژول M5 (infra) است.

### ۲. حجم دارایی‌ها و وابستگی‌های اضافه — **بازِ باز، برای فاز حذف**

فونت‌های شیپ‌شده: **۲۳۴ فایل، ۱۴ مگابایت** در ۹ خانواده —
`Assistant` (عبری)، `Cascadia`، `ComicShanns`، `Excalifont`، `Liberation`،
`Lilita`، `Nunito`، `Virgil`، `Xiaolai` (چینی، بیش از ۲۰۰ فایل subset).

دو نکته:

1. **هیچ‌کدام خط عربی/فارسی را پوشش نمی‌دهند.** با `grep` روی نام فایل‌ها و
   خانواده‌ها تایید شد. یعنی متن فارسی روی بوم **قطعاً** به فونت fallback مرورگر
   می‌افتد مگر اینکه Vazirmatn را خودمان در رجیستری فونت موتور ثبت کنیم.
   این گام ۱٫۲ را از «خوب است باشد» به **پیش‌نیاز قطعی spike گام ۱٫۳** تبدیل می‌کند.
2. `Xiaolai` (چینی) و `Assistant` (عبری) برای هم‌بوم بی‌مصرف‌اند و بخش عمده‌ی
   آن ۱۴ مگابایت‌اند. همچنین `mermaid` (از طریق `@excalidraw/mermaid-to-excalidraw`)
   یک وابستگی سنگین است که فیچرش در نقشه‌ی راه هم‌بوم نیست.

> **کار باز:** هرس دارایی‌ها و فیچرهای بی‌مصرف — بخشی از «حذف بخش‌های غیرضروری».
> عمداً الان انجام نمی‌شود: تا قبل از spike گام ۱٫۳ نمی‌دانیم کدام قسمت‌های موتور
> را واقعاً نگه می‌داریم، و هرس زودهنگام یعنی دو بار کار.

---

## قواعد افزودن وابستگی

1. لایسنس را قبل از نصب چک کن. اگر `pnpm license:check` رد کرد، **دور نزن** —
   یا جایگزین پیدا کن یا با دلیل مستند در `license-exceptions.json` ثبت کن.
2. هر وابستگی runtime که تصمیم‌دار است (نه یک utility ساده) در همین سند ثبت شود.
3. وابستگی‌ای که به سرویس خارجی وصل می‌شود، حتی اگر لایسنسش آزاد باشد، اصل P2 را
   نقض می‌کند. مثال بالا نشان می‌دهد این می‌تواند در عمق یک پکیج پنهان باشد.
