-- Миграция 004: Опросы и голосования в постах
-- Применять: docker exec -i mc_postgres psql -U mcuser -d maxcomments < infra/migrations/004_polls.sql

-- Таблица опросов (один опрос на пост)
CREATE TABLE IF NOT EXISTS post_polls (
  id           BIGSERIAL PRIMARY KEY,
  post_id      BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  options_json JSONB NOT NULL,  -- [{text: "Вариант А"}, ...]
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id)               -- один опрос на пост
);

-- Голоса (один голос на пользователя на опрос)
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id     BIGINT NOT NULL REFERENCES post_polls(id) ON DELETE CASCADE,
  user_max_id BIGINT NOT NULL,
  option_idx  INT NOT NULL,
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, user_max_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON poll_votes(poll_id);
