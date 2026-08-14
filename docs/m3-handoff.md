# تحویلِ M2 به M3 — آنچه M3 باید پیاده کند

> **این سند نقطه‌ی ورودِ M3 است.** هدفش این است که یک session جدید بتواند M3 را
> فقط با خواندنِ همین فایل و سه README‌ای که لینک شده‌اند شروع کند، **بدونِ
> خواندنِ کدِ M2**. تاریخ: ۱۴۰۵/۰۵/۲۳ (پایانِ M2).

## وضعیتِ M2 در یک نگاه

`realtime-sync` تحویل شد: بوم‌ها در مرورگرِ واقعی همگام می‌شوند، همدیگر را
می‌بینند، کار از بستنِ تب و از `SIGKILL` جان به در می‌برد، و سرور چندنودی است.

| کجا | چیست | سند |
|---|---|---|
| [`packages/ydoc-schema`](../packages/ydoc-schema/) | مدلِ سند، codec، migration، پروتکل | [README](../packages/ydoc-schema/README.md) |
| [`packages/canvas-sync`](../packages/canvas-sync/) | binderِ کلاینت (`CanvasSyncAdapter` روی Yjs) | [README](../packages/canvas-sync/README.md) |
| [`apps/realtime`](../apps/realtime/) | سرورِ WebSocket، اتاق، پایداری، خوشه | [README](../apps/realtime/README.md) |

**اعدادِ واقعی** در [`realtime-baseline.md`](realtime-baseline.md) و
[`ydoc-baseline.md`](ydoc-baseline.md). **۴۱ تصمیم** در
[ARCHITECTURE_DECISIONS.md](../ARCHITECTURE_DECISIONS.md) — تغییرِ هرکدام تاییدِ
مالک می‌خواهد.

---

## ★★ اول این را بخوان — سه چیزی که اگر رعایت نشوند M3 بی‌صدا می‌شکند

**۱. الگوی اشتراکِ StrictMode-safe** ([ADR-028](../ARCHITECTURE_DECISIONS.md#adr-028)
و [ADR-032](../ARCHITECTURE_DECISIONS.md#adr-032)). `apps/web` **باید** این شکل را
به کار ببرد:

```tsx
const [api, setApi] = useState<CanvasApi | null>(null);
useEffect(() => {
  if (!api) return;
  return api.onChange(handler);      // ← cleanup برمی‌گرداند
}, [api]);
return <HamboomCanvas onReady={setApi} />;
```

⚠️ اشتراک در callbackِ `onReady` — طبیعی‌ترین کار در نگاهِ اول — زیر StrictMode
**مرده می‌مانَد**: موتور عنصر می‌سازد و ری‌اکت هیچ‌وقت خبردار نمی‌شود. یعنی binder
بی‌صدا هیچ تغییری emit نمی‌کند. در مرورگر تایید شده، نگهبانش
`canvas-sync/e2e/strictmode.spec.ts`.

**۲. `bindUndoShortcuts` اجباری است**
([ADR-035](../ARCHITECTURE_DECISIONS.md#adr-035)). Yjs صاحبِ undo است، نه موتور.
اگر جا بیفتد، تاریخچه‌ی موتور دوباره فعال می‌شود و یک `Ctrl+Z` **دو کار** می‌کند.

**۳. `fail closed` را نشکن.** نقشِ ناشناخته → `viewer`، وضعیتِ ذخیره‌ی ناشناخته →
`unsaved`، `BoardAuthority` که `undefined` برگرداند یعنی «نظری ندارم» و `null` یعنی
«دسترسی برداشته شده» — ⚠️ با `??` یکی می‌شوند و یک کاربرِ اخراج‌شده تا انقضای توکن
وصل می‌مانَد.

---

## ۱) چهار پورت که M2 عمداً پیاده نکرد

M2 به‌جای انتظار، پشتِ **پورت** با M3 حرف زد
([ADR-031](../ARCHITECTURE_DECISIONS.md#adr-031)). هر چهار پورت امروز یک
پیاده‌سازیِ **توسعه** دارند که M3 جایگزینشان می‌کند.

### `BoardAuthority` → روی `packages/auth-core`

**کجاست:** [`apps/realtime/src/auth/`](../apps/realtime/src/auth/) · جایگزینِ
`DevBoardAuthority`.

```ts
interface BoardAuthority {
  readonly developmentOnly?: boolean;
  /** `boardId` هم داده می‌شود تا توکنِ معتبرِ **بوردِ دیگر** اینجا کار نکند. */
  verify(token: string, boardId: string): Promise<RtTokenClaims>;
  /** ★ نقشِ **همین حالا** — نه آنچه در توکن نوشته شده. */
  currentRole?(sub: string, boardId: string): Promise<BoardRole | null | undefined>;
}
```

- ★ **گیتِ production روی خودِ پیاده‌سازی است، نه یک پرچمِ config:** علامتِ
  `developmentOnly`. با `APP_ENV=production` سرور باید **بالا نیاید** — نه اینکه
  هشدار بدهد و ادامه دهد. با یک پرچمِ config، اولین مسیرِ فراموش‌شده دورش می‌زد.
- ⚠️ **`currentRole` هر بار سنجیده می‌شود، نه فقط هنگام اتصال**
  ([ADR-012](../ARCHITECTURE_DECISIONS.md#adr-012)). توکن نقش را **حمل می‌کند**، پس
  بدونِ این، کاربرِ تنزل‌داده‌شده با بستن و بازکردنِ تب دوباره `editor` می‌شود.
- ⚠️ **شکلِ claimهای `rtToken` امروز داخلِ خودِ پورت است، نه `shared-types`** (تصمیمِ
  D-2). اگر M3 لازم داشت بیرون برود → **تاییدِ مالک**
  ([ADR-021](../ARCHITECTURE_DECISIONS.md#adr-021)).
- `DevBoardAuthority` عمداً JWT را دستی می‌سنجد (`node:crypto`) چون **حذف می‌شود**.
  سه تستِ حمله‌اش را نگه دار تا وقتی حذفش کنی: `alg: none` · مقایسه‌ی زمان‌ثابت ·
  `exp`ِ اجباری.

### `SnapshotStore` → روی `packages/storage`

**کجاست:** [`apps/realtime/src/persistence/`](../apps/realtime/src/persistence/) ·
جایگزینِ `FsSnapshotStore` (تصمیمِ D-3).

- **P4:** هیچ ماژولی جز `packages/storage` حق ندارد `@aws-sdk/client-s3` را import
  کند. گیتِ ESLintش موجود است و **با `RuleTester` خودآزمون** است.
- ⚠️ **مرحله‌ی بازخوانی بعد از `put` تزئینی نیست:** انباری که `put`ش موفق برگردد
  ولی ناقص بنویسد، بدونِ آن باعث می‌شود updateهای **واقعی** حذف شوند. تستش هست.

### `AssetTransport` → `POST /api/v1/assets` + `packages/storage`

**کجاست:** [`packages/canvas-sync/src/assets.ts`](../packages/canvas-sync/src/assets.ts) ·
جایگزینِ `LocalAssetStore`.

- ⚠️ **`uploadedBy` را کلاینت تعیین نمی‌کند** — سرور از توکن درمی‌آورد. اگر کلاینت
  بفرستدش، هرکس می‌تواند فایل را به نامِ دیگری بالا بگذارد.
- ★ **ترتیب مهم است:** متادیتا **هنگامِ آپلود** در سند نوشته می‌شود، نه فقط از راهِ
  changeset — چون `image-tool` اول `requestAssetUpload` را await می‌کند و بعد عنصر
  را می‌سازد. برعکسش یعنی همتا یک `fileId`ِ آویزان دارد.
- `resolve()` **هرگز reject نمی‌کند** — در مسیرِ رندر است و یک فایلِ گمشده نباید
  کلِ بورد را بشکند.

### endpointِ `rt-token`

کلاینت برای **هر تلاشِ اتصال** یک توکنِ تازه می‌سازد
([ADR-039](../ARCHITECTURE_DECISIONS.md#adr-039)). ⚠️ و «تلاشِ فوری» **سقف** دارد:
بدونش، یک تامین‌کننده‌ی توکن که مقدارِ منقضی را کَش کند یک حلقه‌ی تنگ با تمامِ توانِ
CPU می‌سازد.

★ `HB_AUTH_REFRESH` هر دو نیمه‌اش ساخته شده: کلاینت روی اتصالِ **باز** توکنِ تازه
می‌فرستد و سرور دوباره می‌سنجد. سه قیدش را نشکن: هویت (`sub`) **عوض نمی‌شود** ·
نقش از `currentRole` می‌آید نه از claimِ توکن · و **ردِ تازه‌سازی اتصال را نمی‌بندد**
([ADR-038](../ARCHITECTURE_DECISIONS.md#adr-038)).

---

## ۲) اتصالِ `apps/web`

- سه پورتِ بالا را تزریق کن، به‌علاوه‌ی `user`ِ واقعی روی کانالِ حضور.
- `createWebSocketTransport` و `createIndexeddbDocStore` **محصولی‌اند** و آماده.
- ⚠️ **پیام‌های فارسیِ کلاینت امروز درون‌خطی‌اند، نه در `packages/i18n`** — آن پکیج
  دامنه‌ی M2 نبود. مثالش `TOO_OLD_MESSAGE` در `adapter.ts` است. M3 باید تکلیفشان را
  روشن کند.
- ⚠️ **`permissions.ts`ِ کلاینت گیت نیست، advisory است.** گیتِ واقعی سرور است و روی
  **هر** update می‌سنجد. واگرایی‌اش با `apps/realtime/src/permission.ts` حفره‌ی
  امنیتی نمی‌سازد ولی تجربه‌ی بدی می‌سازد.

---

## ۳) دو موردِ به‌ارث‌رسیده که M2 عمداً حل نکرد

**۱. دو FK** برای `board_updates.board_id` و `board_snapshots.board_id`. جدولِ
`boards` هنوز وجود ندارد، پس ستون‌ها بدونِ FK ساخته شدند (تصمیمِ گام ۰٫۳). بعد از
ساختِ `boards` در M3، یک `ALTER TABLE` لازم است.

**۲. تایپِ `CommentPin`** که از گام ۲٫۲ در `ydoc-schema` زندگی می‌کند. اگر M3 هم
لازمش داشت، **بردنش به `shared-types` تاییدِ مالک می‌خواهد**
([ADR-021](../ARCHITECTURE_DECISIONS.md#adr-021)).

---

## ۴) چهار یافته‌ی M2 که جایشان در M3 است

**۱. خطای «شکلِ» شناسه‌ی بورد کدِ خودش را ندارد.** ستونِ `board_id` از نوعِ `uuid`
است و `brd-<uuid>` در `onJoin` می‌ترکد؛ کلاینت آن را یک `FORBIDDEN`ِ عمومی می‌بیند.
fail-closed درست کار می‌کند، ولی برای کسی که کلاینت می‌نویسد گیج‌کننده است.

**۲. هر بار بازکردنِ تب یک opِ `meta.schemaVersion` تازه می‌نویسد** (چون
`createBoardDoc()` روی سندِ بازیابی‌شده از IndexedDB هم صدا زده می‌شود). داده گم
نمی‌شود ولی state vector بی‌دلیل رشد می‌کند.

**۳. تبدیلِ پیکسل → صحنه از `canvas-core` صادر نشده** و `HamboomCanvas` هم
`onPointerUpdate`ِ موتور را پاس نمی‌دهد. دموی M2 فرمولِ معکوس را دستی دارد (تنها
جایش). **M3 قبل از تکرارِ این فرمول باید تکلیفش را روشن کند** — وگرنه دو نسخه از
یک تبدیل خواهیم داشت (ADR-024).

**۴. ویرایشگرِ متنِ موتور تا وقتی باز است کاملاً ایزوله است** — درجِ همتا هنگامِ
بستنِ ویرایشگر **پاک می‌شود** (اندازه‌گیری شد: >۳۰۰۰ms، یعنی هرگز). باگِ دیف نیست،
محدودیتِ موتور است و با تست قفل شده. **رفعش کارِ M3 است.**

---

## ۵) ★★ سقفِ حافظه — ورودیِ برنامه‌ریزیِ M3، نه یک عددِ جانبی

اندازه‌گیری‌شده در [`realtime-baseline.md`](realtime-baseline.md):

| مقیاس | حجمِ سند | حافظه‌ی اتاق |
|---|---|---|
| ۱۰۰۰ عنصر | ۰٫۷۲MB | ۱۴٫۶MB |
| **۵۰۰۰ عنصر** | **۳٫۶۶MB** (۷٫۳٪ از سقف) | **۷۶MB** |

نمایشِ درون‌حافظه‌ایِ Yjs ~**۲۰ برابرِ** شکلِ روی سیم است — ساختاری، چون هر
property یک `Item` است (همان چیزی که ADR-007 و ADR-033 خواستند).

⚠️ **پس `RT_MAX_DOC_BYTES` گیتِ موثر نیست و `RT_MAX_ROOMS_PER_NODE=۵۰۰` هم برای
بوردهای بزرگ گیت نیست.** ۵۰۰ اتاقِ ۵۰۰۰عنصری = ~۳۸GB؛ روی نودِ ۴گیگی ~۵۰ اتاق.
هر برنامه‌ریزیِ ظرفیتِ M3 باید از **حافظه** شروع کند، نه از تعدادِ اتاق.

★ فازِ ۳ی [ADR-006](../ARCHITECTURE_DECISIONS.md#adr-006) (room affinity با hashing)
عمداً در M2 ساخته نشد — «تا وقتی حافظه واقعاً مسئله نشده». **حالا عددش هست.**

---

## ۶) درسِ روشی که گران‌ترین درسِ M2 بود

**هفت سنجه‌ی زنده، و هر هفت باگی گرفتند که همه‌ی تست‌های واحد سبز از رویش رد شده
بودند** (`rt:durability`، `rt:compaction`، `rt:permission`، `rt:presence`،
`rt:cluster`، `rt:shutdown`، `rt:reconnect`). این دیگر تصادف نیست. الگویش:

- **همزمانی فقط زیرِ بار دیده می‌شود** — ۴۳ از ۵۰۰ append زیرِ همزمانی گم می‌شد.
- **رفتارِ پروتکل فقط با کلاینتِ واقعی** — کدِ ۱۰۰۶ به‌جای ۱۰۰۱.
- **jsdom layout ندارد** — ادعای «کجا رندر می‌شود» فقط در مرورگر آزمودنی است.
- **vitest همان Node نیست** و **لاگِ حافظه‌ای `uuid` نمی‌فهمد.**

★★ **و تستِ خودآزمون‌نشده گیت نیست.** بارها پیش آمد که یک تستِ تازه با برداشتنِ
همان چیزی که می‌سنجید هم **سبز مانْد**. هر گیتی که M3 می‌سازد باید با یک شکستنِ
عمدی **قرمز** شده باشد، وگرنه فقط شبیهِ گیت است.

⚠️ **و الگویی که سه بار تکرار شد:** پیامی در پروتکل که **هیچ‌کس مصرفش نمی‌کند** —
بی‌خطا، و شبیهِ کارکردن. اگر چیزی در `protocol.ts` هست و شاخه‌ای برایش نیست، یا
مرده است یا یک باگ.
