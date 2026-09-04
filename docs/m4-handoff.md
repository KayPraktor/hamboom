# تحویلِ M3 به M4 — آنچه M4 (پرداخت/اشتراک) روی آن سوار می‌شود

> **این سند نقطه‌ی ورودِ M4 است.** هدفش این است که یک session جدید بتواند M4 را
> فقط با خواندنِ همین فایل و README‌های لینک‌شده شروع کند، **بدونِ خواندنِ کدِ M3**.
> تاریخ: ۱۴۰۵/۰۶/۱۴ (پایانِ M3). ⚠️ M4 = **billing** (زرین‌پال، اشتراک، پلن، فاکتور)؛
> زیرساختِ production = M5؛ پنلِ ادمین = M6.

## وضعیتِ M3 در یک نگاه

`backend-api` تحویل شد: احرازِ OTP/JWT، تیم/عضویت، بورد + دسترسی/اشتراک، فولدر،
نشان، سطلِ بازیافت، دارایی (آپلود/نمایش از storageِ واقعی)، sdkِ typed، اپِ وب
(ورود → داشبورد → بورد + نوار ابزار + تصویر)، و `apps/realtime` که حالا با
**احراز و storageِ واقعی** وصل است (گیتِ production برعکس شد: `APP_ENV=production`
بالا می‌آید).

| کجا | چیست | سند |
|---|---|---|
| [`apps/api`](../apps/api/) | REST (Fastify): auth/user/team/board/asset + `rt-token` + migration + OpenAPI 3.1 | [README](../apps/api/README.md) |
| [`packages/auth-core`](../packages/auth-core/) | JWT + refreshِ چرخشی + `effectiveBoardRole` + OTP + `signRtToken` | [README](../packages/auth-core/README.md) |
| [`packages/storage`](../packages/storage/) | دروازه‌ی Object Storage (تنها جای `@aws-sdk/*`، P4) | [README](../packages/storage/README.md) |
| [`packages/assets`](../packages/assets/) | لایه‌ی دامنه‌ی دارایی: presign/validate/resolve | — |
| [`packages/sdk`](../packages/sdk/) | کلاینتِ typedِ REST (تنها کلاینتِ api) | [README](../packages/sdk/README.md) |
| [`packages/board-access-db`](../packages/board-access-db/) | `BoardAccessReader`ِ pg — api و realtime یک منبع ([ADR-046](../ARCHITECTURE_DECISIONS.md#adr-046)) | — |
| [`apps/web`](../apps/web/) | اپِ کاربر (React 19 + Vite + TanStack) | [README](../apps/web/README.md) |

**۴۸ تصمیم** در [ARCHITECTURE_DECISIONS.md](../ARCHITECTURE_DECISIONS.md) — تغییرِ هرکدام
تاییدِ مالک می‌خواهد. شرحِ گام‌به‌گامِ M3 در [`PROGRESS-M3`](../PROGRESS-M3-backend-api.md).

---

## ★★ اول این را بخوان — چند چیزی که اگر رعایت نشوند M4 بی‌صدا می‌شکند

**۱. پول همیشه `BIGINT` ریال** (P5، [ADR-015](../ARCHITECTURE_DECISIONS.md#adr-015)).
هیچ‌جا float، هیچ‌جا تومان در دیتابیس؛ تبدیل فقط در لایه‌ی نمایش. ⚠️ درایورِ Postgres
باید `int8` را به **`number`** بدهد نه `string` — در **یک** جای پلاگینِ db تنظیم شده و
با تست قفل است ([`apps/api/src/plugins/db.ts`](../apps/api/src/plugins/db.ts)). M4 که
مبلغ می‌خواند/می‌نویسد، همین یک نقطه را نگه دارد.

**۲. زرین‌پال پشتِ آداپتورِ درگاه + idempotency سخت‌گیرانه**
([ADR-014](../ARCHITECTURE_DECISIONS.md#adr-014)). درگاه یک **پورت** است (مثلِ
`BoardAuthority`ِ M2)؛ یک پیاده‌سازیِ **توسعه** (بدونِ حسابِ واقعی، P3) و یکی
واقعی. ⚠️ **callbackِ پرداخت باید idempotent باشد** — کاربر/درگاه ممکن است دوبار
صدایش بزند؛ بدونِ کلیدِ idempotency، یک پرداخت دوبار حساب می‌شود. `apps/api` از قبل
یک [`idempotency.ts`](../apps/api/src/idempotency.ts) **درون‌حافظه‌ای** دارد (تک‌نود)؛
برای callbackِ پرداخت باید **ماندگار (DB)** شود.

**۳. بدون سرویسِ خارجی در runtimeِ توسعه** (P2/P3). `docker compose up && pnpm dev`
باید کافی باشد؛ هیچ فیچری برای **توسعه** به حسابِ زرین‌پالِ واقعی نیاز ندارد. مثلِ
`MockSms`ِ auth، درگاه یک mockِ dev دارد که در لاگ «پرداخت شد» را چاپ می‌کند.

**۴. `shared-types` تنها قرارداد است** ([ADR-021](../ARCHITECTURE_DECISIONS.md#adr-021)).
DTOهای `Plan`/`Subscription`/`Invoice` و فیلدهای مالیِ `Team` **هنوز آنجا نیستند**
(اصل «چیزی بی‌مصرف‌کننده اضافه نکن»). M4 که اضافه‌شان می‌کند = تغییرِ `shared-types` =
**تاییدِ مالک**، با schema-first (zod منبعِ حقیقت، نه `interface`).

---

## نقطه‌ی ورودِ billing — مدلی که M4 رویش سوار است

- **تیم صاحبِ اشتراک است، نه کاربر.** `teams` (+ `team_members`، نقش‌های
  owner/admin/member/guest) از M3 هست. پلن/اشتراک به **team** می‌چسبد؛ گیتِ فیچر
  (مثلِ سقفِ بورد) از نقشِ team + پلنِ team می‌آید. `owner`/`admin`ِ تیم پرداخت را می‌بیند.
- **جدول‌ها در schema هستند، منطق نه.** `plans`/`subscriptions`/`payments`/`invoices`
  در migrationِ M3 ساخته شده‌اند (ستون‌ها با مبلغِ `BIGINT`)، ولی هیچ route/سرویسی
  رویشان نیست. M4 منطق + endpointها + UI را می‌سازد.
- **الگوی موجود را کپی کن، نه از نو:** route جدید = همان شکلِ [`routes/boards.ts`](../apps/api/src/routes/boards.ts)
  (preHandlerِ `requireAuth`، گیتِ نقش، تراکنشِ چندجدولی با `withTransaction`)؛ DTO =
  `shared-types` + `sdk`؛ UI = صفحه‌ی TanStack + hookِ react-query (مثلِ `dashboard/`).
- ★ **نوشتنِ چندجدولی همیشه در یک تراکنش** (خط‌قرمزِ api). ساختِ اشتراک + فاکتور +
  به‌روزرسانیِ team باید اتمیک باشد؛ با خودآزمونِ شکستِ وسطِ تراکنش (مثلِ M3).

---

## ارثیه‌های به‌تعویق‌افتاده که جایشان بعد از این است

**۱. فاز ۱۰ — قالب/کامنت/نسخه/خروجی** (M3-D1، به تعویق). TODO و معیارهای پذیرش در
[`TODO-M3` فاز ۱۰](../TODO-M3-backend-api.md) نوشته و **آماده** است؛ اگر مالک دوباره
واردِ دامنه‌ی M3 کرد، از همان‌جا. کامنت (۱۰٫۲) پیش‌نیازِ `link_comment`/`commenter` است.

**۲. `CommentPin`** که هنوز در `ydoc-schema` زندگی می‌کند (M3-D2b — چون کامنت به تعویق
افتاد). هرکس کامنت را بیاورد: **بردنش به `shared-types` تاییدِ مالک می‌خواهد** (ADR-021)،
و `link_comment`/`commenter` که در M3 عمداً از `boardAccessModes`/`assignableBoardRoles`
بیرون ماندند دوباره اضافه می‌شوند (ستونِ DB `varchar` است، جا دارد).

**۳. `apps/worker`** (خروجیِ Chromium، thumbnail، snapshot-compactِ جدا) — M3-D5، بعد
از M3. ⚠️ **`thumbnailUrl`ِ `Board` امروز همیشه `null`** است چون worker نیست؛ و FKِ
`CASCADE`ِ بورد بلابِ S3 را پاک نمی‌کند — **جاروبِ داراییِ یتیم کارِ worker/M5 است**.

**۴. room affinity (ADR-006 فاز ۳)** — به **M5** موکول با تریگرِ عددی
([ADR-048](../ARCHITECTURE_DECISIONS.md#adr-048)): ۷۶MB/بوردِ ۵۰۰۰عنصری → ظرفیتِ نود
حافظه‌محور؛ فعال‌سازی وقتی ≥۲ رِپلیکا + حافظه‌ی مقیمِ یک نود >~۶۰٪ heap. **معیارِ
ظرفیت = حافظه، نه تعدادِ اتاق.**

**۵. یافته‌ی ۴ M2 — انزوای ویرایشگرِ متن** (درجِ همتا هنگامِ بازبودنِ ویرایشگرِ inline
تا بستنش دیده نمی‌شود). در گام ۸٫۵ **مالک رد کرد** (به تعویق). محدودیتِ موتور است و با
تست قفل شده؛ رفعِ واقعی‌اش مسیرِ M1/موتور است.

---

## درس‌های روشیِ M3 (گران‌ترین‌ها)

**۱. «در Node سبز» یعنی «در Node سبز»، نه «کار می‌کند».** بزرگ‌ترین باگِ M3 در گام
۱۱٫۲: `assets.resolve`ِ sdk از `redirect:"manual"` استفاده می‌کرد که در **مرورگر**
پاسخِ opaque (status 0، بی‌Location) می‌دهد، پس URL هرگز خوانده نمی‌شد و **نمایشِ تصویر
هیچ‌وقت در مرورگر کار نمی‌کرد** — ولی تستِ واحد با `fetch`ِ mock سبز بود (Node مثلِ
مرورگر opaque نمی‌کند). ★ هر چیزی که در مرورگر اجرا می‌شود، **در مرورگر** اثبات شود، نه
فقط با تستِ Node.

**۲. لمسِ M1/M2 = تاییدِ تک‌تکِ مالک، ثبت مثلِ B-1.** M3 چند لمسِ M1 داشت (نوار عمودی،
`onPointerUpdate`، `hideNativeUI`، لیزر، `addFiles` بعد از saved) — **هرکدام** جدا
تایید و در PROGRESS ثبت شد. دامنه‌ی خودت را رعایت کن؛ اگر ناچار به لمسِ M1/M2/shared-types
شدی، **بپرس** و ثبت کن.

**۳. تستِ خودآزمون‌نشده گیت نیست** (میراثِ M2، در M3 هم صادق ماند). هر گیت باید با یک
شکستنِ عمدی **قرمز** شده باشد — مثلِ تستِ ترتیبِ `callSeq`ِ image-tool که با move-break
قرمز شد، یا `verify.mjs` که با خطای عمدی exit 1 داد.

**۴. فقط قابلیتِ واقعی — هیچ «به‌زودی».** منوی سه‌نقطه‌ی بورد فقط چیزهایی گرفت که پشتشان
کار بود؛ Duplicate (endpointِ content-less) و Export/History (فاز ۱۰) عمداً **نیامدند**،
نه حتی به‌عنوان placeholder. برای M4: دکمه‌ی «ارتقا/پرداخت» تا وقتی درگاه واقعاً وصل نشده،
ساخته نشود.

**۵. تله‌های محیطیِ ویندوز — پورت‌ها جابه‌جا می‌شوند.** رنجِ excludedِ ویندوز با هر
ری‌استارت عوض می‌شود و پورتِ داکر را می‌گیرد بی‌آنکه کسی listen کند: **DB روی ۵۴۳۳،
MinIO روی ۹۸۰۰، Redis روی ۶۳۷۹/۷۳۷۹** (در `.env`ِ محلی override شده؛ compose/`.env.example`
روی پیش‌فرضِ PLAN ماندند). اگر سرویسی bind نشد: `netsh interface ipv4 show
excludedportrange protocol=tcp` و یک پورتِ بیرونِ رنج بگذار. جزئیات در [CLAUDE.mdِ ریشه](../CLAUDE.md).

**۶. `pnpm verify` تنها گیتِ قابلِ‌استناد است** (میراثِ M2). `lint`/`test` برای حلقه‌ی
سریع خوب‌اند ولی مبنای تیک‌زدن نیستند — دلیلش «سبزِ دروغینِ گام ۱٫۲» در [CLAUDE.mdِ
ریشه](../CLAUDE.md).
