-- ══════════════════════════════════════════════════════════════════════════
-- 0010 — کارت‌به‌کارت/شبا با تاییدِ دستی ([ADR-070](../../../ARCHITECTURE_DECISIONS.md#adr-070))
--
-- ── چرا اصلاً migration لازم است ─────────────────────────────────────────
--
-- ★ `payments_gateway_ck` (۰۰۰۴) فقط `zarinpal|idpay|mock` را می‌پذیرد. بدونِ گشادکردنش **هیچ
--   ردیفِ کارت‌به‌کارتی درج نمی‌شود** — نه با خطای منطقی، با `23514`ِ خامِ دیتابیس سرِ اولین checkout.
--
-- ── تفکیکی که کلِ این فایل رویش بنا است ──────────────────────────────────
--
-- ★★ **ادعای کاربر و مشاهده‌ی staff دو چیزِ متفاوت‌اند و دو ستونِ جدا دارند.**
--    `transfer_claimed_*` = آنچه کاربر تایپ کرد. `transfer_ref`/`transfer_sender_last4` = آنچه staff
--    در صورت‌حسابِ بانک **دید**. یکی‌کردنشان شاهد را از بین می‌بَرد: اگر این دو نخوانند، همان
--    اختلاف خودش سیگنالِ تقلب است. ⊕ و تنها ستونی که تصمیمِ مالی رویش بنا می‌شود، سمتِ staff است.
--
-- ⛔ **`transfer_claimed_ref` عمداً یکتا نیست.** یکتاکردنش یک حمله‌ی انکارِ سرویسِ مجانی می‌ساخت:
--    مهاجم شماره‌ای را زودتر «ادعا» می‌کرد و پرداخت‌کننده‌ی واقعی دیگر نمی‌توانست ثبتش کند.
--    یکتایی جایی می‌نشیند که تصمیم گرفته می‌شود — روی `transfer_ref`.
--
-- ── خطری که این فایل می‌بندد ─────────────────────────────────────────────
--
-- ⚠️ **بازپخشِ شماره‌ی مرجع:** کاربر ب همان شماره‌ی پیگیریِ کاربر الف را بدهد و اپراتورِ خسته
--    دوباره تایید کند ⇒ یک واریز، دو اشتراک. `payments_transfer_ref_uq` این را در **دیتابیس**
--    می‌بندد، نه در دقتِ آدم. همان الگوی `payments_idem_uq` و `payments_authority_uq`.
--    ★ و چون ایندکس روی `(gateway, transfer_ref)` است، فردا اگر درگاهِ دومی هم مرجعِ دستی بگیرد
--      فضای شماره‌هایش جدا می‌مانَد.
--
-- ── چه چیزی عمداً این‌جا نیست ─────────────────────────────────────────────
--
-- ⛔ **مبلغِ یکتای تخصیص‌یافته.** ADR-070 حذفش کرد: استدلالش فرض می‌کرد مبلغ **تنها کلیدِ تطبیق**
--    است، که فقط برای تاییدِ **خودکار** درست بود. با تاییدِ دستی، صورت‌حسابِ بانک شماره‌ی پیگیری،
--    شماره‌ی مرجع، شماره‌ی سند و ۴ رقمِ کارتِ مبدأ را می‌دهد ⇒ سه کلیدِ مستقل و یک آدم که تطبیق
--    می‌دهد. روزی که تطبیقِ دستی دردناک شد، افزودنش یک ایندکسِ یکتای جزئی روی مبلغِ فاکتورهای
--    **باز** است — یک migration، نه بازطراحی.
-- ⛔ **جدولِ جدا برای واریزها.** تا وقتی هر واریز دقیقاً به یک ردیفِ `payments` می‌چسبد، جدولِ دوم
--    فقط یک JOIN اضافه می‌کرد. جدولِ جدا روزی لازم می‌شود که پیامکِ بانک **بی‌صاحب** برسد (گامِ ۴ی
--    ADR-070، ADRِ خودش را می‌خواهد).
--
-- ⚠️ کلِ فایل در **یک تراکنش** اجرا می‌شود (رانرِ `scripts/migrate.ts`) ⇒ `CREATE INDEX CONCURRENTLY`
--    ممنوع؛ `payments` امروز کوچک است. پیش از اجرا در production: پشتیبان (RUNBOOK §۲–۳).
-- ══════════════════════════════════════════════════════════════════════════

-- ── ۱) درگاهِ نو در CHECKِ ۰۰۰۴ ───────────────────────────────────────────
ALTER TABLE payments
  DROP CONSTRAINT payments_gateway_ck,
  ADD CONSTRAINT payments_gateway_ck
    CHECK (gateway IN ('zarinpal', 'idpay', 'mock', 'card_transfer'));

-- ── ۲) دو سمتِ ادعا و مشاهده ──────────────────────────────────────────────
ALTER TABLE payments
  -- سمتِ کاربر: «ریختم، این هم شماره‌اش». هیچ تصمیمِ مالی‌ای رویش بنا نمی‌شود.
  ADD COLUMN transfer_claimed_ref   varchar(80),
  -- ۴ رقمِ آخرِ کارتِ **خودِ کاربر** — اختیاری، فقط برای اینکه پیداکردنش در صورت‌حساب آسان شود.
  -- ⚠️ P7: این هرگز لاگ نمی‌شود.
  ADD COLUMN transfer_claimed_last4 varchar(4),
  ADD COLUMN transfer_claimed_at    timestamptz,
  -- سمتِ staff: آنچه واقعاً در صورت‌حساب دیده شد. **مرجعِ تصمیم.**
  ADD COLUMN transfer_ref           varchar(80),
  ADD COLUMN transfer_sender_last4  varchar(4),
  ADD COLUMN transfer_approved_by   uuid REFERENCES users(id),
  ADD COLUMN transfer_approved_at   timestamptz;

-- ── ۳) قیدها ──────────────────────────────────────────────────────────────
ALTER TABLE payments
  -- ★ تایید همه‌یاهیچ است: زمان، شماره، و **کسی که پاسخ‌گوست**. تاییدِ بی‌actor یعنی جهشِ مالیِ
  --   بی‌صاحب — همان چیزی که گیتِ ۱۶ی ADR-067 برای حذفش نوشته شد.
  ADD CONSTRAINT payments_transfer_approval_ck
    CHECK ((transfer_approved_at IS NOT NULL)
             = (transfer_ref IS NOT NULL AND transfer_approved_by IS NOT NULL)),
  -- ★ ادعا بدونِ شماره بی‌معنی است — شماره تنها چیزی است که staff می‌تواند راستی‌آزمایی کند.
  --   ⊕ ولی عکسش لازم **نیست**: کاربری که شماره را گم کرده بن‌بست ندارد، چون مسیرِ تایید به ادعا
  --     وابسته نیست و staff می‌تواند مستقیم از صورت‌حساب تایید کند.
  ADD CONSTRAINT payments_transfer_claim_ck
    CHECK ((transfer_claimed_at IS NOT NULL) = (transfer_claimed_ref IS NOT NULL)),
  -- ★★ ستون‌های انتقال **فقط** روی ردیفِ کارت‌به‌کارت معنی دارند. بدونِ این قید، یک ردیفِ زرین‌پال
  --    می‌توانست `transfer_ref` بگیرد و درگاهِ انتقال آن را «تاییدشده» بخواند — یعنی فعال‌سازی از
  --    مسیری که هیچ‌کس انتظارش را ندارد. (قرینه‌ی فیلترِ درگاهِ ADR-056.)
  ADD CONSTRAINT payments_transfer_gateway_ck
    CHECK (gateway = 'card_transfer'
             OR (transfer_claimed_ref IS NULL AND transfer_claimed_last4 IS NULL
                 AND transfer_claimed_at IS NULL AND transfer_ref IS NULL
                 AND transfer_sender_last4 IS NULL AND transfer_approved_by IS NULL
                 AND transfer_approved_at IS NULL)),
  -- ★ چهار رقم یعنی چهار رقم — نه خالی، نه با فاصله، نه «****1234».
  ADD CONSTRAINT payments_transfer_last4_ck
    CHECK ((transfer_claimed_last4 IS NULL OR transfer_claimed_last4 ~ '^[0-9]{4}$')
             AND (transfer_sender_last4 IS NULL OR transfer_sender_last4 ~ '^[0-9]{4}$'));

-- ── ۴) دو ایندکس ──────────────────────────────────────────────────────────

-- ★★ نگهبانِ بازپخش. جزئی است چون فقط ردیف‌های **تاییدشده** شماره دارند.
CREATE UNIQUE INDEX payments_transfer_ref_uq
  ON payments (gateway, transfer_ref) WHERE transfer_ref IS NOT NULL;

-- صفِ تاییدِ staff: «چه ردیف‌هایی منتظرِ من‌اند». ادعاشده‌ها اول، بعد بی‌ادعاها.
-- ⊕ عمداً روی `status='pending'` است، مثلِ ایندکسِ sweepِ فاز ۷ — ردیفِ تسویه‌شده دیگر صف نیست.
CREATE INDEX payments_transfer_queue_idx
  ON payments (transfer_claimed_at DESC NULLS LAST, requested_at DESC)
  WHERE status = 'pending' AND gateway = 'card_transfer';
