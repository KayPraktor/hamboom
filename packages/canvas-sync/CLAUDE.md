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
3. ★ **اشتراک‌های موتور باید StrictMode-safe باشند** — الگو **تاییدِ تجربی شده**
   ([ADR-032](../../ARCHITECTURE_DECISIONS.md#adr-032)، گام ۱٫۱):

   ```tsx
   const [api, setApi] = useState<CanvasApi | null>(null);
   useEffect(() => {
     if (!api) return;
     return api.onChange(handler); // ← cleanup برمی‌گرداند
   }, [api]);
   return <HamboomCanvas onReady={setApi} />;
   ```

   **اشتراک را داخلِ callbackِ `onReady` نبند** — طبیعی‌ترین کار در نگاه اول است و
   در مرورگر ثابت شد که زیر StrictMode **مرده می‌مانَد**: موتور عنصر می‌سازد ولی
   ری‌اکت هیچ‌وقت خبردار نمی‌شود. برای binder یعنی **بی‌صدا هیچ تغییری emit نمی‌شود**.
   نگهبان: [`e2e/strictmode.spec.ts`](e2e/strictmode.spec.ts).
4. **viewport را از `onScrollChange` بگیر، نه از `getAppState()`** — که درست بعد از
   جابه‌جاییِ نما **یک فریمْ کهنه** است. همین باگ در M1 مکان‌نمای همتا را روی panِ
   خالص جا می‌گذاشت. برای پروجکشن از تابعِ مشترکِ
   [`sceneToOverlayPixel`](../canvas-core/src/ui/presence-projection.ts) استفاده کن.
5. ★ **دیفِ متن باید علیهِ `ytext.toString()`ِ لحظه‌ی تراکنش باشد**، نه علیه عنصرِ
   کَش‌شده ([ADR-034](../../ARCHITECTURE_DECISIONS.md#adr-034)). با پایه‌ی کهنه بازه‌ی
   `delete` به **ایندکسِ اشتباه** می‌افتد و متن **مخدوش** می‌شود، نه فقط ناقص — در
   گام ۱٫۳ سنجیده شد (انتظار «سلام رفیق»، نتیجه «سلام رفیقا»).
   `text` هرگز CRDT نشود؛ فقط `originalText` منبعِ حقیقت است و `text` از آن بازمحاسبه
   می‌شود.

   **★★ دو اندازه‌گیریِ پین‌شده که گام ۳٫۳ باید انجام دهد** — در گام ۱٫۳ عمداً انجام
   نشدند چون به همین binder نیاز دارند، و عددِ ساختگی نوشته نشد:
   - **عرضِ پنجره‌ی کهنگی** — از «remote روی Y.Doc نشست» تا «textarea نشانش می‌دهد».
     یک عددِ میلی‌ثانیه‌ای، نه «ناچیز است».
   - **پرشِ مکان‌نما** وقتی همتا قبل از caret درج می‌کند. تصمیمِ ADR-034 را عوض
     نمی‌کرد (در هر دو مدل یکسان است)، ولی محدودیتِ واقعیِ شکلِ قرارداد است.
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
| `dev/StrictModeProbe.tsx` | probeِ StrictMode (ADR-032) | ۱٫۱ ✅ |
| `dev/` | دموی دو-نمونه‌ای برای G-1الف | ۳٫۷ |

## دستورِ E2E

```bash
pnpm --filter @hamboom/canvas-sync test:e2e   # نیاز: playwright install chromium
```

⚠️ **تله‌ی محیطیِ ویندوز:** محدوده‌هایی از پورت برای Hyper-V/WSL **رزرو** می‌شوند و
`bind` رویشان `EACCES` می‌دهد — این محدوده‌ها با هر بوت عوض می‌شوند. اگر سرورِ dev
بالا نیامد: `netsh interface ipv4 show excludedportrange protocol=tcp`. (روی ماشینِ
توسعه محدوده‌ی ۵۱۴۸–۵۲۴۷ رزرو بود که **پورتِ ۵۱۸۰ دموی `canvas-core` را هم می‌گیرد**؛
این پکیج روی ۵۲۸۰ نشست.)

## ★★ تله‌ی `UndoManager` (پین‌شده از گام ۱٫۴)

پیش‌فرضِ `new Y.UndoManager(scope)` **وارونه‌ی انتظار** است: فقط تراکنش‌هایی با
origin برابرِ `null` ردیابی می‌شوند. سنجیده شد —

| origin | ردیابی می‌شود؟ |
|---|---|
| `null` · `undefined` | ✔ |
| `"local-user"` · `"remote"` | ✘ |

binder موظف است با originِ **نام‌دار** بنویسد (گروه‌بندیِ ژست، تشخیصِ محلی/remote —
PLAN ۷٫۴). پس اگر `trackedOrigins` جا بیفتد، **undo بی‌صدا هیچ کاری نمی‌کند**: نه
خطا، نه هشدار — کاربر `Ctrl+Z` می‌زند و هیچ اتفاقی نمی‌افتد.

و **`trackedOrigins` جلوی اعمالِ تغییرِ remote را نمی‌گیرد**، فقط نمی‌گذارد در undo
stack بنشیند. یعنی جایگزینِ `captureUpdate: "NEVER"` نیست — آن یکی تاریخچه‌ی **خودِ
موتور** را می‌بندد. **دو سدِ مستقل، هر دو لازم.**

## دستورات

```bash
pnpm --filter @hamboom/canvas-sync test
pnpm --filter @hamboom/canvas-sync typecheck
pnpm --filter @hamboom/canvas-sync lint
```

## چیزهایی که اینجا انجام نمی‌شوند

سرور، اتاق، پایداری، Redis، احراز هویت (کارِ [`apps/realtime`](../../apps/realtime/))؛
ساختارِ سند و codec و migration (کارِ [`ydoc-schema`](../ydoc-schema/)).
