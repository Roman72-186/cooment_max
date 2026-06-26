-- Фото и стикеры в комментариях.
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS attachments_json JSONB NOT NULL DEFAULT '[]';
