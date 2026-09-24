-- ══════════════════════════════════════════════════════════════════════════
-- 0008 — پنلِ ادمین: `users.step_up_verified_at` + ایندکس‌های خواندنِ پنل (M6 فاز ۳/۴،
--        [ADR-066](../../../ARCHITECTURE_DECISIONS.md#adr-066) و
--        [ADR-067](../../../ARCHITECTURE_DECISIONS.md#adr-067))
--
-- ── چه چیزی این‌جاست و چه چیزی عمداً نیست ────────────────────────────────
--
-- ★ **یک ستون:** `users.step_up_verified_at` — لحظه‌ی آخرین OTPِ step-upِ موفقِ staff.
--   `requireStepUp` = `now() − step_up_verified_at ≤ ADMIN_STEP_UP_SECONDS`. ⚠️ **per-user**
--   است نه per-session (ADR-066 §۳)؛ همین ستون همان محدودیت را صادقانه نشان می‌دهد.
--   nullable: `NULL` یعنی «هرگز». هیچ پیش‌فرضی ندارد تا staffِ تازه بدونِ OTP داخلِ پنجره نیفتد.
--
-- ★ **ایندکس‌ها، فقط خواندن (ADR-067 §پیامدها):**
--   • `audit_logs (actor_user_id, created_at DESC)` + `(created_at DESC)` — `GET /admin/audit`
--     با فیلترِ actor و بازه، صفحه‌بندیِ cursor روی `(created_at, id)`. تنها ایندکسِ فعلی
--     `team_idx` است که برای «همه‌ی کارهای این staff» بی‌فایده است.
--   • trgm روی `users.display_name` و `teams.name` — جست‌وجوی پنل (فاز ۵٫۱)، همان
--     `gin_trgm_ops`ی که `boards.title` از M3 دارد؛ `pg_trgm` از `0001` نصب است.
--   • `payments (team_id, requested_at DESC)` و `payments (ref_id)` — اشکال‌زداییِ پرداخت
--     (فاز ۶): «پرداخت‌های این تیم» و «این شماره‌ی پیگیری مالِ کدام ردیف است». ایندکسِ
--     فعلیِ `payments_pending_idx` فقط `pending`ها را می‌بیند.
--
-- ⛔ **ستون‌های استرداد این‌جا نیستند** — migrationِ جدای `0009` (ADR-068): آن یکی
--    CHECKِ `invoices_paid_at_ck` را عوض می‌کند و ماشینِ حالت دارد؛ قاطی‌کردنش با چند
--    ایندکسِ بی‌ضرر یعنی اگر روزی برگشت لازم شد، ایندکس‌ها هم با آن می‌روند.
--
-- ⚠️ کلِ فایل در **یک تراکنش** اجرا می‌شود (رانرِ `scripts/migrate.ts`) ⇒
--    `CREATE INDEX CONCURRENTLY` ممنوع. جدول‌ها امروز کوچک‌اند و قفلِ کوتاه پذیرفتنی است؛
--    روزی که نباشند، ایندکسِ تازه migrationِ خودش را می‌خواهد.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN step_up_verified_at timestamptz;

CREATE INDEX audit_logs_actor_idx   ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE INDEX users_display_name_trgm ON users USING gin (display_name gin_trgm_ops);
CREATE INDEX teams_name_trgm         ON teams USING gin (name gin_trgm_ops);

CREATE INDEX payments_team_idx ON payments (team_id, requested_at DESC);
CREATE INDEX payments_ref_idx  ON payments (ref_id) WHERE ref_id IS NOT NULL;
