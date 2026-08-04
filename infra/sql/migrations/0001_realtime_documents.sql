-- 0001_realtime_documents.sql — پایداریِ سندِ Yjs (ماژول M2).
--
-- الگو ([ADR-009](../../../ARCHITECTURE_DECISIONS.md#adr-009)): لاگِ append-only از
-- updateهای باینریِ Yjs + snapshotِ دوره‌ای. بازیابیِ یک بورد = آخرین snapshot +
-- همه‌ی updateهای بعد از آن.
--
-- ═══ ⚠️ چرا FK به boards/users اینجا نیست ═══════════════════════════════════
--
-- PLAN بخش ۶ برای هر دو جدول `REFERENCES boards(id)` و `REFERENCES users(id)`
-- تعریف کرده. آن جدول‌ها **مالِ M3 اند و هنوز وجود ندارند**.
--
-- اگر M2 خودش `CREATE TABLE boards` بزند، migrationِ `0001_init.sql`ِ خودِ M3 بعداً
-- روی یک جدولِ از پیش موجود می‌افتد و می‌شکند — یعنی برای راحتیِ امروز، فردا را
-- خراب کرده‌ایم. پس ستون‌ها `uuid` ساده می‌مانند و **M3 دو FK را با `ALTER TABLE`
-- در migration خودش اضافه می‌کند**. این در فهرستِ «آنچه M3 باید پیاده کند»
-- (گام ۶٫۴ در TODO.md) ثبت است.
--
-- پیامدِ پذیرفته‌شده: تا آن موقع، `ON DELETE CASCADE` وجود ندارد؛ حذفِ یک بورد
-- ردیف‌های اینجا را پاک نمی‌کند. برای محیطِ توسعه بی‌اهمیت است.

-- ── لاگِ updateها ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_updates (
  id             bigserial   PRIMARY KEY,
  board_id       uuid        NOT NULL,               -- FK را M3 اضافه می‌کند
  seq            bigint      NOT NULL,               -- شماره‌ی ترتیبی درونِ بورد
  payload        bytea       NOT NULL,               -- updateِ باینریِ Yjs
  byte_size      integer     NOT NULL,
  origin_user_id uuid,                               -- FK را M3 اضافه می‌کند
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ترتیبِ درونِ بورد باید یکتا باشد: دو نود که همزمان بنویسند باید یکی‌شان بخورد
-- زمین، نه اینکه هر دو موفق شوند و لاگ سوراخ/تکراری شود (قفلِ صاحب در گام ۴٫۷).
CREATE UNIQUE INDEX IF NOT EXISTS board_updates_seq_uq
  ON board_updates (board_id, seq);

-- ── snapshotها ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_snapshots (
  id            uuid        PRIMARY KEY,
  board_id      uuid        NOT NULL,                -- FK را M3 اضافه می‌کند
  seq_upto      bigint      NOT NULL,                -- تا کدام seq فشرده شده
  storage_key   text        NOT NULL,                -- کلید در SnapshotStore (ADR-031)
  state_vector  bytea       NOT NULL,                -- برای syncِ سریع
  byte_size     bigint      NOT NULL,
  element_count integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS board_snapshots_board_idx
  ON board_snapshots (board_id, seq_upto DESC);
