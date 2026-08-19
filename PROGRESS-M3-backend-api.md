# PROGRESS — M3 (`backend-api` + اتصالِ `apps/web`)

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۵/۲۴ (2026-08-15)
**فاز ۰ + ۱ + ۲ کامل ✅؛ فاز ۳ آغاز شد ولی گام ۳٫۰ بلوکه است.** قراردادِ `shared-types` + پکیجِ
`storage` + `@aws-sdk` (P1 سبز) ساخته شد و `pnpm verify` سبز — ولی ★ **probeِ S3 هرگز روی MinIOِ
واقعی اجرا نشد** (imageِ minio pull نمی‌شود، پایین). پس گام ۳٫۰ **تمام نیست**؛ هیچ یافته‌ی تجربی
درباره‌ی اعمالِ سقفِ presign وجود ندارد. **قدمِ بعد: رفعِ بلوکه‌ی داکر، سپس اجرای probe.**

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

**OD-2 — مکانیزمِ اعمالِ سقفِ اندازه/نوع در presign (باز، بلوکه‌ی محیط).** probeِ گام ۳٫۰ **هرگز روی
MinIOِ واقعی اجرا نشد** (image pull نمی‌شود)، پس نامعلوم است که آیا آپلودِ بالای سقف را **خودِ MinIO
رد می‌کند** یا نه. مکانیزم هم تصمیم‌گرفته‌نشده: `Content-Length`ِ امضاشده (که probe می‌سنجد) در برابرِ
POST-policyِ `content-length-range` (جایگزینِ نیازموده). **گِیتِ امضای `presignPut`ِ گام ۳٫۱** — تا
probe اجرا نشود، ۳٫۱ روی فرض ساخته می‌شود. سوالِ اصلیِ [ADR-013](ARCHITECTURE_DECISIONS.md#adr-013).

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

### فاز ۳ — گام ۳٫۰ در جریان (۱۴۰۵/۰۵/۲۴)

**انجام‌شده (قطعی):**
- `packages/storage` ساخته شد (package.json + tsconfig + eslint + `src/index.ts`ِ اسکلت + CLAUDE
  بعداً). eslintش عمداً `@aws-sdk` را منع نمی‌کند — تنها پکیجِ مجاز (P4/ADR-013). ⚠️ تستش
  `--passWithNoTests` است تا گام ۳٫۱ — بدونش `vitest run` روی صفرْفایل exit 1 می‌داد و **verify را
  قرمز کرده بود** (این turn پیدا و رفع شد؛ پس ادعای «verify سبز»ِ قبلیِ گام ۳٫۰ اشتباه بود — حالا واقعاً سبز است).
- ★ **`@aws-sdk/client-s3` + `s3-request-presigner` افزوده و `license:check` سبز: ۷۵۸ پکیج، همه
  مجاز.** بزرگ‌ترین ریسکِ P1ِ گام ۳٫۰ برطرف شد.
- MinIO به `infra/docker/docker-compose.yml` (بدونِ healthcheck؛ minio-init به ۳٫۳).
- probeِ `packages/storage/probe/s3-probe.ts` نوشته و **آماده** است: رفت‌وبرگشتِ باینری + presignGet +
  ★ آزمونِ اینکه MinIO یک `Content-Length`/`Content-Type`ِ **امضاشده** را اعمال می‌کند (قیدِ مالک).

**[!] بلوکه — محیط، نه کد:** اجرای probe به imageِ `minio/minio` نیاز دارد و **pullش شکست می‌خورد**.
هر دو pull (Docker Hub و quay.io) با exit 1 افتادند؛ خطای دقیقِ quay: `lookup quay.io: no such host` +
«Docker Desktop **HTTPS proxy ندارد**، پس اتصالِ مستقیم». یعنی داکر **HTTP** proxy دارد ولی **HTTPS**
proxy **ندارد** (`http.docker.internal:3128` فقط HTTP)، پس دانلودِ بلابِ HTTPS مستقیم می‌رود و DNS
می‌افتد. imageهای کَش‌شده‌ی M2 و `public.ecr.aws` کار می‌کنند. **رفع: تنظیمِ HTTPS proxy در Docker
Desktop یا یک mirror — کارِ مالک، نه کد.**

**★ سوالِ باز (OD-2) — که probe باید جواب دهد ولی هنوز نداده:** آیا **هر دو حالت روی MinIOِ واقعی**
رخ می‌دهد — آپلودِ **زیرِ سقف پذیرفته** و آپلودِ **بالای سقف توسط خودِ MinIO رد**؟ **هنوز نامعلوم**،
چون probe **صفر بار** اجرا شده (image نیست). و یک نکته‌ی مکانیزم که نباید گم شود: probeِ فعلی
**`Content-Length`ِ امضاشده روی presigned PUT** را می‌سنجد؛ **POST-policy با `content-length-range`**
فقط به‌عنوان **جایگزین** در پیامِ کد یادداشت شده، **نه آزموده**. پس نه Content-Length تایید شده نه
POST-policy — تا probe اجرا نشود، مکانیزمِ اعمالِ سقف **تصمیم‌گرفته‌نشده** است (سوالِ اصلیِ
[ADR-013](ARCHITECTURE_DECISIONS.md#adr-013)). ⚠️ **پیگیری:** وقتی داکر باز شد، اگر
`Content-Length`ِ امضاشده اعمال نشد، probe باید مسیرِ POST-policy را هم اضافه کند و **هر دو** را مقایسه کند.

## قدم بعد

**تصمیمِ مالک برای رفعِ بلوکه:** یک mirrorِ ایرانیِ Docker Hub (تنظیم در Docker Desktop) یا pullِ
یک‌بارِ `minio/minio` با VPN؛ سپس `node packages/storage/probe/s3-probe.ts`. جایگزین: probe را به یک
endpointِ S3ِ موجود بزنیم (`S3_ENDPOINT`/کلیدها را از env می‌خواند). گزینه‌ی نامطلوب: رفتن به ۳٫۱ با
پیش‌فرضِ «Content-Length امضاشده» و تاییدِ تجربیِ معوق (نقضِ سبکِ «اول probe»).
