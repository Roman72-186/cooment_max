-- Миграция 005: шаблон опроса на уровне канала + снапшот на уровне поста
-- Аналогично post_reactions: настройка канала применяется к новым постам,
-- изменение шаблона не затрагивает уже опубликованные посты.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS poll_enabled  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS poll_question TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS poll_options  JSONB;  -- [{text: "Вариант А"}, ...]

ALTER TABLE posts ADD COLUMN IF NOT EXISTS poll_question TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS poll_options  JSONB;
