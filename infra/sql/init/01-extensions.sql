-- افزونه‌های PostgreSQL — PLAN.md بخش ۶.
--
-- ⚠️ این فایل فقط **یک‌بار**، هنگام ساختِ دیتابیسِ خالی توسط Postgres اجرا می‌شود
-- (`docker-entrypoint-initdb.d`). پس فقط چیزهایی اینجا می‌آیند که هرگز عوض
-- نمی‌شوند. هر تغییرِ schema باید یک migration در `infra/sql/migrations/` باشد
-- تا روی دیتابیسِ موجود هم اعمال شود (ADR-005).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- جستجوی فارسیِ عنوانِ بورد (کارِ M3)
CREATE EXTENSION IF NOT EXISTS btree_gin;
