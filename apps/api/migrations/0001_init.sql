-- 0001_init.sql — schemaی اصلیِ هم‌بوم (ماژول M3، فاز ۵٫۱). [PLAN §۶](../../../PLAN.md)
--
-- ═══ آنچه اینجا هست و آنچه نیست ═══════════════════════════════════════════════
--
-- • `board_updates` و `board_snapshots` اینجا **نیستند** — مالِ M2 اند
--   (`infra/sql/migrations/0001_realtime_documents.sql`) و رانرِ واحد آن‌ها را
--   **قبل** از این فایل اجرا می‌کند. دو FKشان به `boards` در `0002_board_fks.sql`.
-- • جدول‌های billing (`plans`/`subscriptions`/`coupons`/`invoices`/`payments`) و
--   `templates`/`comment_threads`/`comments`/`board_versions`/`export_jobs` **ساختار**
--   دارند ولی منطقشان M4/فاز ۱۰ است — «جدول در schema، منطق نه» (PLAN §۸).
--
-- ═══ آشتی‌های قفل‌شده‌ی فاز ۵٫۱ (مالک ۱۴۰۵/۰۵/۲۸) ═══════════════════════════════
--
-- • `auth_sessions.rotated_at` — **افزوده بر PLAN §۶**: پورتِ reuse-detectionِ فاز ۴
--   یک نشانه‌ی «این توکن چرخانده شد»ِ **هر-توکن** می‌خواهد (مدلِ یک-ردیف-به-ازای-هر-چرخش،
--   هم‌خانواده با `family_id`). `markUsed`→ست `rotated_at`؛ `burnFamily`→ست `revoked_at`
--   روی کلِ خانواده؛ توکنِ فعال = `revoked_at IS NULL AND rotated_at IS NULL`.
-- • `boards.access_mode` CHECK بدونِ `link_comment` — `shared-types` آن را حذف کرد
--   (گام ۲٫۲، تا فاز ۱۰). schema با قرارداد هم‌تراز می‌مانَد.
-- • CHECK روی نقش‌ها (`team_members`/`board_members`/`team_invites`) هم‌تراز با enumهای
--   `shared-types`. `board_members.role` مقدارِ `commenter` را **می‌پذیرد** (ترتیبِ سیمِ M2)
--   هرچند endpointِ اعضا آن را قابلِ‌تخصیص نمی‌کند (`assignableBoardRoles`).
-- • `avatar_file_id`/`thumbnail_file_id`/`template_id` FKهای **تاخیری** اند (ارجاعِ رو به جلو
--   به `files`/`templates`) — در انتهای همین فایل با `ALTER` و `ON DELETE SET NULL` بسته می‌شوند.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ══ کاربر و احراز هویت ══════════════════════════════════════════════════════
-- کلیدها UUIDv7 اند و **در اپ** تولید می‌شوند (PLAN §۶) — پس بدونِ DEFAULT.
CREATE TABLE users (
  id                uuid PRIMARY KEY,
  phone             varchar(20),                    -- E.164
  phone_verified_at timestamptz,
  email             varchar(255),
  email_verified_at timestamptz,
  display_name      varchar(80)  NOT NULL,
  avatar_file_id    uuid,                           -- FK تاخیری → files (انتهای فایل)
  locale            varchar(5)   NOT NULL DEFAULT 'fa',
  presence_color    varchar(7)   NOT NULL,          -- رنگِ ثابتِ کاربر در بوم
  status            varchar(20)  NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended', 'deleted')),
  is_staff          boolean      NOT NULL DEFAULT false,
  last_seen_at      timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;

-- کدهای یک‌بارمصرف. کد به‌صورت hash ذخیره می‌شود، هرگز plaintext (P7).
CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY,
  purpose       varchar(30) NOT NULL,               -- login|phone_change|email_verify
  channel       varchar(10) NOT NULL,               -- sms|email
  destination   varchar(255) NOT NULL,
  code_hash     text        NOT NULL,
  attempts      smallint    NOT NULL DEFAULT 0,
  max_attempts  smallint    NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  request_ip    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_dest_idx ON otp_challenges (destination, created_at DESC);

CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL,                 -- برای تشخیصِ reuse در rotation
  refresh_token_hash text NOT NULL,
  device_label       varchar(120),
  ip                 inet,
  user_agent         text,
  expires_at         timestamptz NOT NULL,
  rotated_at         timestamptz,                   -- ★ افزوده‌ی ۵٫۱: این توکن چرخانده شد (یک‌بارمصرف)
  revoked_at         timestamptz,                   -- کلِ خانواده سوخت (burnFamily)
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX auth_sessions_token_uq ON auth_sessions (refresh_token_hash);

-- ══ تیم / ورک‌اسپیس ═════════════════════════════════════════════════════════
CREATE TABLE teams (
  id             uuid PRIMARY KEY,
  slug           varchar(50) NOT NULL,
  name           varchar(120) NOT NULL,
  avatar_file_id uuid,                              -- FK تاخیری → files
  owner_user_id  uuid NOT NULL REFERENCES users(id),
  is_personal    boolean NOT NULL DEFAULT false,    -- ورک‌اسپیسِ شخصیِ خودکار
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE UNIQUE INDEX teams_slug_uq ON teams (lower(slug)) WHERE deleted_at IS NULL;

CREATE TABLE team_members (
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role       varchar(20) NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  invited_by uuid REFERENCES users(id),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

CREATE TABLE team_invites (
  id           uuid PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  channel      varchar(10) NOT NULL,               -- sms|email
  destination  varchar(255) NOT NULL,
  role         varchar(20) NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  token_hash   text NOT NULL,
  invited_by   uuid NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ══ فولدر و بورد ════════════════════════════════════════════════════════════
CREATE TABLE folders (
  id         uuid PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES folders(id) ON DELETE CASCADE,
  name       varchar(120) NOT NULL,
  position   double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE boards (
  id                uuid PRIMARY KEY,
  team_id           uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  folder_id         uuid REFERENCES folders(id) ON DELETE SET NULL,
  title             varchar(200) NOT NULL DEFAULT 'بورد بدون عنوان',
  created_by        uuid NOT NULL REFERENCES users(id),
  thumbnail_file_id uuid,                              -- FK تاخیری → files
  -- ★ بدونِ `link_comment` (shared-types گام ۲٫۲ حذفش کرد، تا فاز ۱۰):
  access_mode       varchar(20) NOT NULL DEFAULT 'team'
                      CHECK (access_mode IN ('private', 'team', 'link_view', 'link_edit')),
  link_token_hash   text,                              -- توکنِ لینکِ اشتراک (hash)
  template_id       uuid,                              -- FK تاخیری → templates
  schema_version    smallint NOT NULL DEFAULT 1,       -- نسخه‌ی ساختارِ Y.Doc
  element_count     integer NOT NULL DEFAULT 0,        -- تقریبی، از realtime به‌روز می‌شود
  doc_size_bytes    bigint  NOT NULL DEFAULT 0,
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX boards_team_idx   ON boards (team_id, last_activity_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX boards_title_trgm ON boards USING gin (title gin_trgm_ops);

CREATE TABLE board_members (          -- دسترسیِ مستقیمِ فرد به بورد (فراتر از عضویتِ تیم)
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role     varchar(20) NOT NULL CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  added_by uuid REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE board_favorites (
  user_id    uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, board_id)
);

-- نسخه‌های نام‌گذاری‌شده — `snapshot_id` به `board_snapshots`ِ **M2** ارجاع می‌دهد
-- (رانرِ واحد infra را اول اجرا کرده، پس جدول موجود است). منطقِ نسخه = فاز ۱۰.
CREATE TABLE board_versions (
  id          uuid PRIMARY KEY,
  board_id    uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES board_snapshots(id),
  label       varchar(120),
  kind        varchar(20) NOT NULL DEFAULT 'auto',  -- auto|manual|pre_restore
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ══ فایل‌ها ═════════════════════════════════════════════════════════════════
CREATE TABLE files (
  id           uuid PRIMARY KEY,
  team_id      uuid REFERENCES teams(id) ON DELETE CASCADE,
  board_id     uuid REFERENCES boards(id) ON DELETE CASCADE,
  uploader_id  uuid REFERENCES users(id),
  bucket       varchar(63) NOT NULL,
  storage_key  text        NOT NULL,
  mime_type    varchar(120) NOT NULL,
  size_bytes   bigint      NOT NULL,
  width        integer,
  height       integer,
  sha256       char(64),
  status       varchar(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'ready', 'failed', 'quarantined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX files_sha_idx ON files (team_id, sha256) WHERE deleted_at IS NULL;  -- دی‌دوپ در سطحِ تیم

-- ══ قالب‌ها ═════════════════════════════════════════════════════════════════
CREATE TABLE templates (
  id                uuid PRIMARY KEY,
  slug              varchar(80) NOT NULL UNIQUE,
  title             varchar(160) NOT NULL,
  description       text,
  category          varchar(40) NOT NULL,
  tags              text[] NOT NULL DEFAULT '{}',
  thumbnail_file_id uuid REFERENCES files(id),
  preview_file_id   uuid REFERENCES files(id),
  doc_storage_key   text NOT NULL,                 -- Y.Docِ اولیه در باکتِ snapshots
  is_public         boolean NOT NULL DEFAULT true,
  is_premium        boolean NOT NULL DEFAULT false,
  usage_count       integer NOT NULL DEFAULT 0,
  sort_order        integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- ══ کامنت (منطق: فاز ۱۰) ════════════════════════════════════════════════════
CREATE TABLE comment_threads (
  id           uuid PRIMARY KEY,
  board_id     uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  anchor_kind  varchar(10) NOT NULL,             -- element|point
  element_id   varchar(64),                      -- idِ عنصر داخلِ Y.Doc (نه FK)
  anchor_x     double precision,
  anchor_y     double precision,
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_threads_board_idx ON comment_threads (board_id) WHERE resolved_at IS NULL;

CREATE TABLE comments (
  id         uuid PRIMARY KEY,
  thread_id  uuid NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL,
  mentions   uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);

-- ══ اشتراک و پرداخت (منطق: M4) ══════════════════════════════════════════════
CREATE TABLE plans (
  code                varchar(30) PRIMARY KEY,     -- free|pro|team|enterprise
  name                varchar(80) NOT NULL,
  description         text,
  price_monthly_rial  bigint NOT NULL DEFAULT 0,   -- P5: همیشه ریالِ bigint
  price_yearly_rial   bigint NOT NULL DEFAULT 0,
  max_members         integer NOT NULL,
  max_boards          integer NOT NULL,            -- -1 = نامحدود
  max_storage_bytes   bigint  NOT NULL,
  features            jsonb   NOT NULL DEFAULT '[]',
  is_active           boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0
);

CREATE TABLE subscriptions (
  id                   uuid PRIMARY KEY,
  team_id              uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  plan_code            varchar(30) NOT NULL REFERENCES plans(code),
  status               varchar(20) NOT NULL,       -- trialing|active|past_due|canceled|expired
  period               varchar(10) NOT NULL,       -- monthly|yearly
  seats                integer NOT NULL DEFAULT 1,
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_active_uq ON subscriptions (team_id)
  WHERE status IN ('trialing', 'active', 'past_due');   -- هر تیم فقط یک اشتراکِ فعال

CREATE TABLE coupons (
  code             varchar(40) PRIMARY KEY,
  percent_off      smallint,
  amount_off_rial  bigint,
  max_redemptions  integer,
  redeemed_count   integer NOT NULL DEFAULT 0,
  valid_from       timestamptz,
  valid_until      timestamptz,
  plan_codes       text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id              uuid PRIMARY KEY,
  team_id         uuid NOT NULL REFERENCES teams(id),
  subscription_id uuid REFERENCES subscriptions(id),
  number          varchar(30) NOT NULL UNIQUE,      -- HB-1405-000123
  subtotal_rial   bigint NOT NULL,
  discount_rial   bigint NOT NULL DEFAULT 0,
  vat_rial        bigint NOT NULL DEFAULT 0,
  total_rial      bigint NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'open',  -- draft|open|paid|void|refunded
  line_items      jsonb NOT NULL DEFAULT '[]',
  buyer_legal     jsonb,                            -- اطلاعاتِ حقوقیِ خریدار برای فاکتورِ رسمی
  coupon_code     varchar(40) REFERENCES coupons(code),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz
);

CREATE TABLE payments (
  id                uuid PRIMARY KEY,
  team_id           uuid NOT NULL REFERENCES teams(id),
  invoice_id        uuid REFERENCES invoices(id),
  initiated_by      uuid NOT NULL REFERENCES users(id),
  gateway           varchar(20) NOT NULL,           -- zarinpal|idpay|mock
  gateway_mode      varchar(20) NOT NULL,           -- sandbox|production
  amount_rial       bigint NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'pending', -- pending|paid|failed|canceled|refunded|verify_failed
  authority         varchar(80),                    -- زرین‌پال Authority
  ref_id            varchar(80),                    -- شماره‌ی پیگیریِ بانک
  card_pan_masked   varchar(30),
  fee_rial          bigint,
  failure_code      varchar(40),
  idempotency_key   varchar(80) NOT NULL,
  request_payload   jsonb,
  callback_payload  jsonb,
  verify_payload    jsonb,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  verified_at       timestamptz
);
CREATE UNIQUE INDEX payments_idem_uq      ON payments (idempotency_key);
CREATE UNIQUE INDEX payments_authority_uq ON payments (gateway, authority) WHERE authority IS NOT NULL;

-- ══ عملیاتی ═════════════════════════════════════════════════════════════════
CREATE TABLE usage_counters (            -- کشِ شمارنده‌ها برای اعمالِ محدودیتِ پلن
  team_id       uuid PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  boards_count  integer NOT NULL DEFAULT 0,
  members_count integer NOT NULL DEFAULT 0,
  storage_bytes bigint  NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  team_id       uuid REFERENCES teams(id),
  action        varchar(60) NOT NULL,       -- board.delete، team.member.role_change، ...
  target_type   varchar(40),
  target_id     text,
  ip            inet,
  user_agent    text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_team_idx ON audit_logs (team_id, created_at DESC);

CREATE TABLE sms_logs (
  id                  uuid PRIMARY KEY,
  provider            varchar(20) NOT NULL,
  destination_masked  varchar(30) NOT NULL,   -- P7: هرگز شماره‌ی کامل
  template            varchar(60),
  status              varchar(20) NOT NULL,
  provider_message_id varchar(80),
  cost_rial           bigint,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE export_jobs (
  id           uuid PRIMARY KEY,
  board_id     uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  format       varchar(10) NOT NULL,       -- png|svg|pdf|json
  options      jsonb NOT NULL DEFAULT '{}',
  status       varchar(20) NOT NULL DEFAULT 'queued',  -- queued|running|done|failed
  file_id      uuid REFERENCES files(id),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE TABLE feature_flags (
  key         varchar(60) PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  rollout_pct smallint NOT NULL DEFAULT 0,
  team_ids    uuid[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ══ FKهای تاخیری (ارجاعِ رو به جلو) ═════════════════════════════════════════
-- حذفِ یک فایل نباید کاربر/تیم/بورد را پاک کند → SET NULL. همین‌طور حذفِ قالب.
ALTER TABLE users  ADD CONSTRAINT users_avatar_file_fk
  FOREIGN KEY (avatar_file_id)    REFERENCES files(id)     ON DELETE SET NULL;
ALTER TABLE teams  ADD CONSTRAINT teams_avatar_file_fk
  FOREIGN KEY (avatar_file_id)    REFERENCES files(id)     ON DELETE SET NULL;
ALTER TABLE boards ADD CONSTRAINT boards_thumbnail_file_fk
  FOREIGN KEY (thumbnail_file_id) REFERENCES files(id)     ON DELETE SET NULL;
ALTER TABLE boards ADD CONSTRAINT boards_template_fk
  FOREIGN KEY (template_id)       REFERENCES templates(id) ON DELETE SET NULL;
