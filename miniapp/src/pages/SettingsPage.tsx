// Настройки канала: вкл/выкл комментарии, стоп-слова
import { useState, useCallback } from 'react';
import { updateChannelSettings } from '../api/backend';
import { useAppStore } from '../store/useAppStore';

interface Props {
  channelId: number;
}

export function SettingsPage({ channelId }: Props) {
  const { user, setPage, updateChannel } = useAppStore();
  const channel = user?.channels.find((c) => c.id === channelId);

  const [commentsEnabled, setCommentsEnabled] = useState(
    channel?.comments_enabled ?? true
  );
  const [bannedInput, setBannedInput] = useState(
    channel ? channel.banned_words?.join(', ') ?? '' : ''
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError(null);

    // Парсим стоп-слова: разделяем по запятой, чистим пробелы, убираем пустые
    const banned = bannedInput
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    if (banned.length > 100) {
      setError('Максимум 100 стоп-слов');
      setSaving(false);
      return;
    }

    try {
      const result = await updateChannelSettings(channelId, {
        comments_enabled: commentsEnabled,
        banned_words: banned,
      });
      // Обновляем канал в глобальном сторе
      updateChannel({
        id: channelId,
        comments_enabled: result.comments_enabled,
        banned_words: result.banned_words,
      });
      setSaved(true);
    } catch {
      setError('Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  }, [channelId, commentsEnabled, bannedInput, updateChannel]);

  if (!channel) return null;

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>
            ← Назад
          </button>
          <h1 className="page-title">Настройки</h1>
        </div>
        <div className="page-subtitle">
          {channel.channel_name ?? channel.max_chat_id}
        </div>
      </header>

      <main className="page-content">
        {/* Переключатель комментариев */}
        <div className="settings-section">
          <div className="settings-section__title">Комментарии</div>
          <label className="toggle-row">
            <span className="toggle-row__label">
              Разрешить комментарии к постам
            </span>
            <input
              type="checkbox"
              className="toggle"
              checked={commentsEnabled}
              onChange={(e) => setCommentsEnabled(e.target.checked)}
            />
          </label>
          <p className="settings-section__hint">
            При отключении кнопка «💬» перестанет добавляться к новым постам.
            Уже опубликованные кнопки останутся.
          </p>
        </div>

        {/* Стоп-слова */}
        <div className="settings-section">
          <div className="settings-section__title">Стоп-слова</div>
          <p className="settings-section__hint">
            Комментарии с этими словами будут автоматически скрыты.
            Введите слова через запятую (макс. 100).
          </p>
          <textarea
            className="settings-textarea"
            placeholder="спам, реклама, ненормативная лексика..."
            value={bannedInput}
            onChange={(e) => setBannedInput(e.target.value)}
            rows={4}
          />
          <div className="settings-section__hint">
            {bannedInput.split(',').filter((w) => w.trim()).length} / 100 слов
          </div>
        </div>

        {/* Уведомления — будущая функция */}
        <div className="settings-section settings-section--coming-soon">
          <div className="settings-section__title">Уведомления</div>
          <p className="settings-section__hint">
            Получать сообщение при новом комментарии — скоро.
          </p>
        </div>

        {/* Сохранить */}
        {error && <div className="alert alert--error">{error}</div>}
        {saved && <div className="alert alert--success">Настройки сохранены</div>}

        <button
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Сохраняю...' : 'Сохранить'}
        </button>

        {/* Опасная зона */}
        <div className="settings-section settings-section--danger">
          <div className="settings-section__title">Опасная зона</div>
          <p className="settings-section__hint">
            Чтобы отключить бота, удалите его из администраторов канала в MAX.
            Данные каналы и комментарии сохранятся.
          </p>
        </div>
      </main>
    </div>
  );
}
