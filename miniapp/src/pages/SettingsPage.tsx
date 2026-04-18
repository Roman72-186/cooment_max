// Настройки канала — каждый тоггл сохраняется мгновенно,
// стоп-слова и реакции — явной кнопкой «Сохранить»
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { updateChannelSettings } from '../api/backend';
import { useAppStore } from '../store/useAppStore';
import { PollSettingsEditor, type PollTemplate } from '../components/PollSettingsEditor';

// Эмодзи для реакций под постами
const PRESET_EMOJIS = ['❤️', '👍', '🔥', '😂', '😮', '😢', '👏', '🎉', '💯', '🤔', '😍', '💪', '🙏', '👎', '🤯'];

// Категории стоп-слов для модерации
interface WordCategory { name: string; words: string[]; }

const PRESET_CATEGORIES: WordCategory[] = [
  {
    name: 'Реклама и продажи',
    words: ['реклама', 'спам', 'продам', 'куплю', 'услуги', 'дешево', 'акция',
            'скидка', 'распродажа', 'бесплатно', 'даром', 'предлагаю', 'продаю',
            'цена', 'стоимость', 'оптом', 'оптовые', 'доставка', 'заказ', 'прайс'],
  },
  {
    name: 'Призывы к действию',
    words: ['подписывайся', 'подпишись', 'переходи', 'жми', 'кликай', 'вступай',
            'регистрируйся', 'пиши', 'звони', 'срочно', 'успей', 'поторопись', 'сейчас'],
  },
  {
    name: 'Мошенничество и финансы',
    words: ['заработок', 'доход', 'инвестиции', 'крипта', 'криптовалюта', 'казино',
            'ставки', 'займ', 'кредит', 'быстрые деньги', 'пассивный доход',
            'финансовая свобода', 'выигрыш', 'розыгрыш', 'конкурс', 'выиграй', 'приз'],
  },
  {
    name: 'Нежелательный контент',
    words: ['эскорт', 'интим', 'знакомства', 'порно', '18+', 'взрослый', 'секс'],
  },
  {
    name: 'Раскрутка и накрутка',
    words: ['раскрутка', 'накрутка', 'подписчики', 'лайки', 'просмотры', 'телеграм',
            'вотсап', 'вконтакте', 'инстаграм', 'канал', 'группа', 'паблик', 'реферал'],
  },
  {
    name: 'Нецензурная лексика',
    words: ['бля', 'хуй', 'пизд', 'ебан', 'сука', 'пидор', 'мудак', 'ублюдок',
            'дебил', 'идиот', 'мразь', 'чёрт'],
  },
];

// Рекомендуемые = первые 3 безопасные категории (без нецензурной лексики)
const RECOMMENDED_WORDS = PRESET_CATEGORIES.slice(0, 3).flatMap((c) => c.words);

type SectionState = 'idle' | 'saving' | 'saved' | 'error';

// Вынесен за пределы компонента — не пересоздаётся на каждом рендере
function SectionBadge({ state, errorText = 'Ошибка' }: { state: SectionState; errorText?: string }) {
  if (state === 'saving') return <span className="settings-status settings-status--saving">Сохраняю…</span>;
  if (state === 'saved')  return <span className="settings-status settings-status--saved">✓ Сохранено</span>;
  if (state === 'error')  return <span className="settings-status settings-status--error">{errorText}</span>;
  return null;
}

interface Props { channelId: number; }

export function SettingsPage({ channelId }: Props) {
  const { user, setPage, updateChannel } = useAppStore();
  const channel = user?.channels.find((c) => c.id === channelId);

  // ── Значения полей ────────────────────────────────────────────
  const [commentsEnabled, setCommentsEnabled]         = useState(channel?.comments_enabled ?? true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(channel?.notifications_enabled ?? true);
  const [reactionsEnabled, setReactionsEnabled]       = useState((channel?.post_reactions?.length ?? 0) > 0);
  const [selectedReactions, setSelectedReactions]     = useState<string[]>(channel?.post_reactions ?? []);
  const [bannedInput, setBannedInput]                 = useState(channel?.banned_words?.join(', ') ?? '');

  // ── Статусы по секциям ────────────────────────────────────────
  // ── Опрос ─────────────────────────────────────────────────────
  const [pollTemplate, setPollTemplate] = useState<PollTemplate>({
    poll_enabled: (channel as any)?.poll_enabled ?? false,
    poll_question: (channel as any)?.poll_question ?? '',
    poll_options: (channel as any)?.poll_options ?? [{ text: '' }, { text: '' }],
  });
  const [stPoll, setStPoll] = useState<SectionState>('idle');
  const timerPoll = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Статусы по секциям ────────────────────────────────────────
  const [stComments, setStComments]             = useState<SectionState>('idle');
  const [stNotifications, setStNotifications]   = useState<SectionState>('idle');
  const [stReactions, setStReactions]           = useState<SectionState>('idle');
  const [stBanned, setStBanned]                 = useState<SectionState>('idle');

  // Таймеры авто-сброса бейджа «Сохранено»
  const timerComments      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerNotifications = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerReactions     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerBanned        = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Очистка всех таймеров при размонтировании
  useEffect(() => {
    return () => {
      [timerComments, timerNotifications, timerReactions, timerBanned, timerPoll].forEach((t) => {
        if (t.current) clearTimeout(t.current);
      });
    };
  }, []);

  function autoReset(setter: (s: SectionState) => void, timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setter('idle'), 2500);
  }

  // ── Вычисляемые значения ──────────────────────────────────────
  const currentWords = useMemo(
    () => new Set(bannedInput.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean)),
    [bannedInput]
  );
  const wordCount = useMemo(
    () => bannedInput.split(',').filter((w) => w.trim().length > 0).length,
    [bannedInput]
  );

  // ── Авто-сохранение тоглов ────────────────────────────────────
  const handleCommentsToggle = async (enabled: boolean) => {
    setCommentsEnabled(enabled);
    setStComments('saving');
    try {
      const result = await updateChannelSettings(channelId, { comments_enabled: enabled });
      updateChannel({ id: channelId, comments_enabled: result.comments_enabled });
      setStComments('saved');
      autoReset(setStComments, timerComments);
    } catch {
      setCommentsEnabled(!enabled); // откат
      setStComments('error');
      autoReset(setStComments, timerComments);
    }
  };

  const handleNotificationsToggle = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    setStNotifications('saving');
    try {
      const result = await updateChannelSettings(channelId, { notifications_enabled: enabled });
      updateChannel({ id: channelId, notifications_enabled: result.notifications_enabled });
      setStNotifications('saved');
      autoReset(setStNotifications, timerNotifications);
    } catch {
      setNotificationsEnabled(!enabled); // откат
      setStNotifications('error');
      autoReset(setStNotifications, timerNotifications);
    }
  };

  // ── Сохранение реакций ────────────────────────────────────────
  const handleSaveReactions = async () => {
    const reactions = reactionsEnabled ? selectedReactions : [];
    setStReactions('saving');
    try {
      const result = await updateChannelSettings(channelId, { post_reactions: reactions });
      updateChannel({ id: channelId, post_reactions: result.post_reactions });
      // Синхронизируем локальное состояние с сервером
      setReactionsEnabled(result.post_reactions.length > 0);
      setSelectedReactions(result.post_reactions);
      setStReactions('saved');
      autoReset(setStReactions, timerReactions);
    } catch {
      setStReactions('error');
      autoReset(setStReactions, timerReactions);
    }
  };

  // ── Сохранение стоп-слов ──────────────────────────────────────
  const handleSaveBanned = async () => {
    const banned = bannedInput
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    if (banned.length > 100) {
      setStBanned('error');
      autoReset(setStBanned, timerBanned);
      return;
    }

    setStBanned('saving');
    try {
      const result = await updateChannelSettings(channelId, { banned_words: banned });
      updateChannel({ id: channelId, banned_words: result.banned_words });
      setBannedInput(result.banned_words.join(', '));
      setStBanned('saved');
      autoReset(setStBanned, timerBanned);
    } catch {
      setStBanned('error');
      autoReset(setStBanned, timerBanned);
    }
  };

  const toggleWord = useCallback((word: string) => {
    const words = bannedInput.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    setBannedInput(
      words.includes(word)
        ? words.filter((w) => w !== word).join(', ')
        : [...words, word].join(', ')
    );
  }, [bannedInput]);

  const addCategory = useCallback((categoryWords: string[]) => {
    const existing = new Set(bannedInput.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean));
    const toAdd = categoryWords.filter((w) => !existing.has(w));
    if (toAdd.length === 0) return;
    setBannedInput([...existing, ...toAdd].join(', '));
  }, [bannedInput]);

  const applyRecommended = useCallback(() => {
    addCategory(RECOMMENDED_WORDS);
  }, [addCategory]);

  const toggleEmoji = useCallback((emoji: string) => {
    setSelectedReactions(prev =>
      prev.includes(emoji)
        ? prev.filter(e => e !== emoji)
        : prev.length < 5 ? [...prev, emoji] : prev
    );
  }, []);

  // ── Сохранение настроек опроса ────────────────────────────────
  const handleSavePoll = async () => {
    if (pollTemplate.poll_enabled) {
      if (!pollTemplate.poll_question.trim()) {
        setStPoll('error');
        autoReset(setStPoll, timerPoll);
        return;
      }
      const validOptions = pollTemplate.poll_options.filter(o => o.text.trim().length > 0);
      if (validOptions.length < 2) {
        setStPoll('error');
        autoReset(setStPoll, timerPoll);
        return;
      }
    }

    setStPoll('saving');
    try {
      const cleanOptions = pollTemplate.poll_options.map(o => ({ text: o.text.trim() }));
      await updateChannelSettings(channelId, {
        poll_enabled: pollTemplate.poll_enabled,
        poll_question: pollTemplate.poll_question.trim() || null,
        poll_options: pollTemplate.poll_enabled ? cleanOptions : null,
      } as any);
      setStPoll('saved');
      autoReset(setStPoll, timerPoll);
    } catch {
      setStPoll('error');
      autoReset(setStPoll, timerPoll);
    }
  };

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
          {channel.channel_name || channel.max_chat_id}
        </div>
      </header>

      <main className="page-content">

        {/* ── Комментарии ───────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section__title-row">
            <div className="settings-section__title">Комментарии</div>
            <SectionBadge state={stComments} />
          </div>
          <label className={`toggle-row ${stComments === 'saving' ? 'toggle-row--disabled' : ''}`}>
            <div className="toggle-row__info">
              <span className="toggle-row__label">Кнопка «💬» под постами</span>
              <span className={`toggle-state ${commentsEnabled ? 'toggle-state--on' : 'toggle-state--off'}`}>
                {commentsEnabled ? 'Включено' : 'Выключено'}
              </span>
            </div>
            <input
              type="checkbox"
              className="toggle"
              checked={commentsEnabled}
              disabled={stComments === 'saving'}
              onChange={(e) => handleCommentsToggle(e.target.checked)}
            />
          </label>
          <p className="settings-section__hint">
            При отключении кнопка «💬» перестанет добавляться к новым постам.
            Уже опубликованные кнопки останутся.
          </p>
        </div>

        {/* ── Уведомления ───────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section__title-row">
            <div className="settings-section__title">Уведомления</div>
            <SectionBadge state={stNotifications} />
          </div>
          <label className={`toggle-row ${stNotifications === 'saving' ? 'toggle-row--disabled' : ''}`}>
            <div className="toggle-row__info">
              <span className="toggle-row__label">Сообщения о новых комментариях</span>
              <span className={`toggle-state ${notificationsEnabled ? 'toggle-state--on' : 'toggle-state--off'}`}>
                {notificationsEnabled ? 'Включено' : 'Выключено'}
              </span>
            </div>
            <input
              type="checkbox"
              className="toggle"
              checked={notificationsEnabled}
              disabled={stNotifications === 'saving'}
              onChange={(e) => handleNotificationsToggle(e.target.checked)}
            />
          </label>
          <p className="settings-section__hint">
            Бот пришлёт вам личное сообщение при появлении новых комментариев под постами.
          </p>
        </div>

        {/* ── Реакции под постами ────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section__title-row">
            <div className="settings-section__title">Реакции под постами</div>
            <SectionBadge state={stReactions} />
          </div>
          <label className="toggle-row">
            <div className="toggle-row__info">
              <span className="toggle-row__label">Кнопки эмодзи под постами</span>
              <span className={`toggle-state ${reactionsEnabled ? 'toggle-state--on' : 'toggle-state--off'}`}>
                {reactionsEnabled ? 'Включено' : 'Выключено'}
              </span>
            </div>
            <input
              type="checkbox"
              className="toggle"
              checked={reactionsEnabled}
              onChange={(e) => {
                setReactionsEnabled(e.target.checked);
                if (!e.target.checked) setSelectedReactions([]);
              }}
            />
          </label>

          {reactionsEnabled && (
            <>
              <p className="settings-section__hint">
                Выберите до 5 эмодзи — они появятся как кнопки под новыми постами.
              </p>
              <div className="preset-words__chips">
                {PRESET_EMOJIS.map((emoji) => {
                  const isSelected = selectedReactions.includes(emoji);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      className={`preset-chip emoji-chip${isSelected ? ' preset-chip--active' : ''}`}
                      onClick={() => toggleEmoji(emoji)}
                      disabled={!isSelected && selectedReactions.length >= 5}
                      aria-pressed={isSelected}
                      aria-label={`${emoji}${isSelected ? ' (выбрано)' : ''}`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
              <div className="settings-section__hint">
                Выбрано: {selectedReactions.length} / 5
                {selectedReactions.length === 0 && (
                  <span className="settings-hint--warn"> — выберите хотя бы один</span>
                )}
              </div>
            </>
          )}

          <button
            className="btn btn--save-section"
            onClick={handleSaveReactions}
            disabled={stReactions === 'saving' || (reactionsEnabled && selectedReactions.length === 0)}
          >
            {stReactions === 'saving' ? 'Сохраняю…' : 'Сохранить реакции'}
          </button>
        </div>

        {/* ── Стоп-слова ─────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section__title-row">
            <div className="settings-section__title">Стоп-слова</div>
            <SectionBadge state={stBanned} errorText="Максимум 100 слов" />
          </div>
          <p className="settings-section__hint">
            Комментарии с этими словами будут автоматически скрыты.
            Вводите через запятую, максимум 100 слов.
          </p>
          <textarea
            className="settings-textarea"
            aria-label="Список стоп-слов через запятую"
            placeholder="спам, реклама, ненормативная лексика..."
            value={bannedInput}
            onChange={(e) => setBannedInput(e.target.value)}
            rows={4}
          />
          <div className="settings-section__hint">
            {wordCount} / 100 слов
          </div>
          {/* Кнопка быстрого старта */}
          <button type="button" className="btn btn--recommended" onClick={applyRecommended}>
            🛡 Добавить рекомендуемые ({RECOMMENDED_WORDS.length})
          </button>

          {/* Категории стоп-слов */}
          <div className="preset-categories">
            {PRESET_CATEGORIES.map((cat) => {
              const allActive = cat.words.every((w) => currentWords.has(w));
              return (
                <div key={cat.name} className="preset-category">
                  <div className="preset-category__header">
                    <span className="preset-category__name">{cat.name}</span>
                    <button
                      type="button"
                      className={`preset-category__btn${allActive ? ' preset-category__btn--done' : ''}`}
                      onClick={() => addCategory(cat.words)}
                      disabled={allActive}
                    >
                      {allActive ? '✓ Все добавлены' : `+ Все (${cat.words.length})`}
                    </button>
                  </div>
                  <div className="preset-words__chips">
                    {cat.words.map((word) => {
                      const isActive = currentWords.has(word);
                      return (
                        <button
                          key={word}
                          type="button"
                          className={`preset-chip${isActive ? ' preset-chip--active' : ''}`}
                          onClick={() => toggleWord(word)}
                          aria-pressed={isActive}
                        >
                          {word}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            className="btn btn--save-section"
            onClick={handleSaveBanned}
            disabled={stBanned === 'saving' || wordCount > 100}
          >
            {stBanned === 'saving' ? 'Сохраняю…' : 'Сохранить стоп-слова'}
          </button>
        </div>

        {/* ── Опрос под постами ─────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section__title-row">
            <div className="settings-section__title">Опрос</div>
            <SectionBadge state={stPoll} errorText="Заполните вопрос и 2+ варианта" />
          </div>
          <p className="settings-section__hint">
            Каждый новый пост канала автоматически получит кнопки с вариантами ответа.
          </p>
          <PollSettingsEditor value={pollTemplate} onChange={setPollTemplate} />
          <button
            className="btn btn--save-section"
            onClick={handleSavePoll}
            disabled={stPoll === 'saving'}
          >
            {stPoll === 'saving' ? 'Сохраняю…' : 'Сохранить опрос'}
          </button>
        </div>

        {/* ── Опасная зона ───────────────────────────────────────── */}
        <div className="settings-section settings-section--danger">
          <div className="settings-section__title">Опасная зона</div>
          <p className="settings-section__hint">
            Чтобы отключить бота, удалите его из администраторов канала в MAX.
            Данные канала и комментарии сохранятся.
          </p>
        </div>

      </main>
    </div>
  );
}
