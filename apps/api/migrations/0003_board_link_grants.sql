-- 0003_board_link_grants.sql — گرنتِ دسترسیِ مهمانِ لینک (ماژول M3، DP-4).
--
-- ═══ چرا این جدول ═══════════════════════════════════════════════════════════
--
-- مهمانی که با لینکِ اشتراک بورد را باز می‌کند، `BoardAccessReader.read(sub, boardId)` توکنِ لینکِ
-- درخواستش را نمی‌بیند. پس در بازبینیِ زنده‌ی realtime (`currentRole` روی هر اتصال) دسترسی‌اش قطع
-- می‌شد. راه‌حل (DP-4، تاییدِ مالک): وقتی مهمان لینک را `resolve` می‌کند، یک **گرنتِ ماندگار** می‌گیرد
-- که به توکنِ لینکِ **فعلی** گره خورده است. `BoardAccessReader` از این‌جا `hasValidLink` را با یک JOIN
-- می‌سازد، و `effectiveBoardRole` مسیرِ لینک را با `access_mode` گیت می‌کند.
--
-- ★ **ابطالِ درست** بدونِ پاک‌سازیِ دستی:
--   • خاموش‌کردنِ لینک (`access_mode` → team/private) → گیتِ access_mode مسیرِ لینک را می‌بندد.
--   • ساختِ توکنِ نو (`boards.link_token_hash` عوض می‌شود) → گرنت‌های قدیمی که `link_token_hash`
--     نمی‌خوانند بی‌اثر می‌شوند.

CREATE TABLE board_link_grants (
  board_id        uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  -- توکنی که با آن گرنت داده شد؛ reader با boards.link_token_hash مقایسه‌اش می‌کند.
  link_token_hash text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);
