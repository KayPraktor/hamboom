# sync/ — قرارداد بین بوم و لایه‌ی همگام‌سازی

> **این سند تحویل‌دهی به ماژول M2 است.** هرچه M2 لازم دارد بداند اینجاست.

```
┌───────────────────────┐                          ┌──────────────────────┐
│    canvas-core        │  ElementChangeSet ─────▶ │  CanvasSyncAdapter   │
│    (این پکیج)         │  PointerState             │  (ماژول M2)          │
│                       │  Viewport، انتخاب         │                      │
│  بدون شبکه            │  EphemeralPayload         │  Yjs, WebSocket,     │
│  بدون Yjs             │                          │  Redis, Postgres     │
│  بدون احراز هویت      │ ◀───── PeerState          │                      │
│                       │ ◀───── ConnectionState    │                      │
│                       │ ◀───── SaveState          │                      │
│                       │ ◀───── CanvasDocument     │                      │
└───────────────────────┘                          └──────────────────────┘
```

## چرخه‌ی عمر

```
1. بوم mount می‌شود
2. adapter.connect(inbound)  ──▶  آداپتور inbound را نگه می‌دارد
3.                           ◀──  inbound.setConnectionState({ status: "connecting" })
4.                           ◀──  inbound.replaceDocument({ elements, assets, appState })
5.                           ◀──  inbound.setPermissions({ canEdit, ... })
6.                           ◀──  inbound.setConnectionState({ status: "connected", peers })
7. بوم رندر می‌شود           ──▶  outbound.emitReady()
8. ... کار عادی ...
9. بوم unmount می‌شود        ──▶  adapter.disconnect()
```

## دو سناریوی اصلی

### الف) کاربر یک استیکی می‌سازد

```
کاربر کلیک می‌کند
  └─ tools/sticky-tool → دو عنصر می‌سازد (ظرف + متن مقید)
      └─ outbound.emitElementChanges({
             upserted: [ظرف, متن],
             deleted: [],
             origin: "local-user",
             gestureId: "g_17"        ← هر دو عنصر یک ژست‌اند
         })
          └─ آداپتور: assertEmittable(changes)     ← نگهبان echo
              ├─ inbound.setSaveState({ status: "saving" })
              ├─ روی Y.Doc اعمال و به شبکه
              └─ inbound.setSaveState({ status: "saved", at })
```

### ب) تغییری از راه دور می‌رسد

```
از شبکه
  └─ آداپتور Y.Doc را به‌روز می‌کند
      └─ inbound.applyRemoteChanges({ ..., origin: "remote" })
          └─ بوم اعمال می‌کند و ★ هیچ emit ای نمی‌کند
```

## ★ حلقه‌ی echo — مهم‌ترین تله‌ی این معماری

اگر بوم تغییری را که با `applyRemoteChanges` گرفته دوباره `emit` کند، طرف مقابل
هم همین کار را می‌کند و دو کلاینت تا ابد به هم پیام می‌دهند. **هیچ خطایی
نمی‌دهد** — هر پیام از نظر ساختاری معتبر است. فقط CPU و پهنای باند می‌سوزد و
سند بی‌دلیل رشد می‌کند.

به‌جای اعتماد به بوم، **آداپتور در مرز چک می‌کند**:

```ts
emitElementChanges(changes) {
  assertEmittable(changes);   // روی origin === "remote" خطا می‌دهد
  ...
}
```

هر پیاده‌سازی `CanvasSyncAdapter` **باید** این خط را داشته باشد.

## قواعد throttle — در بوم، نه در آداپتور

بوم می‌داند یک ژست کی تمام می‌شود؛ آداپتور نمی‌داند. جدول کامل در
[PLAN بخش ۷٫۴](../../../../PLAN.md):

| رویداد | فرکانس |
|---|---|
| `emitPointer` | throttle ۴۰ms |
| `emitViewport` | throttle ۱۰۰ms |
| `emitElementChanges` هنگام درگ | throttle ۵۰ms + commit نهایی در drop |
| تایپ در متن | debounce ۱۵۰ms |
| استروک قلم | فقط **یک** commit در `pointerup` |
| ساخت/حذف/تغییر استایل | فوری |

## آنچه M2 باید پیاده کند

- [ ] `CanvasSyncAdapter` روی Yjs + y-protocols
- [ ] `assertEmittable` در `emitElementChanges` — غیرقابل‌حذف
- [ ] نگاشت `ElementChangeSet` ↔ ساختار `Y.Doc` ([PLAN بخش ۷٫۱](../../../../PLAN.md))
- [ ] `origin` گذاری روی تراکنش‌های Yjs تا `Y.UndoManager` کار دیگران را برنگرداند
- [ ] awareness → `PeerState[]`
- [ ] `EphemeralPayload` روی کانال awareness — **هرگز داخل `Y.Doc`** ([ADR-022](../../../../ARCHITECTURE_DECISIONS.md#adr-022))
- [ ] `requestAssetUpload` → presigned URL (باینری هرگز در سند)
- [ ] `SaveState` که **حقیقت** را بگوید، نه خوش‌بینی
- [ ] اعمال `CanvasPermissions` — **در سرور هم**، نه فقط UI ([ADR-012](../../../../ARCHITECTURE_DECISIONS.md#adr-012))
- [ ] ★ **`applyRemoteChanges` باید صحنه را با `captureUpdate: "NEVER"` بنویسد**
      ([ADR-026](../../../../ARCHITECTURE_DECISIONS.md#adr-026)). وگرنه تغییری که از
      کاربر دیگر می‌رسد در undo stack محلی این کاربر می‌نشیند و `Ctrl+Z` او کار
      دیگری را برمی‌گرداند — همان چیزی که ADR-012 منع کرده. مکمل نگهبان echo.

## گپ‌های شناخته‌شده که M2 باید پر کند

این‌ها عمداً در M1 انجام نشدند و اینجا ثبت می‌شوند تا گم نشوند.

### G-1 — تست دو-نمونه‌ای با بوم واقعی

معیار پذیرش گام ۲٫۲ می‌گفت: «دو نمونه‌ی `<HamboomCanvas>` را با یک آداپتور
مشترک mount کن؛ ساخت استیکی در یکی، در دیگری ظاهر شود.»

در M1 به‌جایش آداپتور با یک بوم **ساختگی** آزموده شد
([`contract.test.ts`](./contract.test.ts)). دلیل: جلوگیری از echo خاصیت
آداپتور و قرارداد است نه کامپوننت React، و mount کردن دو موتور رندر در jsdom
— که پیکسل ندارد — تستی می‌ساخت کندتر و شکننده‌تر بدون اینکه چیز بیشتری
اثبات کند.

**ولی یک چیز را اثبات نمی‌کند:** اینکه *binder واقعی بوم* هم قاعده را رعایت
می‌کند، یعنی تغییری که با `applyRemoteChanges` می‌رسد را دوباره `emit` نکند.
تست فعلی فقط ثابت می‌کند اگر بوم بد رفتار کرد، آداپتور می‌گیردش.

**M2 باید:** وقتی binder واقعی (`ydoc-schema/binder.ts`) ساخته شد، تست
دو-نمونه‌ای را با بوم واقعی در مرورگر بنویسد. تا آن موقع binder وجود ندارد،
پس این تست در M1 اصلاً قابل نوشتن نبود.

### G-2 — تست رگرسیون هش پیکسلی جهت متن

[ADR-025](../../../../ARCHITECTURE_DECISIONS.md#adr-025) با یک wrapper روی
`fillText` کار می‌کند و **بی‌صدا** می‌شکند اگر نسخه‌ی بعدی موتور مسیر رندر را
عوض کند. تشخیص فعلی: شمارنده‌ی زنده در صفحه‌ی `#spike` که در چک‌لیست ارتقای
نسخه‌ی [`patches/README.md`](../../../../patches/README.md) ثبت شده.

**M2 یا گام ۶٫۱ باید:** تست خودکار مرورگری با Playwright که خروجی پیکسلی متن
مخلوط فارسی/لاتین را با و بدون wrapper مقایسه کند. در M1 اضافه نشد چون یک
وابستگی سنگین را فقط برای یک تست می‌آورد.

## مرجع پیاده‌سازی

[`local-adapter.ts`](./local-adapter.ts) یک پیاده‌سازی کامل **بدون هیچ I/O** است.
`LocalSyncHub` جای سرور را می‌گیرد و چند آداپتور می‌توانند به آن وصل شوند.
تست‌های [`contract.test.ts`](./contract.test.ts) رفتارهایی را می‌آزمایند که
آداپتور واقعی هم باید داشته باشد — از جمله سناریوی «بوم بدرفتار» که ثابت می‌کند
نگهبان echo واقعاً کار می‌کند.
