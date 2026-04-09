-- ─────────────────────────────────────────────────────────────────
-- MAX Comments Platform — Схема базы данных PostgreSQL
-- ─────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────
-- ПОЛЬЗОВАТЕЛИ (владельцы каналов и комментаторы)
-- ─────────────────────────────────────────────────
CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  max_user_id    BIGINT UNIQUE NOT NULL,           -- ID пользователя в MAX
  name           TEXT,                              -- отображаемое имя
  username       TEXT,                              -- @юзернейм
  plan           VARCHAR(20) DEFAULT 'free',        -- 'free' | 'pro'
  plan_expires   TIMESTAMPTZ,                       -- NULL = бесплатно навсегда
  is_admin       BOOLEAN DEFAULT false,             -- суперадмин платформы
  ref_code       VARCHAR(16) UNIQUE,                -- реферальный код пользователя
  referred_by    BIGINT REFERENCES users(id),       -- кто пригласил
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- КАНАЛЫ: где установлен бот
-- ─────────────────────────────────────────────────
CREATE TABLE channels (
  id                   BIGSERIAL PRIMARY KEY,
  owner_id             BIGINT REFERENCES users(id),
  max_chat_id          TEXT UNIQUE NOT NULL,
  channel_name         TEXT,
  channel_type         VARCHAR(20) DEFAULT 'public',  -- 'public' | 'private'
  discussion_chat_id   TEXT,          -- скрытый групповой чат (хранилище комментариев)
  is_active            BOOLEAN DEFAULT true,
  post_count           INT DEFAULT 0,
  total_comments       INT DEFAULT 0,
  connected_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- ПОСТЫ: каждый обработанный пост канала
-- ─────────────────────────────────────────────────
CREATE TABLE posts (
  id                BIGSERIAL PRIMARY KEY,
  channel_id        BIGINT REFERENCES channels(id),
  max_message_id    TEXT NOT NULL,
  discussion_msg_id TEXT,            -- ID репоста в скрытом чате
  text_preview      TEXT,            -- первые ~200 символов
  view_count        INT DEFAULT 0,
  comment_count     INT DEFAULT 0,   -- кэш счётчика (обновляется каждые 60с)
  published_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, max_message_id)
);

-- ─────────────────────────────────────────────────
-- КОММЕНТАРИИ (с поддержкой вложенности)
-- ─────────────────────────────────────────────────
CREATE TABLE comments (
  id           BIGSERIAL PRIMARY KEY,
  post_id      BIGINT REFERENCES posts(id),
  author_id    BIGINT REFERENCES users(id),
  parent_id    BIGINT REFERENCES comments(id),  -- NULL = корневой комментарий
  text         TEXT NOT NULL CHECK (length(text) <= 2000),
  is_hidden    BOOLEAN DEFAULT false,            -- мягкое удаление / модерация
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- ПЛАТЕЖИ
-- ─────────────────────────────────────────────────
CREATE TABLE payments (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id),
  tbank_payment_id TEXT,              -- PaymentId от T-Bank
  amount_rub    NUMERIC(10,2),
  plan          VARCHAR(20),
  status        VARCHAR(20),          -- pending | succeeded | cancelled
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- ЕЖЕДНЕВНАЯ АНАЛИТИКА (агрегируется ночным job'ом)
-- ─────────────────────────────────────────────────
CREATE TABLE analytics_daily (
  id           BIGSERIAL PRIMARY KEY,
  channel_id   BIGINT REFERENCES channels(id),
  date         DATE NOT NULL,
  views        INT DEFAULT 0,
  comments     INT DEFAULT 0,
  reactions    INT DEFAULT 0,
  UNIQUE(channel_id, date)
);

-- ─────────────────────────────────────────────────
-- ИНДЕКСЫ
-- ─────────────────────────────────────────────────
CREATE INDEX idx_comments_post    ON comments(post_id);
CREATE INDEX idx_posts_channel    ON posts(channel_id);
CREATE INDEX idx_analytics_ch_dt  ON analytics_daily(channel_id, date);
CREATE INDEX idx_channels_owner   ON channels(owner_id);
