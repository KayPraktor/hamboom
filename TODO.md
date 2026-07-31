# TODO.md — ماژول M1: `canvas-core`

> **این فایل برای اجرا با `/loop` در یک session جداست.**
>
> **قبل از شروع بخوان:** [PLAN.md](PLAN.md) بخش‌های ۲، ۷ و ۸ + [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) (به‌ویژه ADR-003، ADR-007، ADR-010، ADR-016، ADR-017، ADR-022).
>
> **دامنه:** `packages/canvas-core/` و پکیج‌های پشتیبانش. این ماژول **هیچ کد شبکه، احراز هویت یا Yjs** ندارد.
> بوم باید کاملاً آفلاین کار کند و از طریق یک آداپتور با دنیای بیرون حرف بزند.
>
> **خروجی نهایی:** یک دمو لوکال (`pnpm --filter @hamboom/canvas-core dev`) که در آن می‌شود
> استیکی فارسی ساخت، کانکتور کشید، فریم درست کرد، و همه‌چیز RTL و فارسی است — **بدون هیچ سروری**.

---

## قوانین اجرای loop

1. **ترتیب را رعایت کن.** گام‌ها به هم وابسته‌اند. گام ۲ دروازه‌ی کل ماژول است.
2. **بعد از هر گام:** `pnpm typecheck && pnpm lint && pnpm --filter @hamboom/canvas-core test` باید سبز باشد.
3. **تیک زدن فقط بعد از تحقق «معیار پذیرش».** اگر معیار محقق نشد، ننویس «انجام شد».
4. **هیچ dependency ای اضافه نکن** مگر لایسنسش MIT/Apache-2.0/BSD/ISC باشد. لایسنس را چک کن و در `docs/dependencies.md` ثبت کن.
5. **هیچ فایلی خارج از `packages/canvas-core/`، `packages/shared-types/`، `packages/ui/`، `packages/i18n/` و ریشه‌ی پیکربندی دست نزن** — بقیه‌ی ماژول‌ها مال session های دیگرند.
6. **تغییر `packages/shared-types` نیاز به تایید مالک دارد** (ADR-021). اگر لازم شد، پیشنهاد را در `PROGRESS.md` بنویس و **متوقف شو**.
7. **پایان هر session:** `PROGRESS.md` را با «چه شد / چه تصمیمی گرفتم / قدم بعد» به‌روز کن.
8. اگر گامی **بلوکه شد**، آن را با `[!]` علامت بزن، دلیل را بنویس، و به گام بعدیِ مستقل برو — کل loop را متوقف نکن.

---

## فاز ۰ — اسکلت (تخمین: ۰٫۵ روز)

### گام ۰٫۱ — راه‌اندازی مونوریپو ✅ (۱۴۰۵/۰۴/۳۱)
- [x] `pnpm-workspace.yaml` با `apps/*` و `packages/*`
- [x] `turbo.json` با task های `build`, `dev`, `lint`, `typecheck`, `test` و وابستگی `^build`
- [x] `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `moduleResolution: "bundler"`, `target: ES2022`
- [x] `packages/tsconfig` و `packages/eslint-config` به‌عنوان پکیج‌های مشترک
- [x] `.gitignore`, `.editorconfig`, `.nvmrc` (Node 24)
- [x] `scripts/license-check.ts`: پیمایش `pnpm licenses list --json`، خطا روی هر لایسنسی خارج از allow-list
- **معیار پذیرش:** `pnpm install && pnpm typecheck && pnpm license:check` بدون خطا — ✅ محقق شد

**افزوده‌های خارج از چک‌لیست (تصمیم‌های همین گام):**
- `scripts/license-check.ts` سه‌سطحی شد (ALLOWED / REVIEW / denied) با ارزیاب کامل عبارت SPDX و
  `scripts/license-exceptions.json` برای استثناهای تاییدشده. یک `--self-test` با ۱۷ مورد اضافه شد
  که ثابت می‌کند گیت واقعاً GPL/AGPL/CC-BY-NC را رد می‌کند — بدون آن، گیت لایسنس هرگز آزموده نمی‌شد.
- `tsconfig.json` ریشه اضافه شد تا `pnpm typecheck` واقعاً چیزی را چک کند
  (`scripts/**/*.ts` زیر همان قواعد سخت‌گیرانه)، نه اینکه چون هنوز پکیجی وجود ندارد بی‌صدا سبز شود.
- `packages/eslint-config/boundaries.js`: سازنده‌ی قاعده‌ی مرز وابستگی (PLAN بخش ۲) + پیش‌تنظیم
  `canvasCoreBoundaries()` که import شبکه/Yjs/auth را در `canvas-core` خطا می‌کند.
- قاعده‌ی ESLint برای ADR-016 روی style های inline در `react.js` (نسخه‌ی CSS در گام ۴٫۱).
- Prettier + `.prettierignore` (اسناد فارسی مستثنا — هم‌ترازی جدول prettier برای RTL بدتر است).
- `git init -b main` و `CLAUDE.md` ریشه (طبق «مرحله صفر» در سند محصول).

### گام ۰٫۲ — پکیج `canvas-core` و دمو ✅ (۱۴۰۵/۰۴/۳۱)
- [x] `packages/canvas-core/package.json` — نام `@hamboom/canvas-core`، `type: "module"`, exports با `./` و `./sync`
- [x] ساختار پوشه طبق PLAN بخش ۲: `engine/ elements/ tools/ ui/ text/ theme/ sync/`
- [x] یک اپ دمو داخل خود پکیج: `packages/canvas-core/dev/` با Vite (این اپ منتشر نمی‌شود، فقط برای توسعه)
- [x] Vitest + `@testing-library/react` + `jsdom` راه‌اندازی شود
- [x] `packages/canvas-core/CLAUDE.md`: خلاصه‌ی مسئولیت ماژول + لینک به PLAN/ADR + قواعد ۴ و ۵ بالا
- **معیار پذیرش:** `pnpm --filter @hamboom/canvas-core dev` یک صفحه‌ی خالی با متن «هم‌بوم» راست‌چین بالا می‌آورد — ✅ در مرورگر تایید شد (`dir=rtl`, `lang=fa`, بدون overflow افقی)

**افزوده‌های خارج از چک‌لیست:**
- هر پوشه‌ی `src/` یک `README.md` با مسئولیت، قواعد ADR مربوطه و گام TODO خودش دارد —
  تا session بعدی بداند چه چیزی کجا می‌رود بدون خواندن کل PLAN.
- `test/setup.ts` پاک‌سازی DOM را **صریح** ثبت می‌کند. testing-library فقط با
  `globals: true` این کار را خودکار می‌کند و ما globals را خاموش نگه داشته‌ایم؛
  بدون این، رندرهای تست قبلی باقی می‌مانند (همان باگی که در اولین اجرا گرفت).
- سند تست هم `dir=rtl` می‌گیرد تا رگرسیون RTL در تست دیده شود.
- قاعده‌ی مرز وابستگی با یک probe واقعی آزموده شد: `import yjs` و `import @hamboom/sdk`
  هر دو خطا می‌دهند.
- `.claude/launch.json` برای بالا آوردن دمو از داخل session.
- `packages/tsconfig` خودبسنده شد (بدون `extends` به بیرون پکیج) چون از طریق symlink
  پنپی‌ام مصرف می‌شود و مسیر نسبی به بیرون شکننده است.

---

## فاز ۱ — دروازه‌ی ریسک: متن فارسی (تخمین: ۱ تا ۳ روز) ⚠️

> این فاز **قبل از هر کار دیگری** انجام می‌شود. اگر متن فارسی روی بوم درست کار نکند، بقیه‌ی ماژول بی‌معنی است.
> نتیجه‌ی این فاز مستقیماً تعیین می‌کند در کدام پله‌ی [ADR-003](ARCHITECTURE_DECISIONS.md#adr-003) هستیم.

### گام ۱٫۱ — نصب Excalidraw و رندر اولیه ✅ (۱۴۰۵/۰۴/۳۱)
- [x] `@excalidraw/excalidraw` با نسخه‌ی **pin شده** (`0.18.1`، بدون `^`) نصب شود
- [x] لایسنس تایید و در `docs/dependencies.md` ثبت شود — MIT
- [x] یک wrapper مینیمال `<HamboomCanvas />` در `engine/HamboomCanvas.tsx`
- [x] CSS پکیج import شود و در دمو نمایش داده شود
- **معیار پذیرش:** بوم در دمو می‌آید — ✅ تایید شد (دو canvas، بدون خطا)

**دو مشکل جدی که حین این گام پیدا و رفع شد:**
- **نقض اصل P2:** Excalidraw بدون `window.EXCALIDRAW_ASSET_PATH` فونت‌هایش را از
  `esm.sh` دانلود می‌کند — بی‌صدا، بدون خطا. حل شد با `scripts/copy-excalidraw-fonts.mjs`
  (خودمیزبانی ۱۴MB فونت) + `assertAssetPathConfigured()` که نبود تنظیم را به خطای
  صریح تبدیل می‌کند + چهار تست نگهبان.
- **تصرف جهت سند:** موتور `document.documentElement.dir/lang` را عوض می‌کند.
  موقتاً با `document-direction-guard.ts` خنثی شد. جزئیات در ADR-023.

### گام ۱٫۲ — فونت Vazirmatn (بخش انجام‌شده) ⏳
- [x] Vazirmatn به‌صورت پکیج OFL-1.1 نصب و خودمیزبان شد (`@fontsource-variable/vazirmatn@5.3.0`)
- [x] `OFL-1.1` به allow-list لایسنس اضافه شد (مطابق ADR-017)
- [x] gate بارگذاری فونت: بوم تا `document.fonts.ready` رندر نمی‌شود
- [x] ترفند تزریق فونت با `unicode-range` کشف و در `dev/fonts.css` تایید شد
- [ ] انتقال `fonts.css` از `dev/` به `src/theme/` (گام ۱٫۴)
- [ ] `text/font-registry.ts` با `awaitFontsReady()` به‌عنوان API عمومی (گام ۱٫۴)

> این گام عمداً زودتر از موعد و به‌صورت جزئی انجام شد، چون بدون فونت فارسی
> spike گام ۱٫۳ نتیجه‌ی معتبری نمی‌داد — هیچ‌کدام از ۹ فونت شیپ‌شده‌ی Excalidraw
> خط عربی را پوشش نمی‌دهند.

### گام ۱٫۲ — بارگذاری فونت Vazirmatn و gate اندازه‌گیری
- [ ] فایل variable font Vazirmatn (SIL OFL) در `packages/canvas-core/assets/fonts/` — **خودمیزبان، بدون CDN**
- [ ] `@font-face` با `font-display: block` برای فونت بوم (نه `swap` — تا اندازه‌گیری با فونت اشتباه انجام نشود)
- [ ] `text/font-registry.ts`: ثبت فونت در رجیستری فونت Excalidraw + یک `awaitFontsReady()` که روی `document.fonts.ready` و `document.fonts.load()` صبر می‌کند
- [ ] `<HamboomCanvas>` تا آماده شدن فونت، بوم را رندر نکند (اسپینر نشان دهد) — [ADR-017](ARCHITECTURE_DECISIONS.md#adr-017)
- **معیار پذیرش:** یک تست که ثابت می‌کند `measureText` قبل و بعد از رندر بوم عرض یکسان برمی‌گرداند

### گام ۱٫۳ — ★ spike متن فارسی ✅ (۱۴۰۵/۰۴/۳۱) — **نتیجه: عبور به پله‌ی B، نیاز به تایید مالک**

> **خروجی:** [docs/spike-persian-text.md](docs/spike-persian-text.md) + [ADR-023](ARCHITECTURE_DECISIONS.md#adr-023)
>
> **جمع‌بندی:** شکل‌دهی حروف ✅، اندازه‌گیری ✅، شکست خط ✅ — هر سه ترس اصلی بی‌مورد بود.
> فونت با یک ترفند CSS و **بدون patch** حل شد. تنها یک مشکل واقعی ماند:
> `ctx.direction` هرگز ست نمی‌شود، پس متن فارسی با جهت پایه‌ی LTR چیده می‌شود.
> **یک patch** لازم است.
>
> ⚠️ ترتیب bidi تنها موردی است که چشمی تایید نشده (اسکرین‌شات در آن session
> در دسترس نبود). شواهد عددی قطعی‌اند ولی تایید بصری با مالک است.

<details>
<summary>شرح اصلی گام (بایگانی)</summary>

### گام ۱٫۳ — ★ spike متن فارسی (مهم‌ترین گام ماژول)
هدف: بفهمیم دقیقاً چه چیزی از RTL کار می‌کند و چه چیزی نه. **این گام کد محصولی تولید نمی‌کند، شواهد تولید می‌کند.**

- [ ] یک صفحه‌ی تست `dev/spike-text.tsx` بساز که این موارد را کنار هم رندر کند:
  - متن فارسی ساده تک‌خطی: «سلام دنیا»
  - متن فارسی چندخطی که باید wrap شود (یک پاراگراف ۵۰ کلمه‌ای)
  - متن مخلوط فارسی + انگلیسی: «این یک board برای team ماست»
  - متن مخلوط با عدد: «تعداد ۱۲۳ مورد از 456 مورد»
  - متن با نشانه‌گذاری در انتها: «آیا این درست است؟» و «(داخل پرانتز)»
  - متن با emoji و نویسه‌های zero-width
  - متن داخل ظرف (bound text) با `textAlign` های مختلف
- [ ] برای هر مورد این‌ها را بررسی و در `docs/spike-persian-text.md` ثبت کن:
  1. **شکل‌دهی حروف (shaping):** آیا حروف به هم چسبیده‌اند یا جدا رندر شده‌اند؟
  2. **جهت (bidi):** آیا ترتیب کلمات در متن مخلوط درست است؟ نشانه‌گذاری کجا می‌افتد؟
  3. **شکست خط (wrap):** آیا خط از وسط یک کلمه یا وسط یک لیگاتور می‌شکند؟
  4. **اندازه‌گیری:** آیا کادر عنصر با متن واقعی جور است یا کوچک/بزرگ‌تر است؟
  5. **ویرایشگر inline:** وقتی دابل‌کلیک می‌کنی، متن در textarea درست و راست‌چین است؟ مکان‌نما درست حرکت می‌کند؟
  6. **انتخاب متن:** درگ روی متن، محدوده‌ی درست را انتخاب می‌کند؟
- [ ] برای هر مشکل، مشخص کن با کدام روش قابل حل است: **(props/CSS)** / **(patch)** / **(فورک لازم است)**
- **معیار پذیرش:** فایل `docs/spike-persian-text.md` با جدول ۶×۷ (مورد × معیار) پر شده، و یک جمع‌بندی صریح: «پله‌ی A کافی است» یا «باید به پله‌ی B برویم».
- **⚠️ اگر جمع‌بندی «فورک لازم است» بود:** ننویس فورک را شروع کن. `PROGRESS.md` را بنویس و **از مالک تایید بگیر** — این تصمیم معماری است، نه تصمیم پیاده‌سازی.

</details>

### گام ۱٫۳ب — تکمیل spike: ویرایش inline، کلیپ‌بورد، اعداد ✅ (۱۴۰۵/۰۴/۳۱)

بعد از سوال مالک اضافه شد. مسیر کد ویرایشگر کاملاً جدا از مسیر رندر است.

- [x] **اعداد فارسی/لاتین** — رقم‌ها کاراکتر «قوی» نیستند، پس جهت را خراب نمی‌کنند.
      «۱۲۳ مورد از ۴۵۶» و «456 مورد باقی مانده» هر دو درست `rtl` می‌شوند.
- [x] **ویرایشگر inline** — موتور خودش `dir="auto"` و `unicode-bidi: plaintext`
      می‌گذارد ✅. تنها ایراد `text-align: left` است که از `element.textAlign`
      می‌آید؛ با عوض‌کردن پیش‌فرض حل می‌شود، patch لازم ندارد.
- [x] **مکان‌نما** — ۹ از ۱۱ رشته کاملاً دست‌نخورده. فقط tab متن را عوض می‌کند و
      مکان‌نما را ۷ کاراکتر عقب می‌اندازد — **روی لاتین هم دقیقاً همان‌طور**،
      پس باگ زبان‌ناوابسته‌ی بالادست است، نه مسئله‌ی فارسی.
- [x] **کپی/پیست** — ۴۱ از ۴۱ کاراکتر سالم: ZWNJ، اعداد فارسی، `ي` عربی، emoji.
- [x] **یافته‌ی طراحی‌ساز:** `dir="auto"` روی «board برای تیم ماست» جواب `ltr`
      می‌دهد. → [ADR-024](ARCHITECTURE_DECISIONS.md#adr-024): تشخیص جهت باید
      بر اساس **اکثریت** کاراکترهای قوی باشد، نه اولین.
- [x] `dev/SpikeEditing.tsx` → `#spike-edit`

> **نکته‌ی روش:** Excalidraw رویدادهای اشاره‌گر مصنوعی را نمی‌پذیرد. صفحه منتظر
> می‌ماند تا کاربر واقعاً ویرایشگر را باز کند و با `MutationObserver` خودکار
> probe ها را اجرا می‌کند.

### گام ۱٫۴ — رفع مشکلات متن فارسی ▶️ **آزاد شد (تایید مالک ۱۴۰۵/۰۴/۳۱)**

فهرست به‌روزشده بر اساس یافته‌های ۱٫۳ و ۱٫۳ب:

- [x] `text/bidi.ts` — `detectBaseDirection` **مبتنی بر اکثریت** ([ADR-024](ARCHITECTURE_DECISIONS.md#adr-024))،
      `isRTLChar`, `isLTRChar`, `countStrongChars`, `resolveDirection`, `defaultTextAlignFor` — ۱۷ تست
- [x] `text/normalize.ts` — `normalizePersian()` + `persianSearchKey()` — ۱۸ تست.
      **در فایل جدا، نه در `bidi.ts`** — مسئله‌اش جهت نیست، ورودی است.
      ⚠️ **کاندید انتقال به `shared-types` قبل از M3:** اگر فقط اینجا نرمال‌سازی کنیم،
      متنی که از API، قالب یا seed بیاید نرمال‌نشده می‌ماند و در جستجوی M3 مچ نمی‌شود.
- [x] `engine/canvas-direction.ts` — wrapper روی `fillText`/`strokeText` — ۱۰ تست
      ([ADR-025](ARCHITECTURE_DECISIONS.md#adr-025))
- [x] **🔬 تایید تجربی ADR-025** — شمارنده‌ی «فراخوانی hook» هنگام رندر واقعی بالا
      می‌رود (۳۸ فراخوانی در یک بارگذاری `#spike`). **patch لازم نشد؛ پله‌ی A حفظ شد.**
- [x] ~~اعمال P-1~~ — لازم نشد. به‌عنوان پشتیبان در `patches/README.md` می‌ماند و
      به چک‌لیست ارتقای نسخه اضافه شد.
- [x] پیش‌فرض `element.textAlign` → از `defaultTextAlignFor(defaultDirection)` در
      `initialData.appState.currentItemTextAlign`
- [x] `engine/editor-direction.ts` — صفت `dir` روی textarea از `auto` به مقدار صریح.
      تایید در مرورگر: روی «board برای تیم ماست» نگهبان `rtl` می‌دهد و `dir="auto"`
      مرورگر `ltr` — دقیقاً همان موردی که ADR-024 برایش وجود دارد. ۱۰ تست.
- [x] انتقال `fonts.css` به `src/theme/` — حالا `HamboomCanvas` خودش import می‌کند،
      پس مصرف‌کننده نمی‌تواند فراموشش کند
- [!] **تست رگرسیون هش پیکسلی — به گام ۶٫۱ موکول شد.**
      دلیل: jsdom پیکسل تولید نمی‌کند و تست پیکسلی واقعی به مرورگر headless
      (Playwright) نیاز دارد که یک وابستگی سنگین است و الان فقط برای یک تست
      اضافه می‌شود. جایگزین فعلی: ۶۴ تست واحد + شمارنده‌ی زنده‌ی `#spike` که
      در چک‌لیست ارتقای نسخه ثبت شده. در گام ۶٫۱ که تست یکپارچه‌ی مرورگری
      به‌هرحال لازم است، این هم با آن می‌آید.
- [ ] برای مشکلات دسته‌ی **props/CSS**: در `text/` حل کن (مثلاً `dir="auto"` روی textarea ویرایشگر، `unicode-bidi: plaintext`، `text-align: start`)
- [ ] برای مشکلات دسته‌ی **patch**: با `pnpm patch` اصلاح کن. هر patch باید:
  - در `patches/` باشد
  - در `patches/README.md` یک ورودی داشته باشد: چه فایلی، چرا، چه چیزی می‌شکند اگر برداشته شود
  - حداقلی باشد — فقط همان خطی که لازم است
- [ ] `text/bidi.ts`: توابع کمکی — `detectBaseDirection(text)`, `isRTLChar(ch)`, `normalizePersian(text)` (تبدیل ي/ك عربی به ی/ک فارسی، حذف کشیده‌ی اضافه، نرمال‌سازی نیم‌فاصله)
- [ ] `text/measure.ts`: پوشش روی اندازه‌گیری متن با کش (کلید: `text|font|size|maxWidth`)
- [ ] تست snapshot برای هر ۶ مورد spike
- **معیار پذیرش:** هر ۶ مورد spike روی بوم درست دیده می‌شوند و تست‌ها سبزند. اگر موردی حل نشد، در `docs/spike-persian-text.md` به‌عنوان «محدودیت شناخته‌شده» با اثر محصولی‌اش ثبت شود.

---

## فاز ۲ — قرارداد و مدل داده (تخمین: ۱ روز)

### گام ۲٫۱ — انواع عناصر در `shared-types`
> ⚠️ این گام `packages/shared-types` را می‌سازد (اولین‌بار). چون هنوز وجود ندارد، ساختنش مجاز است؛ **تغییر بعدی‌اش نیاز به تایید دارد.**

- [x] `packages/shared-types/src/canvas/element.ts`: zod schema برای `hbElementBase`, `hbCustomData`, `hbKind`, `hbElementType`
- [x] schema بر اساس **نوع رندر** (`hbShapeElement`, `hbTextElement`, `hbLinearElement`,
      `hbDrawElement`, `hbImageElement`, `hbFrameElement`) با union تفکیک‌شده روی `type`.
      **استیکی schema جدا ندارد** — از دید موتور یک `rectangle` است و فقط
      `customData.hb.kind` فرقش را می‌سازد (ADR-010). این عمدی است.
- [x] `hbAsset` (متادیتای فایل — بدون باینری)
- [x] `hbAppState` (وضعیت مشترک بورد: grid، پس‌زمینه)
- [x] type ها با `z.infer` استخراج شدند، نه دستی
- [x] **`normalizePersian` منتقل شد** — به‌جای موکول‌کردن به قبل از M3
- [x] قاعده‌ی ESLint: هیچ `@hamboom/*` در `src/` این پکیج — با probe واقعی آزموده شد
- [x] `CLAUDE.md` پکیج با قاعده‌ی «تغییر = تایید مالک»
- **معیار پذیرش:** یک نمونه از هر ۷ نوع ساخته و `parse` می‌شود — ✅ ۳۶ تست

### گام ۲٫۲ — ★ قرارداد `CanvasSyncAdapter` ✅ (۱۴۰۵/۰۴/۳۱)

- [x] `sync/contract.ts` — قرارداد کامل، طبق شکل زیر با دو تفاوت عمدی:
      `HbElement`/`HbAsset`/`HbAppState` از `shared-types` می‌آیند (نه تعریف محلی)،
      و `CanvasDocument`/`FocusTarget`/`PeerUser` به‌عنوان type نام‌دار بیرون کشیده شدند.
- [x] `sync/local-adapter.ts` — پیاده‌سازی in-memory با `LocalSyncHub`، بدون هیچ I/O
- [x] `sync/README.md` — نمودار جریان داده، دو سناریوی اصلی، چک‌لیست تحویل به M2
- [x] **نگهبان حلقه‌ی echo** — `assertEmittable` در مرز آداپتور، نه با اعتماد به بوم
- [x] `SYNC_CONTRACT_VERSION` از `0` به `1` رفت (تست smoke به‌روز شد)
- **معیار پذیرش:** تغییر بین دو کلاینت رد و بدل می‌شود و **حلقه‌ی بی‌نهایت رخ نمی‌دهد**
      — ✅ ۱۴ تست، شامل سناریوی «بوم بدرفتار» که عمداً تغییر remote را دوباره emit می‌کند

> **انحراف از متن گام:** معیار پذیرش می‌گفت «دو نمونه‌ی `<HamboomCanvas>` را با یک
> آداپتور mount کن». به‌جایش آداپتور با یک بوم ساختگی آزموده شد. دلیل: جلوگیری از
> echo یک خاصیت آداپتور و قرارداد است، نه کامپوننت React؛ و mount کردن دو موتور
> رندر در jsdom (که پیکسل ندارد) تستی می‌ساخت که کندتر و شکننده‌تر است بدون اینکه
> چیز بیشتری اثبات کند. تست «بوم بدرفتار» دقیقاً همان حلقه را می‌سازد و می‌گیرد.

<details>
<summary>شکل قرارداد که در برنامه‌ریزی تعریف شده بود (بایگانی)</summary>

```ts
// ── واحدهای انتقال ────────────────────────────────────────────
export type ChangeOrigin = "local-user" | "remote" | "undo" | "system";

export interface ElementChangeSet {
  /** عناصر ساخته‌شده یا تغییریافته — همیشه شیء کامل، نه patch */
  upserted: HbElement[];
  /** id عناصر حذف‌شده (حذف نرم: isDeleted=true) */
  deleted: string[];
  /** متادیتای فایل‌های تازه ارجاع‌شده */
  assets?: HbAsset[];
  origin: ChangeOrigin;
  /** برچسب ژست کاربر — همه‌ی تغییرات یک درگ، یک gestureId دارند */
  gestureId?: string;
}

export interface PointerState { x: number; y: number; visible: boolean }
export interface Viewport { scrollX: number; scrollY: number; zoom: number }

export interface PeerState {
  clientId: number;
  user: { id: string; displayName: string; color: string; avatarUrl: string | null };
  pointer: PointerState | null;
  selectedIds: string[];
  viewport: Viewport | null;
  activeTool: string | null;
  ephemeral?: EphemeralPayload | null;
}

/** داده‌ی موقت که هرگز ذخیره نمی‌شود — ADR-022 */
export type EphemeralPayload =
  | { kind: "draw-stroke"; points: [number, number][]; color: string; width: number }
  | { kind: "laser"; points: [number, number][] }
  | { kind: "reaction"; emoji: string; x: number; y: number };

export type ConnectionState =
  | { status: "connecting" }
  | { status: "connected"; peers: number }
  | { status: "reconnecting"; attempt: number; nextRetryMs: number }
  | { status: "offline"; pendingChanges: number }
  | { status: "error"; code: string; message: string };

export type SaveState =
  | { status: "saved"; at: number }
  | { status: "saving" }
  | { status: "unsaved"; pendingChanges: number };

export interface CanvasPermissions {
  canEdit: boolean;
  canComment: boolean;
  canExport: boolean;
  canManageAccess: boolean;
}

// ── بوم → لایه‌ی sync ─────────────────────────────────────────
export interface CanvasOutbound {
  /** تغییر عناصر توسط کاربر محلی. throttle در خود بوم انجام شده. */
  emitElementChanges(changes: ElementChangeSet): void;
  /** حرکت مکان‌نما — throttle 40ms */
  emitPointer(p: PointerState | null): void;
  emitSelection(ids: string[]): void;
  /** throttle 100ms — برای قابلیت «دنبال‌کردن کاربر» */
  emitViewport(v: Viewport): void;
  emitActiveTool(tool: string | null): void;
  /** داده‌ی موقت — بدون ذخیره */
  emitEphemeral(payload: EphemeralPayload | null): void;
  /** درخواست آپلود فایل. بوم منتظر fileId می‌ماند و تا آن موقع placeholder نشان می‌دهد. */
  requestAssetUpload(file: File): Promise<HbAsset>;
  /** درخواست باز کردن یک URL برای فایل موجود (کش‌شونده) */
  resolveAssetUrl(fileId: string): Promise<string>;
  /** بوم آماده شد و اولین رندر انجام شد */
  emitReady(): void;
}

// ── لایه‌ی sync → بوم ─────────────────────────────────────────
export interface CanvasInbound {
  applyRemoteChanges(changes: ElementChangeSet): void;
  applyPeers(peers: PeerState[]): void;
  setConnectionState(s: ConnectionState): void;
  setSaveState(s: SaveState): void;
  setPermissions(p: CanvasPermissions): void;
  /** جایگزینی کامل سند — فقط در بارگذاری اولیه یا بازگردانی نسخه */
  replaceDocument(doc: { elements: HbElement[]; assets: HbAsset[]; appState: HbAppState }): void;
  /** پرش نما به یک کاربر/عنصر */
  focusOn(target: { kind: "peer"; clientId: number } | { kind: "element"; id: string }): void;
}

// ── آداپتوری که M2 پیاده می‌کند ───────────────────────────────
export interface CanvasSyncAdapter {
  /** بوم هنگام mount صدا می‌زند و inbound خودش را می‌دهد؛ آداپتور outbound برمی‌گرداند. */
  connect(inbound: CanvasInbound): Promise<CanvasOutbound>;
  disconnect(): void;
}
```

</details>

### گام ۲٫۳ — نگاشت دوطرفه عنصر ✅ (۱۴۰۵/۰۴/۳۱)
- [x] `elements/mapping.ts`: `toExcalidraw` و `fromExcalidraw`
- [x] `getKind(element)` — تنها راه مجاز خواندن نوع محصولی، با fallback برای عناصری
      که نوار ابزار خودِ موتور ساخته و `customData` ندارند
- [x] `elementKindDiscipline()` در `eslint-config`: خطا روی `===` و `switch` روی نوع‌های
      رندر، بیرون از `mapping.ts`. فقط روی نام نوع‌های واقعی تطبیق می‌دهد تا
      `event.type === "click"` گیر نکند — با probe واقعی هر دو جهت آزموده شد.
- [x] تست round-trip روی هر ۷ نوع + اعتبارسنجی مجدد با `hbElement.parse` — ۱۹ تست

**یک باگ واقعی که تست round-trip گرفت:** `direction` در مسیر رفت به
`customData.hb` منتقل می‌شود (تا از serialization موتور جان سالم به در ببرد)، ولی
`fromExcalidraw` آن را به سطح بالا **کپی** می‌کرد بدون اینکه از `customData`
بردارد — یعنی دو منبع حقیقت، دقیقاً همان چیزی که این لایه قرار بود جلویش را بگیرد.
حالا برداشته می‌شود، نه کپی.
- **معیار پذیرش:** تست property-based روی round-trip سبز است

---

## فاز ۳ — عناصر هم‌بوم (تخمین: ۳ تا ۵ روز)

### گام ۳٫۱ — پالت و توکن‌های ظاهری ✅ (۱۴۰۵/۰۴/۳۱)
- [x] `theme/sticky-palette.ts`: ۱۲ رنگ با `{ key, nameFa, bg, text, accent }`
- [x] `theme/tokens.ts`: رنگ رابط، شعاع، سایه، فاصله، تایپوگرافی، اندازه‌ها
- [x] `theme/defaults.ts`: پیش‌فرض‌های میرو-استایل
- [x] `theme/contrast.ts`: پیاده‌سازی WCAG 2.1 — **خودش با مقادیر مرجع مستقل تست شد**
      (سیاه/سفید = ۲۱، رنگ روی خودش = ۱، روشنایی قرمز/سبز/آبی خالص). یک گیت
      آزموده‌نشده گیت نیست.
- [x] تست کنتراست روی **هر ۱۲ رنگ**: متن ≥ ۴٫۵ و accent ≥ ۳ — همه در اولین اجرا سبز
- [x] تستی که کلیدهای پالت را با `hbStickyColor` در `shared-types` مقایسه می‌کند —
      اگر یکی به‌روز شود و دیگری نه، سند و رابط از هم جدا می‌شوند
- [x] صفحه‌ی `#palette` با متن فارسی واقعی روی هر رنگ + عدد کنتراست زنده
- **معیار پذیرش:** ✅ ۵۰ تست تم سبز؛ دمو ۱۲ رنگ را کنار هم نشان می‌دهد
      (تایید برنامه‌ای در مرورگر: RTL، بدون overflow، هر ۲۴ بررسی کنتراست ✅)

> ⚠️ **تایید بصری با مالک:** اسکرین‌شات در این session در دسترس نبود. اعداد و
> مقادیر computed در مرورگر بررسی شدند، ولی قضاوت زیبایی‌شناختی روی هماهنگی
> رنگ‌ها با توست — `#palette` را باز کن.

### گام ۳٫۲ — استیکی‌نوت ✅ (۱۴۰۵/۰۴/۳۱) — با یک محدودیت ثبت‌شده
- [x] `elements/sticky.ts`: `createSticky` → ظرف + متن مقید. همه‌چیز تزریق‌پذیر
      (`makeId`, `random`, `now`, `measure`) تا خروجی در تست قطعی بماند.
- [x] `tools/sticky-tool.ts`: کلیک روی بوم → ساخت استیکی انتخاب‌شده
- [!] **ورود فوری به حالت ویرایش متن — با API عمومی ممکن نیست.** `ExcalidrawImperativeAPI`
      متدی برایش ندارد و `editingTextElement` بخشی از یک view مشتق‌شده است، نه چیزی
      که `updateScene` بپذیرد؛ ویرایشگر با side-effect ساخته می‌شود نه از روی state.
      استیکی **انتخاب‌شده** ساخته می‌شود تا کاربر با `Enter` (میانبر خود موتور) وارد
      ویرایش شود. حل کامل در گام ۴٫۲ با نوار ابزار خودمان.
- [x] `autoFit`: `fitStickyFontSize` بین ۱۲ و ۴۸، با شکست خط حریصانه.
      به `createSticky` وصل است (وقتی `measure` داده شود).
      ⚠️ **به ویرایش زنده وصل نیست** — آن هم به همان یکپارچگی ویرایشگر نیاز دارد.
- [x] `applyStickyPalette`: تغییر رنگ روی چند انتخاب همزمان، شامل رنگ متن مقید.
      پنل و منوی راست‌کلیک خودشان کار گام‌های ۴٫۳ اند؛ عملیات اینجاست.
- [x] `nextStickyPosition`: فاصله‌ی ثابت، جهت منطقی (RTL → چپ)
- [x] میانبرهای `N` و `Tab` در دمو
- **معیار پذیرش:** ✅ در مرورگر تایید شد — پنج استیکی با یک کلیک و چهار `Tab`،
      فاصله‌ی دقیقاً یکنواخت ۲۴۴px، تغییر رنگ روی انتخاب کار می‌کند (زرد + بنفش).
      متن بلند اندازه‌ی فونت را کم می‌کند (تست واحد).

**دو باگ که فقط در مرورگر دیده شدند، نه در تست:**
1. `.excalidraw` هنگام فراخوانی `excalidrawAPI` هنوز در DOM نیست — ابزار بی‌صدا
   ساخته نمی‌شد. حالا به `document` گوش می‌دهد و در لحظه با `closest()` فیلتر می‌کند.
2. `api.onChange` برای `updateScene` **برنامه‌ای** صدا زده نمی‌شود. شمارنده‌های دمو
   صفر می‌ماندند در حالی که استیکی ساخته شده بود — یعنی نمایشگر دروغ می‌گفت.

### گام ۳٫۳ — شکل و متن آزاد ✅ (۱۴۰۵/۰۵/۰۱)
- [x] `elements/factory.ts` — سازنده‌ی پایه‌ی مشترک. **قبل از نوشتن شکل استخراج شد**،
      چون همان ۳۰ خط boilerplate در استیکی بود و داشت سه‌نسخه‌ای می‌شد. `sticky.ts`
      هم روی آن بازنویسی شد و هر ۳۳ تستش بدون تغییر سبز ماند.
- [x] `elements/shape.ts`: مستطیل، بیضی، لوزی + متن مقید اختیاری.
      فقط مستطیل گوشه‌ی گرد می‌گیرد.
- [x] `elements/text.ts`: متن آزاد + `realignTextForContent` که وقتی کاربر متن را
      عوض می‌کند راست‌چینی را با محتوای جدید هم‌راستا می‌کند (جهت صریح دست‌نخورده می‌ماند)
- [x] `elements/style.ts`: `applyStyle`, `commonStyle`, `withBoundElements` —
      منطق جدا از رابط، چون همان عملیات از منوی راست‌کلیک و میانبر هم می‌آید
- [x] `ui/StylePanel.tsx` + `style-panel.css`: رنگ خط، رنگ پر، ضخامت، نوع خط،
      شفافیت، اندازه متن — فقط logical properties
- **معیار پذیرش:** ✅ در مرورگر تایید شد — هر سه شکل ساخته و استایل‌دهی می‌شوند،
      متن آزاد فارسی راست‌چین و متن داخل شکل وسط‌چین است، و پنل در RTL سمت راست
      می‌نشیند (فاصله ۱۶px از راست، بدون کد شرطی)

**دو مورد که در مرورگر گرفته شد:**
1. **`requestAnimationFrame` در تب پس‌زمینه اجرا نمی‌شود** — اولین نسخه‌ی
   تاخیر یک-تیک با rAF بود و به‌روزرسانی معلق می‌ماند. با `setTimeout` جایگزین شد.
   این در کد محصولی هم تکرارشدنی است، پس در `canvas-core/CLAUDE.md` ثبت شد.
2. **قاعده‌ی ADR-010 مثبت کاذب می‌داد** — `shape === "rectangle"` (پارامتر تابع)
   را می‌گرفت. حالا سمت چپ هم باید `.type` باشد. قاعده‌ای که مثبت کاذب می‌دهد
   دور زده می‌شود و آن‌وقت مورد واقعی را هم نمی‌گیرد.

### گام ۳٫۴ — کانکتور ✅ (۱۴۰۵/۰۵/۰۱)
- [x] `elements/connector-routing.ts`: `routeConnector(start, end, style)` **خالص و قطعی** —
      سه سبک، فقط چهار عمل اصلی + `Math.round`، بدون `Math.hypot`/`atan2`/`toFixed`
      (که دقت آخرین بیتشان بین موتورها تضمین نیست)
- [x] `elements/connector.ts`: `createConnector` با binding، و `rerouteConnector`
      (مسیر حالت مشتق‌شده است — ADR-008)
- [x] برچسب روی کانکتور (در `customData.hb.connector.label`)
- [!] **دستگیره‌های اتصال و کشیدن به فضای خالی** — به گام ۴٫۲ موکول شد. این‌ها به
      نوار ابزار و منطق hover نیاز دارند که همان‌جا ساخته می‌شوند؛ اینجا فقط
      لایه‌ی داده و مسیریابی است.
- [x] **تست قطعی بودن — دو لایه:** (۱) self-test با ۵ مورد مقدار **دست‌محاسبه**
      (نه از خروجی کد)، (۲) ممنوعیت صریح توابع غیرقطعی + گرد کردن به ۲ رقم.
      خودِ «بیت‌به‌بیت بین مرورگرها» در Node اثبات‌شدنی نیست، ولی با محدودکردن به
      عملیات کاملاً مشخص IEEE 754 و pin کردن مقادیر، سطح واگرایی صفر می‌شود.
- **معیار پذیرش:** ✅ در مرورگر تایید شد — دو استیکی وصل، یکی حرکت داده شد؛
      کانکتور از پله‌ی افقی به عمودی reroute شد، **idempotent** (سه reroute بدون
      تغییر = بدون پرش)، و نقطه‌ی اول روی **لبه‌ی** استیکی نشست نه مرکزش
      (از داخل شکل رد نمی‌شود)

**دو نکته:**
- **تغییر افزایشی در `shared-types`** (نیازمند اطلاع مالک — ADR-021): تایپ
  `HbConnectorStyle` صادر شد. schema `hbConnectorStyle` از قبل بود؛ فقط `z.infer`
  آن که جا افتاده بود اضافه شد. **قرارداد عوض نشد**، فقط یک تایپِ موجود در دسترس شد.
- تله‌ی موتور جدید: **`api.onChange` داخل خودش می‌تواند حلقه بسازد** اگر
  `updateScene` صدا بزند — ولی چون `updateScene` برنامه‌ای onChange تولید نمی‌کند،
  reroute-on-drag امن است. در `canvas-core/CLAUDE.md` این نکته از قبل ثبت شده بود.

### گام ۳٫۵ — فریم ✅ (۱۴۰۵/۰۵/۰۱)
> پیش‌نیاز چک شد (مثل ۳٫۲): **API عمومی برای گروه‌کردن undo وجود دارد** —
> `captureUpdate: "IMMEDIATELY"` روی `updateScene`. → [ADR-026](ARCHITECTURE_DECISIONS.md#adr-026)

- [x] `elements/frame.ts`: `createFrame` با نام فارسی و رنگ برچسب
- [x] عضویت با `frameId` روی فرزند (نه فهرست روی فریم): `recomputeFrameMembership`.
      باید **کاملاً** داخل باشد؛ فریم تودرتو → بالاترین z برنده؛ متن مقید مستقل نمی‌شود.
- [x] `moveFrame`: فریم + همه‌ی فرزندان + متن مقیدشان با یک جابه‌جایی.
      نوشتن در یک `updateScene(IMMEDIATELY)` = یک ژست، یک undo (ADR-026).
- [x] `deleteFrameKeepChildren`: حذف فریم فرزندان را رها می‌کند نه نابود (رفتار میرو)
- [!] **ویرایش inline نام فریم و تغییر اندازه** → گام ۴٫۲/۴٫۳ (نیاز به رابط)
- **معیار پذیرش:** ✅ در مرورگر تایید شد — فریم + دو استیکی، حرکت فریم؛ هر ۵ عنصر
      (شامل متن مقید) دقیقاً `+120,+80` حرکت کردند، و **یک undo فقط حرکت را
      برگرداند و همه‌ی عناصر ماندند**.

**★ یک باگ واقعی که این گام بیرون کشید و همه‌ی جهش‌دهنده‌ها را می‌شکست:**
تغییر `version` بدون `versionNonce` باعث می‌شد موتور تغییر را برای undo **ثبت
نکند** — حرکت فریم ورودی undo جدا نمی‌ساخت و یک Ctrl+Z کل ساخت را برمی‌گرداند.
با آزمون کنترل‌شده در مرورگر ایزوله شد (version++ تنها = بدون increment؛
versionNonce++ = increment درست). یک `bumpVersion()` مشترک در `factory.ts`
ساخته شد که هر دو را قطعی بالا می‌برد، و **همه‌ی helper های جهش** روی آن رفتند:
`moveFrame`, `applyStyle`, `applyStickyPalette`, `recomputeFrameMembership`,
`deleteFrameKeepChildren`, `realignTextForContent`. یعنی تغییر رنگ و استایل هم
همین باگ خاموش را داشتند و حالا رفع شده.

### گام ۳٫۶ — تصویر ✅ (۱۴۰۵/۰۵/۰۲)
> پیش‌نیاز در مرورگر probe شد (مثل ۳٫۲/۳٫۵): عنصر image + `fileId` + `status` را
> موتور می‌پذیرد، `addFiles` باینری را ثبت می‌کند، و **blob URL** (خروجی
> `resolveAssetUrl`) به‌عنوان منبع فایل رمزگشایی و رندر می‌شود.

- [x] `elements/image.ts`: `createImage` خالص و تزریق‌پذیر، `validateImageFile`
      (نوع/حجم)، `fitImageBox` (جا دادن با حفظ نسبت). باینری هرگز روی عنصر نیست.
- [x] `tools/image-tool.ts`: drag&drop + paste؛ جریان `requestAssetUpload` →
      درج placeholder (pending) → `resolveAssetUrl` (کش در حافظه) → `addFiles` → saved.
- [x] محدودیت کلاینت: حداکثر ۲۰MB، فقط `png|jpeg|webp|gif|svg+xml` — پیام خطای فارسی.
- [x] `local-adapter` از گام ۲٫۲ `URL.createObjectURL` را شبیه‌سازی می‌کند؛ دمو همان
      outbound را اینلاین دارد.
- [x] ۲۳ تست جدید (۱۸ عنصر/اعتبارسنجی + ۵ orchestration ابزار).
- **معیار پذیرش:** ✅ در مرورگر تایید شد — درج با **دکمه، drag&drop، و paste** یک
      عنصر image (status `saved`، انتخاب‌شده) ساخت؛ **یک undo کل تصویر را برداشت و
      redo آن را «saved» برگرداند**؛ فرمت غیرمجاز با toast فارسی رد شد. تغییر
      اندازه/چرخش بومیِ موتور است (عنصر انتخاب‌شده ساخته می‌شود).

**دو مورد که فقط در مرورگر گرفته شد:**
1. **ترتیب `captureUpdate` در جریان دو-مرحله‌ایِ pending→saved.** اول درجِ
   pending را `NEVER` و flip به saved را `IMMEDIATELY` گذاشتم؛ یک undo تصویر را
   **پاک نمی‌کرد**، فقط به pending برمی‌گرداند — چون `NEVER` (و آزموده شد: `EVENTUALLY`
   هم) خطِ پایه‌ی تاریخچه را جلو می‌برند، پس `IMMEDIATELY` فقط تفاوت وضعیت را ثبت
   می‌کرد. درست: درجِ pending=`IMMEDIATELY` (creation)، flip=`NEVER`. در
   `canvas-core/CLAUDE.md` ثبت شد.
2. **موتور خودش drop/paste تصویر را می‌گیرد.** بدون گرفتن رویداد در فاز capture و
   `stopPropagation`، تصویر دوبار درج می‌شد (یک‌بار مسیر ما، یک‌بار مسیر موتور).
   با الگوی capture+stopPropagation (مثل `sticky-tool`) مسیر موتور preempt شد —
   تایید: drop/paste فقط یک عنصر با `fileId` خودمان (`f_local_…`) می‌سازد.

- [ ] **تایید بصری با مالک:** پیکسلِ تصویر روی بوم (اسکرین‌شات در session ممکن نبود؛
      مثل bidi و پالت). blob رمزگشایی می‌شود و فایل بدون خطا ثبت می‌شود.

### گام ۳٫۷ — قلم آزاد با کانال ephemeral ✅ (۱۴۰۵/۰۵/۰۲)
> پیش‌نیاز در مرورگر probe شد: عنصر freedraw با `points` نسبی + `pressures: []` +
> `simulatePressure: true` را موتور می‌پذیرد و بدون خطا رندر می‌کند.

- [x] `elements/draw.ts`: `simplifyStroke` (RDP، خالص) + `createDraw` (خالص؛ نقاط
      مطلق → جعبه‌ی احاطه + نقاط نسبی). ساده‌سازی فقط روی **کلاینتِ کشنده** اجرا و
      نتیجه ذخیره می‌شود، پس برخلاف کانکتور نیازی به تعیّن بین‌مرورگری ندارد (`hypot` مجاز).
- [x] `tools/draw-tool.ts`: حین کشیدن فقط `emitEphemeral({ kind: "draw-stroke", … })`؛
      در `pointerup` مسیر ساده و **یک** `emitElementChanges` + یک `updateScene(IMMEDIATELY)`
      محلی (یک undo). رویداد در فاز capture گرفته می‌شود تا قلمِ خودِ موتور فعال نشود.
- [x] رندر استروکِ محلیِ در حال کشیدن روی یک `<canvas>` overlay (لایه‌ی مجزا،
      `pointer-events: none`). استروکِ **کاربران دیگر** از همین مسیر در M2/4.4
      (از `applyPeers`) می‌آید.
- [x] ۱۸ تست جدید (۱۳ عنصر/RDP + ۵ ابزار).
- **معیار پذیرش:** ✅ تست «۳۰۰ نقطه = یک `emitElementChanges`» سبز، **و در مرورگر
      تایید شد** — استروک ۲۰۱ نقطه‌ای: `emitElementChanges` دقیقاً **۱**، RDP نقاط را
      ۲۰۱→۲۹ کرد، یک عنصر freedraw؛ **یک undo حذفش کرد و redo برگرداند**؛ بدون خطای کنسول.

- [ ] **تایید بصری با مالک:** خودِ استروک روی بوم و overlay (اسکرین‌شات در session
      ممکن نبود — پنل مرورگر نمایش داده نمی‌شد). مسیر داده و undo/redo تایید شدند.

---

## فاز ۴ — رابط کاربری RTL (تخمین: ۲ تا ۴ روز)

### گام ۴٫۱ — زیرساخت RTL و i18n ✅ (۱۴۰۵/۰۵/۰۲)
- [x] `packages/i18n`: `t(key, params)` (درجِ عددِ فارسیِ خودکار)، ارقام فارسی +
      پول ریال/تومان (P5)، تاریخ جلالی با `Intl` (کلندر persian، تهران — [ADR-018](ARCHITECTURE_DECISIONS.md#adr-018)).
      لایه‌ی پایه، بدون وابستگیِ هم‌بومی، فقط Intl بومی. ۲۴ تست.
- [x] Stylelint ([stylelint.config.js](stylelint.config.js)): `property-disallowed-list`
      + `declaration-property-value-disallowed-list` خطا روی `margin/padding/border-left|right`,
      `left`, `right`, `text-align: left|right`, `float/clear` جهت‌دار ([ADR-016](ARCHITECTURE_DECISIONS.md#adr-016)).
      بدون config پایه (یک gate، یک هدف). با fixtureِ نقض **هر دو جهت** آزموده شد.
- [x] `dir="rtl" lang="fa"` روی ریشه‌ی دمو (از گام ۰٫۲).
- [x] **استثنای بوم مستند:** `engine/coords.ts` کامنت صریح «مختصات بوم هرگز آینه
      نمی‌شود» دارد؛ config استایل‌لینت هم `direction` را استثنا نمی‌گیرد (فقط جهت‌دارها).
- **معیار پذیرش:** ✅ `pnpm lint:css` روی هر ۳ فایل CSS سبز، **بدون هیچ
      `stylelint-disable`**. لایسنسِ stylelint (+۸۳ پکیج) با `pnpm license:check`
      تایید شد — ۶۵۵ پکیج، همه مجاز (P1).

### گام ۴٫۲ — نوار ابزار ✅ (۱۴۰۵/۰۵/۰۲)
> **یافته‌ی API موتور:** `UIOptions` **نوار را کامل خاموش نمی‌کند** (فقط ابزارها/
> canvasActions را تک‌تک). مسیر درست: نوار خودمان + مخفی‌کردن `.App-toolbar` با CSS.
> در مرورگر تایید شد که `.App-toolbar` سلکتورِ درست است (`display: none`).
>
> **تصمیمِ موقعیت (تاییدِ مالک):** پایین، وسط، شناور — در PROGRESS ثبت شد.

- [x] `ui/Toolbar.tsx` (ارائه‌ای) + `toolbar-tools.ts` (فراداده‌ی خالص) + آیکون‌های
      درون‌خطی. نوارِ موتور با CSS مخفی شد.
- [x] ۱۱ ابزار: انتخاب، دست، استیکی، متن، شکل، کانکتور، قلم، تصویر، فریم، کامنت، پاک‌کن.
      موتوری‌ها با `setActiveTool`، سفارشی‌ها (استیکی/قلم) با activate، تصویر با
      انتخابگرِ فایل، کامنت stub (محتوا کار M3).
- [x] موقعیت: پایین-وسط-شناور با `margin-inline: auto` (نه `left` — گیتِ Stylelint).
- [x] tooltip فارسی + میانبر برای هر ابزار، **از `@hamboom/i18n`** (`t()`, کلیدهای
      `tool.*`). میانبرها از همان جدولِ نوار (`toolForShortcut`) — یک منبع.
- [x] ۹ تست (فراداده + رندر). تستِ «هر labelKey در کاتالوگِ fa هست».
- **معیار پذیرش:** ✅ در مرورگر تایید شد — نوارِ موتور مخفی، نوارِ ما پایین-وسط با
      ۱۱ دکمه و tooltipِ فارسی؛ هر ابزار **با کلیک و با میانبر** کار می‌کند (شکل→مستطیل،
      دست→hand، v→انتخاب، n→استیکی، p→قلم)، هایلایتِ فعال درست دنبال می‌کند، و ساختِ
      استیکی از مسیرِ نوار سرتاسر کار کرد. بدون خطای کنسول.

- [ ] **تایید بصری با مالک:** ظاهرِ نوار (اسکرین‌شات در session ممکن نبود).

### گام ۴٫۳ — پنل‌های جانبی ✅ (۱۴۰۵/۰۵/۰۲) — ۴ از ۵ بخش؛ mini-map موکول شد
> **یافته‌ی API موتور:** منوی راست‌کلیکِ موتور یک `onContextMenu`ِ Reactـیِ delegate‌شده
> است و در `.popover` رندر می‌شود. با `contextmenu` در فاز capture + `preventDefault` +
> `stopImmediatePropagation` کامل preempt می‌شود — **هم‌کلاسِ drop/paste** (در مرورگر
> هر دو جهت تایید شد). zoom با `updateScene(appState)` و برازش با `scrollToContent`؛
> zoomِ پیش‌فرض و `.App-toolbar` با CSS مخفی می‌شوند.

- [x] **پنل استایل** — `StylePanel` (رنگ/ضخامت/نوع خط/شفافیت/اندازه متن از ۳٫۳) +
      **قفل** (از `toggleLock`ِ مشترک). «لایه» coming-soon (منطقش ۵٫۱ است).
- [x] **منوی راست‌کلیک RTL** — کپی/پیست/تکثیر/حذف/قفل/گروه/لایه/کپی‌به‌عنوان‌تصویر.
      کاری: تکثیر، حذف، قفل (از `elements/*`). بقیه coming-soon (کلیپ‌بورد ۵٫۳، گروه/لایه ۵٫۱).
- [x] **کنترل zoom** + «برازش با صفحه» + درصد با ارقام فارسی (zoom حول مرکز، `zoom.ts`).
- [!] **mini-map** — **موکول به بعد از فاز ۴** (تصمیم مالک ۱۴۰۵/۰۵/۰۲): کم‌ضروری‌ترین
      برای MVP. رویکرد وقتی ساخته شود: رندرِ سفارشیِ نقشه‌ی کوچک از مرزهای صحنه +
      مستطیلِ نمای فعلی، کلیک = پرشِ نما. باقی‌مانده‌ی تنهای فاز ۴.
- [x] **نوار وضعیت** — `ConnectionState`/`SaveState` با متن فارسی از `@hamboom/i18n`.
- [x] **تک‌منبعیِ قفل/حذف** — `elements/operations.ts` (`toggleLock`/`deleteElements`/
      `areAllLocked`)؛ منو و پنل هر دو همین را صدا می‌زنند (ADR-024).
- **معیار پذیرش:** ✅ در مرورگر تایید شد — همه‌ی پنل‌ها RTL، بدون متن انگلیسی؛ منوی
      موتور preempt، zoom زنجیر می‌شود، قفل از هر دو سطح یک نتیجه. (mini-map تنها بخشِ
      موکول‌شده است و در معیار پذیرشِ RTL/فارسی نقشی ندارد.)

- [ ] **تایید بصری با مالک:** ظاهرِ پنل‌ها/نوار وضعیت/zoom (اسکرین‌شات در session ممکن نبود).

### گام ۴٫۴ — حضور و همکاری (نمایشی) ✅ (۱۴۰۵/۰۵/۰۲)
- [x] `ui/PeerCursors.tsx` — مکان‌نمای همتاها با نام و رنگ (از `PeerState`، نگاشتِ
      صحنه→پیکسل تزریق‌شده). موقعیت فیزیکی (استثنای بوم).
- [x] `ui/PeerSelections.tsx` — هاله‌ی رنگیِ همتا دورِ عناصری که او انتخاب کرده.
- [x] `ui/PeerAvatars.tsx` — فهرستِ آنلاین + کلیک = دنبال‌کردن (نما روی مکان‌نمای او وسط).
- [x] **حالت فقط-خواندنی** — `viewModeEnabled` + guardِ ابزارهای ویرایش (select/hand مجاز).
- [x] **ترابریِ نمایشیِ حضور** — `dev/usePresence.ts` با `BroadcastChannel` (جای آداپتورِ
      M2)؛ همان شکلِ `PeerState`. ۹ تست جدید (۳ cursors + ۳ avatars + ۳ selections).
- **معیار پذیرش:** ✅ در مرورگر تایید شد (بازِ دومِ تب با policy بسته بود؛ با کانالِ
      دومِ `BroadcastChannel` — مکانیزم یکسان — تایید شد): مکان‌نمای همتا با نام/رنگ/
      آواتار رندر شد و اپ مکان‌نمای خودش را پخش کرد؛ leave حذفش کرد؛ follow دقیقاً روی
      مکان‌نمای همتا (۵۰۰،۳۰۰) وسط کرد؛ read-only استیکی را بست ولی select را نه؛ هاله‌ی
      انتخاب دورِ عنصر با رنگِ همتا آمد و با لغوِ انتخاب رفت.
- [x] **★ Q1 (re-project حضور هنگام pan/zoomِ محلی) — آزموده و فیکس شد (۱۴۰۵/۰۵/۰۷).**
      باگِ دمو: روی **panِ خالص** مکان‌نما/هاله سرِ جای صفحه می‌ماند (getAppState یک فریم
      کهنه + bailِ `setZoom(همان‌مقدار)`). فیکس: stateِ واحدِ `viewport` از `onScrollChange`
      و پروجکشن از همان. در مرورگر با مقادیرِ دست‌محاسبه تایید شد (مکان‌نما+هاله روی pan،
      مکان‌نما روی zoom). جزئیات در `PROGRESS.md`. **درسِ M2 ذیلِ G-1 (گام ۶٫۱).**

- [ ] **تایید بصری با مالک:** مکان‌نماها/هاله/آواتارها روی بوم (اسکرین‌شات ممکن نبود).

---

## فاز ۵ — تعامل و صیقل (تخمین: ۲ تا ۳ روز)

### گام ۵٫۱ — انتخاب، گروه و چیدمان ✅ (۱۴۰۵/۰۵/۰۷)

> **پروبِ توانمندیِ موتور (۱۴۰۵/۰۵/۰۷) — قبل از نوشتنِ منطق:** بیشترِ ۵٫۱ در موتور
> بومی است. یافته‌ها (تا از نو پروب نشود):
> - **کادرِ انتخاب + `Shift+Click`**: بومیِ ابزارِ selection.
> - **گروه‌بندی**: بومی با فیلدِ `groupIds`؛ `Ctrl+G` از keydownِ دمو رد می‌شود (ctrl → دستِ موتور).
> - **snap + راهنمای هم‌ترازی**: بومی ولی **خاموش** (`objectsSnapModeEnabled:false`,
>   `gridModeEnabled:false`, `gridSize:20`) — فقط باید در appState روشن شود، کدِ جدید نمی‌خواهد.
> - **align/distribute**: API امپراتیوِ مستقیم **ندارد** (نه actionManager) → تابعِ خالصِ خودمان
>   روی x/y + رابطِ RTL. ⚠️ «چپ/راست» عملیاتِ **مختصاتِ بوم** است (آینه نمی‌شود، P6)؛ فقط برچسبِ UI فارسی.
> - **z-order**: فیلدِ `index` **ایندکسِ کسریِ بومی** است (`a0..`)؛ با پاسِ آرایه‌ی مرتب‌شده به
>   `updateScene`، موتور خودش ایندکس را بازتولید می‌کند — بی‌نیاز از پیاده‌سازیِ الگوریتم (ADR-007+024).

- [x] انتخاب چندتایی با کادر و با `Shift+Click` — بومیِ موتور؛ **تاییدِ چشمیِ مالک ۱۴۰۵/۰۵/۰۷**.
- [x] گروه‌بندی (`Ctrl+G` / `Ctrl+Shift+G`) — بومی (`groupIds`)؛ **تاییدِ چشمیِ مالک ۱۴۰۵/۰۵/۰۷**.
- [x] راهنمای هم‌ترازی (alignment guides) هنگام درگ — ✅ روشن شد: `objectsSnapModeEnabled: true`
      در initialDataِ [`HamboomCanvas`](packages/canvas-core/src/engine/HamboomCanvas.tsx). config در
      مرورگر تایید شد؛ **دیدنِ خطوطِ راهنما هنگام درگ در چک‌لیستِ تاییدِ چشمیِ PROGRESS.**
- [x] snap به عناصر دیگر و به شبکه — ✅ snap به عناصر پیش‌فرض روشن؛ snap به شبکه با toggleِ
      «شبکه» در دمو (`gridModeEnabled`). config + toggle در مرورگر تایید شد؛ **رفتارِ snap
      در چک‌لیستِ چشمی.**
- [x] **ابزار هم‌ترازی: چپ/راست/وسط، توزیع یکنواخت** — ✅ (۱۴۰۵/۰۵/۰۷) `alignElements`/
      `distributeElements` در [`elements/align.ts`](packages/canvas-core/src/elements/align.ts)
      (خالص؛ مختصاتِ بوم، **بدونِ آینه** P6؛ متنِ مقید با ظرفش حرکت می‌کند؛ ۱۲ تستِ دست‌محاسبه).
      در پنل استایل: هم‌ترازی با ۲+ انتخاب، توزیع با ۳+. یک ژست undo (commitGesture).
      **گپِ تاییدِ بصری (به مالک موکول شد):** نمایشِ بخشِ هم‌ترازی هنگام انتخابِ چندتایی در
      مرورگرِ این session تایید نشد — پنجره‌ی مرورگر **مخفی** است، فریم composite نمی‌شود، و
      onChangeِ موتور برای تغییرِ **انتخاب** fire نمی‌شود؛ پس snapshot به‌روز نمی‌شد. رفتارِ
      pureها و سیم‌کشیِ پنل با تستِ واحد سبزند. (حین این، یک باگِ نهفته‌ی دمو هم رفع شد — پایین.)
- [x] **تغییر لایه: جلو/عقب/جلوترین/عقب‌ترین با fractional index** ([ADR-007](ARCHITECTURE_DECISIONS.md#adr-007)) —
      ✅ (۱۴۰۵/۰۵/۰۷) `reorderElements` در `elements/operations.ts` (خالص، ۱۱ تست، فقط ترتیبِ
      آرایه؛ موتور ایندکس را بازتولید می‌کند). **منبعِ واحد** (ADR-024): منوی راست‌کلیک
      (جلوترین/عقب‌ترین = front/back) و پنل استایل (جلو/عقب = یک‌پله) هر دو از همین تابع، از راهِ
      `applyReorder`ِ دمو. **تاییدِ مرورگر:** پنلِ «عقب» عنصر را یک لایه پایین برد و منوی «بردن به
      عقب» به ته؛ **یک** Ctrl+Z هر دو را برگرداند (commitGesture IMMEDIATELY + bumpVersion، ADR-026).

### گام ۵٫۲ — Undo/Redo ✅ (۱۴۰۵/۰۵/۰۷)

> **بیشترِ این گام قبلاً با [ADR-026](ARCHITECTURE_DECISIONS.md#adr-026) ساخته شده بود.**
> مکانیزمِ «یک ژست = یک undo» همان `captureUpdate: "IMMEDIATELY"` است که همه‌ی نوشتن‌ها
> از `commitGesture` می‌گیرند و قاعده‌ی ESLintِ `require-capture-update` اجباری‌اش می‌کند.

- [x] undo/redo کلِ یک ژست را یک واحد می‌بیند — ✅ مکانیزمِ ADR-026 (`commitGesture`
      IMMEDIATELY). در M1 مرزِ ژست همان فراخوانیِ capture است؛ `gestureId` مکانیزمِ
      گروه‌بندیِ M2 است (در `ElementChangeSet` قرارداد از قبل هست). **تاییدِ مرورگر:**
      ساختِ فریم+فرزندان (۵ عنصر) → **یک** Ctrl+Z همه را برگرداند، redo همه را بازگرداند.
- [x] در حالت متصل، undo کار دیگران را برنگرداند — **آماده‌سازیِ M2 مستند شد**: `applyRemoteChanges`
      باید `captureUpdate: "NEVER"` بنویسد و روی تراکنش‌های Yjs `origin` بگذارد تا
      `Y.UndoManager` با `trackedOrigins` کار دیگران را برنگرداند ([sync/README](packages/canvas-core/src/sync/README.md)
      + ADR-026/ADR-012). M1 شبکه ندارد، پس اینجا فقط قرارداد است.
- [x] تست «فریم با ۳ فرزند → یک Ctrl+Z همه برمی‌گردند» — ✅ در مرورگر تایید شد؛ **تستِ واحدِ
      اتمیک‌بودنِ ژست** (`scene-commit.test.ts`: ژستِ چندعنصری = یک `updateScene`) اضافه شد.
      تستِ تکرارپذیرِ خودِ undoِ موتور به harnessِ مرورگریِ گام ۶٫۱ موکول است (خانواده‌ی G-1؛
      jsdom undo ندارد).

### گام ۵٫۳ — کلیپ‌بورد ✅ (۱۴۰۵/۰۵/۰۷) — به‌جز copy-as-PNG

> **پروب (اول):** preemptِ copy/cut/paste هم‌کلاسِ drop/paste است (تایید مرورگر)؛
> پیستِ تصویر از قبل با image-tool (۳٫۶) گرفته می‌شود و ابزارِ کلیپ‌بورد آن را defer
> می‌کند. **منبعِ واحد:** هسته‌ی کلونِ `duplicateElements` به `cloneElements` استخراج شد و
> paste رویش سوار است؛ cut از `deleteElements`.

- [x] کپی/پیست داخل بوم (id جدید + آفست) — [`tools/clipboard-tool.ts`](packages/canvas-core/src/tools/clipboard-tool.ts)
      + [`elements/clipboard.ts`](packages/canvas-core/src/elements/clipboard.ts) روی `cloneElements`.
      کلیپ‌بوردِ درون‌حافظه‌ای + token برای تفکیکِ داخلی/خارجی؛ آفستِ آبشاری. منو (کپی/پیست)
      و Ctrl+C/X/V. ۴ تستِ ابزار.
- [x] پیست تصویر از کلیپ‌بورد سیستم — از گام ۳٫۶ (image-tool)؛ ابزارِ کلیپ‌بورد تصویر را **defer** می‌کند.
- [x] پیست متن ساده → استیکی — `textToStickies` (روی `createSticky`).
- [x] پیست چند خط → چند استیکیِ کنارِ هم — `textToStickies` چندخطی (روی `nextStickyPosition`، RTL). ۶ تست.
- [!] **کپی به‌عنوان PNG** — موکول: به exportِ PNGِ موتور + `navigator.clipboard.write` با
      دسترسیِ کلیپ‌بورد نیاز دارد؛ در این محیط قابلِ تایید نیست. مثلِ mini-map موکول شد.

> **تاییدِ چشمی (به مالک):** رفتارِ Ctrl+C/V (کپی/پیستِ عناصر، متن→استیکی، defer تصویر) و
> منوی کپی/پیست به کلیپ‌بوردِ واقعی نیاز دارد → در چک‌لیستِ چشمیِ PROGRESS. منطق و
> imperative-ها تستِ واحدِ سبز دارند.

### گام ۵٫۴ — دسترس‌پذیری و کارایی ✅ (۱۴۰۵/۰۵/۰۷)
- [x] پیمایش با کیبورد بین عناصر، `Escape`/`Enter`/جهت‌ها — `cycleSelection` در
      `operations.ts` (خالص، ترتیبِ خواندنِ RTL، wrap؛ ۵ تست) + `Tab`/`Shift+Tab` در دمو
      (**تاییدِ مرورگر: چرخش بین ۳ عنصر + wrap**). `Escape`/`Enter`/nudgeِ جهت‌دار بومیِ موتورند
      (دمو دستشان نمی‌زند).
- [x] `aria-label` فارسی روی همه‌ی دکمه‌ها — ممیزیِ [`ui/a11y.test.tsx`](packages/canvas-core/src/ui/a11y.test.tsx):
      هر دکمه‌ی Toolbar/StylePanel/ZoomControl/ContextMenu/PeerAvatars نامِ در دسترس دارد
      (aria-label یا متن). همه سبز — از قبل کامل بود، حالا نگهبان دارد.
- [x] **بنچمارک ۲۰۰۰ عنصر / ۳۰fps** — صفحه‌ی [`dev/Bench.tsx`](packages/canvas-core/dev/Bench.tsx)
      (مسیر `#bench`). **استفاده‌ی واقعی (zoom ۱): ۱۴۴fps، صفر فریمِ کند** — معیار با حاشیه‌ی
      بزرگ پاس. («۴۵fps»ِ اولیه artifactِ sweepِ تهاجمیِ zoom-out بود، نه محصول.)
- [x] **cullingِ خارج از viewport — رد شد.** آزمایشِ قطعی: در zoom ۱، ۱۰۰۰ و ۲۰۰۰ عنصر هر
      دو ۱۴۳–۱۴۴fps → دوبرابرشدنِ **کل** هیچ اثری نداشت → هزینه **O(visible)** است، موتور
      خودش off-screen را cull می‌کند. پس virtualization **زائد** است و ساخته نشد. دلیلِ کامل
      در [`docs/perf-baseline.md`](docs/perf-baseline.md) (تا دوباره سراغش نروند).
- **معیار پذیرش:** ✅ `docs/perf-baseline.md` با هر دو مجموعه‌ی اعدادِ واقعیِ مالک نوشته شد.

---

## فاز ۶ — تحویل (تخمین: ۱ روز)

### گام ۶٫۱ — تست و مستندسازی

> **دو کار که از گام‌های قبلی به اینجا موکول شدند.** هر دو در
> [`src/sync/README.md`](packages/canvas-core/src/sync/README.md) هم به‌عنوان
> گپ M2 ثبت شده‌اند تا از دو جا قابل پیدا شدن باشند.

- [ ] **G-2 (از گام ۱٫۴):** تست رگرسیون هش پیکسلی جهت متن با Playwright.
      [ADR-025](ARCHITECTURE_DECISIONS.md#adr-025) روی wrapper `fillText` بنا شده و
      **بی‌صدا** می‌شکند اگر موتور مسیر رندر را عوض کند. تشخیص فعلی فقط شمارنده‌ی
      دستی در `#spike` است.
- [ ] **G-1 (از گام ۲٫۲ + حضورِ ۴٫۴):** تست دو-نمونه‌ای با بوم **واقعی** — دو
      `<HamboomCanvas>` با یک آداپتور مشترک. تست فعلی فقط ثابت می‌کند آداپتور بومِ
      بدرفتار را می‌گیرد، نه اینکه binder واقعی قاعده را رعایت می‌کند. **پیش‌نیاز:
      binder در M2.** این تست باید **رندرِ حضور** را هم پوشش دهد (نه فقط echo آداپتور):
  - [ ] مکان‌نما/هاله/آواتارِ همتا از `applyPeers` در نمونه‌ی دیگر رندر شود (Q2 — تاییدِ
        فعلی با کانالِ دومِ `BroadcastChannel` بود، نه دو موتورِ واقعی).
  - [ ] **re-projectِ حضور با هر تغییرِ viewport** — pan **خالص** و zoom (Q1). درسِ ثابت‌شده
        در دمو: از نمای معتبرِ `onScrollChange` پروجکت کن، نه `getAppState()`ِ کهنه؛ و با
        هر جابه‌جاییِ نما re-render بده.
  - [ ] follow کردنِ همتا: viewportِ مستقلِ دو موتور و پرشِ درست به مکان‌نمای طرف.
- [ ] پوشش تست واحد ≥ ۶۰٪ روی `elements/`, `text/`, `sync/`
- [ ] تست یکپارچه: سناریوی «باز کردن بوم خالی → ساخت ۵ استیکی و ۲ کانکتور → undo/redo → بازخوانی از آداپتور»
- [ ] `packages/canvas-core/README.md`: نحوه‌ی مصرف پکیج، props ها، مثال حداقلی
- [ ] `sync/README.md` نهایی با نمودار جریان داده
- [ ] `docs/dependencies.md` کامل با لایسنس هر پکیج

### گام ۶٫۲ — آماده‌سازی برای M2
- [ ] چک کن `canvas-core` **هیچ import ای** از شبکه، Yjs، یا `@hamboom/sdk` ندارد
- [ ] `local-adapter` به‌عنوان مرجع پیاده‌سازی، کامنت‌گذاری کامل شده باشد
- [ ] فهرست صریح «چیزی که M2 باید پیاده کند» در `sync/README.md`
- [ ] `PROGRESS.md` نهایی: چه چیزی ساخته شد، چه محدودیت‌هایی ماند، کدام پله‌ی ADR-003 هستیم

---

## چیزهایی که در این ماژول **انجام نمی‌شوند**

تا وسوسه نشوی — این‌ها عمداً بیرون‌اند:

- ❌ اتصال به هر سروری، WebSocket، یا Yjs (کار M2)
- ❌ احراز هویت، کاربر واقعی، مجوز واقعی (کار M3) — در دمو کاربر ساختگی است
- ❌ ذخیره در دیتابیس یا Object Storage (کار M3)
- ❌ متن کامنت‌ها (فقط سنجاق روی بوم؛ محتوا کار M3 است)
- ❌ گالری قالب‌ها (کار M3 + web)
- ❌ Export سمت سرور (کار M3/worker) — فقط export کلاینتی ساده
- ❌ صفحه‌ی داشبورد، لیست بورد، تنظیمات تیم (کار `apps/web`)

---

## قالب `PROGRESS.md`

```markdown
# PROGRESS — canvas-core
تاریخ آخرین به‌روزرسانی: <YYYY-MM-DD>
گام فعلی: <شماره گام>

## انجام شد
- ...

## تصمیم‌های گرفته‌شده (کاندید ADR)
- ...

## بلوکه (نیاز به تصمیم مالک)
- ...

## قدم بعدی
- ...

## پله‌ی فعلی ADR-003
A (بسته npm) / B (patch) / C (فورک) — و چرا
```
