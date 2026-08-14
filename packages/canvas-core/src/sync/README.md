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

## آنچه M2 باید پیاده کند — ✅ **همه انجام شد (M2 تحویل شد، ۱۴۰۵/۰۵/۲۳)**

پیاده‌سازی در [`packages/canvas-sync`](../../../canvas-sync/) است؛ شرحِ کاملش در
[`canvas-sync/README.md`](../../../canvas-sync/README.md).

- [x] `CanvasSyncAdapter` روی Yjs + y-protocols — `YjsSyncAdapter`
- [x] `assertEmittable` در `emitElementChanges` — **اولین خط**، از همین پکیج قرض گرفته شد
- [x] نگاشت `ElementChangeSet` ↔ ساختار `Y.Doc` — در
      [`ydoc-schema`](../../../ydoc-schema/)، **per-property** (ADR-007/ADR-033)
- [x] `origin` گذاری روی تراکنش‌های Yjs — `LocalOrigin`ِ کلاس‌دار، حاملِ `gestureId`.
      ⚠️ پیش‌فرضِ `Y.UndoManager` **فقط `null` را ردیابی می‌کند**، پس `trackedOrigins`
      اجباری است (ADR-035)
- [x] awareness → `PeerState[]`
- [x] `EphemeralPayload` روی کانالِ **جدا**، نه داخلِ stateِ awareness
      ([ADR-036](../../../../ARCHITECTURE_DECISIONS.md#adr-036)) — و هرگز داخلِ `Y.Doc`
      ([ADR-022](../../../../ARCHITECTURE_DECISIONS.md#adr-022))
- [x] ⚠️ `requestAssetUpload` — **پورت ساخته شد، نه presigned URLِ واقعی.**
      `AssetTransport` + پیاده‌سازیِ توسعه؛ مسیرِ واقعی به `apps/api` و
      `packages/storage` نیاز دارد که کارِ **M3** است (P4،
      [ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031)). باینری هرگز در سند نرفت.
- [x] `SaveState` که حقیقت را بگوید — update **قبل از** ack در Postgres می‌نشیند
      ([ADR-009](../../../../ARCHITECTURE_DECISIONS.md#adr-009)، ۳۰–۳۵ms اندازه‌گیری‌شده)،
      و تا وقتی سیم قطع است **هیچ‌وقت** `saved` نمی‌گوید
- [x] اعمالِ `CanvasPermissions` **در سرور** روی **هر** update
      ([ADR-012](../../../../ARCHITECTURE_DECISIONS.md#adr-012)) — تصمیمش فقط در
      `apps/realtime/src/permission.ts`. سمتِ کلاینت (`permissions.ts`) عمداً
      **advisory** است، نه گیت
- [x] ★ `applyRemoteChanges` با `captureUpdate: "NEVER"` — از راهِ
      `commitSystemUpdate` ([ADR-026](../../../../ARCHITECTURE_DECISIONS.md#adr-026)).
      ⚠️ **دو سدِ مستقل‌اند و هر دو لازم:** `trackedOrigins` تاریخچه‌ی Yjs را
      می‌بندد، `NEVER` تاریخچه‌ی **موتور** را

## گپ‌های شناخته‌شده که M2 باید پر کند

این‌ها عمداً در M1 انجام نشدند و اینجا ثبت می‌شوند تا گم نشوند.

### G-1 — تست دو-نمونه‌ای با بوم واقعی — ✅✅ **بسته شد (M2، گام‌های ۳٫۷ و ۶٫۱)**

> **★★ نیمه‌ی دوم هم بسته شد** در
> [`canvas-sync/e2e/g1-server.spec.ts`](../../../canvas-sync/e2e/g1-server.spec.ts)
> (گام ۶٫۱): همان سناریو روی **سرورِ realtimeِ واقعی**، با دو پنل روی **دو نودِ
> جدا** (Postgres + Redis)، و همگرایی بعد از یک قطعیِ ۱۰ثانیه‌ای که با **مقایسه‌ی
> بردارِ وضعیت** سنجیده می‌شود، نه چشمی.
>
> ★ **و هیچ harnessِ دومی نوشته نشد**: همان صفحه، همان کامپوننت‌ها، همان اوراکلِ
> پروجکشن — فقط ترابری عوض شد (`SyncTransport`، قولِ ADR-030).
>
> ⚠️ **و همان‌جا یک باگِ واقعیِ خوشه پیدا شد** (F-2): بینِ مرگِ نودِ صاحب و انقضای
> اجاره‌ی قفل هیچ نودی صاحب نیست، پس updateِ کلاینت هیچ‌جا پایدار نمی‌شد و
> می‌توانست **بی‌صدا** گم شود. رفع شد با تبادلِ حالت هنگام بازکردنِ اتاق
> ([ADR-041](../../../../ARCHITECTURE_DECISIONS.md#adr-041)).
>
> ── نیمه‌ی اول (گام ۳٫۷) ──────────────────────────────────────────────
>
> **★ بسته شد در [`canvas-sync/e2e/presence-render.spec.ts`](../../../canvas-sync/e2e/presence-render.spec.ts)**
> — دو `<HamboomCanvas>`ِ واقعی زیر StrictMode روی یک hub، بدونِ سرور. هر چهار
> زیرمورد سبز و پایدار (سه اجرای متوالی): sync + نگهبانِ echo · رندرِ حضور ·
> re-project با panِ خالص و zoom · follow.
>
> ⚠️ **و همان‌جا یک باگِ RTL در همین پکیج پیدا شد** ([`peer-cursors.css`](../ui/peer-cursors.css)
> و [`peer-selections.css`](../ui/peer-selections.css)): مبدأ با
> `inset-inline-start` تعیین می‌شد که در سندِ RTL به `right: 0` ترجمه می‌شد و
> مکان‌نما به اندازه‌ی کلِ عرضِ بوم پرت می‌شد. `transform` همیشه درست بود، پس تستِ
> واحد — که در jsdom **layout ندارد** — سبز می‌مانْد. رفع شد (تاییدِ مالک) و
> نگهبانش همان تستِ مرورگری است که پیکسلِ **واقعی** را با پروجکشنِ **دست‌محاسبه**
> می‌سنجد.
>
> **نیمه‌ی دوم** (همین سناریو با سرورِ واقعیِ WebSocket) در گام ۶٫۱ی M2 انجام شد — بالا.

<details>
<summary>متنِ اصلیِ گپ (بایگانی)</summary>

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

> **★ زیرساختش آماده است (گام ۶٫۱):** حالا Playwright + harnessِ E2E هست
> ([`e2e/`](../../e2e/)، `pnpm --filter @hamboom/canvas-core test:e2e`). نیمه‌ی
> **رندرِ حضور** (پایین) با همین harness خودکارشدنی است؛ فقط نیمه‌ی **sync** منتظرِ
> binderِ M2 است. الگوهای مفید در همان harness: focusِ کانتینر برای کیبورد،
> `#a5d8ff` برای کلیک‌پذیریِ شکل، و **نپیچاندنِ دمو در StrictMode** (با APIِ امریِ
> موتور ناسازگار است — [`dev/main.tsx`](../../dev/main.tsx)).

**این تست باید رندرِ حضور را هم پوشش دهد** (از گام ۴٫۴). در M1 حضور با یک
`BroadcastChannel`ِ دوم در همان تب تایید شد، نه دو موتورِ واقعی. با binder، تست باید:

- مکان‌نما/هاله/آواتارِ همتا از `applyPeers` در نمونه‌ی مقابل رندر شود.
- **re-projectِ حضور با هر تغییرِ viewport** — شاملِ **panِ خالص** و zoom. ★ برای
  پروجکشن **از تابعِ مشترکِ [`sceneToOverlayPixel`](../ui/presence-projection.ts)
  استفاده کن، از نو ننویس** (منبعِ واحد، ADR-024). آن تابع `viewport` را ورودیِ
  **صریح** می‌گیرد؛ مقدارش را از **`onScrollChange`** بده، نه از `api.getAppState()`
  که درست بعد از یک جابه‌جاییِ نما **یک فریمْ کهنه** است — همان باگِ Q1 که در دمو
  panِ خالص مکان‌نمای همتا را سرِ جای صفحه جا می‌گذاشت. و با هر تغییرِ viewport
  re-render بده.
- follow کردنِ همتا با viewportِ مستقلِ دو موتور.

</details>

### G-2 — رگرسیونِ جهتِ متن — ✅ **انجام شد (گام ۶٫۱)**

[ADR-025](../../../../ARCHITECTURE_DECISIONS.md#adr-025) با یک wrapper روی
`fillText` کار می‌کند و **بی‌صدا** می‌شکند اگر نسخه‌ی بعدی موتور مسیر رندر را
عوض کند. حالا [`e2e/text-direction.spec.ts`](../../e2e/text-direction.spec.ts)
در مرورگرِ واقعی می‌سنجد که **شمارنده‌ی فراخوانیِ wrapper هنگام رندرِ واقعی > ۰**
است — همان ملاکی که خودِ ADR-025 گذاشته؛ اگر موتور از fillText رد نشود، صفر می‌ماند.

**یافته‌ی ثبت‌شده:** «هش پیکسلیِ جهت» شدنی نبود — `getImageData` روی canvasِ GPUـیِ
موتور بلانک است، اثرِ خودِ `ctx.direction` در Chromiumِ هدلس پیکسلی سنجش‌پذیر نیست،
و golden از canvas به‌خاطرِ seedِ rough.js ناپایدار است. پس نگهبانِ قطعی همان شمارنده
است (جزئیات در سرِ فایلِ spec و [`canvas-core/CLAUDE.md`](../../CLAUDE.md)).

## مرجع پیاده‌سازی

[`local-adapter.ts`](./local-adapter.ts) یک پیاده‌سازی کامل **بدون هیچ I/O** است.
`LocalSyncHub` جای سرور را می‌گیرد و چند آداپتور می‌توانند به آن وصل شوند.
تست‌های [`contract.test.ts`](./contract.test.ts) رفتارهایی را می‌آزمایند که
آداپتور واقعی هم باید داشته باشد — از جمله سناریوی «بوم بدرفتار» که ثابت می‌کند
نگهبان echo واقعاً کار می‌کند.
