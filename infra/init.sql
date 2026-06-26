-- ─────────────────────────────────────────────────────────────────
-- MAX Comments Platform — Схема базы данных PostgreSQL
-- ─────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────
-- ПОЛЬЗОВАТЕЛИ (владельцы каналов и комментаторы)
-- ─────────────────────────────────────────────────
CREATE TABLE users (
  id                            BIGSERIAL PRIMARY KEY,
  max_user_id                   BIGINT UNIQUE NOT NULL,           -- ID пользователя в MAX
  name                          TEXT,                              -- отображаемое имя
  username                      TEXT,                              -- @юзернейм
  plan                          VARCHAR(20) DEFAULT 'free',        -- 'free' | 'pro'
  plan_expires                  TIMESTAMPTZ,                       -- NULL = бесплатно навсегда
  is_admin                      BOOLEAN DEFAULT false,             -- суперадмин платформы
  ref_code                      VARCHAR(16) UNIQUE,                -- реферальный код пользователя
  referred_by                   BIGINT REFERENCES users(id),       -- кто пригласил
  reply_notifications_enabled   BOOLEAN NOT NULL DEFAULT true,     -- получать DM когда ответили на комментарий
  created_at                    TIMESTAMPTZ DEFAULT NOW()
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
  view_count          INT DEFAULT 0,
  comment_count       INT DEFAULT 0,   -- кэш счётчика (обновляется каждые 60с)
  published_at        TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at    TIMESTAMPTZ,     -- последнее создание/удаление комментария; используется updateCounters для старых постов
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
  attachments_json JSONB NOT NULL DEFAULT '[]',  -- фото/стикеры в комментарии
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
-- РЕФЕРАЛЬНЫЕ НАЧИСЛЕНИЯ
-- ─────────────────────────────────────────────────
CREATE TABLE referral_rewards (
  id                    BIGSERIAL PRIMARY KEY,
  referrer_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id            BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  reward_type           TEXT NOT NULL CHECK (reward_type IN ('first_pro_days', 'commission')),
  reward_days           INT NOT NULL DEFAULT 0 CHECK (reward_days >= 0),
  commission_percent    INT NOT NULL DEFAULT 0 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  commission_amount_rub NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (commission_amount_rub >= 0),
  paid_referrals_count  INT NOT NULL DEFAULT 0 CHECK (paid_referrals_count >= 0),
  status                TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'paid', 'cancelled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- РУЧНЫЕ КОРРЕКТИРОВКИ РЕФЕРАЛЬНОГО БАЛАНСА
-- ─────────────────────────────────────────────────
CREATE TABLE referral_balance_adjustments (
  id             BIGSERIAL PRIMARY KEY,
  referrer_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  amount_rub     NUMERIC(10,2) NOT NULL CHECK (amount_rub <> 0),
  reason         TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE INDEX idx_comments_post       ON comments(post_id);
CREATE INDEX idx_posts_channel       ON posts(channel_id);
CREATE INDEX idx_analytics_ch_dt     ON analytics_daily(channel_id, date);
CREATE INDEX idx_channels_owner      ON channels(owner_id);

-- Индексы для фоновых job-ов: updateCounters, sendNotifications, getRecentActivePosts
CREATE INDEX idx_comments_created_at  ON comments(created_at);          -- подзапрос OR-ветки в getRecentActivePosts
CREATE INDEX idx_posts_published_at   ON posts(published_at);           -- первая ветка WHERE в getRecentActivePosts
CREATE INDEX idx_posts_last_activity  ON posts(last_activity_at) WHERE last_activity_at IS NOT NULL; -- третья OR-ветка: удаление комментариев на старых постах
CREATE INDEX idx_comments_post_vis    ON comments(post_id) WHERE is_hidden = false; -- getCommentCount (каждые 60 с)
CREATE INDEX idx_comments_author_id   ON comments(author_id);           -- LEFT JOIN users в GET /api/comments и /feed
CREATE INDEX idx_comments_post_visible_id ON comments(post_id, id) WHERE is_hidden = false;
CREATE INDEX idx_comments_post_visible_created_id ON comments(post_id, created_at, id) WHERE is_hidden = false;
CREATE INDEX idx_posts_channel_published_comments ON posts(channel_id, published_at DESC, comment_count DESC);
CREATE UNIQUE INDEX idx_referral_rewards_first_once ON referral_rewards(referrer_id, referred_user_id) WHERE reward_type = 'first_pro_days';
CREATE UNIQUE INDEX idx_referral_rewards_payment_type ON referral_rewards(payment_id, reward_type) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_referral_rewards_referrer ON referral_rewards(referrer_id, created_at DESC);
CREATE INDEX idx_referral_rewards_referred ON referral_rewards(referred_user_id, created_at DESC);
CREATE INDEX idx_referral_adjustments_referrer ON referral_balance_adjustments(referrer_id, created_at DESC);
CREATE INDEX idx_referral_adjustments_created ON referral_balance_adjustments(created_at DESC);
CREATE INDEX idx_users_referred_by ON users(referred_by);

-- ─────────────────────────────────────────────────
-- МИГРАЦИИ (применяются к уже развёрнутой БД)
-- ─────────────────────────────────────────────────
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS last_notified_at    TIMESTAMPTZ;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true;

-- Колонки для постов и каналов (реакции, комментарии, стоп-слова)
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS attachments_json   JSONB    NOT NULL DEFAULT '[]';
ALTER TABLE comments ADD COLUMN IF NOT EXISTS attachments_json   JSONB    NOT NULL DEFAULT '[]';
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS comments_enabled   BOOLEAN  NOT NULL DEFAULT true;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS comments_enabled   BOOLEAN  NOT NULL DEFAULT true;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS banned_words       TEXT[]   NOT NULL DEFAULT '{}';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS post_reactions     TEXT[]   NOT NULL DEFAULT '{}';

-- Счётчики реакций под постами (инициализируются при создании поста)
CREATE TABLE IF NOT EXISTS post_reaction_counts (
  post_id  BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  emoji    TEXT   NOT NULL,
  count    INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, emoji)
);

-- Реакции пользователей под постами: один пользователь — одна реакция на пост
CREATE TABLE IF NOT EXISTS post_user_reactions (
  post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  max_user_id BIGINT NOT NULL,
  emoji       TEXT   NOT NULL,
  PRIMARY KEY (post_id, max_user_id)
);

-- Реакции пользователей на комментарии: каждый emoji независим
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      TEXT   NOT NULL DEFAULT '❤️',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id, emoji)
);

-- Бан пользователей владельцем канала
CREATE TABLE IF NOT EXISTS channel_bans (
  id            SERIAL PRIMARY KEY,
  channel_id    INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  banned_max_id BIGINT  NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, banned_max_id)
);

-- Подписки пользователей на уведомления о новых комментариях под постом
CREATE TABLE IF NOT EXISTS post_subscriptions (
  id                SERIAL PRIMARY KEY,
  post_id           INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_max_id       BIGINT  NOT NULL,
  last_notified_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_max_id)
);

CREATE INDEX IF NOT EXISTS idx_post_subscriptions_post_last_notified
  ON post_subscriptions(post_id, last_notified_at);

-- Очередь уведомлений об ответах на комментарии
-- Backend пишет при создании reply, бот читает и отправляет DM
CREATE TABLE IF NOT EXISTS reply_notifications (
  id                    SERIAL PRIMARY KEY,
  reply_comment_id      BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  recipient_max_user_id BIGINT NOT NULL,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Partial index: быстрый поиск неотправленных уведомлений (sent_at IS NULL)
-- Незначительный размер — только «живые» строки попадают в индекс
CREATE INDEX IF NOT EXISTS idx_reply_notif_unsent ON reply_notifications(created_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reply_notifications_unsent_created_id ON reply_notifications(created_at, id) WHERE sent_at IS NULL;

-- idx_comments_author_id уже создан выше в секции ИНДЕКСЫ (строка 104)

-- ─────────────────────────────────────────────────
-- СНАПШОТ EMOJI-РЕАКЦИЙ НА МОМЕНТ СОЗДАНИЯ ПОСТА
-- (migration 003: изменение настроек канала не трогает старые посты)
-- ─────────────────────────────────────────────────
ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_reactions TEXT[] NOT NULL DEFAULT '{}';

-- ─────────────────────────────────────────────────
-- ДИНАМИЧЕСКИЕ НАСТРОЙКИ ПЛАТФОРМЫ
-- (migration 001: цена и длительность PRO через admin panel)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─────────────────────────────────────────────────
-- ПРОМО-КОДЫ
-- (migration 002)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id               BIGSERIAL PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,
  discount_percent INT  NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  max_uses         INT,
  used_count       INT  NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Новые колонки в payments (migration 002)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS promo_code       TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_percent INT;
