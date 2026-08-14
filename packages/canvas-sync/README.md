# `@hamboom/canvas-sync`

binderِ سمتِ کلاینت — پیاده‌سازیِ `CanvasSyncAdapter`ِ M1 روی `Y.Doc`ِ M2.
**تنها پکیجی که هر دو طرف را می‌بیند** ([ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029)).

> برای کار کردن **روی** این پکیج، [`CLAUDE.md`](CLAUDE.md) را بخوان (خط قرمزها و
> شرحِ کاملِ تله‌ها). این فایل برای **مصرف‌کننده** است — یعنی `apps/web` در M3.

## وصل کردنش به یک اپ

```tsx
import { HamboomCanvas } from "@hamboom/canvas-core";
import { YjsSyncAdapter, createWebSocketTransport, createIndexeddbDocStore } from "@hamboom/canvas-sync";
import * as Y from "yjs";

// ⚠️ سند **قبل از** آداپتور ساخته می‌شود — انبارِ محلی هم به همان نمونه نیاز دارد.
const doc = new Y.Doc();

const adapter = new YjsSyncAdapter({
  doc,
  transport: createWebSocketTransport({
    // ★ نشانی **بدونِ توکن**؛ بورد در خودِ URL است.
    url: `wss://…/rt?board=${encodeURIComponent(boardId)}`,
    // ★★ برای **هر تلاش** دوباره صدا زده می‌شود، نه یک‌بار. با توکنِ کَش‌شده، هر
    //    بازگشت بعد از یک قطعیِ طولانی `TOKEN_EXPIRED` می‌گیرد.
    token: () => mintRtToken(boardId),
  }),
  localStore: createIndexeddbDocStore({ doc, name: `hamboom-${boardId}` }),
  assets: myAssetTransport,          // پورت — پیاده‌سازیِ واقعی‌اش کارِ M3 است
  user: { id, displayName, color, avatarUrl },
  onProtocolError: (error) => toast(error.message),
});

// ★★ اشتراک **باید** این شکل باشد (ADR-032):
const [api, setApi] = useState<CanvasApi | null>(null);
useEffect(() => {
  if (!api) return;
  return api.onChange(handler);      // ← cleanup برمی‌گرداند
}, [api]);
return <HamboomCanvas onReady={setApi} />;
```

⚠️ **اشتراک را داخلِ callbackِ `onReady` نبند.** طبیعی‌ترین کار در نگاهِ اول است و
در مرورگر ثابت شد که زیر StrictMode **مرده می‌مانَد**: موتور عنصر می‌سازد و ری‌اکت
هیچ‌وقت خبردار نمی‌شود — یعنی binder **بی‌صدا هیچ تغییری emit نمی‌کند**
([ADR-032](../../ARCHITECTURE_DECISIONS.md#adr-032)). نگهبانش
[`e2e/strictmode.spec.ts`](e2e/strictmode.spec.ts) است.

⚠️ و اپ **باید** `bindUndoShortcuts` را به کار ببرد
([ADR-035](../../ARCHITECTURE_DECISIONS.md#adr-035)). اگر جا بیفتد، تاریخچه‌ی موتور
دوباره فعال می‌شود و یک `Ctrl+Z` **دو کار** می‌کند.

## چهار پورتی که این پکیج به بیرون دارد

هیچ‌کدام پیاده‌سازیِ محصولی ندارند و همه **عمداً** پشتِ seam ماندند
([ADR-030](../../ARCHITECTURE_DECISIONS.md#adr-030)،
[ADR-031](../../ARCHITECTURE_DECISIONS.md#adr-031)):

| پورت | پیاده‌سازیِ امروز | پیاده‌سازیِ واقعی |
|---|---|---|
| `SyncTransport` | `LocalTransportHub` (تست) · `createWebSocketTransport` (محصولی ✅) | — |
| `LocalDocStore` | `createIndexeddbDocStore` ✅ | — |
| `AssetTransport` | `LocalAssetStore` (توسعه) | **M3** — `packages/storage` + `POST /api/v1/assets` |
| توکن (`token()`) | `signDevToken` | **M3** — endpointِ `rt-token` روی `auth-core` |

## آنچه تضمین می‌کند

- **حلقه‌ی echo ممکن نیست** — `assertEmittable` اولین خطِ `emitElementChanges` است و
  از `canvas-core` **قرض گرفته** می‌شود، از نو نوشته نمی‌شود
  ([ADR-024](../../ARCHITECTURE_DECISIONS.md#adr-024)).
- **`Ctrl+Z` فقط کارِ خودِ کاربر را برمی‌گرداند** — دو سدِ مستقل: `trackedOrigins`
  (تاریخچه‌ی Yjs) و `captureUpdate: "NEVER"` (تاریخچه‌ی موتور). **هر دو لازم‌اند.**
- **تعارض داده نمی‌خورد** — نوشتنِ **افتراقیِ** per-property؛ آزموده روی مسیرِ
  واقعیِ binder در [`src/conflict.test.ts`](src/conflict.test.ts) با پارتیشنِ
  واقعیِ شبکه، نه پخشِ همزمان.
- **همگرایی زیرِ ترتیب‌های رسیدنِ متفاوت** —
  [`src/convergence.test.ts`](src/convergence.test.ts)، با تصادفِ قطعی و یک
  **کنترلِ منفی**.
- **کار از بستنِ تب جان به در می‌بَرد** — سند در IndexedDB، بازیابی **قبل از**
  دست‌دادن، و `SaveState` تا وقتی سیم قطع است **هیچ‌وقت** `saved` نمی‌گوید.
- **اتصالِ مجدد سیاست دارد، نه یک backoffِ یکسان**
  ([ADR-039](../../ARCHITECTURE_DECISIONS.md#adr-039)): ۱۰۰۱ فوری · ۱۰۰۸ بسته به کدِ
  `HB_ERROR` · بقیه backoff **+ jitter**. کدِ ناشناخته **مرگبار** است.

## ★ فهرستِ تله‌های کشف‌شده

شرحِ کاملِ هرکدام در [`CLAUDE.md`](CLAUDE.md).

| تله | نشانه |
|---|---|
| **اشتراک در `onReady` زیر StrictMode مرده می‌مانَد** | binder بی‌صدا هیچ تغییری emit نمی‌کند (ADR-032) |
| **`disconnect` وسطِ `connect`** | observerهای نشتی؛ هر `await`ِ تازه در `connect` **باید** بعدش نگهبانِ نسل داشته باشد |
| **updateِ افزایشیِ بی‌پیشینه** | Yjs در `pendingStructs` **بایگانی می‌کند بدونِ هیچ خطایی** — sync فقط کار نمی‌کند. آشتی باید با `y-protocols/sync` باشد |
| **`y-protocols` خطای داخلِ observer را می‌بلعد** | `EchoLoopError` به هیچ‌کس نمی‌رسد؛ پس تحویل به بوم **بیرونِ** تراکنش انجام می‌شود |
| **شمارنده‌ی awareness باید بینِ اتصال‌ها حفظ شود** | با clockِ کوچک‌تر، همتاها ما را **برای همیشه نامرئی** می‌بینند |
| **پاسخِ همتا در ترابریِ لوکال همزمان برمی‌گردد** | نامتقارن: یک طرف می‌بیند، آن یکی نه |
| **ephemeral نباید فیلدی در stateِ awareness شود** | `encodeAwarenessUpdate` دیف نمی‌گیرد — ۵۳۶۲ بایت در برابرِ ۱۹۸ (ADR-036) |
| **`text` مشتق است** | بعد از ادغام تا بازمحاسبه غلط است؛ همیشه `originalText` را مقایسه کن (ADR-034) |
| **viewport را از `onScrollChange` بگیر** | `getAppState()` درست بعد از جابه‌جاییِ نما **یک فریمْ کهنه** است |
| **لایه‌ی پروجکشن نباید property منطقی برای مبدأ داشته باشد** | در RTL، `inset-inline-start` می‌شود `right: 0`؛ **jsdom layout ندارد** پس تستِ واحد سبز می‌مانَد (B-1) |
| **`LocalTransportHub` «همزمان» نمی‌سازد** | پخشِ هم‌پشته یعنی هر تعارضی سریالی می‌شود؛ برای تستِ تعارض `PartitionHub` لازم است (گام ۶٫۲) |
| **پیامِ پروتکلی بدونِ مصرف‌کننده** | سه بار تکرار شد (`HB_AUTH_REFRESH`، `HB_PERMISSION`، `HB_ERROR`): روی سیم می‌آمدند و `handleMessage` شاخه‌ای برایشان نداشت — بی‌خطا، و **شبیهِ کارکردن** |

## دستورات

```bash
pnpm --filter @hamboom/canvas-sync test
pnpm --filter @hamboom/canvas-sync test:coverage      # گیتِ ۶۰٪ — داخلِ pnpm verify هم هست
pnpm --filter @hamboom/canvas-sync test:e2e           # ۲۸ تست، بدونِ داکر
pnpm --filter @hamboom/canvas-sync test:e2e:server    # ★ داکر لازم دارد (G-1ب)
pnpm --filter @hamboom/canvas-sync dev                # /#pair و /#offline
```

⚠️ **E2E در `pnpm verify` نیست** (مرورگر لازم دارد) ولی ادعاهایی را می‌آزماید که
**فقط** آنجا آزمودنی‌اند — انزوای undo، چرخه‌ی واقعیِ StrictMode، و رندرِ حضور
(jsdom **layout ندارد**). بعد از هر تغییر در `apply-remote.ts`، `awareness.ts` یا
دمو دستی اجرایش کن.

## آنچه اینجا انجام نمی‌شود

سرور، اتاق، پایداری، Redis، احراز هویت → [`apps/realtime`](../../apps/realtime/) ·
ساختارِ سند، codec، migration → [`ydoc-schema`](../ydoc-schema/).
