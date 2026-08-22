-- 0002_board_fks.sql — دو FKِ به‌ارث‌رسیده‌ی M2 (ماژول M3، فاز ۵٫۱).
--
-- ═══ چرا این‌جا و نه در migrationِ M2 ═════════════════════════════════════════
--
-- `board_updates`/`board_snapshots` را M2 ساخت (`infra/sql/migrations/0001_...`)، ولی
-- `boards` هنوز وجود نداشت — پس ستونِ `board_id` بدونِ FK ماند (تصمیمِ گام ۰٫۳ M2). حالا که
-- `0001_init.sql` جدولِ `boards` را ساخت، FK را با `ALTER` اضافه می‌کنیم. رانرِ واحد
-- ترتیب را تضمین می‌کند: infra (board_updates) → api/0001 (boards) → این فایل.
--
-- ═══ رفتارِ حذف (تصمیمِ مالک ۱۴۰۵/۰۵/۲۸، سوال ۲) ══════════════════════════════
--
-- • `board_id → boards(id)` **`ON DELETE CASCADE`**: حذفِ بورد در مسیرِ عادی **نرم** است
--   (`deleted_at`)، پس FK فقط در حذفِ **سخت** (پاک‌سازی بعد از trash، یا CASCADE از حذفِ تیم)
--   شلیک می‌کند — آن‌جا لاگِ append و snapshot باید **با** بورد بروند. نقطه‌ی تصمیم بالادست و
--   فقط-ownerـ است، پس CASCADE امن است.
-- • `origin_user_id → users(id)` **`ON DELETE SET NULL`**: کاربرِ پاک‌شده نباید updateاش را
--   با خود ببرد؛ ستون nullable است و «که این را نوشت» گم می‌شود، نه خودِ داده.
--
-- ⚠️ CASCADE ردیفِ DB را می‌برد، **نه بلابِ Object Storage** (`board_snapshots.storage_key`).
--    بازپس‌گیریِ فضای S3 یک جاروبِ جدا است (worker/M5)، نه این FK.

ALTER TABLE board_updates
  ADD CONSTRAINT board_updates_board_fk
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE;

ALTER TABLE board_updates
  ADD CONSTRAINT board_updates_origin_user_fk
  FOREIGN KEY (origin_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE board_snapshots
  ADD CONSTRAINT board_snapshots_board_fk
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE;
