# PROGRESS — M3 (`backend-api` + اتصالِ `apps/web`)

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۶/۱۲ (2026-09-01)

## ★★ فاز ۹ (`apps/web` — نوار ابزارِ عمودی) — ✅ **گام ۹٫۱** (۱۴۰۵/۰۶/۱۲)

**چه شد:** نوار ابزارِ عمودیِ شبیه‌میرو روی بومِ **واقعاً وصل‌شده** سیم‌کشی شد و **در دو مرورگرِ همگام اثبات شد**.
**همه‌چیز از canvas-core reuse شد** (ADR-024): مدلِ ابزار (`HB_TOOLS`)، میانبرها (`toolForShortcut`)، ابزارهای
سفارشی (`createStickyTool`/`ImageTool`/`DrawTool`)، سازنده‌های موتور (شکل/متن/کانکتور/فریم)، و پالتِ ۱۲رنگه
(`HB_STICKY_PALETTE`). **تنها چیزِ نو، «پوسته‌ی چیدمانِ عمودی» است.**

| چه شد | اثبات در مرورگر |
|---|---|
| نوارِ عمودی روی لبه‌ی **inline-start** (در RTL راست)، وسطِ عمودی؛ ۱۱ ابزار | screenshot؛ `hb-toolbar--vertical hb-overlay--center-start`، aria-orientation عمودی |
| **استیکیِ فارسی** («استیکی فارسی» RTL) از نوار + پالتِ ۱۲رنگه (کلیک «سبز» → استیکیِ سبز) | ساخت + **همگام در تبِ دوم**؛ ۱۲ نامِ فارسی (زرد…مشکی) |
| **کانکتور** (arrow) و **فریم** (دربرگیرنده‌ی استیکی) از نوار | هر دو دیده و **همگام در تبِ دوم** |
| **ابزارِ فعالِ همتا** (`emitActiveTool`→`PeerState.activeTool`) | پیلِ «کاربر 0002 · فریم/انتخاب/قلم» — **دوطرفه** |
| میانبر (`n`→استیکی)، قلم (استروکِ همگام)، ذخیره‌ی پایدار (reload همه را برگرداند) | همه در مرورگر با سرورِ واقعی |

**M1 touch (تاییدِ صریحِ مالک ۱۴۰۵/۰۶/۱۲ — قاعده‌ی گام ۸٫۵، ثبت مثلِ B-1):**

| لمس | تغییر | چرا این شکل | اثبات |
|---|---|---|---|
| **M1** [`Toolbar.tsx`](packages/canvas-core/src/ui/Toolbar.tsx) + `toolbar.css` + `overlay-layout.css` | propِ **افزایشیِ** `orientation?: "horizontal"\|"vertical"` (پیش‌فرض افقی، سازگار با گذشته) + اسلاتِ `--center-start` + flexِ ستونی | Toolbarِ canonical جای درستِ یک toolbar است (`src/ui`)؛ یک نوار/آیکون/مدلِ مشترک (DRY). جای‌گذاری با logical properties (`inset-inline-start` + `translateY`ِ محورِ بلوک) — RTL خودش، بی‌آینه، Stylelint-clean | ۲ تستِ نو در `Toolbar.test.tsx` (پیش‌فرض افقی می‌مانَد؛ vertical کلاس/aria درست)؛ در مرورگر روی لبه‌ی راست |
| **M1** (پولیش) [`HamboomCanvas.tsx`](packages/canvas-core/src/engine/HamboomCanvas.tsx) + [`canvas-chrome.css`](packages/canvas-core/src/engine/canvas-chrome.css) | propِ **افزایشیِ** `hideNativeUI` (پیش‌فرض `false`) → wrapperِ `display:contents` + `display:none` روی chromeِ نیتیو | برای «شبیه‌میرو» باید chromeِ **تکراریِ** excalidraw برود؛ opt-in تا دمو/تست‌های M1 دست‌نخورند. **CSS نه zenMode** (زن‌مود فوترِ نیتیو + «خروج از زن‌مود» را نگه می‌دارد). سلکتورْ ظرفِ ساختاریِ ۰٫۱۸٫۱ (پین، ADR-003=npm؛ با ارتقا بازبینی) | مرورگر: نوار/منو/فوترِ نیتیو `display:none`؛ نوارِ عمودی، رسمِ مستطیل، و زوم سالم |
| **M1** (لیزر) [`toolbar-tools.ts`](packages/canvas-core/src/ui/toolbar-tools.ts) + [`toolbar-icons.tsx`](packages/canvas-core/src/ui/toolbar-icons.tsx) + i18n [`fa.ts`](packages/i18n/src/strings/fa.ts) | `laser` به `ToolId`/`HB_TOOLS` (میانبرِ `l`) + آیکون + کلیدِ `tool.laser` | لیزر فقط در «ابزارهای بیشترِ» نیتیو بود؛ برای پوششِ کامل باید ابزارِ نو باشد | نوار **۱۲ ابزار**؛ تست‌های شمارش ۱۱→۱۲ سبز؛ در مرورگر فعال، پیلِ همتا «لیزر» |

**نکاتِ کلیدی:**
- **★ حضورِ ابزارِ فعال از قبل کامل بود — صفر لمسِ M2/shared-types.** قراردادِ `CanvasOutbound.emitActiveTool` و
  `PeerState.activeTool` از M2 وجود داشت و awareness آن را relay می‌کند (سرورِ realtime awareness را عمومی پخش
  می‌کند، پس هیچ ارجاعِ `activeTool` ندارد). اپ فقط emit می‌کند و برچسبِ فارسی را از همان `HB_TOOLS` (i18n) می‌سازد.
- **★★ نوشتنِ برنامه‌ایِ ابزارها onChange نمی‌دهد (تله‌ی M1) → مسیرِ تک‌emitِ یکپارچه:** استیکی/تصویر/قلم
  برنامه‌ای به صحنه می‌نویسند، پس `onChange` (که flushLocalِ 8.4 را می‌زند) fire نمی‌شود. راه‌حل: هر ابزار در
  callbackِ پایانش (`onCreated`/`onInserted`/`onCommitted`) **دستی** `flushLocal` می‌کند — همان مسیرِ تک‌emit که
  `known` را هم درست نگه می‌دارد. ابزارهای موتور (شکل/متن/کانکتور/فریم/پاک‌کن) با درگِ **واقعیِ کاربر** onChange
  می‌دهند و خودکار emit می‌شوند.
- **★ قلم: ضدِ دو-emit.** DrawTool هم به صحنه می‌نویسد (برنامه‌ای) و هم `outbound.emitElementChanges` دارد.
  چون flushLocal (از `onCommitted`) تنها مسیرِ emit است، `emitElementChanges`ِ ابزار **no-op** شد؛ `emitEphemeral`
  به outboundِ واقعی می‌رود (پیش‌نمایشِ زنده‌ی همتا). روکشِ استروکِ محلی از `sceneToOverlayPixel`ِ مشترک رندر می‌شود
  (صفر importِ excalidraw در web، ADR-024). استروکِ نهایی در تبِ دوم دیده شد.
- **استیکی بعد از یک قراردهی خودش deactivate می‌شود (M1)** → `onCreated` UI را صادقانه به «انتخاب» برمی‌گرداند
  (پالت بسته می‌شود). با reload اثبات شد.
- **⚠️ تصویر به فاز ۱۱٫۲ موکول شد:** adapter اینجا بدونِ `assets` (AssetTransport) است، پس `requestAssetUpload`
  خطا می‌دهد (تزریقِ تستیِ فایل نشانش داد). وایرینگِ کامل و **آماده‌ی ۱۱٫۲** است (فقط `assets:` به adapter اضافه
  می‌شود)؛ تا آن‌وقت به‌جای کرش یک نوتیسِ روشن. `createLocalAssetTransport` عمداً استفاده **نشد** — بلابِ per-page
  است و بینِ تب‌ها sync نمی‌شود (نیمه‌فیچرِ گیج‌کننده)؛ مسیرِ synced همان فاز ۱۱٫۲ (`upload→api.addFiles`) است.
- **✅ نوار ابزارِ نیتیوِ excalidraw پنهان شد** (پولیشِ ۹٫۱، تاییدِ مالک ۱۴۰۵/۰۶/۱۲): propِ `hideNativeUI` روی
  `HamboomCanvas` (لمسِ M1ِ دوم، جدولِ بالا) نوار/منو/فوترِ نیتیو را با CSS پنهان می‌کند. چون فوترِ زوم/undoِ نیتیو
  هم رفت، `ZoomControl`ِ خودِ canvas-core (**reuse**، ADR-024) در `BoardPage` وصل شد و با CSSِ اپ به گوشه‌ی مقابلِ
  نوار (**bottom-end**) برده شد تا با نوارِ center-start تصادم نکند (undo با `Ctrl+Z` هست). ⚠️ **CSS نه zenMode**:
  زن‌مود فوترِ نیتیو و افردنسِ «خروج از زن‌مود» را نگه می‌دارد؛ CSSِ روی دو ظرفِ ساختاری کنترلِ دقیق می‌دهد (پین‌شده،
  با ارتقای excalidraw بازبینی شود). در مرورگر: نوار/فوتر ناپدید، رسمِ مستطیل + زوم ۱۰۰→۱۲۰→۱۰۰ + fit همه کار کرد.
- **★ کاملیتِ نوار — قدمِ ۱: بیضی/لوزی/خط** (تاییدِ مالک ۱۴۰۵/۰۶/۱۲): بعد از پنهان‌کردنِ chromeِ نیتیو، بازرسیِ
  **DOMِ نوارِ نیتیو** (هنوز در DOM، فقط `display:none`) نشان داد این‌ها فقط آنجا بودند: **بیضی، لوزی، خط، لیزر** (+
  embed/library/keep-active). برای بیضی/لوزی/خط، دکمه‌ی «شکل» و «کانکتور» **فلای‌اوتِ واریانت** گرفتند — **سمتِ اپ،
  بی‌لمسِ M1**: «شکل»→مستطیل/بیضی/لوزی، «کانکتور»→پیکان/خط، با `setActiveTool`ِ نیتیو (`shapeKindRef`/`connectorKindRef`).
  ⚠️ **نگرانیِ خط رفع شد:** نگاشتِ M1 از قبل `line→"shape"` را داشت و codecِ `fromExcalidraw`/`toExcalidraw`
  **spread-based** است (type/points حفظ می‌شود)، پس **خط با pointsِ سالم در تبِ دوم خط ماند، نه جعبه**. embed
  (خلافِ P2)، library (منبعِ خارجی)، و keep-active (modifier) عمداً کنار. **لیزر = قدمِ ۲** (بزرگ‌تر: رندرِ زنده‌ی لیزرِ
  همتا هنوز ساخته نشده — همان گپِ استروکِ همتا).
- **★ کاملیتِ نوار — قدمِ ۲: لیزر** (لمسِ M1ِ سوم، جدولِ بالا): سمتِ M3، ابزارِ موتور `setActiveTool("laser")` (رفتارِ
  **اینرت** — نه select/draw)، و دنباله از `onPointerUpdate`ِ **صحنه‌ای** (بی‌تبدیل) به‌صورت `emitEphemeral({kind:"laser"})`
  برای همتاها. **رندرِ لیزر (محلی و همتا) روی همان روکشِ قلم** با `redrawOverlay`ِ **یکپارچه** (peer.ephemeral + قلم + لیزرِ
  خودم؛ یک `clearRect`)، رنگِ کاربر. throttleِ ۴۰ms + پاک‌شدنِ ۳۲۰ms پس از توقف.
  ⚠️⚠️ **کشفِ مهم حین دیباگ: کانالِ ephemeral (استروکِ زنده‌ی قلم + لیزر) هیچ‌وقت peer-to-peer با سرورِ واقعی اثبات
  نشده بود.** حالا شد — با console-probe (seed emit=۱٫٫۱۴ نقطه) + pixel-detector (روکشِ tab-2: `everSeen=true`, alpha=۲۵۵) در
  دو تبِ واقعی. سرور از M2 relay می‌کرد؛ فقط هیچ‌وقت end-to-end دیده نشده بود.
  ⚠️ **رندرِ لیزرِ نیتیوِ موتور با رویدادِ مصنوعی نمی‌آید** (تله‌ی M1)، پس عمداً به آن **تکیه نکردم** و لیزرِ محلی را
  خودم روی روکش می‌کشم — مستقل، قابلِ‌اثبات، متقارن با آنچه همتا می‌بیند. `setActiveTool("laser")` فقط برای رفتارِ اینرت
  است (اگر نیتیو هم برای کاربرِ واقعی رندر کرد، هم‌رنگ/هم‌جا و بی‌ضرر روی مالِ من می‌افتد).
- **★ گپِ استروکِ زنده‌ی قلمِ همتا هم بسته شد** (بعد از لیزر، تاییدِ مالک ۱۴۰۵/۰۶/۱۲): همان `redrawOverlay` حالا
  `kind:"draw-stroke"` را هم می‌کشد (رنگ/عرضِ **خودِ استروک**؛ عرض × zoom چون عرض در واحدِ صحنه است). draw-tool از
  قبل ephemeral را emit می‌کرد (`drawOutbound.emitEphemeral`) — فقط رندرِ **گیرنده** نبود. اثباتِ دو-تب: روکشِ tab-1 حین
  استروکِ زنده‌ی seed `alpha=۲۵۵`. پس همتا حالا هم استروکِ **زنده** می‌بیند (روکش) هم **نهایی** (صحنه، از flushLocal).

**اثباتِ نهایی:** `pnpm verify` سبز (هر ۸ گیت). دو تب همگام (استیکیِ فارسی/کانکتور/فریم/قلم)، ابزارِ فعالِ همتا
دوطرفه، پالتِ ۱۲رنگه، میانبر، و ذخیره‌ی پایدار همه در مرورگر با سرورِ واقعی.
**قدمِ بعد:** فاز ۱۱ (ظرفیت + سخت‌سازی + تحویل) — فاز ۱۰ به تعویق است.

## ★★ فاز ۸ (`apps/web`) — ✅ **۸٫۱–۸٫۵ (۸٫۵: یافته‌ی ۳ و ۲؛ ۴ موکول)** (۱۴۰۵/۰۶/۱۰)

**چه شد:** اپِ وبِ کاربر از صفر ساخته شد و **هر گام در مرورگر با سرورِ واقعی اثبات شد** (نه فقط build):

| گام | چه شد | اثبات در مرورگر |
|---|---|---|
| **۸٫۱** | اسکلت: React 19 + Vite 6 + TanStack Router(code-based)/Query، RTL، Vazirmatnِ خودمیزبان، StrictMode، تم، ErrorBoundary | screenshot RTL + **صفر requestِ خارجی** (P2) + Stylelint با شکستنِ عمدی قرمز |
| **۸٫۲** | احرازِ موبایل/OTP روی `sdk`؛ access در حافظه، نشست از کوکیِ HttpOnly | ورودِ کامل + رفرش نشست را نگه داشت؛ localStorage خالی، کوکی HttpOnly |
| **۸٫۳** | داشبورد (لیست/ساخت/نشان/جستجوی بورد) + صفحه‌ی تیم (اعضا/دعوت/**تغییرِ نقش**/حذف) | ساختِ بورد + toggle؛ دعوت→پذیرشِ کاربرِ دوم→member→admin در UI بازتاب یافت |
| **۸٫۳ (فولدر/سطل)** | ریلِ پیمایشِ per-team + فولدر (ساخت/تغییرِنام/حذف/جابه‌جاییِ بورد) + **سطلِ بازیافت** | حلقه‌ی کامل در مرورگر: ساختِ فولدر→جابه‌جایی (منوی ⋯)→فیلترِ فولدر؛ حذف→سطل (`?trashed=true`)→بازیابی→برگشت به «همه» |
| **۸٫۴** | پوسته‌ی بورد: `HamboomCanvas`+`YjsSyncAdapter` روی realtimeِ واقعی + **پلِ گرفتنِ ویرایشِ محلی** | **دو تب همگام** (رسم در A→زنده در B)؛ `Ctrl+Z` کلِ مستطیل یک‌باره + حذف به B؛ `board_updates` جلو رفت |
| **۸٫۴ (بستن)** | **emitِ زنده‌ی میان‌درگ** + **E2Eِ وبِ viewer** + تصمیمِ §۲ (ADR-047) | رسمِ واقعی=۳ emit در یک ژست (نه ۱)، یک Ctrl+Z کلش را برداشت؛ کاربرِ دومِ viewer: نوارِ ابزار غایب + «فقط‌خواندنی» + تلاشِ رسم فقط pan کرد |

**تصمیم‌ها و کشف‌ها:**
- **روترِ code-based** (نه file-based) — تا `tsc`ِ verify بدونِ Vite/codegen کار کند.
- **مسیرهای SPA باید از پیشوندهای پروکسیِ api جدا باشند:** `/team` و `/b` (مفرد)، نه `/teams`/`/boards` —
  وگرنه رفرش به api می‌خورد (۴۰۱). پروکسیِ dev **بدونِ rewrite** تا کوکیِ `/auth` برگردد.
- **گرفتنِ ویرایشِ محلی را M1/M2 به اپ سپرده بود:** `createCanvasBinding` فقط remote→بوم است. پل در
  `BoardPage`: `onChange` (فقط تغییرِ محلی — برنامه‌ای fire نمی‌کند) → دیفِ نسخه‌ای → emit؛ ضدِ اکو با
  `known`ِ به‌روزشونده روی هر اعمالِ remote؛ گروه‌بندیِ ژست با settle ۱۵۰ms.
- **★★ ADR-028 تجربی حل شد:** بومِ واقعی زیر StrictMode با الگوی `useEffect([api])` سالم ماند
  (رسم/پنل/undo) — ریسکِ ثبت‌شده بسته.
- **refreshِ دوگانه‌ی StrictMode** با ref تک‌بار شد (هدررفت + ریسکِ reuse-burnِ خانواده‌ی refresh).
- **Redis→۷۳۷۹** (۶۳۷۹ داخلِ رنجِ excludedِ **جابه‌جاشده‌ی** ویندوز افتاد — همان تله‌ی MinIO).
- **★ سطلِ بازیافت یک افزوده‌ی کوچکِ api خواست:** `GET /boards` مسیرِ `deleted_at IS NULL` را سفت‌کد کرده بود —
  تنها راهِ لیست‌کردنِ سطل. `?trashed=true` اضافه شد (پیش‌بندِ حذف برعکس + گیتِ owner مثلِ `assertDeletedBoardOwner`؛
  نقشِ سطل همیشه owner) + `trashed?` در فیلترِ `sdk`. **shared-types دست‌نخورد** (BoardSummary همان). تستِ wiringِ
  کپچرِ SQL، با شکستِ عمدی قرمز شد.
- **فولدر team-first، بدونِ فیلترِ teamId:** `BoardSummary` تیم را ندارد، پس منوی جابه‌جایی `boards.get` می‌زند تا
  `teamId` (+ فولدرِ فعلی) را بگیرد و فقط فولدرهای همان تیم را پیشنهاد دهد (جابه‌جاییِ بین‌تیمی را api رد می‌کند).
  حذفِ فولدر نرم است؛ بوردهای داخلش پاک نمی‌شوند و در «همه‌ی بوردها» می‌مانند.
- **فرمِ تک‌inputی فقط با Enter یک گپِ دسترسی‌پذیری بود** (و در اتوماسیونِ CDP هم submit نمی‌شد) — دکمه‌ی ✓ به فرمِ
  فولدر افزوده شد. منطقِ خالصِ نگاشتِ انتخاب→فیلتر در `selection.ts` جداست و تستِ واحد دارد (trash با شکستِ عمدی قرمز شد).
- **★★ باگِ emitِ زنده در خودِ `BoardPage` بود، نه canvas-sync:** `createEmitScheduler` از قبل throttleِ ۵۰msِ درگ را
  دارد، ولی debounceِ ۱۵۰msِ اپ **قبلش** بود، پس scheduler حالت‌های میان‌درگ را هرگز نمی‌دید. رفع: حذفِ debounce،
  emit روی هر onChange با `gestureId`ِ **ثابت در طولِ درگ** (`gesture-tracker.ts`، خودآزمون).
- **★ `queueMicrotask` نه `requestAnimationFrame` برای coalesce:** با rAF، درگ در تبِ **پس‌زمینه** فقط ۱ update ساخت
  (سنجیده شد؛ rAF آنجا می‌ایستد). microtask همیشه اجرا می‌شود. **درسِ اندازه‌گیری:** رویدادهای pointerِ **مصنوعی** را
  excalidraw دسته می‌کند (۲۰ move → ۲ onChange)، پس سنجه فقط با درگِ **واقعیِ ابزار** (رویدادِ trusted) معتبر است؛
  و Fast Refresh افکت را با depهای ثابت **اجرا نمی‌کند**، پس اندازه‌گیریِ کدِ نو **reloadِ کامل** می‌خواهد.
- **E2Eِ viewer با کاربرِ دومِ واقعی:** کوکیِ نشست per-origin است، پس دو کاربرِ **هم‌زمان** در یک preview ممکن نیست —
  proof **ترتیبی** شد (A محتوا ساخت و persist، بعد B به‌عنوان viewer عضوِ بورد شد و باز کرد). سرور نقشِ viewer داد،
  وب view-mode شد. **گیتِ سرور از فاز ۷** (`rt:permission`) قبلاً اثبات‌شده بود.
- **§۲ (پیام‌های فارسیِ کلاینت) → [ADR-047](ARCHITECTURE_DECISIONS.md#adr-047):** رشته‌ها در `canvas-sync` می‌مانند
  (لمسِ M2 + churn بی‌سود)؛ اپ `onProtocolError` را به نوتیسِ فارسی نشان می‌دهد، نه console-only.

**مانده در فاز ۸:** — (۸٫۵ زیر ثبت شد؛ یافته‌ی ۴ موکول).
**قدمِ بعد:** فاز ۹ (نوار ابزار).

### ★★ گام ۸٫۵ — سه یافته‌ی M2 (تاییدِ تک‌تکِ مالک ۱۴۰۵/۰۶/۱۰)

مالک یافته‌ی ۳ و ۲ را تایید کرد، یافته‌ی ۴ را رد. **لمسِ M1/M2 اینجا ثبت می‌شود (قاعده‌ی گام ۸٫۵، مثلِ B-1):**

| یافته | لمسِ M1/M2 | تغییر | اثبات |
|---|---|---|---|
| **۳ — مکان‌نمای زنده** | **M1** [`HamboomCanvas.tsx`](packages/canvas-core/src/engine/HamboomCanvas.tsx) | propِ **افزایشیِ** `onPointerUpdate` که `onPointerUpdate`ِ موتور (مختصاتِ **صحنه**) را forward می‌کند | مرورگر: `.hb-peer-cursor` با نام «کاربر 0002» و transformِ زنده که با حرکتِ همتا عوض شد؛ رسم هم همگام |
| **۲ — opِ اضافیِ schemaVersion** | **M2** [`adapter.ts`](packages/canvas-sync/src/adapter.ts) | مهرِ `schemaVersion` **تنبل** در `commitChanges` (فقط اگر `getSchemaVersion===undefined`) | تستِ خودآزمون در `adapter.test.ts` (۳ تست؛ با شکستِ عمدی «بوردِ نو مهر نمی‌زند» قرمز شد) |

**یافته‌ی ۳ (چرا این شکل):** `onPointerUpdate`ِ موتور از قبل **صحنه** می‌دهد، پس با پاس‌دادنش تبدیلِ پیکسل→صحنه
کلاً حذف شد — نه صادرکردنِ `viewportCoordsToSceneCoords` و نه تکرارِ فرمولِ دمو (ADR-024). سمتِ M3 (`BoardPage`):
`emitPointer` روی propِ نو، `applyPeers`→state، نما از `onScrollChange`، و رندرِ `PeerCursors`ِ M1 با `sceneToOverlayPixel`.

**یافته‌ی ۲ (چرا تنبل):** تله‌ی زمان‌بندی — «آیا بوردِ واقعاً نو است؟» فقط **بعد از** hydrationِ IndexedDB + syncِ سرور
معلوم می‌شود، و sync ناهمگام است. مهرزدن روی **اولین نوشتنِ** واقعی این را دور می‌زند: بوردِ نو با اولین ویرایش نسخه
می‌گیرد، بوردِ موجود از sync دارد پس مهر نمی‌خورد. `meta` بیرونِ دامنه‌ی `UndoManager` (فقط `elements`) است، پس
undoِ اولین ویرایش نسخه را پاک نمی‌کند. `BoardPage` حالا `new Y.Doc()` می‌دهد نه `createBoardDoc()`.

**یافته‌ی ۴ (چرا موکول — ۴ج):** انزوای ویرایشگرِ متنِ موتور یک **محدودیتِ موتور** است؛ رفعِ واقعی یا داخلیِ موتور
را دست می‌زند (۴الف، پرریسک) یا مدلِ همکاری را عوض می‌کند (۴ب: قفلِ نرم، تصمیمِ UX). لبه‌ی نادر، با
`e2e/text-latency.spec.ts` ثبت‌شده. مالک رد کرد؛ برای وقتی UXِ متن تمرکز شد.

## ★★ فاز ۷ (`apps/realtime` روی پورت‌های واقعی) — ✅ **کامل شد** (۱۴۰۵/۰۶/۱۰)

**چه شد:** چهار پورتِ M2 پیاده و تزریق شدند، و **هر هفت سنجه‌ی زنده + bench** با auth **و** storageِ
واقعی دوباره سبز شدند. `main.ts` حالا `createRealtimeAuthority` (verifyِ JWTِ auth-core +
`createPgBoardAccessReader`) و `createStorageSnapshotStore` روی MinIO می‌سازد — نه `DevBoardAuthority`
و `FsSnapshotStore`. **گیتِ production برعکسِ M2 شد:** `APP_ENV=production` سرور را **بالا آورد**
(آزموده روی پورتِ ۷۷۹۹) چون `developmentOnly=false`.

| زیرگام | چه شد |
|---|---|
| **۷ (پکیجِ مشترک)** | ★ `packages/board-access-db` — پیاده‌سازیِ pgِ `BoardAccessReader`، **منبعِ واحدِ** api و realtime ([ADR-046](ARCHITECTURE_DECISIONS.md#adr-046))، تا دریفتِ منطقِ دسترسی ممکن نباشد. گیتِ خودآزمونِ سه‌لایه. |
| **۷٫۱ تزریق** | `main.ts` واقعی‌ها را می‌سازد؛ `assertAuthorityUsable` دیگر رد نمی‌کند. `createMemoryBoardAccessReader` به auth-core افزوده شد (نقشِ درون‌فرایندی برای سنجه‌های Group-B و `rt-dev-server`). |
| **۷٫۲ هفت سنجه** | `durability·compaction·permission·presence·cluster·shutdown·reconnect` — همه سبز با seedِ DB + توکنِ امضاشده‌ی واقعی + MinIO. **FKهای فاز ۵٫۱** (`board_updates_board_fk`/`origin_user_fk`) حالا بوردِ واقعی + کاربرِ واقعی می‌خواهند، پس هر سنجه از `scripts/rt-seed.ts` seed می‌کند و پاک می‌کند. |
| **bench** | بوردِ ۵۰۰۰ عنصری = **۳٫۶۶MB سند / ۷۶٫۱۱MB حافظه** — بایت‌به‌بایت مثلِ M2. تزریق منطق را عوض نکرد (ADR-031). خطِ «۱ snapshot (۳٫۶۵MB)» ثابت کرد مسیرِ فشرده‌سازیِ MinIO end-to-end کار کرد. |
| **حذفِ dev-impl** | `dev-board-authority.ts`+تست و `fs-snapshot-store.ts`+تست حذف شدند (M2 گفته بود «با auth-core حذف می‌شود»). سه حمله‌ی JWT روی verifierِ واقعی در auth-core زنده‌اند؛ contractِ SnapshotStore با `storage-snapshot-store.test.ts` پوشیده. |
| **بازسیم‌کشیِ تست** | `server.test.ts`+`shutdown.test.ts` با **بدلِ تستیِ `BoardAuthority`** (سینک) بازنویسی شدند — نه authorityِ واقعی، چون عقب‌گردِ `currentRole() ?? نقشِ‌توکن` فقط با `undefined` فعال می‌شود و auth-coreِ واقعی **هرگز** undefined نمی‌دهد. ۱۶۳ تستِ realtime سبز. |

**تصمیم‌ها:**
- **بدل به‌جای authorityِ واقعی در تست‌های سرور** — تاییدِ JWT کارِ auth-core است (همان‌جا آزموده)؛ تست‌های
  سرور مسیرِ **سرور** را می‌سنجند، از جمله عقب‌گردی که فقط یک authorityِ undefined-دِه فعالش می‌کند.
- **خواننده‌ی pg در سنجه‌ی in-process bench** (نه حافظه‌ای) — تا harnessِ درون‌فرایندی **دقیقاً** همان چیزی
  باشد که `main.ts` سرِ هم می‌کند؛ `@hamboom/board-access-db` به devDepهای ریشه افزوده شد.
- **خودآزمون:** `rt:reconnect` با تنزلِ عمدیِ نقش (viewer به‌جای editor، توکن هنوز editor) **قرمز** شد،
  و ۴ تستِ خواننده‌ی حافظه‌ای با شکستنِ پیش‌فرضِ unset→null قرمز شدند. گیت‌ها ضعیف نشدند.

**قدمِ بعد: فاز ۸ (`apps/web`)** — احراز → داشبورد → پوسته‌ی بورد (اتصالِ `canvas-sync` به سرورِ واقعی).

## ★★ فاز ۵ (`apps/api`) — ✅ **کامل شد** (۱۴۰۵/۰۶/۰۸)

**تمام‌شده (همه با curl/سرورِ زنده اثبات‌شده، `pnpm verify` سبز، ۶ کامیتِ این session روی origin):**

| زیرگام | چه ساخته شد |
|---|---|
| **۵٫۰** | اسکلتِ `apps/api` + گیتِ خودآزمونِ `apiBoundaries` (P4، سه‌لایه، شکستنِ عمدی) |
| **۵٫۱ schema** | رانرِ دو-پوشه‌ای (DP-1) + کلِ schemaی PLAN §۶ + دو FKِ ارثی؛ ★ `db:fk-test` (CASCADE/SET NULL/اتمیک، واقعی) |
| **۵٫۱ buildApp** | `buildApp()`ِ تزریق‌پذیر + پلاگینِ db (**int8→number/P5**، fail-loud) + logger (**redact/P7**) + خطای یکسان + `/healthz`/`/readyz` |
| **۵٫۲ auth** | adapterهای DB (`OtpStore`/`SessionStore`/`BoardAccessReader`/AssetTransport) · endpointهای otp/verify/refresh · ★★ **atomic rotate** (`FOR UPDATE` + `db:store-test`ِ خودآزمون + conformanceِ PG↔memory) · رفعِ **باگِ reuse** (commit-on-reuse، از تستِ دستی) · کوکیِ HttpOnly · rate-limit · zod |
| **۵٫۳** | `PATCH /me` · تیم (CRUD/members/invites) · فولدر (CRUD) · `requireTeamRole` |
| **۵٫۴** | CRUDِ کاملِ بورد (patch/delete/restore/duplicate/favorite/جستجوی pg_trgm) · ★★ **`GET /boards/:id/rt-token` (پورتِ چهارم، با `verifyRtToken` اثبات‌شده)** · **access/share + DP-4 گرنتِ ماندگار** (ابطالِ خودکار اثبات‌شده) · عضوِ مستقیمِ بورد |
| **۵٫۴ storage** | ★ **`GET /boards/:id/snapshot`** (octet-stream: کاتالوگِ `board_snapshots` → بایت از باکتِ snapshots؛ ۲۰۴ِ تاب‌آور روی نبودِ ردیف/بایت) · ★★ **endpointهای asset** (presign/commit/GET با ۳۰۲؛ commit **sha256 را روی بایتِ واقعی بازمحاسبه** می‌کند، به ادعای کلاینت اعتماد نمی‌شود؛ **دی‌دوپِ سطحِ تیمِ بعد از تاییدِ sha**) · `minio-init` (ساختِ باکت‌ها، P3) · `uploadEnvSchema` |
| **۵٫۵** ✅جدید | ★ **OpenAPI 3.1** از همان zodِ منبعِ حقیقت (`z.toJSONSchema`، بدونِ وابستگیِ نو) — `GET /openapi.json` + `GET /api/v1/docs` (مرورگرِ self-hosted، P2) + `scripts/gen-openapi.ts` → `docs/api.md`/`docs/openapi.json` · **گاردِ دریفت** (هر مسیرِ ثبت‌شده مستند است) · **Idempotency-Key** روی POSTِ احرازشده (replay + in-flight de-dup، تک‌نود/۲۴h) · تستِ قطعیِ rate-limit (عبور از سقفِ OTP → ۴۲۹، با شکستنِ عمدی قرمز) |

**✅ فاز ۵ کامل شد** — کلِ سطحِ REST (auth/user/team/folder/board/access/asset/rt-token/snapshot) + OpenAPI + Idempotency.

## ★★ فاز ۶ (`packages/sdk`) — ✅ **کامل شد** (۱۴۰۵/۰۶/۰۸)

**کلاینتِ typedِ REST از `shared-types`** (`createClient`) روی همه‌ی endpointها؛ access در حافظه + **۴۰۱→refresh→retry**
خودکار؛ §۵ error → `SdkError`؛ گیتِ `sdkBoundaries` (سه‌لایه، با شکستنِ عمدی قرمز شد). ۸ تستِ واحد (fetchِ دروغین) داخلِ
verify + **تستِ قراردادی در برابرِ `buildApp()`ِ واقعی** (`pnpm sdk:contract`، ۸/۸ روی DBِ واقعی).

★★ **یافته‌ی بزرگِ فاز ۶ — و چرا sdk قبل از web است:** api **ردیفِ خامِ snake_case** می‌داد (`team_id`)، ولی قرارداد و
OpenAPI **camelCaseِ پرمحتوا** (`teamId`, `createdBy`). یعنی قرارداد **دروغ** بود و curlِ فاز ۵ (که مقدار را چک می‌کرد
نه شکل) و گاردِ دریفت (که مسیر را می‌سنجد نه بدنه) بی‌صدا از رویش رد شده بودند. **تاییدِ مالک: api را به قرارداد برسان**
([ADR-045](ARCHITECTURE_DECISIONS.md#adr-045)) → لایه‌ی serialize (`apps/api/src/dto.ts`)، بدنه‌های درخواست + `Folder` به
`shared-types`، و **تستِ قراردادی هر پاسخ را با zod parse می‌کند** (گیتی که curl نداشت). **قدمِ بعد: فاز ۷** — تزریقِ
`auth-core`/`storage` به `apps/realtime` + اجرای دوباره‌ی هر ۷ سنجه.

**✅ MinIO باز شد (۱۴۰۵/۰۶/۰۷):** «بالا نمی‌آید»ی قبلی **تداخلِ پورت نبود**، بلکه **رنجِ excludedِ ویندوز** بود (`netsh
... excludedportrange`: ۸۹۰۶–۹۱۰۵ هم ۹۰۰۰ هم ۹۰۰۱ را می‌گیرد — Hyper-V، بعد از ری‌استارت جابه‌جا می‌شود؛ برای همین در فاز ۳
کار می‌کرد و بعد نه). ⚠️ **رفع روی این ماشین: در `.env`ِ محلی `MINIO_PORT=9800`/`MINIO_CONSOLE_PORT=9801` + `S3_ENDPOINT=
http://localhost:9800`** (همان الگوی ۵۴۳۳ برای DB — `.env.example`/compose روی پیش‌فرضِ PLAN ۹۰۰۰ ماندند). `storage:smoke` ۱۱/۱۱ سبز روی پورتِ نو.

**✅ دیتابیسِ dev کامل-migrate شد** (`0001`+`0002`+`0003`): دادهٔ یتیمِ متریکِ M2 پاک و رانر بقیه را اعمال کرد؛ «ریستِ dev» بسته شد.

**بعد از فاز ۵:** فاز ۶ (`packages/sdk`) · فاز ۷ (تزریقِ auth-core/storage به `apps/realtime` + اجرای دوباره‌ی ۷ سنجه) ·
فاز ۸ (`apps/web`) · فاز ۹ (نوار ابزار) · فاز ۱۱ (ظرفیت/تحویل).

⚠️ **موارد باز (غیربلوکه):** یکی‌شدنِ redactor با realtime · بلوکِ دفاعیِ `0002` · `AssetValidationError`ِ parameter
property · rate-limitِ Redis-backed برای چندنودی · MinIO (برای snapshot/asset).

**فاز ۰–۴ کامل ✅ (۱۴۰۵/۰۵/۲۸)** — `packages/auth-core` تمام شد: دو گیتِ امنیتیِ فاز ۱ (حفره‌ی `exp` + OD-1)
بسته، به‌علاوه‌ی **refreshِ چرخشی** (reuse → سوزاندنِ خانواده) و **OTP** (hash، P7، ضدِ enumeration) — همه پشتِ
پورت، DBشان فاز ۵. فاز ۳: منطقِ گام ۳٫۳ الان ساخته و روی MinIO تست شد؛ endpointهای HTTPش به فاز ۵ موکول. بلوکه‌ی داکر رفع شد، probe مکانیزمِ سقف را بست
(OD-2/ADR-044)، و سه لایه ساخته شد: ★ **`packages/storage`** (رابطِ `ObjectStore` روی S3، تنها جای `@aws-sdk`،
گیتِ P4 خودآزمون، smoke ۱۱ سبز) · ★ **`StorageSnapshotStore`** (پورتِ SnapshotStoreِ realtime روی storage،
آداپتورِ نازک) · ★ **`packages/assets`** (لایه‌ی دامنه‌ی دارایی — presign/validateUploaded/resolve؛
**مصرف‌کننده‌ی** storage نه بخشی از آن، [ADR-029](ARCHITECTURE_DECISIONS.md#adr-029)؛ **sha256 روی بایت‌های
واقعی بازمحاسبه می‌شود**؛ smoke ۶ سبز). مکانیزمِ سقف = **presigned POST با `content-length-range`**
([ADR-044](ARCHITECTURE_DECISIONS.md#adr-044)، PLAN §۵٫۲ به‌روز شد). `pnpm verify` سبز (۸ گیت).
**قدمِ بعد: فاز ۵ (`apps/api` — Fastify): پلاگین‌ها + migrationِ کاملِ schema + پیاده‌سازیِ DBِ پورت‌ها + endpointها.**

TODOی این ماژول: [`TODO-M3-backend-api.md`](TODO-M3-backend-api.md). نقطه‌ی ورود:
[`docs/m3-handoff.md`](docs/m3-handoff.md). ماژول‌های تمام‌شده: M1
([بایگانی](TODO-M1-canvas-core.md)) · M2 ([TODO.md](TODO.md) · [PROGRESS.md](PROGRESS.md)).

---

## انجام شد

### برنامه‌ریزیِ M3 (۱۴۰۵/۰۵/۲۴)

- **[TODO-M3-backend-api.md](TODO-M3-backend-api.md) نوشته شد** — ۱۲ فاز، هر گام با معیارِ
  پذیرشِ قابل‌سنجش. ترتیب: تصمیم‌ها → probeها → config/قرارداد → storage → auth-core → api →
  sdk → اتصالِ realtime → web → نوار ابزار → (فاز ۱۰ به تعویق) → ظرفیت/تحویل. دلیلِ ترتیب در
  خودِ فایل: پورت‌ها پایین‌ترین لایه‌اند، api قبل از web (مثلِ «binder قبل از سرور»ی M2)، و
  نوار ابزار **بعد از** پوسته‌ی بورد (قیدِ صریحِ مالک).

- **کشفِ ساختاری حین برنامه‌ریزی:** `packages/shared-types` امروز فقط قراردادِ canvas/text
  دارد؛ **کلِ لایه‌ی DTOهای API را M3 اضافه می‌کند** — و *آن* هم رخدادِ [ADR-021](ARCHITECTURE_DECISIONS.md#adr-021)
  است. از دو موردِ واقعاً بازِ مالک (`rtToken`، `CommentPin`) جدا شد: DTOها شکلشان در
  PLAN §۵٫۱ تثبیت است پس تاییدِ **دسته‌ای** می‌خواهند؛ آن دو تصمیمِ تازه‌اند.

### تصمیم‌های مرزیِ M3 — بسته شد (مالک، ۱۴۰۵/۰۵/۲۴)

| # | تصمیم |
|---|---|
| **M3-D1** | **دامنه = هسته + نوار ابزار** (فاز ۰–۹ + ۱۱). فاز ۱۰ (قالب/کامنت/نسخه/خروجی) و `apps/worker` **به تعویق** → ارثیه‌ی m4. |
| **M3-D2** | DTOهای PLAN §۵٫۱ به `shared-types` به‌صورت **دسته‌ای** (تاییدِ نهایی هنگامِ گام ۲٫۲)؛ فقط **مصرف‌کننده‌دارها** الان (User/Team/Board/enum/کدهای‌خطا/pagination)، نه کلِ §۵٫۱. |
| **M3-D2a** | ✅ **claimهای `rtToken` → `shared-types`** ([ADR-042](ARCHITECTURE_DECISIONS.md#adr-042)). |
| **M3-D2b** | ⛔ **`CommentPin` در `ydoc-schema` می‌مانَد** (چون فاز ۱۰ به تعویق) — ارثیه‌ی m4. |
| **M3-D3** | Fastify ([ADR-001](ARCHITECTURE_DECISIONS.md#adr-001)) + SQL خام/Kysely ([ADR-005](ARCHITECTURE_DECISIONS.md#adr-005)) — تاییدِ دوباره لازم نبود. |
| **M3-D4** | ⚠️ رفعِ سه یافته‌ی M2 که به `canvas-core`/`canvas-sync` دست می‌زند: **تک‌تک** تایید می‌شود (توقف + گزینه + هزینه)، **اجازه‌ی کلی نیست**. مقصد: گام ۸٫۵. |
| **M3-D5** | `apps/worker`/خروجی: **بعد از M3** (همراهِ فاز ۱۰). |

### دو پالایشِ TODO از پرسش‌های مالک (۱۴۰۵/۰۵/۲۴)

۱. **گام ۳٫۳ (آپلودِ دارایی) — سفت شد.** چون آپلودِ مستقیمِ کلاینت→Object Storage دورِ سرور را
   می‌زند، محدودیتِ اندازه/نوع باید در **خودِ امضای presign** باشد (`Content-Length`ِ امضاشده
   یا POST-policyِ `content-length-range` + `Content-Type`ِ امضاشده)، نه فقط در `commit`.
   `commit` فقط برای sniffِ نوعِ **واقعی**/ابعاد/`sha256` می‌مانَد. مکانیزم در فاز ۱٫۲ روی
   MinIO probe می‌شود ([ADR-013](ARCHITECTURE_DECISIONS.md#adr-013): رفتارِ presign بین
   سرویس‌های S3 فرق می‌کند). معیارِ پذیرشِ ۳٫۳ و ۱٫۲ به‌روز شد.
۲. **گام ۵٫۱ (دو FKِ به‌ارث‌رسیده) — ترتیب صریح شد.** ثبت بود، ولی نکته‌ی **دو-رانر** اضافه شد:
   `board_updates`/`board_snapshots` را migrationِ infraی M2 ساخته (`infra/sql/migrations`)،
   پس FK-ALTER به اجرای آن **وابسته** است (اول `pnpm db:migrate`، بعد `migrate:up`ی api).

### گام ۰٫۱ — ADR-042 (۱۴۰۵/۰۵/۲۴)

- **[ADR-042](ARCHITECTURE_DECISIONS.md#adr-042)** نوشته شد: claimهای `rtToken` به
  `shared-types`، به‌عنوان **جایگزینِ** قیدِ rtTokenِ [ADR-031](ARCHITECTURE_DECISIONS.md#adr-031)
  (که با نبودِ طرفِ دوم توجیه داشت و حالا هر دو طرف — api صادرکننده و realtime مصرف‌کننده —
  وجود دارند). بقیه‌ی ADR-031 دست‌نخورده. در فهرست ثبت و لنگر کار می‌کند.
- ADRهای «پیکسل→صحنه» و «room affinity» عمداً **حالا نوشته نشدند** — تا فازِ تصمیمشان (۸٫۵ و
  ۱۱٫۱)، چون M3-D4 تک‌تک است و ADRِ زودهنگام یعنی قفلِ حدس.
- `CLAUDE.md` به‌روز شد: جدولِ اشاره‌گر (ردیفِ TODOی فعالِ M3 + بایگانیِ M2)، «وضعیت فعلی»
  (کلِ تصمیم‌های مرزی، تا بعد از هر compact دقیق برگردند)، و شمارشِ ADR ۴۱→۴۲.

### فاز ۱ — probeها: ۱٫۱ و ۱٫۳ سبز (۱۴۰۵/۰۵/۲۴)

هر دو **واقعاً اجرا** شدند (Node مستقیم، بدونِ داکر) روی کدِ **واقعیِ** امروزِ realtime، نه فرض.
اسکریپت‌های موقت بعد از گرفتنِ شواهد پاک شدند؛ در فاز ۴ به تستِ دائمیِ `auth-core` تبدیل می‌شوند.

**probe ۱٫۱ — نقشِ موثر + fail-closed (۱۰/۱۰ سبز):**
- جدولِ تصمیمِ ۸ردیفیِ «بیشترینِ منابع» درست: staff→owner، مستقیم بر تیم، لینکِ commenter بر
  تیمِ guest، و بوردِ خصوصیِ بی‌منبع → **`null`** (دسترسی نیست)، نه viewer.
- حفره‌ی `??` بازتولید شد: کاربرِ اخراج‌شده (`currentRole=null`) با `cur ?? tokenRole` **editor
  می‌مانَد**؛ تفکیکِ `cur === null → رد` می‌بنددش. تنزل و «نظری ندارم» در هر دو یکسان‌اند — یعنی
  تفاوت **فقط** سرِ `null` است، همان‌جا که باید.
- ⚠️ **یافته:** نگاشتِ **تیم→بورد** در PLAN صریح نیست. پیش‌فرضِ probe owner/admin/member→editor،
  guest→viewer بود؛ تصمیمِ مالک در گام ۴٫۲ پین شد.

**probe ۱٫۳ — برابریِ verify (۸/۸ روی «باید بگذرد» + حفره‌ی نشان‌داده‌شده):**
با verifierِ **واقعیِ** `createDevBoardAuthority`:
- منبعِ واحد: round-trip هر ۴ فیلد + چهار ردِ امنیتی (بوردِ دیگر→FORBIDDEN، منقضی، alg:none،
  امضای دستکاری‌شده).
- سه واگراییِ صادرکننده fail-closed شد: `role` به‌صورت **ایندکسِ سیم** (۱ به‌جای "editor")،
  فیلدِ `userId` به‌جای `sub`، و `boardId`ِ غایب.
- ★★ **تنها حفره‌ی خاموش — واحدِ `exp`:** صادرکننده‌ای که ms بنویسد، توکنی می‌سازد که verify
  (که `exp*1000` می‌کند) تا **~۵۵٬۷۱۵ سال** معتبر می‌بیند. تنها واگرایی‌ای که شکل‌سنجی نمی‌گیردش،
  چون verify واحد را **فرض** می‌گیرد.

★ **قفلِ طراحیِ «قطعی» که از ۱٫۳ آمد** (نگرانیِ صریحِ مالک، پین در گام ۴٫۳): (۱) schemaی claim در
`shared-types` با `exp`=ثانیه (ADR-042) · (۲) **یک** signer در auth-core تا api نتواند ms بنویسد ·
(۳) `verify` یک **سقفِ آینده** روی `exp` بگذارد (rt-token ۶۰ثانیه‌ای است). سه سدِ مستقل.

⚠️ اتصالِ **end-to-end واقعی** (api→realtime با auth-core) به auth-coreِ نساخته نیاز دارد →
معیارش در فاز ۷ (اجرای دوباره‌ی ۷ سنجه).

## تصمیم‌های باز

> ★ **وضعیت (۱۴۰۵/۰۵/۲۸):** **OD-1 و OD-2 بسته** شدند (تصمیم + شواهد)؛ **OD-3 یک قیدِ باز است، نه بلوکه** —
> `member→editor` فقط تا وقتی عضویتِ تیم **عمدی** است معتبر می‌مانَد. تاریخچه‌ی هرکدام برای مرجع نگه داشته شده.

**OD-1 — مدلِ دسترسیِ بورد + نگاشتِ `member`→بورد — ✅ بسته (مالک، ۱۴۰۵/۰۵/۲۸).** نگاشتِ نقشِ تیم→بورد در
`effectiveBoardRole` وقتی `access_mode='team'`: **owner/admin→editor · member→editor · guest→viewer**.
**گیتینگِ تاییدشده:** مسیرِ تیم **فقط** برای `access_mode='team'` فعال است؛ `private` → فقط مالکِ بورد +
`board_members` + staff (عضویتِ تیم هیچ نقشی نمی‌دهد)؛ در `link_view`/`link_edit` مسیرِ تیم **خاموش** و مسیرِ لینک
روشن (viewer/editor). پس امضای `effectiveBoardRole` به `access_mode` نیاز دارد (probe ۱٫۱ نداشت). پیاده در گام ۴٫۲.

**OD-3 — قیدِ مشروطِ `member→editor` (مالک، ۱۴۰۵/۰۵/۲۸).** ⚠️ نگاشتِ `member→editor` **معتبر است فقط تا وقتی
عضویتِ تیم صرفاً با افزودنِ عمدیِ admin/owner ساخته می‌شود.** اگر روزی **عضویتِ باز** اضافه شد (لینکِ دعوتِ
عمومی، ثبت‌نامِ خودکار به تیم)، `member→editor` یعنی هرکس واردِ تیم شد **همه‌ی** بوردهای تیم را ویرایش می‌کند —
یک حفره. پس افزودنِ عضویتِ باز **بازنگریِ این نگاشت را لازم می‌کند**. این قید در کامنتِ `effectiveBoardRole` و
در `m4-handoff` ثبت می‌شود.

**OD-2 — مکانیزمِ اعمالِ سقفِ اندازه/نوع در presign — ✅ بسته با شواهد (۱۴۰۵/۰۵/۲۸).** probe روی MinIOِ
واقعی اجرا شد و **هر دو حالت** را با عدد نشان داد. **تصمیم: presigned POST با `content-length-range` +
`eq $Content-Type`** — نه presigned PUT.
- **POST-policy (مکانیزمِ منتخب):** زیرِ سقف (۵۰۰ ≤ ۱۰۲۴) → **۲۰۴ پذیرفته**؛ بالای سقف (۵۰۰۰) →
  **۴۰۰، ردِ خودِ MinIO**؛ Content-Typeِ ناهمخوان → **۴۰۳**. سقف یک **بازه** [۰..MAX] است که policy
  سمتِ سرور اعمالش می‌کند، مستقلِ از هدرِ کلاینت.
- **چرا PUT نه (تصحیحِ دقیقِ «بایپسبل»):** ادعای اولیه «Content-Lengthِ امضاشده دورزدنی است» با عدد
  **دقیق‌تر** شد و **درست از آب درآمد**. signed PUT اندازه را فقط **پینِ دقیق** می‌کند (نه بازه) و **فقط
  اگر** content-length امضا شود — تغییرِ هر هدرِ امضاشده امضا را می‌شکند (۴۰۳). ولی PUTِ **بدونِ** امضای
  content-length، بدنه‌ی ۵۰۰۰بایتی را **۲۰۰ پذیرفت — هیچ سقفی نیست**. پس PUT نمی‌تواند سقف/بازه را
  قابل‌اتکا اعمال کند؛ POST-policy مکانیزمِ استانداردِ همین کار است.
- ⚠️ **قیدِ [ADR-013](ARCHITECTURE_DECISIONS.md#adr-013) هنوز برقرار:** این روی **MinIO** است؛ آروان
  (production) اینجا آزموده‌ناپذیر است. `content-length-range` استانداردِ S3 است و محتمل‌ترین گزینه‌ی
  قابل‌حمل، ولی رفتارِ دقیقِ آروان در گام ۳٫۳/سختی‌سنجیِ M5 باید تایید شود.
- **پیامد:** امضای `presignPut`ِ گام ۳٫۱ و AssetTransportِ گام ۳٫۳ روی **POST-policy** بسته می‌شوند
  (نه Content-Lengthِ امضاشده). این تصمیم در گام ۳٫۳ یک **ADR** می‌شود (نه حالا — الگوی «ADRِ مؤخر»).

### فاز ۲ — قراردادِ `shared-types` (گام ۲٫۲ + ۲٫۳) — ✅ (۱۴۰۵/۰۵/۲۴)

گزینه A: **گام ۲٫۱/config حذف** (env بدونِ مصرف‌کننده اضافه نمی‌شود — خط‌قرمزِ `config`)؛ config
افزایشی با مصرف‌کننده رشد می‌کند (توزیعش در فازهای ۳/۴/۵ پین شد). مالک قرارداد را مرور و با سه اصلاح تایید کرد.

**گام ۲٫۲ — DTOها (`pnpm verify` سبز):** ۷ فایلِ `src/api/*` در `shared-types` + barrel +
`api.test.ts`. نسخه‌ی **مصرف‌کننده‌دارِ** M3: User/UserPublic/Team/TeamMember/Board/BoardSummary/
BoardMember + enumها + قالبِ خطای HTTP + pagination. سه اصلاحِ مالک: `email` nullable (کاربرِ
فقط-موبایل)؛ `boardMember` + `assignableBoardRoles` **بدونِ `commenter`** (نقشِ بی‌اثر نباشد، ولی در
`boardRoles` می‌مانَد چون ایندکسِ سیمِ M2 است — نمی‌شود برداشت)؛ و حذفِ `link_comment` از
`boardAccessModes` (تا فاز ۱۰، چون ایندکس‌دار نیست تمیز حذف شد). فیلدهای مالیِ `Team` → M4.

**★ انتقالِ `BoardRole` (لمسِ M2، [ADR-043](ARCHITECTURE_DECISIONS.md#adr-043)):** منبعِ حقیقتش از
`ydoc-schema` به `shared-types` رفت (چون shared-types نمی‌تواند ydoc-schema را import کند و کپی
ممنوع است). `ydoc-schema` واردش می‌کند و `BOARD_ROLES`/`BoardRole` را re-export — **ترتیبِ سیم حفظ**،
API عمومی‌اش دست‌نخورده. verify سبز، پس تست‌های M2 نشکستند.

**گام ۲٫۳ — `rtTokenClaims` ([ADR-042](ARCHITECTURE_DECISIONS.md#adr-042)):** شکلِ توکنِ WS به
`shared-types` رفت (`exp`=ثانیه، آماده برای سقفِ exp که probe ۱٫۳ خواست). `apps/realtime` تعریفِ
محلی را حذف کرد و از همان‌جا می‌خواند — **رفعِ تعریفِ موازی**، سه تستِ حمله‌ی JWT سبز.

**گام ۲٫۴ (`CommentPin`)** از قبل به تعویق (M3-D2b) — کاری نشد.

### فاز ۳ — گام ۳٫۰ ✅ کامل (۱۴۰۵/۰۵/۲۸)

**زیرساخت + P1:**
- `packages/storage` (package.json + tsconfig + eslint + `src/index.ts`ِ اسکلت). eslint عمداً
  `@aws-sdk` را منع نمی‌کند — تنها پکیجِ مجاز (P4/ADR-013). تستش `--passWithNoTests` تا گام ۳٫۱.
- `@aws-sdk/client-s3` + `s3-request-presigner` + **`s3-presigned-post`** افزوده؛ `license:check` سبز:
  **۷۵۹ پکیج، همه مجاز**.
- MinIO در `infra/docker/docker-compose.yml` (بدونِ healthcheck؛ minio-init به ۳٫۳). ⚠️ بلوکه‌ی pull
  که در نسخه‌ی قبلیِ این سند ثبت بود (Docker Desktop بدونِ HTTPS proxy → DNS می‌افتاد) **رفع شد** —
  مالک HTTPS proxy را تنظیم کرد، `docker compose up -d minio` بالا آمد.

**★ probe اجرا شد — `packages/storage/probe/s3-probe.ts` (۷ سبز، exit 0):**
- رفت‌وبرگشتِ باینریِ بیت‌به‌بیت + `headObject` اندازه‌ی واقعی + presignGet (۲۰۰).
- **presigned PUT (مشاهده‌ای):** آپلودِ درست ۲۰۰؛ تغییرِ هدرِ امضاشده (۲۰۰۰بایت یا نوعِ غلط) → ۴۰۳
  (شکستِ امضا، نه اعمالِ سقف)؛ **PUTِ بدونِ امضای content-length، بدنه‌ی ۵۰۰۰بایت → ۲۰۰ (هیچ سقفی نیست)**.
- **★ presigned POST (مکانیزمِ منتخب):** زیرِ سقف ۲۰۴ · **بالای سقف ۴۰۰ (ردِ خودِ MinIO)** · نوعِ غلط ۴۰۳.

**نتیجه:** مکانیزمِ سقف = **POST-policy `content-length-range` + `eq $Content-Type`** (جزئیات و تصحیحِ
«بایپسبل» در §OD-2 بالا). معیارِ پذیرشِ گام ۳٫۰ محقق شد: رفت‌وبرگشت + presign اثبات شد، MinIO آپلودِ
بالای سقف/نوعِ غلط را **خودش** رد کرد، `license:check` سبز، تصمیمِ مکانیزم ثبت شد.

### فاز ۳ — گام ۳٫۱ ✅ کامل (۱۴۰۵/۰۵/۲۸)

**`packages/storage` — رابطِ `ObjectStore` روی S3 (P4، [ADR-013](ARCHITECTURE_DECISIONS.md#adr-013)):**
- `object-store.ts` (پورت + تایپ‌ها: `ObjectHead`/`PresignedUpload`/`PresignUploadOptions`) و
  `s3-object-store.ts` (`createS3ObjectStore(config)` روی `@aws-sdk`). متدها: `putObject`/`getObject`(→`null`)/
  `deleteObject`/`headObject`(→`null`)/`listPrefix`/`presignGet`/`presignUpload`.
- ⚠️ **`presignPut` → `presignUpload`** (`{url, fields}`ِ POST-policy، نه `{headers}`ِ PUT) — یافته‌ی گام ۳٫۰.
  `presignUpload({key, maxBytes, contentType})` = `createPresignedPost` با `content-length-range` + `eq
  $Content-Type`. **پیامد بر گام ۳٫۳:** پاسخِ endpointِ presign از `{uploadUrl, headers}` (PLAN §۵٫۲) به
  `{url, fields}` می‌شود — نکته برای هنگامِ ساختِ AssetTransport.
- **env:** `s3EnvSchema` در `@hamboom/config` (endpoint/region/کلیدها/`S3_FORCE_PATH_STYLE`/TTL + باکتِ
  assets/snapshots) + `.env.example`. storage خودش `process.env` نمی‌خواند؛ config می‌سازد، factory می‌گیرد.
- **گیتِ P4 خودآزمون:** `storageBoundaries()` (eslint-config) — `@aws-sdk` **مجاز**، UI/شبکه/دیتابیسِ دیگر
  ممنوع؛ وصل به `storage/eslint.config.js`؛ سه‌لایه در `boundaries.test.js`. ★ با شکستنِ عمدی (افزودنِ
  `@aws-sdk/*` به forbid) **۵ تست قرمز** شد (لایه‌ی ۱ و ۲)، بعد revert سبز — گیتِ واقعی، نه تزئینی.
- **رفت‌وبرگشتِ واقعی:** `pnpm storage:smoke` (`smoke/round-trip.ts`، بیرونِ verify) روی MinIOِ واقعی
  **۱۱ سبز**: put/get بیت‌به‌بیت، head، list، presignGet، presignUpload (۲۰۴/۴۰۰/۴۰۳ + ذخیره‌ی واقعی)، و
  قراردادِ «کلیدِ غایب = `null`، نه throw». `pnpm verify` سبز (۸ گیت).

### فاز ۳ — گام ۳٫۲ ✅ کامل (۱۴۰۵/۰۵/۲۸)

**`StorageSnapshotStore` — پورتِ ۲ روی storage ([ADR-031](ARCHITECTURE_DECISIONS.md#adr-031)):**
- `apps/realtime/src/persistence/storage-snapshot-store.ts`: `createStorageSnapshotStore(objectStore)` که پورتِ
  `SnapshotStore` را می‌دهد. **آداپتورِ نازک:** `put`→`putObject`(octet-stream) · `get`→`getObject`(→`null`) ·
  `delete`→`deleteObject`. امضای پورت **دست‌نخورده**، پس `compactor.ts` عوض نشد.
- ★ **یافته‌ی مطالعه‌ی کد — «بازخوانی بعد از put» جای درستش compactor است، نه store.** مرحله‌ی ۴ فشرده‌سازی
  از **خودِ انبار** بازمی‌خواند و state vector می‌سنجد؛ store-agnostic و از M2 اثبات‌شده (compaction.test.ts).
  پس `StorageSnapshotStore` مثلِ `FsSnapshotStore` readbackِ داخلی ندارد — دومش فقط کندی بود، نه امنیت.
- **دامنه:** `@hamboom/storage` به deps‌ِ `apps/realtime` اضافه شد (لمسِ M2، ولی مجازِ `realtimeBoundaries` و
  همان مسیری که ADR-031 تجویز کرد: «M3 پیاده‌سازیِ دوم را می‌دهد»). **صفر تغییر در منطقِ M2.**
- **`MemoryObjectStore`** به `packages/storage` افزوده شد (همتای `MemorySnapshotStore`) + خودآزمون (۵ تست)؛
  storage از `--passWithNoTests` درآمد.
- **تست‌ها (۵ سبز):** conformance روی `MemoryObjectStore` + ★ integration: compactorِ واقعی روی
  `StorageSnapshotStore(ObjectStoreِ دروغین)` → `rejects("state vector")` + **صفر prune**. با شکستنِ عمدی
  (صادق‌کردنِ دروغ) قرمز شد (compact به‌جای reject، resolve کرد)، بعد revert سبز. `pnpm verify` سبز (۸ گیت).

### فاز ۳ — گام ۳٫۳ ✅ منطق + DTO (۱۴۰۵/۰۵/۲۸)؛ HTTP/DB → فاز ۵

★ **تصمیمِ مرزیِ مالک (۱۴۰۵/۰۵/۲۸):** منطق + DTO الان و روی MinIO تست شد؛ endpointهای HTTP + `apps/api` +
جدولِ `files` به فاز ۵ (بدونِ اسکلتِ نصفه). و **بحثِ معماریِ خانه‌ی منطق:** مالک درست گفت storage نازک بمانَد؛
پس **`packages/assets`ِ جدا** ساخته شد که مصرف‌کننده‌ی storage است نه بخشی از آن (ADR-029؛ نشتِ export/pg_dumpِ M5).

**`packages/assets` — لایه‌ی دامنه‌ی دارایی:**
- `createAssetService({ objectStore, maxBytes, … })`: `presign` (اعتبار + کلیدِ `teams/<t>/boards/<b>/<fileId>.<ext>`
  + presigned POST)، `validateUploaded`، `resolve`؛ + `sniffMime` (magic-bytes: png/jpeg/webp/gif/svg).
- ★★ **`validateUploaded` هیچ چیز را از کلاینت باور نمی‌کند** (قیدِ مالک): `sha256` را **خودش روی بایت‌های
  دانلودشده** بازمحاسبه و با ادعا مقایسه می‌کند، نوعِ واقعی را **sniff** می‌کند (نه Content-Typeِ اعلامی)، اندازه
  را با `headObject`. برمی‌گرداند `{ mime, sizeBytes, sha256 }`ِ **سرور-معتبر** (w/h را مصرف‌کننده اضافه می‌کند).
- ★ `uploadedBy`/team/board از `ctx` (توکن)، نه بدنه — ساختاری در `presign(req, ctx)`.
- **DTOها در shared-types:** `assetPresignRequest`/`assetPresignResponse` (`HbAsset`/`HB_ALLOWED_IMAGE_MIME` بازاستفاده).
- **گیتِ P4 `assetsBoundaries` (خودآزمون سه‌لایه):** برخلافِ storage، `@aws-sdk` **ممنوع**. با شکستنِ عمدی ۴ تست قرمز، بعد سبز.
- **`ensureBucket`** به storage افزوده شد (ادمینِ باکت، **بیرونِ** interfaceِ نازک — smoke لازمش داشت و assets حق `@aws-sdk` ندارد).
- **[ADR-044](ARCHITECTURE_DECISIONS.md#adr-044)** نوشته شد (مکانیزمِ POST-policy، ثبتِ رسمیِ یافته‌ی probe ۳٫۰).
- **تست‌ها:** unit ۲۰ سبز (sniff + service با `MemoryObjectStore`)؛ `pnpm assets:smoke` روی MinIO **۶ سبز**
  (presign→آپلودِ واقعی→validate→resolve + sha256ِ اعلامیِ غلط رد + آپلودِ بزرگ‌تر از declared را MinIO رد). `pnpm verify` سبز.

**w/h موکول** (تصمیمِ مالک): decoderِ سمتِ سرور (`sharp`) وابستگیِ native سنگین است و w/h نمایشی است نه امنیتی؛ فاز ۵/worker.

## فاز ۴ — هسته‌ی امنیتیِ auth-core ✅ (۱۴۰۵/۰۵/۲۸؛ گام‌های ۴٫۱-JWT + ۴٫۲ + ۴٫۳)

`packages/auth-core` ساخته شد — **منطقِ خالص + پورت** (DBِ پورت‌ها فاز ۵). تصمیم‌های مالک: exp-lock + `jose`
تایید؛ member→editor با گیتینگِ access_mode (OD-1)؛ قیدِ OD-3 ثبت شد؛ JWT = HS256 (زیرساختِ مورداعتماد).

- **JWT (`tokens.ts` — جای‌گزینِ JWTِ دستیِ DevBoardAuthority):** `signRtToken`/`verifyRtToken` روی `jose`.
  ★★ **سه سدِ حفره‌ی `exp` (probe ۱٫۳):** `algorithms:["HS256"]` (alg:none رد) · یک signer که exp را از **ثانیه**
  می‌سازد · **سقفِ آینده** (`exp-now > 2×TTL` → رد). probeِ jose ثابت کرد jose **تنها** سومی را نمی‌گیرد (سالِ ~۵۸۶۰۷).
- **`effectiveBoardRole` (`roles.ts`، ADR-012):** بیشترین‌برنده، fail-closed (→`null`). ★ گیتینگِ `access_mode`
  (OD-1): مسیرِ تیم فقط `team`؛ `private` فقط مالک+board_members+staff؛ لینک فقط `link_*`+توکن. نگاشتِ تیم
  owner/admin/member→editor، guest→viewer (**OD-3** در کامنت).
- **`AuthCoreBoardAuthority` (`board-authority.ts`، پورتِ ۱):** `verify` (rt-token) + `currentRole` (نقشِ
  همین‌حالا via `effectiveBoardRole` + پورتِ `BoardAccessReader`). ⚠️ `null`≠`undefined`: auth-core همیشه نظر
  دارد. شیءِ **هم‌شکلِ** BoardAuthority (پکیج اپ را import نمی‌کند)؛ تزریق + نگاشتِ خطا در فاز ۷.
- **`refresh.ts` (گام ۴٫۱):** `startSession`/`rotateSession` روی پورتِ `SessionStore`. ★★ **تشخیصِ استفاده‌ی
  مجدد (تصمیمِ مالک):** توکنِ یک‌بارمصرف؛ ارائه‌ی دوباره‌ی توکنِ چرخانده‌شده → **کلِ خانواده می‌سوزد**، نه فقط ردِ
  همان یکی. ★ با شکستنِ عمدیِ `burnFamily` قرمز شد. ⚠️ اتمی‌بودنِ rotate در تراکنشِ DB = فاز ۵.
- **`otp.ts` (گام ۴٫۴):** `requestOtp`/`verifyOtp` روی پورتِ `OtpStore` + `SmsProvider`/Mock. کد **hash** (P7،
  خام هرگز ذخیره/لاگ نمی‌شود)، `maxAttempts`، انقضا، cooldown، تطبیقِ زمان‌ثابت، `maskPhone`. ★ ضدِ enumeration
  (`requestOtp` همیشه موفق). سوییچِ کاوه‌نگار = فاز ۵.
- **تست‌ها: ۴۳ سبز** · ★ **سه شکستنِ عمدی** (سقفِ exp، `pg` در boundaries، `burnFamily`) هر سه قرمز→سبز. `pnpm verify` سبز.
- **گیتِ P4 `authCoreBoundaries` (خودآزمون سه‌لایه):** `pg`/`ioredis`/`ws`/`@aws-sdk` ممنوع (DB در apps/api)؛ jose مجاز.

## قدم بعد — فاز ۵ (`apps/api`)، **با نقشه‌ی اول** (مثلِ گام ۳٫۳ و فاز ۴)

بزرگ‌ترین و یکپارچه‌سازترین فاز. پیش از کد، نقشه + مرزها به مالک داده می‌شود. شامل:

- `buildApp()`ِ تست‌پذیر (بدونِ `listen`) + پلاگین‌ها: `db` (Kysely+pg، ★ کوئرسِ `int8`→number، P5)، `redis`،
  `s3` (از `packages/storage`)، `auth-guard`، `rate-limit`، `request-id`، `error`، و pino + **redactorِ P7**.
- migrationِ **کاملِ** schema (`0001_init.sql`، همه‌ی جدول‌های [PLAN §۶](PLAN.md)).
- ★★ **دو FKِ به‌ارث‌رسیده‌ی M2 (handoff §۳) — حالا که `boards` ساخته می‌شود:**
  `board_updates.board_id → boards(id)` و `board_snapshots.board_id → boards(id)` (در M2 عمداً **بدونِ FK**
  ماندند چون `boards` هنوز نبود). ⚠️ **ترتیب:** این `ALTER`ها بعد از `CREATE TABLE boards` می‌آیند و
  **وابسته به اجرای migrationِ infraِ M2** (`infra/sql/migrations`) اند — روی دیتابیسِ تازه اول `pnpm db:migrate`
  بعد `migrate:up`ِ api. `\d board_updates` باید دو FK را نشان دهد.
- **پیاده‌سازیِ DBِ همه‌ی پورت‌های فاز ۳/۴:** `BoardAccessReader` (داده‌ی `effectiveBoardRole`)، `SessionStore`
  (refresh، ★ با تراکنشِ اتمیِ `SELECT … FOR UPDATE`)، `OtpStore`، و AssetTransportِ HTTP (presign/commit/GET).
- endpointها (auth/user/team/board + ★ `GET /boards/:id/rt-token`ِ پورتِ ۴) + سوییچِ کاوه‌نگار + `UPLOAD_MAX_BYTES`.

⚠️ **لوز-اِندهای فاز ۳/۴ که به فاز ۵ رفتند (فهرست):** endpointهای asset، جدولِ `files`+دی‌دوپِ sha256،
minio-init (۳ باکت)، w/h (decoder)، `UPLOAD_MAX_BYTES`، دو FKِ بالا، و DBِ سه پورتِ auth.
⚠️ **اسکریپت‌های دورریختنی:** `storage/probe/s3-probe.ts` + `auth-core/probe/jose-probe.ts` (عدد گرفته شد)؛
`smoke/`های storage و assets **کِیپر**‌اند (رفت‌وبرگشتِ واقعیِ MinIO).

⚠️ **لوز-اِندهای فاز ۳ که به فاز ۵ رفتند:** endpointهای asset، جدولِ `files`+دی‌دوپ، minio-init، `UPLOAD_MAX_BYTES`، w/h.
⚠️ **اسکریپت‌ها:** `storage/probe/s3-probe.ts` + `auth-core/probe/jose-probe.ts` دورریختنی؛ `smoke/`های storage/assets **کِیپر**.

## فاز ۵ — `apps/api` (Fastify)

### سه سوالِ مالک قبل از شروع — پاسخ‌های قفل‌شده (۱۴۰۵/۰۵/۳۱)

۱. **مسیرِ داغ:** `effectiveBoardRole`/`BoardAccessReader` روی هر update **صدا زده نمی‌شود** — کدِ M2 نشان داد
   `currentRole` فقط در اتصال ([`server.ts:318`](apps/realtime/src/server.ts)) و `HB_AUTH_REFRESH` (~۱/دقیقه/کلاینت)
   فراخوانی می‌شود و در `session.role` **کش** می‌ماند؛ گیتِ هر-update در حافظه است (`mayWriteDocument`). پس **یک
   کوئریِ JOINدارِ ایندکس‌شده** per read، **بدونِ کشِ زودهنگام** (کش = بازکردنِ همان حفره‌ی اتصالِ مجددِ M2؛ تاییدِ مالک).
   تغییرِ زنده‌ی نقش via push روی Redis busِ موجود، نه TTL.
۲. **دو FKِ ارثی: `ON DELETE CASCADE`** (+ `origin_user_id → SET NULL`). چون حذفِ بورد **نرم** است، FK فقط در حذفِ
   سختِ فقط-ownerِ بالادست شلیک می‌کند. ⚠️ CASCADE بلابِ S3 را پاک نمی‌کند (جاروبِ M5/worker).
۳. **نوشتنِ چندجدولی: همیشه تراکنش** + خودآزمونِ شکستِ وسطِ تراکنش. ساختِ بورد ذاتاً تک‌ردیفی (`created_by`) → بوردِ بی‌مالک ناممکن.

### گام ۵٫۰ — اسکلتِ `apps/api` + گیتِ `apiBoundaries` ✅ (۱۴۰۵/۰۵/۳۱)

«مرز قبل از کد»: `apps/api` خالی ساخته شد ولی مرزش قفل شد. **`apiBoundaries()`** (eslint-config): `@aws-sdk`ِ خام/
موتورِ رندر/React/`@hamboom/sdk` ممنوع؛ storage/auth-core/assets مجاز. خودآزمونِ سه‌لایه (الگو/سیم‌کشی/manifest).
★ با برداشتنِ `@aws-sdk/*` از forbid → **۳ تست قرمز**؛ revert → **۱۶۰ سبز**. `test` فعلاً `--passWithNoTests` (تا ۵٫۱-buildApp).

### گام ۵٫۱ — schema + migration ✅ (۱۴۰۵/۰۵/۳۱)

- **DP-1 پیاده شد:** `scripts/migrate.ts` تعمیم یافت — یک رانر، دو پوشه‌ی **مرتبِ ثابت** (`infra/sql/migrations` →
  `apps/api/migrations`)، یک `schema_migrations`. افزایشی: بلوکِ infraِ M2 بی‌تغییر (همان checksumها)؛ + گیتِ نامِ تکراری
  بینِ پوشه‌ها + پرشِ پوشه‌ی ناموجود.
- **`0001_init.sql`** — کلِ schemaی PLAN §۶ (**بدونِ** `board_updates`/`board_snapshotsِ` infra). آشتی‌های قفل‌شده:
  `auth_sessions.rotated_at` (پورتِ reuse)، CHECKِ `access_mode` بدونِ `link_comment` (هم‌تراز با shared-types)، CHECKِ
  نقش‌های `team_members`/`board_members`(commenter می‌پذیرد ولی تخصیص نه)/`team_invites`، و FKهای تاخیریِ
  `avatar/thumbnail/template → SET NULL`.
- **`0002_board_fks.sql`** — دو FKِ ارثی: `board_updates`/`board_snapshots.board_id → boards` **CASCADE**؛
  `board_updates.origin_user_id → users` **SET NULL**.
- ★ **روی دیتابیسِ تازه اثبات شد:** زنجیره به ترتیبِ `0001_realtime_documents`(infra) → `0001_init` → `0002` تمیز اعمال
  شد؛ `\d board_updates` **هر دو FK** را دارد؛ **۲۸ جدول**؛ اجرای دوم = no-op (ledgerِ واحد روی دو پوشه). گیتِ
  checksum-تغییرناپذیری با ویرایشِ عمدیِ فایلِ اعمال‌شده **قرمز** شد، بعد rev. `pnpm verify` سبز (۸ گیت).
- ★★ **رفتار روی Postgresِ زنده اثبات شد، نه ادعا** (`pnpm db:fk-test`، درخواستِ صریحِ مالک؛ بیرونِ verify):
  **CASCADE** (حذفِ بورد → update/snapshot واقعاً ۲→۰)، **SET NULL** (حذفِ نویسنده → `origin_user_id` نال، update می‌مانَد)،
  و **اتمیک‌بودنِ تراکنش** (واحدِ بورد+ردیفِ نامعتبر که وسط بشکند کامل rollback می‌شود — مکانیزمِ ساختِ بورد؛ تستِ خودِ
  endpoint فاز ۵٫۴). ★ خودآزمون: روی دیتابیسِ **بدونِ** FK (همان `hamboom`ِ dev پیش از `0002`) چک‌های ۱و۲ **قرمز**
  شدند (updatesLeft=1، origin=uuidِ کاربرِ حذف‌شده) — پس تست رفتار را می‌سنجد نه وجودِ ردیف. هر چک در تراکنشِ rollbackـی، بدونِ آلودگی.
- ⚠️ **مکانیزمِ idempotency/ترتیبِ `0002`:** خودِ SQL یک `ALTER`ِ ساده است؛ **idempotency (ledger) و ترتیب (پوشه‌ی
  ثابتِ infra→api) از رانر می‌آید**، نه یک بلوکِ خودمحافظِ درون-SQL. اثر همان است. افزودنِ بلوکِ `DO`ِ دفاعی به `0002`
  (چکِ وجودِ جدول‌های M2 + constraintِ if-not-exists) به مالک پیشنهاد شد — منتظرِ تصمیم.
- ⚠️ **دیتابیسِ `hamboom`ِ dev نیمه-migrate است:** `0001_init` اعمال شد ولی `0002` روی **۲۳۲۴ ردیفِ یتیمِ متریکِ M2**
  در `board_updates` (۹۳ boardِ آزمایشی، هیچ‌کدام در `boards`) افتاد — که رفتارِ **درستِ** FK است. روی دیتابیسِ تازه رخ
  نمی‌دهد. رفعِ پیشنهادی (نیازِ تاییدِ مالک، چون مخرب): `docker compose ... down -v && pnpm db:up && pnpm db:migrate`.
  دیتابیسِ اثبات (`hamboom_migrate_test`) دورریختنی است و می‌تواند drop شود.

### گام ۵٫۱-buildApp — اسکلتِ اپ + پلاگین‌های پایه ✅ (۱۴۰۵/۰۵/۳۱)

`buildApp()`ِ تست‌پذیر (بدونِ `listen`، همه‌ی وابستگی‌ها تزریق‌پذیر) با:
- **پلاگینِ db** (`plugins/db.ts`): `createDbPool` + ★★ **کوئرسِ `int8`→number (P5/ADR-015)** با `pg.types.setTypeParser(20)`؛
  ⚠️ **fail-loud روی سرریزِ `MAX_SAFE_INTEGER`** (نه گم‌شدنِ خاموشِ دقتِ ریالی). `app.db` decorate می‌شود.
- **logger با redactِ P7** (`logger.ts`): pino هر مسیرِ حساس (authorization/cookie/token/code/…) را `[Redacted]` می‌کند.
- **خطای یکسان** (`errors.ts`): `HttpError` + هندلر که شکلِ `apiError`ِ shared-types را می‌دهد؛ ناشناخته → `INTERNAL` بدونِ لو.
- `/healthz` (liveness) و `/readyz` (db را ping می‌کند، ۵۰۳ اگر بیفتد) — تفکیکِ گام ۴٫۸ realtime.
- **وابستگی‌ها:** fastify + pg + pino (`license:check` سبز، ۸۰۱ پکیج). `--passWithNoTests` برداشته شد (اولین تست‌های api).
- **تست‌ها (۸ سبز):** integration با inject (healthz/readyz/۵۰۰-یکسان/HttpError/۴۰۴)، + ★ دو خط‌قرمزِ خودآزمون: **P5**
  (سرریز → خطا) و **P7** (نشتِ عمدیِ توکن/کد → redact). هر دو با شکستنِ عمدی **قرمز** شدند (paths خالی / guard برداشته)، بعد rev.
- ★★ **P5 روی Postgresِ واقعی هم اثبات شد** (نه فقط unit): `1500000::bigint` و `count(*)::bigint` هر دو `typeof number` برگشتند.
- ⚠️ **موکول به گام‌های بعد:** پلاگین‌های `redis`/`s3`/`auth-guard`/`rate-limit`، و یکی‌شدنِ redactor با نسخه‌ی realtime (لیستِ مرکزی).

### گام ۵٫۲–۵٫۴ — vertical sliceِ جریانِ OTP→بورد ✅ (۱۴۰۵/۰۶/۰۳)

درخواستِ مالک: «می‌خوام دستی با curl تست کنم». برای اینکه جریانِ واقعی تست‌پذیر شود، برشِ عمودیِ ۵٫۲–۵٫۴ ساخته شد
و **end-to-end روی سرورِ زنده (پورت ۳۰۰۲) با curl اثبات شد**:
- **adapterهای DB** (`src/adapters/`): `createPgSessionStore` (★★ `findByHash` با `SELECT … FOR UPDATE`؛ اتمی وقتی با
  `createPgSessionStore(tx)` صدا زده شود)، `createPgOtpStore` (phone→destination، آخرین مصرف‌نشده)، `createPgBoardAccessReader`
  (کوئریِ JOINدارِ واحد؛ ⚠️ DP-4: `hasValidLink=false`، مسیرِ لینک تا گرنتِ ماندگار خاموش).
- **`withTransaction`** + `Executor` در `plugins/db.ts` (اتمی‌بودنِ چندجدولی — سوالِ ۳ مالک).
- **auth-guard** (`makeRequireAuth`): Bearer را با `verifyAccessToken` می‌سنجد، `req.authUser={sub}` (نقش نه — ADR-012).
- **endpointها:** `POST /auth/otp/request` (همیشه ۲۰۰، ضدِ enumeration)، `POST /auth/otp/verify` (verify بیرونِ tx تا
  attempts بماند؛ موفق → کاربر+فضای شخصی+نشست اتمیک → accessToken)، `POST /auth/refresh` (rotateSession در tx، اتمی)،
  `POST /boards` (تک‌ردیفی، `created_by`)، `GET /boards/:id` (نقشِ موثر؛ ★ boardIdِ بدشکل → `BOARD_ID_MALFORMED`، یافته‌ی M2 #۱).
- **config:** `authEnvSchema` (JWT_SECRET/TTLها) + `otpEnvSchema` در `@hamboom/config` + `.env`/`.env.example`.
- **MockSms** کدِ خام را در لاگِ سرور چاپ می‌کند (فقط dev، P3؛ شماره ماسک). `apps/api/src/server.ts` + configِ `api` در `.claude/launch.json`.
- ⚠️ **رفعِ لازم:** `auth-core` کلاس‌های خطا (`TokenError`/`RefreshError`) parameter property داشتند → **زیرِ Node
  strip-only می‌شکنند**؛ به فیلدِ صریح تبدیل شدند (کدِ خودم، بدونِ تغییرِ رفتار). `errors.ts`ِ api هم همین.
- **curlِ اثبات‌شده:** otp/request→`{ok:true}`؛ کد از لاگ؛ verify→`{accessToken,…,isNewUser:true}`؛ POST /boards→بورد؛
  GET→`myRole:"owner"`؛ بی‌توکن→`401`. عنوانِ فارسی درست ذخیره شد (طول ۱۵). `pnpm verify` سبز (۸ گیت، ۸۰۱ پکیج).

### گام ۵٫۲ — سخت‌سازی ✅ (۱۴۰۵/۰۶/۰۳)

- ★★ **conformanceِ مشترک + اتمیک‌بودن** (کامیتِ جدا): سوییتِ مشترکِ `SessionStore`/`OtpStore` روی memory (verify) و
  PG (`db:store-test`)؛ + **تستِ قطعیِ FOR UPDATE** (findByHashِ دومِ همزمان باید بلاک شود) که با شکستنِ عمدیِ
  `FOR UPDATE` **قطعاً قرمز** می‌شود + تستِ end-to-endِ ۱۰-چرخشِ همزمان. (خانواده‌ی باگِ seq.)
- ★ **رفعِ باگِ reuse** (کامیتِ `5aa59fb`، از تستِ دستیِ مالک): در reuse باید `burnFamily` را **commit** کرد نه rollback.
- **کوکیِ HttpOnly برای refresh:** verify/refresh کوکیِ `refresh_token` (HttpOnly، path=/auth، Secure در production) ست
  می‌کنند؛ `/auth/refresh` از کوکی می‌خواند (یا بدنه در dev). روی سرورِ زنده اثبات شد (چرخش فقط با کوکی).
- **rate-limit:** `@fastify/rate-limit`؛ سقفِ سراسری ۱۰۰ + سقفِ سخت‌ترِ ۵ روی `/auth/otp/request`. ⚠️ **باگی که زنده
  گرفتم:** خطای ۴۲۹ از `setErrorHandler` رد می‌شد و به ۵۰۰ می‌افتاد؛ شاخه‌ی `statusCode===429 → RATE_LIMITED` اضافه شد.
  روی سرورِ زنده اثبات شد (req ۶+ → ۴۲۹). store حافظه‌ای (تک‌نود)؛ چندنودی → Redis (فاز بعد).
- **zod:** `schemas.ts` (otpRequest/otpVerify/createBoard) + `parseBody`؛ شماره‌ی بدفرمت → ۴۰۰ VALIDATION_ERROR (اثبات‌شده).
  ضدِ enumeration حفظ شد (فقط فرمت را می‌سنجد). config: `rateLimitEnvSchema` افزوده.

### گام ۵٫۴ — پورتِ چهارم + /me + لیستِ بورد ✅ (۱۴۰۵/۰۶/۰۵)

- ★★ **`GET /boards/:id/rt-token` (پورتِ چهارم):** نقشِ موثر → `signRtToken`. **اثباتِ اعتبار روی مسیرِ محصولی:**
  توکنِ api با **همان `verifyRtToken`ِ مشترکِ** realtime (فاز ۷) **قبول شد** (role=owner) و برای **بوردِ دیگر رد شد**
  (`wrong_board`). E2Eِ سرور-به-سرور = فاز ۷.
- **`GET /me`** (پروفایل + تیم‌ها) و **`GET /boards`** (لیست، با گیتینگِ effectiveBoardRole). اثبات‌شده روی سرورِ زنده.
- ⚠️ نکته: بندهای «بقیه‌ی endpointها»ی زیر که الان ساخته شدند (`/me`, rt-token) دیگر todo نیستند.

### قدمِ بعد

- **بقیه‌ی endpointهای فاز ۵٫۳/۵٫۴** که برشِ عمودی نساخت: `/me`, `/teams`, `/folders`, بقیه‌ی CRUDِ بورد، `/boards/:id/access`,
  ★ `GET /boards/:id/rt-token` (پورتِ ۴)، `GET /boards/:id/snapshot`، endpointهای asset. + OpenAPI (۵٫۵).
- **موارد باز (غیربلوکه):** یکی‌شدنِ redactor با realtime؛ بلوکِ دفاعیِ `0002`؛ ریستِ dev؛ `AssetValidationError`ِ
  parameter property (لمسِ آینده)؛ rate-limitِ Redis-backed برای چندنودی.

### گام ۵٫۳ — کاربر + تیم + فولدر ✅ (۱۴۰۵/۰۶/۰۶)

- **`PATCH /me`** (displayName/locale، با COALESCE).
- **تیم:** `POST /teams` (اتمیک: team+owner+usage_counters؛ ۴۰۹ روی slugِ تکراری)، `GET`/`PATCH /teams/:id`،
  `GET /teams/:id/members`، `PATCH`/`DELETE /teams/:id/members/:userId` (مالک محافظت‌شده)، `POST /teams/:id/invites`
  (توکنِ hash، dev: در بدنه/لاگ)، `POST /invites/:token/accept` (اتمیک، `FOR UPDATE`).
- **فولدر:** `GET`/`POST /teams/:id/folders`، `PATCH`/`DELETE /folders/:id`.
- **دسترسی:** سرویسِ `requireTeamRole` (رتبه‌ی نقش؛ ★ غیرعضو → ۴۰۴ نه ۴۰۳، تا وجودِ تیم لو نرود) + گاردِ `assertUuid`
  روی پارامترهای مسیر (وگرنه کوئریِ uuid روی PG می‌ترکد). همه با zod.
- **اثباتِ زنده (دو کاربر):** A تیم/فولدر/دعوت ساخت → B پذیرفت و عضو شد → اعضا (owner/member) → نقشِ B→admin →
  PATCH /me. `pnpm verify` سبز.

### قدمِ بعدِ واقعی

بقیه‌ی CRUDِ بورد (PATCH/DELETE/restore/duplicate/favorite/جستجوی pg_trgm)، `/boards/:id/access` (اشتراک+linkToken،
که DP-4 را زنده می‌کند)، `GET /boards/:id/snapshot` (از storage)، endpointهای asset، و OpenAPI (۵٫۵).

### گام ۵٫۴ (ادامه) — CRUDِ کاملِ بورد ✅ (۱۴۰۵/۰۶/۰۶)

- `PATCH /boards/:id` (title/folderId، editor+؛ SETِ افتراقی؛ اعتبارِ فولدرِ هم‌تیم)، `DELETE` (نرم، owner)،
  `POST .../restore` (owner؛ چون reader بوردِ حذف‌شده را نمی‌بیند، `assertDeletedBoardOwner` جدا)، `POST .../duplicate`
  (editor+؛ فقط متادیتا — محتوای Y.Doc = کپیِ snapshot، فاز بعد)، `POST`/`DELETE .../favorite` (viewer+).
- `GET /boards` سرشار شد: `?q=` (ILIKE روی ایندکسِ `gin_trgm`)، `?folderId=`، `?favorite=true` + پرچمِ `is_favorite`.
- **سرویسِ `requireBoardRole`** (نقشِ موثرِ مشترک + رتبه). **اثباتِ زنده:** rename→favorite→list?favorite→search(`rena`→
  renamed)→duplicate(`… (کپی)`)→delete(۲۰۴)→GET(۴۰۴)→restore. `pnpm verify` سبز.

### گام ۵٫۴ — دسترسی/اشتراک + DP-4 حل شد ✅ (۱۴۰۵/۰۶/۰۷)

★ **DP-4 با گرنتِ ماندگار (تاییدِ مالک):** جدولِ `board_link_grants` (migration `0003`؛ board+user، PK، هر دو FK CASCADE)
که به `link_token_hash`ِ **فعلی** گره خورده. `BoardAccessReader` حالا `hasValidLink` را با یک JOIN می‌سازد
(گرنت موجود **و** token با `boards.link_token_hash` بخواند) — **امضای پورت دست‌نخورده** (فاز ۴/۷ نمی‌شکند).

- **endpointها** (`routes/board-access.ts`): `GET /boards/:id/access` (viewer+، حالت+اعضا)، `PUT /boards/:id/access`
  (owner؛ تولید/ابطالِ لینک، `linkToken` فقط همین‌بار برمی‌گردد)، `POST /public/boards/resolve` (کاربرِ احرازشده،
  گرنت upsert)، `POST`/`PATCH`/`DELETE /boards/:id/members` (owner).
- ★★ **اثباتِ زنده (شاملِ ابطال):** B بی‌دسترسی→۴۰۳ · A لینک ساخت → B resolve → **myRole:viewer** (گرنت کار می‌کند) ·
  A لینک را regenerate کرد → B دوباره → **۴۰۳** (توکنِ گرنت با لینکِ نو نمی‌خواند = **ابطالِ خودکار**) · عضوِ مستقیم:
  A، B را editor کرد → **myRole:editor**. یعنی realtime فاز ۷ هم مهمانِ لینک را درست می‌بیند/می‌بندد.
- ✅ **دیتابیسِ dev بالاخره کامل-migrate شد** (`0002`+`0003`): دادهٔ یتیمِ متریکِ M2 (۲۳۲۴ ردیف در دو جدولِ لاگ)
  با `TRUNCATE … CASCADE` پاک شد (دورریختنی)، بعد رانر `0002`/`0003` را اعمال کرد. مشکلِ «ریستِ dev» بسته شد.

### گام ۵٫۴ — snapshot + asset (storage روی MinIO) ✅ (۱۴۰۵/۰۶/۰۷)

★ **اول MinIO باز شد** (بالا، §وضعیت: رنجِ excludedِ ویندوز، نه تداخل؛ رفع = پورتِ ۹۸۰۰ در `.env`ِ محلی). بعد:

- **`GET /boards/:id/snapshot`** (`routes/boards.ts`، viewer+): کاتالوگِ `board_snapshots` (`latest` = `seq_upto DESC`)
  → `storage_key` → `ObjectStore.getObject` از باکتِ snapshots → `application/octet-stream`. بایت‌ها در S3اند، متادیتا در
  PG (ADR-031). **تاب‌آور:** بی‌ردیف → ۲۰۴ (کلاینت از WS بوت می‌کند)؛ ردیف با بایتِ گم‌شده → warn-log + ۲۰۴ (فایلِ
  گم‌شده بوم را نمی‌شکند). `plugins/s3.ts`: `ObjectStore` به‌ازای هر باکت از `@hamboom/storage` (P4)، **تزریق‌پذیر** در
  `buildApp` (تستِ بی‌MinIO).
- **endpointهای asset** (`routes/assets.ts`، PLAN §۵٫۲): `POST /boards/:boardId/assets/presign` (editor+) → رکوردِ
  pendingِ `files` + presigned POST؛ `POST .../assets/:fileId/commit` (editor+) → ★★ **`validateUploaded` sha256 را روی
  بایتِ واقعی بازمحاسبه، نوع را sniff، اندازه را headObject** (به ادعا اعتماد نمی‌شود)، سپس `ready`؛ `GET /assets/:fileId`
  (viewer+) → ۳۰۲ به presignGet (دسترسی از راهِ بوردِ فایل). **دی‌دوپِ سطحِ تیم بعد از تاییدِ sha** (نه ادعای presign —
  ناامن بود): فایلِ readyِ همسان → repoint + حذفِ ابجکتِ تکراری، fileId ثابت. `uploadEnvSchema` (UPLOAD_MAX_BYTES).
  کدها: `NOT_FOUND`/`VALIDATION_ERROR`ِ موجود (بدونِ لمسِ shared-types، ADR-021).
- **`minio-init`** به compose (P3: باکت‌ها روی ماشینِ تازه؛ `mc mb --ignore-existing`، idempotent، `$$VAR` برای shell).
- **گیت:** ۵ تستِ سیم‌کشیِ خودآزمون در `app.test.ts` (۴۰۱/بدشکل→کدِ درست) داخلِ verify. ★★ **اثباتِ زنده روی PG+MinIOِ
  واقعی:** snapshot ۶/۶ (بایتِ بیت‌به‌بیت، دو شاخه‌ی ۲۰۴، بیگانه ۴۰۳، بدشکل ۴۰۰) · asset ۱۰/۱۰ (presign→آپلودِ واقعی→
  commit→GET۳۰۲→دانلودِ بیت‌به‌بیت، دی‌دوپ+حذفِ یتیم، sha غلط→۴۲۲، بیگانه ۴۰۳، بدشکل ۴۰۴). `pnpm verify` سبز (۸ گیت).

### گام ۵٫۵ — OpenAPI + Idempotency-Key ✅ (۱۴۰۵/۰۶/۰۸) — فاز ۵ بسته شد

- **OpenAPI 3.1 از zodِ منبعِ حقیقت** (خط‌قرمزِ ۳ی `shared-types`: «یک تعریف، سه خروجی»): `openapi.ts` با
  `z.toJSONSchema` (بومیِ zod v4 — **بدونِ وابستگیِ نو**، P1) `components.schemas` را از DTOها می‌سازد و یک
  **منیفستِ مسیر** (`ROUTES`) را به paths تبدیل می‌کند. `routes/docs.ts`: `GET /openapi.json` + `GET /api/v1/docs`
  (مرورگرِ درون‌خطیِ **self-hosted** — P2، بدونِ CDN؛ در مرورگرِ واقعی رندر شد). `scripts/gen-openapi.ts`
  (`pnpm openapi:gen`) → `docs/api.md` + `docs/openapi.json`.
- ★ **گاردِ دریفت:** هوکِ `onRoute` هر مسیرِ ثبت‌شده را جمع می‌کند؛ تست ثابت می‌کند `registered == documented`
  (دوطرفه) — هیچ endpointی بی‌سند نمی‌مانَد. + تستِ ساختاری (هر operation پاسخ دارد، هر `$ref` resolve می‌شود).
- **Idempotency-Key** (`idempotency.ts`، هوکِ سراسری): روی POSTِ **احرازشده‌ی** دارای هدر، همان کلید → پاسخِ
  کش‌شده + `idempotent-replay: true` (منبعِ دوم ساخته نمی‌شود)؛ **in-flight de-dup** تا double-submitِ هم‌زمان هم یک
  اجرا شود. کلید = هشِ توکن + مسیر + کلید. حافظه‌ای + ۲۴h (تک‌نود؛ Redis = فاز بعد).
- **تستِ قطعیِ rate-limit:** عبور از سقفِ OTP → ۴۲۹؛ ★ با بردنِ سقف به ۱۰۰۰ **قرمز** شد (خودآزمون). `TEST_CONFIG`/`fakeDb`
  به `test-fixtures.ts` درآمد (اشتراکِ سه فایلِ تست).
- **گیت:** +۹ تستِ verify (۵ openapi، ۴ idempotency). ★★ **اثباتِ زنده ۹/۹:** `/openapi.json` (3.1.0)، `/api/v1/docs`
  در مرورگر رندر شد، POST /boards با کلیدِ یکسان **دقیقاً یک ردیف** ساخت و دومی کش برگرداند، بدونِ کلید دو ردیفِ متفاوت.
  `pnpm verify` سبز (۸ گیت).

### قدمِ بعد — فاز ۶ (`packages/sdk`)

کلاینتِ typedِ fetch از `shared-types` روی همه‌ی endpointها؛ قالبِ خطای §۵؛ صفحه‌بندیِ cursor؛ access در حافظه +
refreshِ خودکار روی ۴۰۱. معیار: تستِ قراردادی در برابرِ `buildApp()`ِ **واقعی** (نه mock)؛ typeها از shared-types.
⚠️ موارد باز (غیربلوکه): یکی‌شدنِ redactor با realtime · بلوکِ دفاعیِ `0002` · `AssetValidationError`ِ parameter
property · rate-limit/idempotencyِ Redis-backed برای چندنودی.
