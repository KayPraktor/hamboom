# PROGRESS — M3 (`backend-api` + اتصالِ `apps/web`)

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۵/۲۸ (2026-08-19)
**فاز ۰ + ۱ + ۲ کامل ✅؛ گام ۳٫۰ هم کامل شد ✅ (۱۴۰۵/۰۵/۲۸).** بلوکه‌ی داکر رفع شد (مالک HTTPS proxy
را تنظیم کرد)، MinIO بالا آمد، و probe **واقعاً روی MinIOِ واقعی اجرا شد**. ★ **یافته‌ی تجربی (OD-2
بسته):** مکانیزمِ سقف = **presigned POST با `content-length-range` + `eq $Content-Type`** — هر دو حالت
روی خودِ MinIO تایید شد: زیرِ سقف ۲۰۴، **بالای سقف ۴۰۰ (ردِ MinIO)**، نوعِ غلط ۴۰۳. presigned PUT
مکانیزمِ سقف نیست (اثباتِ عددی پایین). **قدمِ بعد: گام ۳٫۱ (abstractionِ S3).**

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

**OD-1 — مدلِ دسترسیِ بورد + نگاشتِ `member`→بورد (مالک، ۱۴۰۵/۰۵/۲۴).** `guest→viewer` و
`owner/admin→editor` قطعی‌اند. **`member→editor` باز است:** آیا هر عضوِ تیم هر بوردِ تیم را
ویرایش می‌کند؟ به مدلِ اشتراک وابسته است — بوردها پیش‌فرض برای کلِ تیم بازند (`access_mode='team'`)
یا فقط با اشتراکِ صریح؟ پیامد: مسیرِ نقشِ **تیم** در `effectiveBoardRole` باید با `access_mode`
**گِیت** شود (بوردِ `private` → عضویتِ تیم به‌تنهایی هیچ نقشی نمی‌دهد)، و امضای تابع به `access_mode`
نیاز دارد — که probe ۱٫۱ نداشت. **گِیتِ گام ۴٫۲**، مؤثر بر گام ۵٫۴. تا جواب، ۴٫۲ قفل نمی‌شود.

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

## قدم بعد

**گام ۳٫۱ — abstractionِ S3** ([ADR-013](ARCHITECTURE_DECISIONS.md#adr-013)): رابطِ
`putObject`/`getObject`/`deleteObject`/`presignPut`/`presignGet`/`headObject`/`listPrefix` **بدونِ نامِ
سرویس** در امضا؛ گیتِ ESLintِ P4 (RuleTester خودآزمون) که فقط `storage` حق `@aws-sdk` دارد؛ و
`presignPut` بر پایه‌ی **POST-policy** (یافته‌ی گام ۳٫۰)، نه Content-Lengthِ امضاشده. سپس گام ۳٫۲
(`StorageSnapshotStore`) و ۳٫۳ (`AssetTransport` + ADRِ مکانیزمِ POST-policy).

⚠️ **probeِ `probe/s3-probe.ts`** طبق کامنتِ eslintش «بعد از گرفتنِ عدد پاک می‌شود» — عدد گرفته شد؛
حذفش هنگامِ بستنِ فاز ۳ (یا زودتر، به‌صلاحِ مالک).
