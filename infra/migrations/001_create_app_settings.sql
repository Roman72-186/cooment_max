-- Миграция: создание таблицы app_settings для хранения настроек платформы
-- Дата: 2026-04-11
-- Описание: Таблица для динамического управления ценой и длительностью PRO-подписки

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Начальные значения (по умолчанию будут использоваться если строк нет)
-- Можно раскомментировать если нужно задать явные дефолты:
-- INSERT INTO app_settings (key, value) VALUES ('pro_price_rub', '299') ON CONFLICT DO NOTHING;
-- INSERT INTO app_settings (key, value) VALUES ('pro_days', '30') ON CONFLICT DO NOTHING;

COMMENT ON TABLE app_settings IS 'Глобальные настройки платформы (цена PRO, длительность подписки и т.д.)';
COMMENT ON COLUMN app_settings.key IS 'Ключ настройки (например: pro_price_rub, pro_days)';
COMMENT ON COLUMN app_settings.value IS 'Значение настройки в виде строки';
