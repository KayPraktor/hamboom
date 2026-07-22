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

### گام ۰٫۲ — پکیج `canvas-core` و دمو
- [ ] `packages/canvas-core/package.json` — نام `@hamboom/canvas-core`، `type: "module"`, exports با `./` و `./sync`
- [ ] ساختار پوشه طبق PLAN بخش ۲: `engine/ elements/ tools/ ui/ text/ theme/ sync/`
- [ ] یک اپ دمو داخل خود پکیج: `packages/canvas-core/dev/` با Vite (این اپ منتشر نمی‌شود، فقط برای توسعه)
- [ ] Vitest + `@testing-library/react` + `jsdom` راه‌اندازی شود
- [ ] `packages/canvas-core/CLAUDE.md`: خلاصه‌ی مسئولیت ماژول + لینک به PLAN/ADR + قواعد ۴ و ۵ بالا
- **معیار پذیرش:** `pnpm --filter @hamboom/canvas-core dev` یک صفحه‌ی خالی با متن «هم‌بوم» راست‌چین بالا می‌آورد

---

## فاز ۱ — دروازه‌ی ریسک: متن فارسی (تخمین: ۱ تا ۳ روز) ⚠️

> این فاز **قبل از هر کار دیگری** انجام می‌شود. اگر متن فارسی روی بوم درست کار نکند، بقیه‌ی ماژول بی‌معنی است.
> نتیجه‌ی این فاز مستقیماً تعیین می‌کند در کدام پله‌ی [ADR-003](ARCHITECTURE_DECISIONS.md#adr-003) هستیم.

### گام ۱٫۱ — نصب Excalidraw و رندر اولیه
- [ ] `@excalidraw/excalidraw` با نسخه‌ی **pin شده** (بدون `^`) نصب شود
- [ ] لایسنس تایید و در `docs/dependencies.md` ثبت شود
- [ ] یک wrapper مینیمال `<HamboomCanvas />` در `engine/HamboomCanvas.tsx` که `<Excalidraw>` را رندر می‌کند و `excalidrawAPI` را در ref می‌گیرد
- [ ] CSS پکیج import شود و در دمو نمایش داده شود
- **معیار پذیرش:** بوم در دمو می‌آید، می‌شود مستطیل کشید و zoom/pan کرد

### گام ۱٫۲ — بارگذاری فونت Vazirmatn و gate اندازه‌گیری
- [ ] فایل variable font Vazirmatn (SIL OFL) در `packages/canvas-core/assets/fonts/` — **خودمیزبان، بدون CDN**
- [ ] `@font-face` با `font-display: block` برای فونت بوم (نه `swap` — تا اندازه‌گیری با فونت اشتباه انجام نشود)
- [ ] `text/font-registry.ts`: ثبت فونت در رجیستری فونت Excalidraw + یک `awaitFontsReady()` که روی `document.fonts.ready` و `document.fonts.load()` صبر می‌کند
- [ ] `<HamboomCanvas>` تا آماده شدن فونت، بوم را رندر نکند (اسپینر نشان دهد) — [ADR-017](ARCHITECTURE_DECISIONS.md#adr-017)
- **معیار پذیرش:** یک تست که ثابت می‌کند `measureText` قبل و بعد از رندر بوم عرض یکسان برمی‌گرداند

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

### گام ۱٫۴ — رفع مشکلات متن فارسی
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

- [ ] `packages/shared-types/src/canvas/element.ts`: zod schema برای `HbElementBase`, `HbCustomData`, `HbKind`, `HbElementType` — دقیقاً طبق [PLAN.md بخش ۷٫۲](PLAN.md#۷۲-property-های-مشترک-همه-عناصر)
- [ ] schema اختصاصی هر نوع: `HbStickyElement`, `HbShapeElement`, `HbTextElement`, `HbConnectorElement`, `HbFrameElement`, `HbImageElement`, `HbDrawElement`
- [ ] `HbAsset` (متادیتای فایل — بدون باینری)
- [ ] `HbAppState` (وضعیت مشترک بورد: grid، پس‌زمینه)
- [ ] type ها با `z.infer` استخراج شوند، نه دستی نوشته شوند
- **معیار پذیرش:** یک تست که یک نمونه از هر ۷ نوع را می‌سازد و `parse` می‌کند

### گام ۲٫۲ — ★ قرارداد `CanvasSyncAdapter`
> **این مهم‌ترین خروجی ماژول است.** ماژول M2 (realtime-sync) دقیقاً همین interface را پیاده می‌کند.

- [ ] `packages/canvas-core/src/sync/contract.ts` با این محتوا (شکل نهایی؛ نام‌ها را تغییر نده مگر با ثبت دلیل در PROGRESS):

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

- [ ] `sync/local-adapter.ts`: یک پیاده‌سازی in-memory از `CanvasSyncAdapter` برای دمو و تست (بدون شبکه، با `localStorage` برای پایداری ساده)
- [ ] `sync/README.md`: توضیح جریان داده + نمودار ترتیبی برای «کاربر یک استیکی می‌سازد» و «تغییر remote می‌رسد»
- [ ] **جلوگیری از حلقه‌ی echo:** تغییرات با `origin: "remote"` نباید دوباره `emitElementChanges` تولید کنند — این با یک flag در binder و تست اختصاصی تضمین شود
- **معیار پذیرش:** تستی که دو نمونه‌ی `<HamboomCanvas>` را با یک `local-adapter` مشترک mount می‌کند؛ ساخت استیکی در یکی، در دیگری ظاهر می‌شود، و **هیچ حلقه‌ی بی‌نهایتی** رخ نمی‌دهد

### گام ۲٫۳ — نگاشت دوطرفه عنصر
- [ ] `elements/mapping.ts`: `toExcalidraw(hbElement)` و `fromExcalidraw(exElement)`
- [ ] `getKind(element)` — تنها راه مجاز خواندن نوع محصولی ([ADR-010](ARCHITECTURE_DECISIONS.md#adr-010))
- [ ] ESLint rule سفارشی: خطا روی `element.type === "rectangle"` در کد خارج از `elements/mapping.ts`
- [ ] تست round-trip: `fromExcalidraw(toExcalidraw(x))` باید عیناً `x` بدهد، برای هر ۷ نوع
- **معیار پذیرش:** تست property-based روی round-trip سبز است

---

## فاز ۳ — عناصر هم‌بوم (تخمین: ۳ تا ۵ روز)

### گام ۳٫۱ — پالت و توکن‌های ظاهری
- [ ] `theme/sticky-palette.ts`: ۱۲ رنگ طبق [PLAN.md بخش ۷٫۳](PLAN.md#الف-sticky-note-استیکینوت) با `{ key, nameFa, bg, text, accent }`
- [ ] `theme/tokens.ts`: رنگ‌های رابط، شعاع گوشه، سایه، فاصله‌ها، اندازه‌های فونت
- [ ] `theme/defaults.ts`: پیش‌فرض‌های میرو-استایل — `roughness: 0`، `fillStyle: "solid"`، `roundness: {type:3}`، `strokeWidth: 1`
- [ ] تست کنتراست: هر جفت `bg`/`text` باید نسبت ≥ 4.5:1 داشته باشد (WCAG AA)
- **معیار پذیرش:** تست کنتراست سبز؛ صفحه‌ی دمو ۱۲ رنگ را کنار هم نشان می‌دهد

### گام ۳٫۲ — استیکی‌نوت
- [ ] `elements/sticky.ts`: `createSticky({ x, y, palette, text?, authorId })` → دو عنصر (ظرف + متن مقید)
- [ ] ابزار استیکی در `tools/sticky-tool.ts`: کلیک روی بوم → ساخت + ورود فوری به حالت ویرایش متن
- [ ] `autoFit`: اندازه‌ی فونت با طول متن تنظیم شود (مثل میرو)، بین ۱۲ تا ۴۸ پیکسل
- [ ] تغییر رنگ استیکی از پنل و از منوی راست‌کلیک، با اعمال روی چند انتخاب همزمان
- [ ] چسبیدن (snap) استیکی‌ها به شبکه‌ای با فاصله‌ی ثابت هنگام ساخت پشت‌سرهم
- [ ] کلید میانبر: `N` برای ابزار استیکی، `Tab` بعد از ساخت = استیکی بعدی در امتداد
- **معیار پذیرش:** در دمو می‌شود ۵ استیکی فارسی با رنگ‌های مختلف ساخت؛ متن بلند اندازه‌ی فونت را کم می‌کند؛ همه راست‌چین‌اند

### گام ۳٫۳ — شکل و متن آزاد
- [ ] `elements/shape.ts`: مستطیل، بیضی، لوزی + متن اختیاری داخل
- [ ] `elements/text.ts`: متن آزاد با `textAlign: "right"` پیش‌فرض و `direction: "auto"`
- [ ] پنل استایل: رنگ خط، رنگ پر، ضخامت، نوع خط، شفافیت، شعاع گوشه — همه RTL
- **معیار پذیرش:** هر سه شکل ساخته و استایل‌دهی می‌شوند؛ متن داخل شکل فارسی درست است

### گام ۳٫۴ — کانکتور
- [ ] `elements/connector.ts`: ساخت پیکان با binding به دو عنصر
- [ ] `elements/connector-routing.ts`: تابع **خالص و قطعی** `routeConnector(start, end, style)` — [ADR-008](ARCHITECTURE_DECISIONS.md#adr-008)
  - سه سبک: `straight`, `elbow` (پله‌ای، میرو-استایل)، `curved`
  - بدون `Math.random`، بدون وابستگی به زمان، گرد کردن مختصات به ۲ رقم اعشار
- [ ] دستگیره‌های اتصال روی لبه‌ی هر عنصر (hover → ۴ نقطه‌ی اتصال)
- [ ] کشیدن از دستگیره به فضای خالی → ساخت خودکار یک استیکی/شکل در انتها (رفتار میرو)
- [ ] برچسب روی کانکتور (متن مقید روی خط)
- [ ] تست: خروجی `routeConnector` برای ورودی یکسان در دو اجرا بیت‌به‌بیت یکسان باشد
- **معیار پذیرش:** دو استیکی را وصل کن، یکی را حرکت بده؛ خط بدون پرش دنبال می‌کند و از داخل شکل رد نمی‌شود

### گام ۳٫۵ — فریم
- [ ] `elements/frame.ts`: ساخت فریم با نام فارسی، رنگ برچسب
- [ ] عضویت: عنصری که داخل مرز فریم رها شود، `frameId` می‌گیرد؛ خروج، آن را پاک می‌کند
- [ ] حرکت فریم = حرکت همه‌ی فرزندان در **یک** `gestureId`
- [ ] تغییر اندازه‌ی فریم فرزندان را جابه‌جا نمی‌کند (فقط عضویت را به‌روز می‌کند)
- [ ] برچسب نام فریم قابل ویرایش inline، راست‌چین
- **معیار پذیرش:** فریم بساز، ۳ استیکی داخلش بگذار، فریم را حرکت بده — همه با هم می‌آیند؛ undo یک‌بار همه را برمی‌گرداند

### گام ۳٫۶ — تصویر
- [ ] `elements/image.ts`: افزودن تصویر با drag&drop و paste
- [ ] فراخوانی `outbound.requestAssetUpload(file)` و نمایش placeholder تا آماده شدن
- [ ] نمایش با `resolveAssetUrl(fileId)` + کش در حافظه تا انقضا
- [ ] محدودیت سمت کلاینت: حداکثر ۲۰MB، فقط `image/png|jpeg|webp|gif|svg+xml`
- [ ] در `local-adapter`، آپلود با `URL.createObjectURL` شبیه‌سازی شود
- **معیار پذیرش:** drag یک تصویر روی بوم، ظاهر می‌شود، قابل تغییر اندازه و چرخش است

### گام ۳٫۷ — قلم آزاد با کانال ephemeral
- [ ] `tools/draw-tool.ts`: در حال کشیدن، فقط `emitEphemeral({ kind: "draw-stroke", … })` — [ADR-022](ARCHITECTURE_DECISIONS.md#adr-022)
- [ ] در `pointerup`: ساده‌سازی مسیر با Ramer–Douglas–Peucker (آستانه‌ی قابل تنظیم) سپس یک `emitElementChanges` واحد
- [ ] رندر استروک ephemeral کاربران دیگر در یک لایه‌ی مجزا (بالای بوم، پایین رابط)
- [ ] تست: کشیدن یک خط ۳۰۰ نقطه‌ای باید دقیقاً **یک** فراخوانی `emitElementChanges` تولید کند
- **معیار پذیرش:** تست بالا سبز است

---

## فاز ۴ — رابط کاربری RTL (تخمین: ۲ تا ۴ روز)

### گام ۴٫۱ — زیرساخت RTL و i18n
- [ ] `packages/i18n`: بارگذار رشته‌های `fa`، تابع `t(key, params)`، قالب‌بندی عدد فارسی، تاریخ جلالی با `Intl` ([ADR-018](ARCHITECTURE_DECISIONS.md#adr-018))
- [ ] Stylelint rule: خطا روی `margin-left`, `padding-right`, `left:`, `right:`, `text-align: left|right` — فقط logical properties ([ADR-016](ARCHITECTURE_DECISIONS.md#adr-016))
- [ ] `dir="rtl"` روی ریشه‌ی دمو
- [ ] **استثنای بوم مستند شود:** مختصات بوم هرگز آینه نمی‌شود؛ یک کامنت صریح در `engine/`
- **معیار پذیرش:** Stylelint روی کل پکیج سبز است و هیچ استثنایی ندارد

### گام ۴٫۲ — نوار ابزار
- [ ] نوار ابزار سفارشی هم‌بوم جایگزین نوار Excalidraw (با `UIOptions` غیرفعال کردن نوار پیش‌فرض)
- [ ] ابزارها: انتخاب، دست (pan)، استیکی، متن، شکل، کانکتور، قلم، تصویر، فریم، کامنت، پاک‌کن
- [ ] موقعیت: چپِ صفحه در RTL (چون در میرو نوار ابزار سمت مبدأ خواندن است — یعنی راست در RTL؛ **تصمیم را در PROGRESS ثبت کن**)
- [ ] tooltip فارسی + کلید میانبر برای هر ابزار
- **معیار پذیرش:** همه‌ی ابزارها با کلیک و با میانبر کار می‌کنند؛ tooltip ها فارسی‌اند

### گام ۴٫۳ — پنل‌های جانبی
- [ ] پنل استایل (وقتی چیزی انتخاب شده): رنگ، ضخامت، شفافیت، لایه، قفل
- [ ] منوی راست‌کلیک RTL: کپی، پیست، تکثیر، حذف، گروه‌بندی، لایه، قفل، «کپی به‌عنوان تصویر»
- [ ] کنترل zoom + دکمه‌ی «برازش با صفحه» + نمایش درصد با ارقام فارسی
- [ ] mini-map گوشه‌ی صفحه
- [ ] نوار وضعیت: نشانگر اتصال (`ConnectionState`) و ذخیره (`SaveState`) با متن فارسی
- **معیار پذیرش:** همه‌ی پنل‌ها در RTL درست چیده‌اند و هیچ متن انگلیسی‌ای در UI نیست

### گام ۴٫۴ — حضور و همکاری (نمایشی)
- [ ] رندر مکان‌نمای همکاران با نام و رنگ (از `applyPeers`)
- [ ] هاله‌ی انتخاب همکاران روی عناصر
- [ ] لیست آواتار کاربران آنلاین + کلیک = `focusOn({kind:"peer"})` (دنبال‌کردن)
- [ ] حالت فقط-خواندنی وقتی `permissions.canEdit === false`: همه‌ی ابزارهای ویرایش غیرفعال
- **معیار پذیرش:** با دو تب باز روی `local-adapter`، مکان‌نمای هم را می‌بینند

---

## فاز ۵ — تعامل و صیقل (تخمین: ۲ تا ۳ روز)

### گام ۵٫۱ — انتخاب، گروه و چیدمان
- [ ] انتخاب چندتایی با کادر و با `Shift+Click`
- [ ] گروه‌بندی (`Ctrl+G` / `Ctrl+Shift+G`)
- [ ] راهنمای هم‌ترازی (alignment guides) هنگام درگ
- [ ] snap به عناصر دیگر و به شبکه
- [ ] ابزار هم‌ترازی: چپ/راست/وسط، توزیع یکنواخت
- [ ] تغییر لایه: جلو/عقب/جلوترین/عقب‌ترین با fractional index ([ADR-007](ARCHITECTURE_DECISIONS.md#adr-007))

### گام ۵٫۲ — Undo/Redo
- [ ] undo/redo باید **کل یک ژست** را یک واحد ببیند (بر اساس `gestureId`)
- [ ] در حالت متصل، undo نباید کار کاربران دیگر را برگرداند (آماده‌سازی برای `Y.UndoManager` با `trackedOrigins` در M2)
- [ ] تست: ساخت فریم با ۳ فرزند، سپس یک `Ctrl+Z` → همه با هم برمی‌گردند

### گام ۵٫۳ — کلیپ‌بورد
- [ ] کپی/پیست داخل بوم (با id جدید و آفست)
- [ ] پیست تصویر از کلیپ‌بورد سیستم
- [ ] پیست متن ساده → ساخت خودکار استیکی (رفتار میرو)
- [ ] پیست چند خط متن → چند استیکی کنار هم
- [ ] کپی به‌عنوان PNG در کلیپ‌بورد

### گام ۵٫۴ — دسترس‌پذیری و کارایی
- [ ] پیمایش با کیبورد بین عناصر، `Escape` برای لغو، `Enter` برای ویرایش
- [ ] `aria-label` فارسی روی همه‌ی دکمه‌ها
- [ ] بنچمارک: بوم با ۲۰۰۰ عنصر باید در pan/zoom بالای ۳۰fps بماند — نتیجه در `docs/perf-baseline.md`
- [ ] اگر بنچمارک رد شد: culling عناصر خارج از viewport
- **معیار پذیرش:** `docs/perf-baseline.md` با اعداد واقعی روی سخت‌افزار خودت

---

## فاز ۶ — تحویل (تخمین: ۱ روز)

### گام ۶٫۱ — تست و مستندسازی
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
