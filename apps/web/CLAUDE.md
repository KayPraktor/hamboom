# CLAUDE.md — `@hamboom/web`

اپِ وبِ کاربر — احراز هویت، داشبورد، پوسته‌ی بورد، نوار ابزار. **ماژول M3، فاز ۸–۹.**
React 19 + Vite 6 + TypeScript + TanStack Router (code-based) + TanStack Query.

**قبل از کار بخوان:** [TODO فاز ۸](../../TODO-M3-backend-api.md) · [PLAN §۵](../../PLAN.md) ·
ADRها: **[ADR-016](../../ARCHITECTURE_DECISIONS.md#adr-016)** (RTL) ·
**[ADR-017](../../ARCHITECTURE_DECISIONS.md#adr-017)** (فونت) ·
**[ADR-032](../../ARCHITECTURE_DECISIONS.md#adr-032)** (StrictMode) ·
**[ADR-035](../../ARCHITECTURE_DECISIONS.md#adr-035)** (undo) · ADR-038 (رد ≠ بستن).

## خط قرمزها

1. **P2 — هیچ سرویسِ خارجی در runtime.** بدون Google Fonts، CDN، Sentry SaaS.
   فونتِ Vazirmatn **خودمیزبان** از `@fontsource-variable/vazirmatn` (OFL-1.1). هر
   دارایی باید از خودِ اپ سرو شود. (آزموده: همه‌ی requestها روی `127.0.0.1`.)
2. **P6 — RTL واقعی.** `<html dir="rtl" lang="fa">` + **فقط** logical properties
   (`margin-inline-start`، نه `margin-left`). گیتِ Stylelintِ داخلِ verify اعمالش
   می‌کند (آزموده با شکستنِ عمدی). ⚠️ **استثنا: مختصاتِ بوم هرگز آینه نمی‌شود** (فاز ۸٫۴).
3. ★ **StrictMode-safe از خط اول** ([ADR-032](../../ARCHITECTURE_DECISIONS.md#adr-032)).
   بایندرِ بوم (۸٫۴) باید اشتراک را در `useEffect([api])` با cleanup بگذارد، **نه**
   در `onReady` — وگرنه زیرِ StrictMode بی‌صدا مرده می‌مانَد. اپ عمداً زیرِ StrictMode است.
4. ★ **access-token در حافظه، نه `localStorage`** (فاز ۸٫۲). فقط کوکیِ refreshِ
   HttpOnly پایدار است؛ `sdk` خودش ۴۰۱→refresh→retry را دارد.
5. **تنها کلاینتِ API `@hamboom/sdk` است.** هیچ `fetch`ِ خام به api زده نمی‌شود —
   قرارداد و ۴۰۱-refresh و §۵ error همه آنجاست.
6. ★ **fail-closed** (۸٫۴): نقشِ ناشناخته → `viewer`؛ `token()` برای **هر تلاش**
   تازه؛ `undefined`/`null` قاطی نشوند ([درسِ M2](../realtime/CLAUDE.md)).

## ★ تصمیم: روترِ code-based (نه file-based)

گیتِ `typecheck`ِ verify با `tsc`ِ خالص اجرا می‌شود، بدونِ Vite. پلاگینِ
file-based یک `routeTree.gen.ts` می‌سازد که هنگامِ `tsc` باید از قبل باشد —
یعنی یا فایلِ تولیدی commit شود یا هوکِ codegen پیش از typecheck. code-based هر
دو را حذف می‌کند و کاملاً typed می‌مانَد. مسیرها در [`src/router.tsx`](src/router.tsx).

## ساختار

| مسیر | چیست | فاز |
|---|---|---|
| `index.html` · `src/main.tsx` | ریشه: RTL، StrictMode، QueryClient، ErrorBoundary | ۸٫۱ ✅ |
| `src/router.tsx` · `src/routes/` | روترِ code-based + صفحات | ۸٫۱ ✅ |
| `src/fonts.ts` | گیتِ `document.fonts.ready` (برای بوم، ۸٫۴) | ۸٫۱ ✅ |
| `src/styles/app.css` | تمِ روشن/تیره + پوسته + فرم‌ها، فقط logical properties | ۸٫۱ ✅ |
| `src/api/client.ts` | singletonِ `sdk` (access در حافظه، `baseUrl=""`) | ۸٫۲ ✅ |
| `src/auth/` | `LoginPage` (موبایل/OTP) · `SessionProvider`+`session-context` · `RequireAuth` · `validate` | ۸٫۲ ✅ |
| `src/dashboard/` | فهرست/ساخت/نشان/جستجو + **ریلِ فولدرِ per-team** (`FolderNav`) + **سطلِ بازیافت** + منوی کارت (`BoardCardMenu`) | ۸٫۳ ✅ |
| `src/team/` | اعضا/دعوت/نقش + پذیرشِ دعوت | ۸٫۳ ✅ |
| `src/board/` | پوسته‌ی بورد: `HamboomCanvas` + `YjsSyncAdapter` + گرفتنِ ویرایشِ محلی + **مکان‌نمای زنده‌ی همتا** + **نوار ابزارِ عمودی** | ۸٫۴/۸٫۵/۹٫۱ ✅ |

## ★ حضور و دو یافته‌ی ۸٫۵ (لمسِ M1/M2 با تاییدِ مالک)

- **مکان‌نمای زنده (یافته‌ی ۳):** `BoardPage` مکان‌نمای محلی را از propِ نو `onPointerUpdate`ِ `HamboomCanvas`
  می‌گیرد (موتور **مختصاتِ صحنه** می‌دهد، بی‌تبدیل)، `emitPointer` می‌کند، `applyPeers`→state، و `PeerCursors`ِ M1
  را با `sceneToOverlayPixel` رندر می‌کند. نما از `onScrollChange` (نه getAppState — درسِ Q1). **تکرارِ فرمولِ
  پیکسل→صحنه صفر است** (ADR-024). لمسِ **M1**: propِ افزایشیِ `onPointerUpdate`.
- **مهرِ تنبلِ `schemaVersion` (یافته‌ی ۲):** `BoardPage` یک `new Y.Doc()`ِ ساده می‌دهد، نه `createBoardDoc()` —
  وگرنه هر باز شدنِ تب یک opِ اضافی (کلاینتِ فانتوم در state vector) می‌ساخت. adapter (**M2**) نسخه را روی اولین
  نوشتنِ واقعی و فقط اگر بی‌نسخه باشد مهر می‌زند.

## ★★ گرفتنِ ویرایشِ محلی — تکه‌ای که M1/M2 به M3 سپرد (فاز ۸٫۴)

`createCanvasBinding` فقط **remote→بوم** است. طرفِ **محلی** (ویرایشِ کاربر → سرور) کارِ اپ است و
دموها فقط ژست‌های خاص (استیکی/تصویر) را دستی emit می‌کردند. [`BoardPage`](src/board/BoardPage.tsx) این
پل را می‌سازد:

- **`onChange` = فقط تغییرِ محلی.** تله‌ی M1: `updateScene`ِ **برنامه‌ای** (اعمالِ remote) `onChange` را
  fire **نمی‌کند** — پس onChange یعنی ویرایشِ کاربر و اکو ممکن نیست.
- **ضدِ اکو:** `known` (id→version) روی هر اعمالِ remote هم به‌روز می‌شود (binding پیچیده می‌شود) تا دیف
  عنصرِ همتا را دوباره emit نکند.
- **★★ emitِ زنده (نه settle):** debounce **ندارد** — هر onChange روی یک `queueMicrotask` دیف و emit می‌شود؛
  throttleِ واقعی کارِ `createEmitScheduler`ِ canvas-sync است (۵۰ms درگ / فوریِ ساخت‌وحذف / ۱۵۰ms متن). اگر اپ
  اینجا هم debounce کند، scheduler حالت‌های میان‌درگ را **هرگز نمی‌بیند**. ⚠️ **`queueMicrotask` نه `requestAnimationFrame`:**
  rAF در تبِ پس‌زمینه می‌ایستد (سنجیده شد: درگ آنجا فقط ۱ update).
- **گروه‌بندیِ ژست:** `gestureId` از [`gesture-tracker.ts`](src/board/gesture-tracker.ts) می‌آید — در طولِ یک درگ
  **ثابت**، بینِ ژست‌ها نو (مرز از فاصله‌ی زمانی). scheduler با همان id گروه می‌کند → یک درگ = یک ورودیِ undo = یک
  `Ctrl+Z` (وگرنه تله‌ی «بی‌ژست» یا «هر تیک یک ورودی» M2). تست‌دار و خودآزمون.
- `fromExcalidraw` عنصرِ موتور را به `HbElement` می‌بَرد؛ نوعِ نگاشت‌نشده رد می‌شود.
- **پیام‌های پروتکل ([ADR-047](../../ARCHITECTURE_DECISIONS.md#adr-047)):** `onProtocolError` یک نوتیسِ فارسی نشان
  می‌دهد (نه console-only) — `error.message` از قبل فارسیِ آماده است. رشته‌ها در `canvas-sync` می‌مانند، به i18n نمی‌روند.

## ★ نوار ابزارِ عمودی (فاز ۹٫۱)

نوار ابزارِ عمودیِ شبیه‌میرو روی بومِ وصل‌شده. **همه از canvas-core reuse شد** (ADR-024) — تنها لمسِ نو، propِ
افزایشیِ `orientation="vertical"` روی `Toolbar`ِ **M1** است (تاییدِ مالک ۱۴۰۵/۰۶/۱۲، در PROGRESS مثلِ B-1 ثبت).

- **نوار همان `Toolbar`ِ canvas-core است** با `orientation="vertical"` (نه کامپوننتِ نو). `selectTool` نگاشتِ
  `ToolId`→رفتار است: موتور با `setActiveTool` (شکل=rectangle، کانکتور=arrow، فریم/متن/پاک‌کن)، استیکی/قلمِ سفارشی
  با `activate`، تصویر با انتخابگرِ فایل. میان‌برها از `toolForShortcut` (یک منبع). پالتِ ۱۲رنگه از `HB_STICKY_PALETTE`.
- **★★ نوشتنِ برنامه‌ایِ ابزار onChange نمی‌دهد (تله‌ی M1) → `flushLocal`ِ دستی.** استیکی/تصویر/قلم برنامه‌ای به
  صحنه می‌نویسند، پس `onChange` (که emitِ 8.4 را می‌زند) fire نمی‌شود؛ هر ابزار در callbackِ پایانش
  (`onCreated`/`onInserted`/`onCommitted`) `flushLocal` می‌کند — همان مسیرِ تک‌emit که `known` را هم درست نگه می‌دارد.
  ابزارهای موتور (شکل/متن/کانکتور/فریم/پاک‌کن) با درگِ **واقعیِ کاربر** onChange می‌دهند و خودکار emit می‌شوند.
- **★ قلم: ضدِ دو-emit.** `DrawTool` هم صحنه را می‌نویسد هم `emitElementChanges` دارد؛ چون flushLocal تنها مسیرِ
  emit است، `emitElementChanges`ِ ابزار **no-op** است و `emitEphemeral`→outboundِ واقعی (پیش‌نمایشِ زنده‌ی همتا).
  روکشِ استروکِ محلی از `sceneToOverlayPixel`ِ مشترک رندر می‌شود (صفر importِ excalidraw در web).
- **★ ابزارِ فعالِ همتا:** `emitActiveTool(id)` روی هر انتخاب؛ برچسبِ همتا از همان `HB_TOOLS` (i18n). **قرارداد از
  M2 بود** (`emitActiveTool`/`PeerState.activeTool`؛ awareness relayش می‌کند) — **صفر لمسِ M2/shared-types**.
- **استیکی بعد از یک قراردهی خودش deactivate می‌شود (M1)** → `onCreated` UI را به «انتخاب» برمی‌گرداند (پالت بسته می‌شود).
- **⚠️ تصویر به فاز ۱۱٫۲ موکول:** adapter بدونِ `assets` است → `requestAssetUpload` خطا می‌دهد؛ نوتیسِ گراسفول
  (وایرینگ آماده، فقط `assets:` به adapter در ۱۱٫۲). `createLocalAssetTransport` عمداً **نه** (بلابِ per-page، بی‌sync).
- **✅ نوار ابزارِ نیتیوِ excalidraw پنهان شد** (پولیشِ ۹٫۱، تاییدِ مالک ۱۴۰۵/۰۶/۱۲): `HamboomCanvas` با `hideNativeUI`
  رندر می‌شود (لمسِ M1ِ دوم، با CSS نه zenMode). چون فوترِ زوم/undoِ نیتیو هم رفت، `ZoomControl`ِ **خودِ canvas-core**
  (reuse) وصل شد (`applyZoom`/`fitToScreen` با `zoomAroundCenter`/`zoomStep`) و با CSSِ اپ به **bottom-end** برده شد تا
  با نوارِ عمودیِ center-start تصادم نکند؛ undo با `Ctrl+Z`.
- **★ کاملیتِ نوار (بیضی/لوزی/خط):** چون chromeِ نیتیو رفت، ابزارهایی که فقط آنجا بودند نباید گم شوند. «شکل» و
  «کانکتور» **فلای‌اوتِ واریانت** دارند (`VariantFlyout`، مثلِ پالتِ استیکی): شکل→مستطیل/بیضی/لوزی، کانکتور→پیکان/خط.
  **سمتِ اپ، بی‌لمسِ M1** — `setActiveTool`ِ نیتیو + `shapeKindRef`/`connectorKindRef` (تا انتخاب/میانبرِ بعدی همان
  واریانت را بزند). خط با pointsِ سالم سینک می‌شود (codec spread-based؛ `line→shape` در نگاشتِ M1).
- **★ لیزر:** ابزارِ موتور `setActiveTool("laser")` (اینرت)، و دنباله از `onPointerUpdate`ِ صحنه‌ای به‌صورت
  `emitEphemeral({kind:"laser"})`. **رندرِ لیزر (محلی و همتا) روی همان روکشِ قلم** با `redrawOverlay`ِ یکپارچه
  (peer.ephemeral + قلم + لیزرِ خودم؛ یک `clearRect`)، رنگِ کاربر. ⚠️ **به رندرِ لیزرِ نیتیوِ موتور تکیه نکن** — با
  رویدادِ مصنوعی نمی‌آید (تله‌ی M1) و رفتارش با ابزار فرق می‌کند؛ لیزرِ محلی را خودت بکش (متقارن با همتا، قابلِ‌اثبات).
  ⚠️⚠️ **کانالِ ephemeral (استروکِ زنده/لیزر) اولین بار همین‌جا end-to-end با سرورِ واقعی اثبات شد** (سرور از M2 relay
  می‌کرد ولی هیچ‌وقت peer-to-peer دیده نشده بود؛ با console-probe + pixel-detector در دو تب). **استروکِ زنده‌ی قلمِ
  همتا هنوز رندر نمی‌شود** (فقط نهایی سینک است)؛ زیرساختش (`redrawOverlay`) حالا هست، `kind:"draw-stroke"` نمانده جز افزودن.
- **viewer:** نوار ابزار/پالت/روکش فقط برای **ویرایشگر** رندر می‌شوند (`ZoomControl` برای همه — ناوبری است)؛
  `selectTool` هم edit-toolها را برای readOnly گیت می‌کند.

## ★★ درسِ اندازه‌گیریِ بوم در مرورگر (فاز ۸٫۴)

اثباتِ رفتارِ بوم دو تله دارد که هر دو وقتم را گرفتند:
- **رویدادهای pointerِ مصنوعی را excalidraw دسته می‌کند:** ۲۰ `pointermove`ِ dispatch‌شده فقط ~۲ onChange دادند
  (رندرِ داخلیِ rAF). برای سنجشِ نرخِ واقعی باید از درگِ **ابزارِ واقعی** (رویدادِ trusted) استفاده کرد.
- **Fast Refresh افکتِ `useEffect([deps])` را با depهای ثابت اجرا نمی‌کند** — پس بعد از ویرایشِ کد، اندازه‌گیری
  با کدِ **کهنه** انجام می‌شود مگر صفحه **کامل reload** شود. (ابزارگذاریِ موقتِ شمارنده حقیقت را نشان داد.)

## ★★ ADR-028 حل شد — تجربی (فاز ۸٫۴)

الگوی امنِ StrictMode (apiِ onReady در **state** + اشتراک در `useEffect([api])`) در مرورگر با
**بومِ واقعی زیر StrictMode** اثبات شد: رسم همگام شد، پنلِ استایلِ excalidraw روی انتخاب باز شد،
و `Ctrl+Z` کار کرد — هیچ‌کدام «مرده» نماند. ریسکِ ثبت‌شده‌ی ADR-028 بسته است.

## فولدر + سطلِ بازیافت (فاز ۸٫۳)

- **سطلِ بازیافت یک افزوده‌ی کوچکِ api خواست:** `GET /boards` مسیرِ `deleted_at IS NULL` را سفت‌کد کرده بود —
  هیچ راهی برای *لیست‌کردنِ* بوردهای حذف‌شده نبود (`remove`/`restore` بود، «دیدنِ سطل» نه). `?trashed=true`
  اضافه شد: پیش‌بندِ حذف برعکس + گیتِ **owner** (مثلِ `assertDeletedBoardOwner`)، نقشِ سطل همیشه `owner`.
  `trashed?` هم به فیلترِ `sdk`. ⚠️ **`shared-types` دست‌نخورد** — `BoardSummary` همان است (سطل فیلد جدید نخواست).
- **فولدر team-first (بدونِ فیلترِ teamId):** فولدرها per-team اند و `BoardSummary` تیم را **ندارد**. `FolderNav`
  برای هر تیمِ نشست فولدرها را می‌گیرد؛ منوی جابه‌جایی (`BoardCardMenu`) `boards.get` می‌زند تا `teamId` (+ فولدرِ
  فعلی) را بگیرد و فقط فولدرهای **همان تیم** را پیشنهاد دهد (جابه‌جاییِ بین‌تیمی را api رد می‌کند).
- **حذفِ فولدر نرم است:** بوردهای داخلش پاک نمی‌شوند و در «همه‌ی بوردها» می‌مانند (به مالکشان نمی‌خورد).
- **منطقِ انتخاب→فیلتر خالص و تست‌دار است** ([`selection.ts`](src/dashboard/selection.ts)) — نگاشتِ
  همه/نشان/سطل/فولدر به `BoardsFilter` بیرونِ React، پس قابلِ تستِ واحد (trash با شکستِ عمدی قرمز شد).
- ⚠️ **فرمِ تک‌inputی نباید فقط به Enter تکیه کند** — دکمه‌ی submit (✓) هم دارد (دسترسی‌پذیری + لمس + اتوماسیون).

## ★ اجرای محلیِ کاملِ زنجیره

```bash
pnpm db:up                                   # postgres 5433 + redis 7379 + minio 9800
APP_ENV=local node --env-file-if-exists=.env apps/api/src/server.ts            # api روی 3002 (SMS mock → کد در لاگ)
RT_PORT=3001 APP_ENV=local node --env-file-if-exists=.env apps/realtime/src/main.ts  # realtime روی 3001 (برای بورد، ۸٫۴)
pnpm --filter @hamboom/web dev               # web روی 15380، پروکسی به 3002، WS به 3001
```

- **بورد (۸٫۴) به هر سه نیاز دارد:** api (rt-token) + realtime (WS، `VITE_RT_URL` پیش‌فرض `ws://127.0.0.1:3001`) + web.
  realtime به **Redis** هم نیاز دارد — اگر «خطای اتصالِ Redis» داد، نکته‌ی پورتِ ۷۳۷۹ در [CLAUDE.mdِ ریشه](../../CLAUDE.md) را ببین.
- **تستِ دو-تبِ همگام:** یک بورد بساز، `/b/<id>` را در **دو تب** باز کن، در یکی رسم کن → در آن یکی زنده دیده می‌شود.
- ⚠️ **کوکیِ refresh مسیرِ `/auth` دارد** — پروکسیِ dev **نباید rewrite کند** وگرنه مرورگر کوکی را برنمی‌گردانَد؛
  `baseUrl`ِ sdk هم `""` است. و **مسیرهای SPA مفردند** (`/team`، `/b`) تا با پیشوندهای پروکسیِ api (`/teams`، `/boards`) تصادم نکنند.

## دستورات

```bash
pnpm --filter @hamboom/web dev         # سرورِ dev روی 15380
pnpm --filter @hamboom/web typecheck
pnpm --filter @hamboom/web lint
pnpm --filter @hamboom/web test
pnpm --filter @hamboom/web build       # tsc --noEmit سپس vite build
```

> **پورتِ dev = 15380** (بیرونِ بازه‌ی dynamic portِ ویندوز؛ مثلِ canvas-core=15180،
> canvas-sync=15280). هوکِ `predev` با `check-dev-port.mjs` بررسی‌اش می‌کند.
