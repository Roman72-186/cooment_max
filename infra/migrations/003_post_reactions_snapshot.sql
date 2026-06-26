-- Миграция: снапшот emoji-реакций на момент создания поста
-- Дата: 2026-04-12
-- Описание: Изменение настроек канала (post_reactions) не должно затрагивать старые посты.
--           Колонка posts.post_reactions фиксирует набор emoji на момент onPostCreated.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_reactions TEXT[] NOT NULL DEFAULT '{}';
