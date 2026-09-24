-- ══════════════════════════════════════════════════════════════════════════
-- 0009 — مدلِ استرداد (M6 فاز ۶٫۴، [ADR-068](../../../ARCHITECTURE_DECISIONS.md#adr-068))
--
-- ── چرا migrationِ جدا (و نه داخلِ ۰۰۰۸) ─────────────────────────────────
--
-- ★ این فایل **ماشینِ حالت** دارد و یک CHECKِ موجود را عوض می‌کند؛ ۰۰۰۸ فقط ایندکس بود. ADR-068
--   عمداً جدایشان کرد تا بازبینیِ خصمانه‌ی فاز ۶ بتواند مدل را پیش از انجماد عوض کند بی‌آنکه
--   ایندکس‌ها را با خود ببرد. پیش از اجرا در production: پشتیبان (RUNBOOK §۲–۳).
--
-- ── دو قیدِ اندازه‌گیری‌شده که شکلِ این فایل را تعیین کردند (ADR-068 §دلیل) ─────
--
-- ۱. `invoices_paid_at_ck` (۰۰۰۴) می‌گفت `(status='paid') = (paid_at IS NOT NULL)` ⇒ برای فاکتورِ
--    `refunded` **باید** `paid_at` را NULL می‌کردیم — یعنی پاک‌کردنِ همان رکوردِ مالی‌ای که ADR-052
--    ثابت می‌خواهد. CHECKِ جایگزین `paid_at` را روی هر دو وضعیت نگه می‌دارد و `refunded_at` را برای
--    `refunded` اجباری می‌کند: پولی که برگشته، هم تاریخِ گرفتنش را دارد هم تاریخِ برگشتش را.
-- ۲. هیچ نویسنده‌ای برای `payments.status='refunded'` وجود نداشت (واقعیتِ ۴ی فاز ۰) ⇒ «پولش برگشت ولی
--    اشتراک فعال است» را هیچ‌کس نمی‌دید. ستون‌های این‌جا + `refundPayment(tx)` آن نویسنده‌اند.
--
-- ── چه چیزی عمداً این‌جا نیست ─────────────────────────────────────────────
--
-- ⛔ **استردادِ جزئی** — `payments_refund_full_ck` می‌گوید مبلغِ استرداد همیشه `amount_rial` است
--    (ADR-068: «هرگز بازمحاسبه»). روزی که استردادِ جزئی ADR گرفت، **این CHECK** عوض می‌شود، نه کدِ
--    اطرافش — ستون از امروز مبلغ را نگه می‌دارد تا آن روز migrationِ داده نخواهد.
-- ⛔ `refund_payload` — کانالِ واقعیِ زرین‌پال هنوز نیست (`REFUND_UNAVAILABLE`)؛ شماره‌ی مرجعِ استرداد
--    (`refund_ref`) از پنلِ زرین‌پال دستی ثبت می‌شود. وقتی کانال آمد، پاسخِ خامش ستونِ خودش را می‌گیرد.
--
-- ⚠️ کلِ فایل در **یک تراکنش** اجرا می‌شود (رانرِ `scripts/migrate.ts`) ⇒ `CREATE INDEX CONCURRENTLY`
--    ممنوع؛ `payments` امروز کوچک است.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE payments
  ADD COLUMN refunded_at        timestamptz,
  -- شماره‌ی مرجعِ استرداد — از پنلِ درگاه (دستی) یا از `PaymentGateway.refund` (Mock امروز).
  ADD COLUMN refund_ref         varchar(80),
  ADD COLUMN refund_amount_rial bigint,
  -- ★ `refunded` ⇔ هم زمان دارد هم مبلغ؛ هیچ وضعیتِ دیگری هیچ‌کدام را ندارد.
  ADD CONSTRAINT payments_refunded_ck
    CHECK ((status = 'refunded') = (refunded_at IS NOT NULL AND refund_amount_rial IS NOT NULL)),
  -- ★ ADR-068: مبلغِ استرداد **همیشه** مبلغِ پرداخت. (استردادِ جزئی = ADRِ جدا = تغییرِ همین CHECK.)
  ADD CONSTRAINT payments_refund_full_ck
    CHECK (refund_amount_rial IS NULL OR refund_amount_rial = amount_rial),
  -- ★ قرینه‌ی CHECKِ فاکتور، این‌بار روی پرداخت: `paid_at` با استرداد **پاک نمی‌شود** (ADR-052)، و
  --   پرداختِ pending/failed/canceled هرگز `paid_at` ندارد. (ردیف‌های موجود: paid همه `paid_at` دارند.)
  ADD CONSTRAINT payments_paid_at_ck
    CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL));

ALTER TABLE invoices
  ADD COLUMN refunded_at timestamptz,
  DROP CONSTRAINT invoices_paid_at_ck,
  -- ★★ جایگزین: فاکتورِ `refunded` هم `paid_at` دارد (رکوردِ مالی می‌مانَد) هم `refunded_at`.
  ADD CONSTRAINT invoices_paid_at_ck
    CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL)),
  ADD CONSTRAINT invoices_refunded_ck
    CHECK ((status = 'refunded') = (refunded_at IS NOT NULL));

-- فهرستِ پرداخت‌های پنل **بدونِ** فیلترِ تیم (۶٫۱): keyset روی `(requested_at DESC, id DESC)`.
-- `payments_team_idx` (۰۰۰۸) فقط با فیلترِ تیم می‌نشیند و `payments_pending_idx` فقط pendingها را می‌بیند.
CREATE INDEX payments_requested_idx ON payments (requested_at DESC, id DESC);
