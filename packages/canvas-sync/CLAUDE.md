# CLAUDE.md — `@hamboom/canvas-sync`

binder سمتِ کلاینت — پیاده‌سازیِ `CanvasSyncAdapter` روی Yjs. **قلبِ ماژول M2.**

**قبل از کار بخوان:** [TODO.md](../../TODO.md) (فاز ۳)، ★
[`canvas-core/src/sync/README.md`](../canvas-core/src/sync/README.md) (سندِ تحویلِ M1 —
جریانِ داده، چرخه‌ی عمر، جدولِ throttle)، و
[ARCHITECTURE_DECISIONS.md](../../ARCHITECTURE_DECISIONS.md) — به‌ویژه ADR-004،
ADR-012، ADR-022، ADR-024، ADR-026، **ADR-028**، ADR-029.

## خط قرمزها

1. ★ **`applyRemoteChanges` باید با `captureUpdate: "NEVER"` بنویسد**
   ([ADR-026](../../ARCHITECTURE_DECISIONS.md#adr-026)) — از راهِ `commitSystemUpdate`
   در [`canvas-core/src/engine/scene-commit.ts`](../canvas-core/src/engine/scene-commit.ts)،
   نه `updateScene`ِ خام. وگرنه کارِ کاربرِ دیگر در undo stackِ **محلی** می‌نشیند و
   `Ctrl+Z` او کارِ آن یکی را برمی‌گرداند — همان چیزی که
   [ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012) منع کرده.
2. ★ **`assertEmittable` در اولین خطِ `emitElementChanges`** — از `canvas-core` قرض
   گرفته می‌شود، از نو نوشته نمی‌شود ([ADR-024](../../ARCHITECTURE_DECISIONS.md#adr-024)).
3. ★ **اشتراک‌های موتور باید StrictMode-safe باشند**
   ([ADR-028](../../ARCHITECTURE_DECISIONS.md#adr-028)). این پکیج دقیقاً همان کاری را
   می‌کند که در M1 زیر StrictMode **مرده مانْد**: اشتراک به `onChange`/`onScrollChange`.
   الگویی که گام ۱٫۱ تایید کرده را به کار ببر؛ الگوی `onReady` را نه.
4. **viewport را از `onScrollChange` بگیر، نه از `getAppState()`** — که درست بعد از
   جابه‌جاییِ نما **یک فریمْ کهنه** است. همین باگ در M1 مکان‌نمای همتا را روی panِ
   خالص جا می‌گذاشت. برای پروجکشن از تابعِ مشترکِ
   [`sceneToOverlayPixel`](../canvas-core/src/ui/presence-projection.ts) استفاده کن.
5. **دیفِ متن باید علیهِ `ytext.toString()`ِ لحظه‌ی تراکنش باشد**، نه علیه عنصرِ
   کَش‌شده — **هم‌کلاسِ همان باگِ کهنگی، ولی این‌بار پیامدش از دست رفتنِ داده‌ی
   کاربر است** (کاراکترِ تازه‌رسیده‌ی همتا «حذف» تفسیر می‌شود). گام ۱٫۳.
6. **کدِ سرور اینجا راه ندارد** — `ws`، `pg`، `ioredis`، `@aws-sdk/*` با ESLint
   خطا می‌شوند. دسترسی به storage/auth از راهِ پورت است
   ([ADR-031](../../ARCHITECTURE_DECISIONS.md#adr-031)).
7. **`packages/shared-types` را تغییر نده** — ★ قیدِ فعالِ M2: این ماژول باید
   **بدون هیچ تغییری** در آن تمام شود. اگر لازم شد، **متوقف شو و بپرس**.

## ساختار (فاز ۳ پرش می‌کند)

| فایل | مسئولیت | گام TODO |
|---|---|---|
| `src/index.ts` | صادراتِ عمومی | ۰٫۲ |
| `src/adapter.ts` | `YjsSyncAdapter` — چرخه‌ی عمر + نگهبانِ echo | ۳٫۱ |
| `src/apply-remote.ts` | ★ نوشتنِ تغییرِ remote با `NEVER` | ۳٫۲ |
| `src/emit-local.ts` | `doc.transact(origin)` + جدولِ throttle | ۳٫۳ |
| `src/undo.ts` | `Y.UndoManager` با `trackedOrigins` | ۳٫۴ |
| `src/awareness.ts` | awareness ↔ `PeerState` + ephemeral | ۳٫۵ |
| `src/assets.ts` | پورتِ `AssetTransport` | ۳٫۶ |
| `dev/` | دموی دو-نمونه‌ای برای G-1الف | ۳٫۷ |

## دستورات

```bash
pnpm --filter @hamboom/canvas-sync test
pnpm --filter @hamboom/canvas-sync typecheck
pnpm --filter @hamboom/canvas-sync lint
```

## چیزهایی که اینجا انجام نمی‌شوند

سرور، اتاق، پایداری، Redis، احراز هویت (کارِ [`apps/realtime`](../../apps/realtime/))؛
ساختارِ سند و codec و migration (کارِ [`ydoc-schema`](../ydoc-schema/)).
