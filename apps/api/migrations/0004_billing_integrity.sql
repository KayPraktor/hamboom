-- 0004_billing_integrity.sql — بستنِ حفره‌های schemaی billing (ماژول M4، فاز ۴).
--
-- ═══ چرا این migration ═══════════════════════════════════════════════════════
--
-- جدول‌های billing از `0001_init.sql` وجود داشتند ولی **بدونِ هیچ نگهبانی**. probeها و
-- بازبینیِ فاز ۰/۱ شش حفره‌ی مشخص پیدا کردند که هرکدام بی‌صدا پول یا سرویس را خراب می‌کنند:
--
--   ۱. (B-4) هیچ `CHECK` روی هیچ ستونِ وضعیتِ billing نبود — در حالی که شش `CHECK` جای
--      دیگرِ همین schema هست. `status='Active'` تمیز درج می‌شد و **بیرونِ**
--      `subscriptions_active_uq` می‌افتاد (که فقط `active|trialing|past_due` را می‌بیند)،
--      پس تیم دو اشتراکِ «فعال» می‌گرفت در حالی که هر `WHERE status='active'` می‌گفت پلنی ندارد.
--   ۲. رابطه‌ی `subtotal − discount + vat = total` هیچ‌جا اجباری نبود. ADR-052 آن را در کد
--      تضمین می‌کند؛ اینجا **دیتابیس هم** تضمینش می‌کند تا هیچ مسیرِ دومی نتواند نقضش کند.
--   ۳. `coupons.redeemed_count` هیچ رابطه‌ای با `max_redemptions` نداشت و هیچ جدولی
--      «چه کسی چه کوپنی را مصرف کرد» را نگه نمی‌داشت ⇒ خواندن-سپس-نوشتن، و مصرفِ دوباره‌ی
--      همان کوپن در هر تمدید.
--   ۴. `subscriptions` هیچ اشاره‌ای به پرداختی که فعالش کرد نداشت ⇒ «پول گرفته شد ولی
--      سرویس داده نشد» با هیچ joinی قابلِ گزارش نبود. و قیمت منجمد نمی‌شد، پس تغییرِ
--      `plans.price_*` وسطِ یک پرداخت، verify را خراب می‌کرد.
--   ۵. شماره‌ی فاکتور با `max(number)+1` ⇒ دو درخواستِ هم‌زمان همان عدد را می‌گیرند و دومی
--      با ۲۳۵۰۵ می‌افتد — **بعد از اینکه پول جابه‌جا شده**.
--   ۶. `card_hash`ِ ۶۴کاراکتریِ verify ستون نداشت و بی‌صدا در `verify_payload` گم می‌شد؛
--      و نرخِ VAT روی فاکتور منجمد نمی‌شد.
--
-- ⚠️ `0001_init.sql` **منجمد** است (گیتِ checksumِ رانر). هر اصلاحی اینجا می‌آید.
-- ⚠️ کلِ فایل در **یک تراکنش** اجرا می‌شود ⇒ `CREATE INDEX CONCURRENTLY` ممنوع.

-- ══ ۱. نگهبانِ وضعیت‌ها (B-4) ═══════════════════════════════════════════════
-- مقادیر دقیقاً همان enumهای `packages/shared-types/src/api/billing.ts` اند؛ واگرایی‌شان
-- یعنی یک DTOی معتبر در دیتابیس رد شود (یا برعکس).

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_ck
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  ADD CONSTRAINT subscriptions_period_ck
    CHECK (period IN ('monthly', 'yearly')),
  ADD CONSTRAINT subscriptions_seats_ck
    CHECK (seats >= 1),
  -- دوره‌ی وارونه یعنی محاسبه‌ی انقضا جایی خراب شده.
  ADD CONSTRAINT subscriptions_period_order_ck
    CHECK (current_period_end > current_period_start);

ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_ck
    CHECK (status IN ('draft', 'open', 'paid', 'void', 'refunded')),
  -- ★★ خودِ رابطه‌ی ADR-052، این‌بار در سطحِ دیتابیس. اگر روزی کسی مسیرِ دومِ محاسبه
  --    بسازد (همان چیزی که probeِ گام ۱٫۵ خطرناک بودنش را نشان داد)، درج **رد** می‌شود.
  ADD CONSTRAINT invoices_total_ck
    CHECK (subtotal_rial - discount_rial + vat_rial = total_rial),
  -- clampِ تخفیف — probe نشان داد بدونش مبلغِ **منفی** ساخته می‌شود.
  ADD CONSTRAINT invoices_discount_ck
    CHECK (discount_rial >= 0 AND discount_rial <= subtotal_rial),
  ADD CONSTRAINT invoices_amounts_ck
    CHECK (subtotal_rial >= 0 AND vat_rial >= 0 AND total_rial >= 0),
  -- فاکتورِ پرداخت‌شده باید زمانِ پرداخت داشته باشد، و برعکس.
  ADD CONSTRAINT invoices_paid_at_ck
    CHECK ((status = 'paid') = (paid_at IS NOT NULL));

ALTER TABLE payments
  ADD CONSTRAINT payments_status_ck
    CHECK (status IN ('pending', 'paid', 'failed', 'canceled', 'refunded', 'verify_failed')),
  ADD CONSTRAINT payments_gateway_ck
    CHECK (gateway IN ('zarinpal', 'idpay', 'mock')),
  ADD CONSTRAINT payments_gateway_mode_ck
    CHECK (gateway_mode IN ('sandbox', 'production')),
  -- کفِ درگاه، اندازه‌گیری‌شده در گام ۱٫۱ (مبلغِ ۱۰۰ ریال خطای -9 گرفت).
  ADD CONSTRAINT payments_amount_ck
    CHECK (amount_rial >= 1000);

ALTER TABLE coupons
  -- یکی از دو شکل، هرگز هر دو و هرگز هیچ‌کدام.
  ADD CONSTRAINT coupons_shape_ck
    CHECK ((percent_off IS NULL) <> (amount_off_rial IS NULL)),
  ADD CONSTRAINT coupons_percent_ck
    CHECK (percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)),
  ADD CONSTRAINT coupons_amount_ck
    CHECK (amount_off_rial IS NULL OR amount_off_rial > 0),
  ADD CONSTRAINT coupons_redemptions_ck
    CHECK (redeemed_count >= 0 AND (max_redemptions IS NULL OR redeemed_count <= max_redemptions));

-- ══ ۲. مصرفِ کوپن — یک ردیف به‌ازای هر (کوپن، تیم) ═════════════════════════
-- ★ ایندکسِ یکتا کارِ «خواندن-سپس-نوشتن» را می‌کند بدونِ مسابقه: دومین redeemِ همزمان
--   با ۲۳۵۰۵ می‌افتد، نه اینکه هر دو از چکِ `redeemed_count < max` رد شوند.
-- ★ و چون کلید `(coupon_code, team_id)` است، همان تیم نمی‌تواند در تمدیدِ بعدی دوباره
--   همان کوپن را خرج کند.

CREATE TABLE coupon_redemptions (
  coupon_code varchar(40)  NOT NULL REFERENCES coupons(code),
  team_id     uuid         NOT NULL REFERENCES teams(id),
  invoice_id  uuid         REFERENCES invoices(id),
  redeemed_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_code, team_id)
);
CREATE INDEX coupon_redemptions_team_idx ON coupon_redemptions (team_id);

-- ══ ۳. پیوندِ اشتراک به پرداخت + قیمتِ منجمد ═══════════════════════════════

ALTER TABLE subscriptions
  -- «پول گرفته شد ولی سرویس داده نشد» حالا با یک join قابلِ گزارش است.
  ADD COLUMN activated_by_payment_id uuid REFERENCES payments(id),
  -- ★ قیمتِ واحد در لحظه‌ی فعال‌سازی **منجمد** می‌شود. بدونِ این، تغییرِ `plans.price_*`
  --   وسطِ یک پرداخت یا verify را می‌شکند یا پلنی را با قیمتِ کمتر فعال می‌کند.
  ADD COLUMN unit_price_rial bigint,
  ADD CONSTRAINT subscriptions_unit_price_ck
    CHECK (unit_price_rial IS NULL OR unit_price_rial >= 0);

-- ══ ۴. ستون‌های جاافتاده‌ی verify و فاکتور ═════════════════════════════════

ALTER TABLE payments
  -- هشِ ۶۴کاراکتریِ کارت که verify برمی‌گرداند؛ تا امروز بی‌صدا در verify_payload گم می‌شد.
  ADD COLUMN card_hash varchar(64);

ALTER TABLE invoices
  -- ★ نرخِ VATِ **در لحظه‌ی صدور** (ADR-052). بازمحاسبه از یک عددِ سراسری یعنی تغییرِ نرخ،
  --   تاریخِ مالی را عوض می‌کند. `0` مقدارِ کاملاً معتبر است (M4-D6).
  ADD COLUMN vat_percent smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT invoices_vat_percent_ck
    CHECK (vat_percent >= 0 AND vat_percent <= 100);

-- ══ ۵. دنباله‌ی اتمیکِ شماره‌ی فاکتور، به ازای هر سالِ جلالی ═════════════════
-- ⚠️ `max(number)+1` در کد **قابلِ اتکا نیست**: دو درخواستِ هم‌زمان همان عدد را می‌گیرند و
--    دومی با ۲۳۵۰۵ می‌افتد — بعد از اینکه پول جابه‌جا شده. این جدول با یک
--    `INSERT … ON CONFLICT DO UPDATE … RETURNING` عددِ بعدی را **اتمیک** می‌دهد:
--
--      INSERT INTO invoice_sequences (jalali_year, last_seq) VALUES ($1, 1)
--      ON CONFLICT (jalali_year) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1
--      RETURNING last_seq;
--
-- ★ سالِ جلالی **پارامتر** است، نه محاسبه‌ی دیتابیس: تهران (UTC+3:30) سرِ نوروز زودتر از
--   روزِ UTC وارد سالِ نو می‌شود، و همان لحظه‌ای که شماره را می‌سازد باید `issued_at` را هم
--   بسازد (probeِ گام ۱٫۵، `billing-core/src/period.ts`).

CREATE TABLE invoice_sequences (
  jalali_year integer     PRIMARY KEY,
  last_seq    integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_sequences_year_ck CHECK (jalali_year BETWEEN 1400 AND 1500),
  CONSTRAINT invoice_sequences_seq_ck  CHECK (last_seq >= 0)
);

-- ══ ۶. صراحتِ رفتارِ حذف روی رکوردهای مالی ═════════════════════════════════
-- probeِ فاز ۱ خودش به این خورد: حذفِ کاربر با ۲۳۵۰۳ افتاد چون `teams.owner_user_id` و
-- `payments.initiated_by` هیچ `ON DELETE` نداشتند.
--
-- ★★ و این رفتار **درست** است — فقط نانوشته بود. رکوردِ مالی نباید با حذفِ کاربر یا تیم
--    نابود شود؛ مسیرِ حذف در این پروژه **نرم** است (`deleted_at`). پس به‌جای عوض‌کردنِ
--    رفتار، آن را **صریح و نام‌دار** می‌کنیم تا کسی بعداً از روی ناآگاهی `CASCADE` نزند.
-- ⚠️ افزودنِ `ON DELETE CASCADE` به `invoices` وسوسه‌انگیز است و **سوابقِ مالی را نابود
--    می‌کند**. اگر روزی لازم شد، بایگانی کن، حذف نکن.

ALTER TABLE invoices DROP CONSTRAINT invoices_team_id_fkey;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE RESTRICT;

ALTER TABLE payments DROP CONSTRAINT payments_team_id_fkey;
ALTER TABLE payments
  ADD CONSTRAINT payments_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE RESTRICT;

ALTER TABLE payments DROP CONSTRAINT payments_initiated_by_fkey;
ALTER TABLE payments
  ADD CONSTRAINT payments_initiated_by_fkey
    FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE RESTRICT;

-- ایندکس‌های کاری که sweepِ فاز ۷ و صفحه‌ی فاکتورِ فاز ۹ لازم دارند.
CREATE INDEX payments_pending_idx ON payments (requested_at) WHERE status = 'pending';
CREATE INDEX invoices_team_idx    ON invoices (team_id, issued_at DESC);
CREATE INDEX subscriptions_team_idx ON subscriptions (team_id);

-- ══ ۷. seedِ پلن‌ها ════════════════════════════════════════════════════════
--
-- ★★ **`free` زیرساخت است، نه تصمیمِ کسب‌وکار** — هر تیمی باید یک پلن داشته باشد وگرنه
--    `Team.planCode` معنایی ندارد و گیتِ ظرفیت (ADR-053) چیزی برای خواندن ندارد. قیمتش
--    صفر است، پس هیچ عددی اینجا اختراع نشده.
--
-- ⚠️ **`pro` و `team` عمداً `is_active = false` اند.** قیمت‌هایشان **جای‌نگهدار** است و
--    تصمیمِ قیمت‌گذاری مالِ مالک است، نه این migration. تا وقتی کسی عددِ واقعی نگذاشته و
--    فعالشان نکرده، در فهرستِ عمومیِ پلن‌ها ظاهر نمی‌شوند و **قابلِ خرید نیستند** — همان
--    قاعده‌ی «فقط قابلیتِ واقعی، هیچ به‌زودی» (درسِ ۴ی M3).
--
-- `-1` در ستون‌های سقف یعنی **نامحدود** (قراردادِ `planLimit`).

INSERT INTO plans (code, name, description, price_monthly_rial, price_yearly_rial,
                   max_members, max_boards, max_storage_bytes, features, is_active, sort_order)
VALUES
  ('free', 'رایگان',
   'برای شروع و تیم‌های کوچک — بدون هزینه.',
   0, 0,
   3, 3, 104857600,                                  -- ۳ عضو، ۳ بورد، ۱۰۰MB
   '["همکاری بلادرنگ", "۳ بورد", "۱۰۰ مگابایت فضا"]'::jsonb,
   true, 0),

  ('pro', 'حرفه‌ای',
   'برای تیم‌هایی که جدی کار می‌کنند. ⚠️ قیمت جای‌نگهدار است — تا تاییدِ مالک غیرفعال.',
   0, 0,
   10, -1, 5368709120,                               -- ۱۰ عضو، بوردِ نامحدود، ۵GB
   '["بوردِ نامحدود", "۵ گیگابایت فضا", "تاریخچه‌ی نسخه"]'::jsonb,
   false, 1),

  ('team', 'تیمی',
   'برای سازمان‌ها. ⚠️ قیمت جای‌نگهدار است — تا تاییدِ مالک غیرفعال.',
   0, 0,
   50, -1, 53687091200,                              -- ۵۰ عضو، بوردِ نامحدود، ۵۰GB
   '["همه‌ی امکاناتِ حرفه‌ای", "۵۰ گیگابایت فضا", "مدیریتِ دسترسیِ پیشرفته"]'::jsonb,
   false, 2)
ON CONFLICT (code) DO NOTHING;
